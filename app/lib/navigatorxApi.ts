import axios from "axios";

/**
 * A single step in the navigation instructions (e.g., "Turn Left onto Main St").
 */
export interface Direction {
  instruction: string;
  annotation?: {
    duration: number[];
    distance: number[];
    geometry: string;
    segment_ids: number[];
    segment_geometry_offset: number[];
    edge_ids?: number[];
  };
  turn_point: {
    lat: number;
    lon: number;
  };
  street_name: string;
  travel_time: number; // Duration of this specific segment in minutes
  distance: number; // Distance of this specific segment in Kilometers
  turn_bearing: number;
  turn_type: string;
  suggest_alternatives?: boolean; // Indicates if the backend recommends checking alternatives here
}

/**
 * Enhanced direction interface with cumulative progress used for UI listing.
 */
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
  useAnnotation: boolean;
}

export interface AlternativeRoutesResponse {
  data: {
    routes: RouteCRPResponse[];
  };
}

export interface BoundingBoxResponse {
  min_lat: number;
  min_lon: number;
  max_lat: number;
  max_lon: number;
}

export interface BoundingBoxWrapper {
  data: BoundingBoxResponse;
}

const getRouteError = (error: unknown): Error => {
  if (axios.isAxiosError(error) && error.response) {
    if (error.response.status === 502) {
      return new Error("navigatorx routing engine sedang ada perbaikan");
    } else if (error.response.status === 400) {
      const backendMessage = (error.response.data?.error?.message ??
        error.response.data?.message ??
        (typeof error.response.data?.error === "string"
          ? error.response.data.error
          : undefined)) as string | undefined;

      if (typeof backendMessage === "string" && backendMessage.trim()) {
        return new Error(backendMessage);
      }

      return new Error("Bad request");
    } else {
      const backendMessage = error.response.data?.error?.message;
      if (typeof backendMessage === "string" && backendMessage.trim()) {
        return new Error(backendMessage);
      }
      return new Error(
        `Server error (${error.response.status}): ${error.response.statusText}`,
      );
    }
  }
  return new Error("navigatorx routing engine sedang ada perbaikan");
};

// for https://github.com/lintang-b-s/Navigatorx
export const fetchRouteCRP = async ({
  srcLat,
  srcLon,
  destLat,
  destLon,
  reroute = false,
  startEdgeId,
  useAnnotation,
}: RouteRequest): Promise<RouteCRPResponseWrapper> => {
  try {
    let url = `${process.env.NEXT_PUBLIC_ROUTER_API_URL}/api/computeRoutes?origin_lat=${srcLat}&origin_lon=${srcLon}&destination_lat=${destLat}&destination_lon=${destLon}&useAnnotation=${useAnnotation}${reroute ? "&reroute=true" : ""}`;

    if (startEdgeId !== undefined && startEdgeId !== -1) {
      url += `&start_edge_id=${startEdgeId}`;
    }

    const { data } = await axios.get(url, {});

    return data as RouteCRPResponseWrapper;
  } catch (error: unknown) {
    throw getRouteError(error);
  }
};

export const fetchBoundingBox = async (): Promise<BoundingBoxWrapper> => {
  try {
    const url = `${process.env.NEXT_PUBLIC_ROUTER_API_URL}/api/boundingBox`;
    const { data } = await axios.get(url);
    return data as BoundingBoxWrapper;
  } catch {
    throw new Error("Failed to fetch bounding box");
  }
};

export const fetchRouteWithAlternatives = async ({
  srcLat,
  srcLon,
  destLat,
  destLon,
  reroute = false,
  startEdgeId,
  useAnnotation,
}: RouteRequest): Promise<AlternativeRoutesResponse> => {
  try {
    let url = `${process.env.NEXT_PUBLIC_ROUTER_API_URL}/api/computeRoutes?origin_lat=${srcLat}&origin_lon=${srcLon}&destination_lat=${destLat}&destination_lon=${destLon}&alternatives=true&k=2&useAnnotation=${useAnnotation}${reroute ? "&reroute=true" : ""}`;

    if (startEdgeId !== undefined && startEdgeId !== -1) {
      url += `&start_edge_id=${startEdgeId}`;
    }

    const { data } = await axios.get(url, {});

    return data as AlternativeRoutesResponse;
  } catch (error: unknown) {
    throw getRouteError(error);
  }
};
