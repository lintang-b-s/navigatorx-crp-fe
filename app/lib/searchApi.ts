import axios from "axios";

export interface OsmObject {
  id: number;
  name: string;
  lat: number;
  lon: number;
  address: string;
  type: string;
}

export interface Place {
  osm_object: OsmObject;
  distance: number;
}

export interface SearchResponse {
  data: Place[];
}

export const fetchSearch = async (
  query: string,
  lat: number,
  lon: number
): Promise<SearchResponse> => {
  try {
    const param = {
      query: query,
      topk: 10,
      offset: 0,
      lat: lat,
      lon: lon,
    };
    const { data } = await axios.get(
      `https://navigatorx.lintangbs.my.id/search/api/autocomplete?query=${param.query}&top_k=${param.topk}&offset=${param.offset}&lat=${param.lat}&lon=${param.lon}`,
      {}
    );
    return data;
  } catch (error) {
    throw new Error("Failed to fetch search results");
  }
};

export type ReverseGeocodingRequest = {
  lat: number;
  lon: number;
};

export type ReverseGeocodingResponse = {
  data: {
    data: {
      lat: number;
      lon: number;
      name: string;
      address: string;
    };
  };
};
export const fetchReverseGeocoding = async ({
  lat,
  lon,
}: ReverseGeocodingRequest): Promise<ReverseGeocodingResponse> => {
  try {
    const param = {
      lat: lat,
      lon: lon,
    };
    const { data } = await axios.get(
      `https://navigatorx.lintangbs.my.id/search/api/reverse?lat=${param.lat}&lon=${param.lon}`,
      {}
    );
    return data;
  } catch (error) {
    throw new Error("Failed to fetch search results");
  }
};
