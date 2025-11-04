import { Coord, Gps } from "./mapmatchApi";
import { Direction, RouteCRPResponse } from "./navigatorxApi";
import { haversineDistance } from "./util";

export function isUserOffTheRoute({
  snappedEdgeID,
  routeData,
}: {
  snappedEdgeID: number;
  routeData: RouteCRPResponse;
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
  drivingDirections,
}: {
  snappedEdgeID: number;
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
  matchedGpsLoc,
  nextTurnPoint,
}: {
  matchedGpsLoc: Coord;
  nextTurnPoint: {
    lat: number;
    lon: number;
  };
}): number {
  return haversineDistance(
    matchedGpsLoc.lat,
    matchedGpsLoc.lon,
    nextTurnPoint.lat,
    nextTurnPoint.lon
  );
}
