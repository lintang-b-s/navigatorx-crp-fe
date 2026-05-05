import axios from "axios";
import toast from "react-hot-toast";
import geohash from "ngeohash";




export class WasmMapMatcher {
    private isReady = false;
    private currentTile: string | null = null;
    private isInitializing = false;
    private apiUrl = process.env.NEXT_PUBLIC_ROUTER_API_URL || "http://localhost:6060";

    async init() {
        if (this.isReady || this.isInitializing) return;
        this.isInitializing = true;

        const toastId = toast.loading("Initializing WASM Online Map Matcher...");
        try {
            // 1. Load wasm_exec.js if not already present
            if (!(window as any).Go) {
                await this.loadScript(`/wasm_exec.js?v=${Date.now()}`);
            }

            // 2. Instantiate WASM
            const go = new (window as any).Go();
            const result = await WebAssembly.instantiateStreaming(
                fetch(`/online_map_matcher.wasm?v=${Date.now()}`),
                go.importObject
            );
            go.run(result.instance);
            
            // 3. Wait for Go to initialize functions (race condition prevention)
            let retries = 0;
            const maxRetries = 50;
            while (!(window as any).InitializeMapMatchingGraph && retries < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, 100));
                retries++;
            }

            if (!(window as any).InitializeMapMatchingGraph) {
                throw new Error("Go WASM failed to export functions to window within 5 seconds");
            }

            // 4. Initialize Graph with metadata

            const response = await axios.get(`${this.apiUrl}/api/tile-init`);

            
            const number_of_vertices = response.data?.data?.number_of_vertices;
            
            if (typeof number_of_vertices !== 'number') {
                throw new Error(`Invalid number_of_vertices received: ${number_of_vertices}. Check if backend is running on ${this.apiUrl}`);
            }


            const matrixResponse = await axios.get(`${this.apiUrl}/api/tile-init-transition-matrix`, {
                responseType: 'arraybuffer'
            });
            const matrixBytes = new Uint8Array(matrixResponse.data);


            (window as any).InitializeMapMatchingGraph(number_of_vertices, matrixBytes);


            this.isReady = true;
            toast.success("WASM Engine Ready", { id: toastId });
        } catch (error: any) {
            console.error("WASM Init Error:", error);
            toast.error(`WASM Init Failed: ${error.message}`, { id: toastId });
            this.isInitializing = false;
        }
    }

    private loadScript(src: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = src;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
            document.head.appendChild(script);
        });
    }

    async loadTile(lat: number, lon: number) {
        if (!this.isReady) return;

        const gh = geohash.encode(lat, lon, 6);
        if (this.currentTile === gh) return;
        // only RebuildMapMatchGraph jika current user gehoash tile berubah...
        try {

            const response = await axios.get(`${this.apiUrl}/api/tile/${gh}`, {
                responseType: 'arraybuffer'
            });
            
            const tileData = new Uint8Array(response.data);
            (window as any).RebuildMapMatchGraph(tileData);
            this.currentTile = gh;

        } catch (error) {
            console.warn(`[WasmMapMatcher] Failed to load tile ${gh}:`, error);
        }
    }


    onlineMapMatch(gpsPoint: any, k: number, candidates: any[], speedMeanK: number, speedStdK: number, lastBearing: number) {
        if (!this.isReady || !(window as any).OnlineMapMatch) return null;
        
        return (window as any).OnlineMapMatch(
            gpsPoint,
            k,
            candidates,
            speedMeanK,
            speedStdK,
            lastBearing
        );
    }

    reset() {
        if (this.isReady && (window as any).InitializeMapMatchingGraph) {
            this.currentTile = null;
        }
    }

}

export const wasmMapMatcher = new WasmMapMatcher();
