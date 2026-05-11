import * as Comlink from "comlink";
import geohash from "ngeohash";
import type { Candidate, Gps, MatchedGpsPoint } from "./mapmatchApi";

interface InitOptions {
  apiUrl: string;
}

declare global {
  var Go: new () => {
    importObject: WebAssembly.Imports;
    run: (instance: WebAssembly.Instance) => Promise<void>;
  };
  var InitializeMapMatchingGraph: (
    vertices: number,
    matrix: Uint8Array,
  ) => void;
  var RebuildMapMatchGraph: (tileData: Uint8Array) => void;
  var OnlineMapMatch: (
    gpsPoint: Gps,
    k: number,
    candidates: Candidate[],
    speedMeanK: number,
    speedStdK: number,
    lastBearing: number,
  ) => {
    matched_gps_point: MatchedGpsPoint;
    candidates: Candidate[];
    speed_mean_k: number;
    speed_std_k: number;
    edge_initial_bearing: number;
  };
}

class WasmMapMatcherWorker {
  private isReady = false;
  private currentTile: string | null = null;
  private requestedTile: string | null = null;
  private loadingTiles = new Set<string>();
  private isInitializing = false;
  private initPromise: Promise<void> | null = null;
  private apiUrl = "http://localhost:6060";

  async init(options: InitOptions) {
    this.apiUrl = options.apiUrl;

    if (this.isReady) return;
    if (this.initPromise) return this.initPromise;

    this.isInitializing = true;
    this.initPromise = this.initialize();

    try {
      await this.initPromise;
    } catch (error) {
      this.initPromise = null;
      this.isInitializing = false;
      throw error;
    }
  }

  private async initialize() {
    if (!globalThis.Go) {
      await import(/* webpackIgnore: true */ `/wasm_exec.js?v=${Date.now()}`);
    }

    const go = new globalThis.Go();
    const wasmResponse = await fetch(
      `/online_map_matcher.wasm?v=${Date.now()}`,
    );

    if (!wasmResponse.ok) {
      throw new Error(`Failed to load WASM binary: ${wasmResponse.status}`);
    }

    const result = await WebAssembly.instantiateStreaming(
      wasmResponse,
      go.importObject,
    );
    void go.run(result.instance);

    let retries = 0;
    const maxRetries = 50;
    while (!globalThis.InitializeMapMatchingGraph && retries < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      retries++;
    }

    if (!globalThis.InitializeMapMatchingGraph) {
      throw new Error("Go WASM failed to export functions within 5 seconds");
    }

    const initResponse = await fetch(`${this.apiUrl}/api/tile-init`);
    if (!initResponse.ok) {
      throw new Error(`Failed to fetch tile metadata: ${initResponse.status}`);
    }

    const initPayload = await initResponse.json();
    const numberOfVertices = initPayload?.data?.number_of_vertices;
    if (typeof numberOfVertices !== "number") {
      throw new Error(
        `Invalid number_of_vertices received: ${numberOfVertices}. Check if backend is running on ${this.apiUrl}`,
      );
    }

    const matrixResponse = await fetch(
      `${this.apiUrl}/api/tile-init-transition-matrix`,
    );
    if (!matrixResponse.ok) {
      throw new Error(
        `Failed to fetch transition matrix: ${matrixResponse.status}`,
      );
    }

    const matrixBytes = new Uint8Array(await matrixResponse.arrayBuffer());
    globalThis.InitializeMapMatchingGraph(numberOfVertices, matrixBytes);

    this.isReady = true;
    this.isInitializing = false;
  }

  async loadTile(lat: number, lon: number) {
    if (!this.isReady) return;

    const gh = geohash.encode(lat, lon, 6);
    if (this.currentTile === gh) return;
    this.requestedTile = gh;
    if (this.loadingTiles.has(gh)) return;

    this.loadingTiles.add(gh);
    try {
      const response = await fetch(`${this.apiUrl}/api/tile/${gh}`);
      if (!response.ok) {
        throw new Error(`Tile ${gh} request failed: ${response.status}`);
      }

      const tileData = new Uint8Array(await response.arrayBuffer());
      if (this.requestedTile !== gh) return;

      globalThis.RebuildMapMatchGraph(tileData);
      this.currentTile = gh;
    } catch (error) {
      console.warn(`[WasmMapMatcherWorker] Failed to load tile ${gh}:`, error);
    } finally {
      this.loadingTiles.delete(gh);
    }
  }

  onlineMapMatch(
    gpsPoint: Gps,
    k: number,
    candidates: Candidate[],
    speedMeanK: number,
    speedStdK: number,
    lastBearing: number,
  ) {
    if (!this.isReady || !globalThis.OnlineMapMatch) return null;

    return globalThis.OnlineMapMatch(
      gpsPoint,
      k,
      candidates,
      speedMeanK,
      speedStdK,
      lastBearing,
    );
  }

  reset() {
    this.currentTile = null;
    this.requestedTile = null;
  }

  getStatus() {
    return {
      isReady: this.isReady,
      isInitializing: this.isInitializing,
      currentTile: this.currentTile,
      requestedTile: this.requestedTile,
    };
  }
}

const workerApi = new WasmMapMatcherWorker();

Comlink.expose(workerApi);

export type WasmMapMatcherWorkerApi = typeof workerApi;
