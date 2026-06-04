import { Place } from "../lib/searchApi";
import { RouteCRPResponse, RouteResponse } from "../lib/navigatorxApi";
import { Coord } from "../lib/mapmatchApi";

export interface SearchBoxProps {
  isSource: boolean;
  activate: (val: boolean) => void;
  sourceLoc?: Place;
  destinationLoc?: Place;
  onSelectSource: (place: Place) => void;
  onSelectDestination: (place: Place) => void;
}

export interface RouterProps {
  sourceSearchActive: (val: boolean) => void;
  destinationSearchActive: (val: boolean) => void;
  onHandleGetRoutes: (e: any) => void;
  isFetchingRoutes: boolean;
  isSourceFocused: boolean;
  isDestinationFocused: boolean;
  onHandleReverseGeocoding: (e: any, isSource: boolean) => void;
  routeData?: RouteResponse[];
  routeDataCRP?: RouteCRPResponse[];
  activeRoute: number;
  routeStarted: boolean;
  isStartingNavigation?: boolean;
  handleRouteClick: (index: number) => void;
  handleDirectionActive: (show: boolean) => void;
  handleSetNextTurnIndex: (index: number) => void;
  distanceFromNextTurnPoint: number;
  currentDirectionIndex: number;
  userLoc: UserLocation;
  sourceLoc?: Place;
  destinationLoc?: Place;
  handleSetRouteData?: (routeData: RouteResponse[]) => void;
  handleSetRouteDataCRP: (routeData: RouteCRPResponse[]) => void;
  isAlternativeChecked: boolean;
  handleIsAlternativeChecked: () => void;
  onSelectSource: (place: Place) => void;
  onSelectDestination: (place: Place) => void;
  ignoreDistanceCheck?: boolean;
  timeSpent?: number;
  distanceTraveled?: number;
  speed?: number;
}

export interface SearchSelectorProps {
  places: Place[];
  select: (place: Place) => void;
}

export interface MapComponentProps {
  lineData?: LineData;
  alternativeRoutes?: LineData[];
  onUserLocationUpdateHandler: (lat: number, lon: number) => void;
  activeRoute: number;
  isDirectionActive: boolean;
  routeDataCRP?: RouteCRPResponse[];
  nextTurnIndex: number;
  onSelectSource: (place: Place) => void;
  onSelectDestination: (place: Place) => void;
  matchedGpsLoc: Coord | undefined;
  rawGpsLoc?: Coord | undefined;
  gpsWindowPoints?: Coord[];
  routeStarted: boolean;
  userHeading: number;
  onMapClick?: (lat: number, lon: number) => void;
  isSimulation?: boolean;
  currentGpsLocRef?: React.RefObject<{ lat: number; lon: number } | null>;
  currentHeadingRef?: React.RefObject<number>;
  triggerGeolocate?: number;
}

export interface LineData {
  type: string;
  properties?: Record<string, unknown>;
  geometry: {
    type: string;
    coordinates: number[][];
  };
}
