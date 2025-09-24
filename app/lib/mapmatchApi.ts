// https://navigatorx.lintangbs.my.id/mapmatch/api/map-match/map-matching

import axios from "axios";
import { GPSTrace } from "../types/definition";

export interface Coord {
  lat: number;
  lon: number;
}

export interface Observation {
  observation: Coord;
  snapped_edge_id: number;
}

export interface MapMatchResponse {
  path: string;
  projection_coordinates: Coord[];
  observations: Observation[];
}

export const fetchMapMatch = async (
  latlons: GPSTrace[]
): Promise<MapMatchResponse> => {
  try {
    const { data } = await axios.post(
      `https://navigatorx.lintangbs.my.id/mapmatch/api/map-match/map-matching`,
      {
        coordinates: latlons,
      }
    );

    return data;
  } catch (error) {
    throw new Error("Failed to fetch search results");
  }
};
