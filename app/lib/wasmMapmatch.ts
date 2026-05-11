import * as Comlink from "comlink";
import toast from "react-hot-toast";
import type { Candidate, Gps } from "./mapmatchApi";
import type { WasmMapMatcherWorkerApi } from "./wasmMapMatch.worker";

export class WasmMapMatcher {
  private isReady = false;
  private isInitializing = false;
  private apiUrl =
    process.env.NEXT_PUBLIC_ROUTER_API_URL ?? "http://localhost:6060";
  private worker: Worker | null = null;
  private workerApi: Comlink.Remote<WasmMapMatcherWorkerApi> | null = null;
  private initPromise: Promise<void> | null = null;

  async init() {
    if (this.isReady) return;
    if (this.initPromise) return this.initPromise;

    this.isInitializing = true;

    const toastId = toast.loading("Initializing WASM Online Map Matcher...");
    this.initPromise = this.initializeWorker(toastId);

    try {
      await this.initPromise;
    } catch (error) {
      this.initPromise = null;
      throw error;
    }
  }

  private async initializeWorker(toastId: string) {
    try {
      this.ensureWorker();
      await this.workerApi?.init({ apiUrl: this.apiUrl });

      this.isReady = true;
      this.isInitializing = false;
      toast.success("WASM Engine Ready", { id: toastId });
    } catch (error: unknown) {
      console.error("WASM Init Error:", error);
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`WASM Init Failed: ${message}`, { id: toastId });
      this.isInitializing = false;
      throw error;
    }
  }

  private ensureWorker() {
    if (this.workerApi) return;

    this.worker = new Worker(
      new URL("./wasmMapMatch.worker.ts", import.meta.url),
      {
        type: "module",
      },
    );
    this.workerApi = Comlink.wrap<WasmMapMatcherWorkerApi>(this.worker);
  }

  async loadTile(lat: number, lon: number): Promise<void> {
    if (!this.isReady) return;

    this.ensureWorker();
    try {
      await this.workerApi?.loadTile(lat, lon);
    } catch (error) {
      console.warn("[WasmMapMatcher] Failed to schedule tile load:", error);
    }
  }

  async onlineMapMatch(
    gpsPoint: Gps,
    k: number,
    candidates: Candidate[],
    speedMeanK: number,
    speedStdK: number,
    lastBearing: number,
  ) {
    if (!this.isReady) return null;

    this.ensureWorker();
    return this.workerApi?.onlineMapMatch(
      gpsPoint,
      k,
      candidates,
      speedMeanK,
      speedStdK,
      lastBearing,
    );
  }

  reset() {
    void this.workerApi?.reset();
  }
}

export const wasmMapMatcher = new WasmMapMatcher();
