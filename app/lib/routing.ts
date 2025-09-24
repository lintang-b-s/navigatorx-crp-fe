import { GPSTrace } from "../types/definition";
import { Direction, RouteCRPResponse, RouteResponse } from "./navigatorxApi";
import { haversineDistance } from "./util";

export function isUserOffTheRoute({
  snappedEdgeID,
  snappedGPSLoc,
  routeData,
}: {
  snappedEdgeID: number;
  snappedGPSLoc: GPSTrace;
  routeData: RouteResponse;
}): boolean {
  let isOffRoute = true;
  for (let i = 0; i < routeData.driving_directions.length; i++) {
    const direction = routeData.driving_directions[i];
    for (let j = 0; j < direction.edge_ids.length; j++) {
      const directionEdgeID = direction.edge_ids[j];
      if (snappedEdgeID === directionEdgeID) {
        isOffRoute = false;
        break;
      }
    }
  }

  if (!isOffRoute) {
    return isOffRoute;
  }

  return true;
}



export function getCurrentUserDirectionIndex({
  snappedEdgeID,
  snappedGPSLoc,
  drivingDirections,
}: {
  snappedEdgeID: number;
  snappedGPSLoc: GPSTrace;
  drivingDirections: Direction[];
}): number {
  let directionIndex = 1;
  for (let i = 0; i < drivingDirections.length; i++) {
    const direction = drivingDirections[i];
    for (let j = 0; j < direction.edge_ids.length; j++) {
      const directionEdgeID = direction.edge_ids[j];
      if (snappedEdgeID === directionEdgeID) {
        directionIndex = i;
        break;
      }
    }
  }

  return directionIndex;
}

export function getDistanceFromUserToNextTurn({
  snappedGPSLoc,
  nextTurnPoint,
}: {
  snappedGPSLoc: GPSTrace;
  nextTurnPoint: {
    lat: number;
    lon: number;
  };
}): number {
  return haversineDistance(
    snappedGPSLoc.lat,
    snappedGPSLoc.lon,
    nextTurnPoint.lat,
    nextTurnPoint.lon
  );
}
