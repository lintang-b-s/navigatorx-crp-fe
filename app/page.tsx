"use client";
import dynamic from "next/dynamic";
import { Router } from "@/app/ui/routing";
import { SearchResults } from "./ui/searchResult";
import { MouseEvent, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams, usePathname, useRouter } from "next/navigation";
import { fetchReverseGeocoding, fetchSearch, Place } from "@/app/lib/searchApi";
import { routingWorker } from "@/app/lib/routingWorkerProxy";
import toast from "react-hot-toast";
import { fetchAlternativeRoutes, RouteCRPResponse } from "./lib/navigatorxApi";
import polyline from "@mapbox/polyline";
import { LineData } from "./types/definition";
import {
  Candidate,
  Coord,
  Gps,
  MapMatchRequest,
  MapMatchResponse,
} from "./lib/mapmatchApi";
import { haversineDistance, mercatorDistance } from "./lib/util";
import {
  getCurrentUserDirectionIndex,
  getDistanceFromUserToNextTurn,
  isUserOffTheRoute,
  isNearEndOfSuggestAlternativesStep,
} from "./lib/routing";

import {
  THROTTLE_DISTANCE_THRESHOLD,
  INVALID_LAT,
  INVALID_LON,
  MIN_SPEED_THRESHOLD,
  DEFAULT_CONSTANT_SPEED,
  MAP_MATCH_SAMPLING_INTERVAL,
  LOST_GPS_THRESHOLD,
  UPDATE_NAVIGATION_STATE_THRESHOLD_MS,
  MIN_ANIMATION_DURATION,
  MAX_ANIMATION_DURATION,
  USER_HAS_ARRIVED_DESTINATION_DISTANCE,
  UPDATE_TURN_INSTRUCTION_DISTANCE_MIN,
} from "@/app/lib/constants";
import gsap from "gsap";
import { wasmMapMatcher } from "./lib/wasmMapmatch";

const MapComponent = dynamic(
  () => import("@/app/ui/map").then((mod) => mod.MapComponent),
  {
    ssr: false,
    loading: () => (
      <div
        style={{
          width: "100vw",
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f0f0f0",
        }}
      >
        <p>Loading map…</p>
      </div>
    ),
  },
);

const normalizeBearing = (bearing: number) => {
  return ((bearing % 360) + 360) % 360;
};

