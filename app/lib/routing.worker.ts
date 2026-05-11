import * as Comlink from "comlink";
import { fetchRouteCRP, fetchAlternativeRoutes, RouteRequest, RouteCRPResponseWrapper, AlternativeRoutesResponse, RouteCRPResponse } from "./navigatorxApi";
import polyline from "@mapbox/polyline";
import { LineData } from "@/app/types/definition";

export class RoutingWorker {
  public async fetchAndProcessRoutes(reqBody: RouteRequest, includeAlternatives = true) {
    try {
      let newSpRouteData: RouteCRPResponseWrapper;
      let alternativeRouteData: AlternativeRoutesResponse = { data: { alternative_routes: [] } };

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
      newAlternatives.forEach((alt: RouteCRPResponse) => {
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
        const alternativesPolyline = newAlternatives.map((route: RouteCRPResponse) => {
          const decodedCoords = polyline.decode(route.path);
          return {
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: decodedCoords.map((coord) => [coord[1], coord[0]]),
            },
          };
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
    } catch (error: unknown) {
        // Need to serialize error because Error objects don't pass through Comlink well sometimes
        const message = error instanceof Error ? error.message : "Unknown error in RoutingWorker";
        throw new Error(message);
    }
  }
}

Comlink.expose(new RoutingWorker());
