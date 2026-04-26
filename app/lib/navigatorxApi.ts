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
  suggest_alternatives?: boolean;
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
  reroute?: boolean;
  startEdgeId?: number;
}

export interface AlternativeRoutesResponse {
  data: {
    alternative_routes: RouteCRPResponse[];
  };
}



// for https://github.com/lintang-b-s/Navigatorx
export const fetchRouteCRP = async ({
  srcLat,
  srcLon,
  destLat,
  destLon,
  reroute = false,
  startEdgeId,
}: RouteRequest): Promise<RouteCRPResponseWrapper> => {
  try {
    let url = `${process.env.NEXT_PUBLIC_ROUTER_API_URL}/api/computeRoutes?origin_lat=${srcLat}&origin_lon=${srcLon}&destination_lat=${destLat}&destination_lon=${destLon}${reroute ? "&reroute=true" : ""}`;

    if (startEdgeId !== undefined && startEdgeId !== -1) {
      url += `&start_edge_id=${startEdgeId}`;
    }

    const { data } = await axios.get(url, {});

    return data;
  } catch (error: any) {
    if (error.response) {
      if (error.response.status === 502) {
        throw new Error("navigatorx routing engine sedang ada perbaikan");
      } else if (error.response.status === 400) {
        const backendMessage =
          error.response.data?.message ||
          error.response.data?.error ||
          error.response.data?.detail;

        if (typeof backendMessage === "string" && backendMessage.trim()) {
          throw new Error(backendMessage);
        }

        throw new Error("Bad request");
      } else {
        throw new Error(
          `Server error (${error.response.status}): ${error.response.statusText}`
        );
      }
    } else {
      throw new Error("navigatorx routing engine sedang ada perbaikan");
    }
  }
};

export const fetchAlternativeRoutes = async ({
  srcLat,
  srcLon,
  destLat,
  destLon,
  reroute = false,
  startEdgeId,
}: RouteRequest): Promise<AlternativeRoutesResponse> => {
  try {
    let url = `${process.env.NEXT_PUBLIC_ROUTER_API_URL}/api/computeAlternativeRoutes?origin_lat=${srcLat}&origin_lon=${srcLon}&destination_lat=${destLat}&destination_lon=${destLon}&k=2${reroute ? "&reroute=true" : ""}`;

    if (startEdgeId !== undefined && startEdgeId !== -1) {
      url += `&start_edge_id=${startEdgeId}`;
    }

    const { data } = await axios.get(url, {});

    return data;
  } catch (error) {
    throw new Error("Failed to fetch search results");
  }
};


