import * as Comlink from "comlink";
import { fetchRouteCRP, fetchAlternativeRoutes, RouteRequest } from "./navigatorxApi";
import polyline from "@mapbox/polyline";
import { LineData } from "@/app/types/definition";

export class RoutingWorker {
  public async fetchAndProcessRoutes(reqBody: RouteRequest, includeAlternatives: boolean = true) {
    try {
      let newSpRouteData: any;
      let alternativeRouteData: any = { data: { alternative_routes: [] } };

      if (includeAlternatives) {
        [newSpRouteData, alternativeRouteData] = await Promise.all([
          fetchRouteCRP(reqBody),
          fetchAlternativeRoutes(reqBody),
        ]);
      } else {
        [newSpRouteData] = await Promise.all([fetchRouteCRP(reqBody)]);
      }

      newSpRouteData.data.distance = parseFloat(
        (newSpRouteData.data.distance / 1000).toFixed(2),
      );
      
      const newAlternatives = alternativeRouteData?.data?.alternative_routes || [];
      newAlternatives.forEach((alt: any) => {
        alt.distance = parseFloat((alt.distance / 1000).toFixed(2));
      });

      const combinedRoutes = [newSpRouteData.data, ...newAlternatives];

      const coords = polyline.decode(newSpRouteData.data.path);
      const mainLineData: LineData = {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: coords.map((coord) => [coord[1], coord[0]]),
        },
      };

      let alternativeRoutesLineData: LineData[] = [];
      if (newAlternatives.length > 0) {
        const alternativesPolyline = newAlternatives.map((route: any) => {
          const decodedCoords = polyline.decode(route.path);
          return {
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: decodedCoords.map((coord) => [coord[1], coord[0]]),
            },
          } as LineData;
        });

        const dummyRoute: LineData = {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [-100, 40],
              [-100, 40],
            ],
          },
        };

        alternativeRoutesLineData = [dummyRoute, ...alternativesPolyline];
      }

      return {
        combinedRoutes,
        mainLineData,
        alternativeRoutesLineData,
      };
    } catch (error: any) {
        // Need to serialize error because Error objects don't pass through Comlink well sometimes
        throw new Error(error?.message || "Unknown error in RoutingWorker");
    }
  }
}

Comlink.expose(new RoutingWorker());
