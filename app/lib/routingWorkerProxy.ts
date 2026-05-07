import * as Comlink from "comlink";
import type { RoutingWorker } from "./routing.worker";

let routingWorker: Comlink.Remote<RoutingWorker>;

if (typeof window !== "undefined") {
  routingWorker = Comlink.wrap<RoutingWorker>(
    new Worker(new URL("./routing.worker.ts", import.meta.url), {
      type: "module",
    }),
  );
}

export { routingWorker };
