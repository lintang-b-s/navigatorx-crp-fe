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
  // Build a Set for O(1) lookup instead of nested O(D×E) loops
  for (const direction of routeData.driving_directions) {
    for (const edgeID of direction.edge_ids) {
      if (snappedEdgeID === edgeID) {
        return false;
      }
    }
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
