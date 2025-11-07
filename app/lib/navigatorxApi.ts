import axios from "axios";

export interface Direction {
  instruction: string;
  turn_point: {
    lat: number;
    lon: number;
  };
  street_name: string;
  travel_time: number;
  distance: number;
  edge_ids: number[];
  polyline: string;
  turn_bearing: number;
  turn_type: string;
}

export interface CumulativeDirection extends Direction {
  cumulativeEta: number;
  cumulativeDistance: number;
}

export interface RouteResponse {
  path: string;
  distance: number;
  travel_time: number;
  driving_directions: Direction[];
  found: boolean;
  algorithm: string;
}

export interface RouteCRPResponse {
  travel_time: number;
  path: string;
  distance: number;
  driving_directions: Direction[];
}

export interface RouteCRPResponseWrapper {
  data: RouteCRPResponse;
}

export interface RouteRequest {
  srcLat: number;
  srcLon: number;
  destLat: number;
  destLon: number;
}

export interface AlternativeRoutesResponse {
  data: {
    alternative_routes: RouteCRPResponse[];
  };
}
// for https://github.com/lintang-b-s/navigatorX-CH
export const fetchRoute = async ({
  srcLat,
  srcLon,
  destLat,
  destLon,
}: RouteRequest): Promise<RouteResponse> => {
  try {
    const { data } = await axios.get(
      `http://localhost:5000/api/navigations/shortest-path?src_lat=${srcLat}&src_lon=${srcLon}&dst_lat=${destLat}&dst_lon=${destLon}`,
      {}
    );

    return data;
  } catch (error) {
    throw new Error("Failed to fetch search results");
  }
};

// for https://github.com/lintang-b-s/Navigatorx
export const fetchRouteCRP = async ({
  srcLat,
  srcLon,
  destLat,
  destLon,
}: RouteRequest): Promise<RouteCRPResponseWrapper> => {
  try {
    const { data } = await axios.get(
      `https://navigatorx.lintangbs.my.id/api/computeRoutes?origin_lat=${srcLat}&origin_lon=${srcLon}&destination_lat=${destLat}&destination_lon=${destLon}`,
      {}
    );

    return data;
  } catch (error: any) {
    if (error.response) {
      if (error.response.status === 502) {
        throw new Error("navigatorx routing engine sedang ada perbaikan");
      } else {
        throw new Error(
          `Server error (${error.response.status}): ${error.response.statusText}`
        );
      }
    } else {
      throw new Error("fetch route error");
    }
  }
};

export const fetchAlternativeRoutes = async ({
  srcLat,
  srcLon,
  destLat,
  destLon,
}: RouteRequest): Promise<AlternativeRoutesResponse> => {
  try {
    const { data } = await axios.get(
      `https://navigatorx.lintangbs.my.id/api/computeAlternativeRoutes?origin_lat=${srcLat}&origin_lon=${srcLon}&destination_lat=${destLat}&destination_lon=${destLon}&k=2`,
      {}
    );

    return data;
  } catch (error) {
    throw new Error("Failed to fetch search results");
  }
};