export default function Home() {
  // REFS: Used for high-frequency updates (60fps) to avoid React re-render lag.
  // We perform math in refs, then sync to state at a controlled rate for the UI.
  const routeDataRef = useRef<RouteCRPResponse[] | undefined>(undefined);
  const activeRouteRef = useRef(0);
  const snappedEdgeIDRef = useRef(-1);
  const currentGpsLocRef = useRef<Coord | null>(null);
  const currentHeadingRef = useRef<number>(0);

  const lastFetchedAlternativesStep = useRef<number>(-1);

  const [snappedEdgeID, setSnappedEdgeID] = useState<number>(-1);
  const [routeStarted, setRouteStarted] = useState(false);
  const [navigationState, setNavigationState] = useState<{
    matchedGpsLoc: Coord | undefined;
    matchedHeading: number;
    distanceFromNextTurnPoint: number;
    currentDirectionIndex: number;
    timeSpent: number;
    distanceTraveled: number;
  }>({
    matchedGpsLoc: undefined,
    matchedHeading: 0,
    distanceFromNextTurnPoint: 0,
    currentDirectionIndex: 0,
    timeSpent: 0,
    distanceTraveled: 0,
  });

  const {
    matchedGpsLoc,
    matchedHeading,
    distanceFromNextTurnPoint,
    currentDirectionIndex,
    timeSpent,
    distanceTraveled,
  } = navigationState;

  const [rawGpsLoc, setRawGpsLoc] = useState<Coord>();
  const [geolocateTrigger, setGeolocateTrigger] = useState(0);
  const [speed, setSpeed] = useState(0);

  // search states
  const searchParams = useSearchParams();
  const source = searchParams.get("source");
  const destination = searchParams.get("destination");
  const [isSourceFocused, setIsSourceFocused] = useState(false);
  const [isDestinationFocused, setIsDestinationFocused] = useState(false);
  const [searchResults, setSearchResults] = useState<Place[]>([]);

  // routing states
  const [routeData, setRouteData] = useState<RouteCRPResponse[]>();
  const [activeRoute, setActiveRoute] = useState(0);
  const [isDirectionActive, setIsDirectionActive] = useState(false);
  const [isStartingNavigation, setIsStartingNavigation] = useState(false);
  const [sourceLoc, setSourceLoc] = useState<Place>();
  const [destinationLoc, setDestinationLoc] = useState<Place>();
  const [polylineData, setPolylineData] = useState<LineData>();
  const [alternativeRoutesLineData, setAlternativeRoutesLineData] = useState<
    LineData[]
  >([]);
  const [isAlternativeChecked, setIsAlternativeChecked] = useState(false);
  const [isFetchingRoutes, setIsFetchingRoutes] = useState(false);

  const [lastFocused, setLastFocused] = useState<
    "source" | "destination" | null
  >(null);
  const [showResult, setShowResult] = useState(false);

  const [nextTurnIndex, setNextTurnIndex] = useState(-1);
  const pathname = usePathname();

  useEffect(() => {
    routeDataRef.current = routeData;
  }, [routeData]);
  useEffect(() => {
    activeRouteRef.current = activeRoute;
  }, [activeRoute]);
  useEffect(() => {
    snappedEdgeIDRef.current = snappedEdgeID;
  }, [snappedEdgeID]);
  const [userLoc, setUserLoc] = useState<UserLocation>({
    longitude: -100,
    latitude: 40,
  });

  const parseCoordinates = useCallback((input: string) => {
    const coordRegex =
      /^[-+]?([1-8]?\d(\.\d+)?|90(\.0+)?),\s*[-+]?(180(\.0+)?|((1[0-7]\d)|([1-9]?\d))(\.\d+)?)$/;
    const trimmedInput = input.trim();
    if (coordRegex.test(trimmedInput)) {
      const [lat, lon] = trimmedInput
        .split(",")
        .map((v) => parseFloat(v.trim()));
      if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
        return { lat, lon };
      }
    }
    return null;
  }, []);

  const onMapClick = useCallback((_l: number, _ln: number) => {
    // Handle map click if needed
  }, []);

  const router = useRouter();
  // search useffect
  useEffect(() => {
    const init = () => {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            setUserLoc({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            });
          },
          (error) => {
            toast.error(error.message, { duration: 2000 });
          },
        );
      } else {
        toast.error("Geolocation is not supported by this browser.", {
          duration: 2000,
        });
      }

      router.replace(`${pathname}`);
    };

    init();
  }, [pathname, router]);

  useEffect(() => {
    if (isSourceFocused && source) {
      const coords = parseCoordinates(source);
      if (!coords) {
        fetchSearch(source, userLoc.latitude, userLoc.longitude)
          .then((resp) => {
            setSearchResults(resp.data);
            setShowResult(true);
          })
          .catch((e) => toast.error(e.message, { duration: 1000 }));
      }
    }

    if (isDestinationFocused && destination) {
      const coords = parseCoordinates(destination);
      if (!coords) {
        fetchSearch(destination, userLoc.latitude, userLoc.longitude)
          .then((resp) => {
            setSearchResults(resp.data);
            setShowResult(true);
          })
          .catch((e) => toast.error(e.message, { duration: 1000 }));
      }
    }
  }, [
    isSourceFocused,
    searchParams,
    isDestinationFocused,
    destination,
    parseCoordinates,
    source,
    userLoc.latitude,
    userLoc.longitude,
  ]);

  // Derived state for search result visibility
  const isAnythingFocused =
    (isSourceFocused && !!source) || (isDestinationFocused && !!destination);
  const actualShowResult = isAnythingFocused && showResult;

  const pushParam = useCallback(
    (key: "source" | "destination", place: Place) => {
      const p = new URLSearchParams(searchParams.toString());
      p.set(
        key,
        `${place.osm_object.name} ${
          place.osm_object.address != "" ? `, ${place.osm_object.address}` : ""
        }`,
      );
      router.replace(`${pathname}?${p.toString()}`);
    },
    [searchParams, pathname, router],
  );

  const handleClickAlternativeCheckbox = useCallback(() => {
    setIsAlternativeChecked((prev) => !prev);
  }, []);
  const onSelectSource = useCallback(
    (place: Place) => {
      setSourceLoc(place);
      pushParam("source", place);
    },
    [pushParam],
  );

  const onSelectDestination = useCallback(
    (place: Place) => {
      setDestinationLoc(place);
      pushParam("destination", place);
    },
    [pushParam],
  );

  const handleFocusSourceSearch = useCallback((val: boolean) => {
    setIsSourceFocused(val);
    if (val) setLastFocused("source");
  }, []);

  const handleFocusDestinationSearch = useCallback((val: boolean) => {
    setIsDestinationFocused(val);
    if (val) setLastFocused("destination");
  }, []);

  const onHandleGetRoutes = async (
    e: MouseEvent<HTMLButtonElement, MouseEvent>,
  ) => {
    if (isFetchingRoutes) {
      return;
    }

    if (!sourceLoc || !destinationLoc) {
      toast.error("Please select both source and destination", {
        duration: 1000,
      });
      return;
    }

    e.preventDefault();

    try {
      setIsFetchingRoutes(true);
      setRouteStarted(false);
      setNextTurnIndex(-1);
      setRouteData([]);
      setNavigationState({
        matchedGpsLoc: undefined,
        matchedHeading: 0,
        distanceFromNextTurnPoint: 0,
        currentDirectionIndex: 0,
        timeSpent: 0,
        distanceTraveled: 0,
      });
      lastFetchedAlternativesStep.current = -1;
      const reqBody = {
        srcLat: sourceLoc.osm_object.lat,
        srcLon: sourceLoc.osm_object.lon,
        destLat: destinationLoc.osm_object.lat,
        destLon: destinationLoc.osm_object.lon,
        useAnnotation: false,
      };

      const processedRoutes = await routingWorker.fetchAndProcessRoutes(
        reqBody,
        isAlternativeChecked,
      );

      setActiveRoute(0);
      setPolylineData(processedRoutes.mainLineData);

      if (processedRoutes.alternativeRoutesLineData.length > 0) {
        setAlternativeRoutesLineData(processedRoutes.alternativeRoutesLineData);
      } else {
        setAlternativeRoutesLineData([]);
      }

      setRouteData(processedRoutes.combinedRoutes);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message, { duration: 800 });
    } finally {
      setIsFetchingRoutes(false);
    }
  };

  const onHandleReverseGeocoding = async (
    e: MouseEvent<HTMLButtonElement, MouseEvent>,
    isSource: boolean,
  ) => {
    setGeolocateTrigger((prev) => prev + 1);
    try {
      const resp = await fetchReverseGeocoding({
        lat: userLoc.latitude,
        lon: userLoc.longitude,
      });

      const newUserLoc = {
        osm_object: {
          id: 0,
          name: resp.data.data.name,
          lat: resp.data.data.lat,
          lon: resp.data.data.lon,
          address: resp.data.data.address,
          type: "source",
        },
        distance: 0,
      };
      const target = isSource
        ? "source"
        : isDestinationFocused
          ? "destination"
          : lastFocused;

      if (target === "source") {
        setSourceLoc(newUserLoc);
        pushParam("source", newUserLoc);
      } else {
        setDestinationLoc(newUserLoc);
        pushParam("destination", newUserLoc);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message, { duration: 1000 });
    }
  };

  const onUserLocationUpdateHandler = useCallback(
    (lat: number, lon: number) => {
      setUserLoc({
        latitude: lat,
        longitude: lon,
      });
    },
    [],
  );

  const handleRouteClick = useCallback((index: number) => {
    setActiveRoute(index);
  }, []);

  const handleDirectionActive = useCallback((show: boolean) => {
    setIsDirectionActive(show);
  }, []);

  const handleSetNextTurnIndex = useCallback((index: number) => {
    setNextTurnIndex(index);
  }, []);

  // Keep a ref to alternativeRoutesLineData so the re-routing effect can read
  // the latest value without listing it as a dependency (which caused an infinite loop).
  const alternativeRoutesLineDataRef = useRef(alternativeRoutesLineData);
  useEffect(() => {
    alternativeRoutesLineDataRef.current = alternativeRoutesLineData;
  }, [alternativeRoutesLineData]);

  const handleSetRouteDataCRP = useCallback((data: RouteCRPResponse[]) => {
    if (data.length === 0) {
      setPolylineData(undefined);
      setAlternativeRoutesLineData([]);
      setActiveRoute(0);
    }
    setRouteData(data);
  }, []);

  // Adjust activeRoute if it's out of bounds (during render)
  const safeActiveRoute =
    routeData && activeRoute >= routeData.length ? 0 : activeRoute;
  if (safeActiveRoute !== activeRoute) {
    setActiveRoute(safeActiveRoute);
  }

  return (
    <main className="flex relative  w-full overflow-hidden">
      <MapComponent
        lineData={polylineData}
        onUserLocationUpdateHandler={onUserLocationUpdateHandler}
        alternativeRoutes={alternativeRoutesLineData}
        activeRoute={activeRoute}
        isDirectionActive={isDirectionActive}
        routeDataCRP={routeData ?? []}
        nextTurnIndex={nextTurnIndex}
        onSelectSource={onSelectSource}
        onSelectDestination={onSelectDestination}
        routeStarted={routeStarted}
        matchedGpsLoc={matchedGpsLoc}
        userHeading={matchedHeading ?? 0}
        currentGpsLocRef={currentGpsLocRef}
        currentHeadingRef={currentHeadingRef}
        onMapClick={onMapClick}
        rawGpsLoc={rawGpsLoc}
        triggerGeolocate={geolocateTrigger}
      />
      <Router
        sourceSearchActive={handleFocusSourceSearch}
        destinationSearchActive={handleFocusDestinationSearch}
        onHandleGetRoutes={onHandleGetRoutes}
        isFetchingRoutes={isFetchingRoutes}
        isSourceFocused={isSourceFocused}
        isDestinationFocused={isDestinationFocused}
        onHandleReverseGeocoding={onHandleReverseGeocoding}
        routeDataCRP={routeData}
        handleRouteClick={handleRouteClick}
        activeRoute={activeRoute}
        handleDirectionActive={handleDirectionActive}
        handleSetNextTurnIndex={handleSetNextTurnIndex}
        routeStarted={routeStarted}
        isStartingNavigation={isStartingNavigation}
        distanceFromNextTurnPoint={distanceFromNextTurnPoint}
        currentDirectionIndex={currentDirectionIndex}
        timeSpent={timeSpent}
        distanceTraveled={distanceTraveled}
        sourceLoc={sourceLoc}
        destinationLoc={destinationLoc}
        userLoc={userLoc}
        handleSetRouteDataCRP={handleSetRouteDataCRP}
        handleIsAlternativeChecked={handleClickAlternativeCheckbox}
        isAlternativeChecked={isAlternativeChecked}
        onSelectSource={onSelectSource}
        onSelectDestination={onSelectDestination}
        speed={speed}
      />

      {actualShowResult && isSourceFocused && (
        <SearchResults places={searchResults} select={onSelectSource} />
      )}
      {actualShowResult && isDestinationFocused && (
        <SearchResults places={searchResults} select={onSelectDestination} />
      )}
    </main>
  );
}
