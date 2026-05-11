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
import { Candidate, Coord, Gps, MapMatchRequest, MapMatchResponse } from "./lib/mapmatchApi";
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
  const isReroutingRef = useRef(false);
  const routeDataRef = useRef<RouteCRPResponse[] | undefined>(undefined);
  const activeRouteRef = useRef(0);
  const snappedEdgeIDRef = useRef(-1);
  const currentGpsLocRef = useRef<Coord | null>(null);
  const currentHeadingRef = useRef<number>(0);
  const lastMatchedPointRef = useRef<Coord | null>(null);
  const startTimeRef = useRef<Date | null>(null);
  const totalDistanceTraveledRef = useRef<number>(0);

  const candidates = useRef<Candidate[]>([]);
  const speedMeanK = useRef<number>(8.3333);
  const speedStdK = useRef<number>(8.3333);
  const lastBearing = useRef<number>(0.0);
  const prevGps = useRef<Gps>(undefined);
  const mapMatchStep = useRef<number>(1);
  const deadReckoning = useRef<boolean>(false);
  const isInitialReroutePerformed = useRef<boolean>(false);
  const lastFetchedAlternativesStep = useRef<number>(-1);
  const hasArrived = useRef(false);

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
  const isAnythingFocused = (isSourceFocused && !!source) || (isDestinationFocused && !!destination);
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
      if (isSource) {
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

  /**
   * Initializes or stops the navigation session.
   * On start: Prepares the WASM map matcher and seeds the first road segment (candidate).
   */
  const handleStartRoute = useCallback(async (start: boolean) => {
    if (start) {
      setIsStartingNavigation(true);
      try {
        await wasmMapMatcher.init();

        // Ensure the initial tile is loaded BEFORE we start watching position
        const usedRoute = routeDataRef.current?.[activeRouteRef.current];
        const startLat = usedRoute?.driving_directions?.[0]?.turn_point?.lat;
        const startLon = usedRoute?.driving_directions?.[0]?.turn_point?.lon;
        if (startLat !== undefined && startLon !== undefined) {
          await wasmMapMatcher.loadTile(startLat, startLon);
        }
      } catch (_e) {
        setIsDirectionActive(false);
        return;
      } finally {
        setIsStartingNavigation(false);
      }
      startTimeRef.current = null; // Reset trip start time
      totalDistanceTraveledRef.current = 0; // Reset odometer
      lastMatchedPointRef.current = null;

      const usedRoute = routeDataRef.current?.[activeRouteRef.current];
      const firstRouteEdgeID =
        usedRoute?.driving_directions?.[0]?.edge_ids?.[0];

      // We seed the map matcher with the first edge of the route to help it
      // "lock on" to the starting road immediately.
      if (firstRouteEdgeID) {
        mapMatchStep.current = 1;
        candidates.current = [
          { edge_id: firstRouteEdgeID, weight: 1.0, length: 0 },
        ];
      } else {
        mapMatchStep.current = 1;
        candidates.current = [];
      }
    } else {
      // STOP navigation logic
      setNavigationState({
        matchedGpsLoc: undefined,
        matchedHeading: 0,
        distanceFromNextTurnPoint: 0,
        currentDirectionIndex: 0,
        timeSpent: 0,
        distanceTraveled: 0,
      });
      setSnappedEdgeID(0);
      
      // Reset internal navigation refs/state
      mapMatchStep.current = 1;
      candidates.current = [];
      speedMeanK.current = DEFAULT_CONSTANT_SPEED;
      speedStdK.current = DEFAULT_CONSTANT_SPEED;
      lastBearing.current = 0.0;
      prevGps.current = undefined;
      deadReckoning.current = false;
      isInitialReroutePerformed.current = false;
      currentGpsLocRef.current = null;
      currentHeadingRef.current = 0;
    }
    hasArrived.current = false;
    setRouteStarted(start);
  }, []);

  // route started useffect
  useEffect(() => {
    if (routeStarted) {
      if (!("geolocation" in navigator)) {
        toast.error("Geolocation not supported", { duration: 1000 });
        return;
      }

      // WASM-only map matching

      let prevTime: Date = new Date();
      let currentGps: Gps;

      const handleMapMatchResponse = (resp: MapMatchResponse) => {
        try {
          if (
            resp.data.matched_gps_point.matched_coord.lat == INVALID_LAT &&
            resp.data.matched_gps_point.matched_coord.lon == INVALID_LON
          ) {
            // reset
            mapMatchStep.current = 1;
            candidates.current = [];
            speedMeanK.current = DEFAULT_CONSTANT_SPEED;
            speedStdK.current = DEFAULT_CONSTANT_SPEED;
            lastBearing.current = 0.0;
            setNavigationState((prev) => ({
              ...prev,
              matchedHeading: 0,
              matchedGpsLoc: undefined,
            }));
            currentGpsLocRef.current = null;
            currentHeadingRef.current = 0;
            return;
          }

          if (deadReckoning.current == true) {
            prevGps.current = {
              lat: resp.data.matched_gps_point.predicted_gps_coord.lat,
              lon: resp.data.matched_gps_point.predicted_gps_coord.lon,
              speed: resp.data.speed_mean_k,
              time: prevTime,
              delta_time: 0,
              dead_reckoning: true,
            };
          }

          candidates.current = resp.data.candidates;
          speedMeanK.current = resp.data.speed_mean_k;
          speedStdK.current = resp.data.speed_std_k;
          lastBearing.current = resp.data.edge_initial_bearing;

          const targetHeading = normalizeBearing(
            resp.data.edge_initial_bearing,
          );
          const matched = resp.data.matched_gps_point.matched_coord;

          // Track time and distance spent
          if (!startTimeRef.current) {
            startTimeRef.current = new Date();
            lastMatchedPointRef.current = {
              lat: matched.lat,
              lon: matched.lon,
            };
          } else if (lastMatchedPointRef.current) {
            const dist = haversineDistance(
              lastMatchedPointRef.current.lat,
              lastMatchedPointRef.current.lon,
              matched.lat,
              matched.lon,
            );
            totalDistanceTraveledRef.current += dist;
            lastMatchedPointRef.current = {
              lat: matched.lat,
              lon: matched.lon,
            };
          }

          if (!currentGpsLocRef.current) {
            currentGpsLocRef.current = { lat: matched.lat, lon: matched.lon };
            currentHeadingRef.current = targetHeading;
            setNavigationState((prev) => ({
              ...prev,
              matchedGpsLoc: currentGpsLocRef.current
                ? { ...currentGpsLocRef.current }
                : undefined,
              matchedHeading: targetHeading,
            }));
          } else {
            let duration = 0.5;
            if (prevGps.current?.time && currentGps?.time) {
              duration =
                (currentGps.time.getTime() - prevGps.current.time.getTime()) /
                1000;
            }

            duration = Math.max(
              MIN_ANIMATION_DURATION,
              Math.min(duration, MAX_ANIMATION_DURATION),
            );

            let diff = targetHeading - currentHeadingRef.current;
            if (diff > 180) diff -= 360;
            if (diff < -180) diff += 360;
            const targetHContinuous = currentHeadingRef.current + diff;

            gsap.to(currentGpsLocRef.current, {
              lat: matched.lat,
              lon: matched.lon,
              duration: duration,
              ease: "none",
              onUpdate: () => {
                // No state update here, let the sync effect handle it
              },
            });

            gsap.to(currentHeadingRef, {
              current: targetHContinuous,
              duration: duration,
              ease: "none",
              onUpdate: () => {
                // No state update here, let the sync effect handle it
              },
            });
          }

          setSnappedEdgeID(resp.data.matched_gps_point.edge_id);
        } catch (_e) {
          toast.error("Failed to process map match result", { duration: 800 });
        }
      };

      const watchId = navigator.geolocation.watchPosition(
        async (pos) => {
          const currentTime = new Date();
          deadReckoning.current = false;
          let deltaTime = 0;
          let distance = 0;

          if (mapMatchStep.current > 1 && prevGps?.current) {
            deltaTime =
              (currentTime.getTime() - prevGps.current.time.getTime()) / 1000.0;
            distance =
              haversineDistance(
                prevGps.current.lat,
                prevGps.current.lon,
                pos.coords.latitude,
                pos.coords.longitude,
              ) * 1000; //meter
          }

          let speed = 0.0;
          if (pos.coords.speed !== null && pos.coords.speed !== undefined) {
            speed = pos.coords.speed;
          } else if (deltaTime > 0) {
            speed = distance / deltaTime; // meter/s
          }

          currentGps = {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            speed: speed,
            delta_time: mapMatchStep.current == 1 ? 0 : deltaTime,
            time: currentTime,
            dead_reckoning: false,
          };

          // Speed threshold check: skip if stationary (but not the first step)
          if (
            (speed < MIN_SPEED_THRESHOLD ||
              speedMeanK.current < MIN_SPEED_THRESHOLD) &&
            distance < THROTTLE_DISTANCE_THRESHOLD &&
            mapMatchStep.current > 1
          ) {
            return;
          }

          const mapMatchRequest: MapMatchRequest = {
            gps_point: currentGps,
            k: mapMatchStep.current,
            candidates: candidates.current,
            speed_mean_k: speedMeanK.current,
            speed_std_k: speedStdK.current,
            last_bearing: lastBearing.current,
          };

          // Intentionally NOT awaited here so it runs asynchronously while onlineMapMatch continues
          void wasmMapMatcher.loadTile(
            pos.coords.latitude,
            pos.coords.longitude,
          );

          const resp = await wasmMapMatcher.onlineMapMatch(
            mapMatchRequest.gps_point,
            mapMatchRequest.k,
            mapMatchRequest.candidates,
            mapMatchRequest.speed_mean_k,
            mapMatchRequest.speed_std_k,
            mapMatchRequest.last_bearing,
          );

          if (resp) handleMapMatchResponse({ data: resp });

          mapMatchStep.current += 1;

          setRawGpsLoc({ lat: currentGps.lat, lon: currentGps.lon });
          setSpeed(currentGps.speed);
          prevGps.current = currentGps;
          prevTime = currentTime;
        },
        async (err) => {
          const currentTime = new Date();
          if (err.code == err.POSITION_UNAVAILABLE || err.code == err.TIMEOUT) {
            // dead reckoning
            const now = new Date();
            if (
              prevGps?.current &&
              now.getTime() - prevGps.current?.time?.getTime() >
                LOST_GPS_THRESHOLD
            ) {
              deadReckoning.current = true;
              currentGps = {
                lat: prevGps.current.lat,
                lon: prevGps.current.lon,
                speed: DEFAULT_CONSTANT_SPEED,
                delta_time: prevTime
                  ? (currentTime.getTime() - prevTime.getTime()) / 1000.0
                  : MAP_MATCH_SAMPLING_INTERVAL,
                time: currentTime,
                dead_reckoning: deadReckoning.current,
              };

              const mapMatchRequest: MapMatchRequest = {
                gps_point: currentGps,
                k: mapMatchStep.current,
                candidates: candidates.current,
                speed_mean_k: speedMeanK.current,
                speed_std_k: speedStdK.current,
                last_bearing: lastBearing.current,
              };

              // Intentionally NOT awaited here so it runs asynchronously while onlineMapMatch continues
              void wasmMapMatcher.loadTile(currentGps.lat, currentGps.lon);

              const resp = await wasmMapMatcher.onlineMapMatch(
                mapMatchRequest.gps_point,
                mapMatchRequest.k,
                mapMatchRequest.candidates,
                mapMatchRequest.speed_mean_k,
                mapMatchRequest.speed_std_k,
                mapMatchRequest.last_bearing,
              );
              if (resp) handleMapMatchResponse({ data: resp });

              mapMatchStep.current += 1;

              setRawGpsLoc({ lat: currentGps.lat, lon: currentGps.lon });
              setSpeed(currentGps.speed);
              prevTime = currentTime;
            }
          }
        },
        {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 2000,
        },
      );

      return () => {
        navigator.geolocation.clearWatch(watchId);
      };
    }
  }, [routeStarted]);

  // Sync refs to state for UI updates at a controlled rate
  useEffect(() => {
    if (!routeStarted) return;

    let frameId: number;
    let lastLat = 0;
    let lastLon = 0;
    let lastH = 0;
    let lastDist = 0;
    let lastDirIndex = -1;
    let lastUpdateTimestamp = 0;

    /**
     * HIGH-FREQUENCY SYNC LOOP
     * This loop runs at ~60fps using requestAnimationFrame.
     * It handles smooth car marker movement and calculates "Real-Time" distance/ETA
     * based on the latest Map-Matched GPS location.
     */
    const sync = () => {
      if (currentGpsLocRef.current) {
        const curLat = currentGpsLocRef.current.lat;
        const curLon = currentGpsLocRef.current.lon;
        const curH = normalizeBearing(currentHeadingRef.current);

        const updatedState: Partial<typeof navigationState> = {};
        let stateChanged = false;

        const usedRoute = routeDataRef.current?.[activeRouteRef.current];
        if (usedRoute) {
          const usedRouteDirections = usedRoute.driving_directions;

          // 1. Identify which turn instruction the user is currently in.
          const directionsIndex = getCurrentUserDirectionIndex({
            snappedEdgeID: snappedEdgeIDRef.current,
            drivingDirections: usedRouteDirections,
          });

          // When rerouting, we often want to skip the initial "Head [Direction]" instruction at index 0
          // and show the first real turn maneuver instead.
          let targetIndex = directionsIndex;
          if (
            mapMatchStep.current > 1 &&
            targetIndex === 0 &&
            usedRouteDirections.length > 1
          ) {
            targetIndex = 1;
          }

          if (directionsIndex !== lastDirIndex || mapMatchStep.current > 1) {
            updatedState.currentDirectionIndex = targetIndex;
            lastDirIndex = directionsIndex;
            stateChanged = true;
          }

          // 2. Calculate distance to the next turn point (the "X meters to turn" number).
          const nextTurnPoint =
            targetIndex >= 0 && usedRouteDirections[targetIndex]?.turn_point
              ? usedRouteDirections[targetIndex].turn_point
              : {
                  lat: destinationLoc?.osm_object.lat ?? 0,
                  lon: destinationLoc?.osm_object.lon ?? 0,
                };

          const newDist =
            getDistanceFromUserToNextTurn({
              matchedGpsLoc: { lat: curLat, lon: curLon },
              nextTurnPoint,
            }) * 1000.0; // Convert KM to Meters

          const timeSpent = startTimeRef.current
            ? (new Date().getTime() - startTimeRef.current.getTime()) / 60000
            : 0;

          if (
            Math.abs(newDist - lastDist) > UPDATE_TURN_INSTRUCTION_DISTANCE_MIN
          ) {
            updatedState.distanceFromNextTurnPoint = newDist;
            lastDist = newDist;
            stateChanged = true;
          }

          updatedState.timeSpent = timeSpent;
          updatedState.distanceTraveled = totalDistanceTraveledRef.current;
          stateChanged = true;

          // Arrival check
          if (destinationLoc && !hasArrived.current) {
            const distToDest =
              haversineDistance(
                curLat,
                curLon,
                destinationLoc.osm_object.lat,
                destinationLoc.osm_object.lon,
              ) * 1000;

            if (distToDest < USER_HAS_ARRIVED_DESTINATION_DISTANCE) {
              toast.success("You have arrived at your destination!", {
                duration: 3000,
                icon: "🏁",
              });
              hasArrived.current = true;
              setRouteStarted(false);
              setRouteData(undefined);
              setPolylineData(undefined);
              setSourceLoc(undefined);
              setDestinationLoc(undefined);
              setAlternativeRoutesLineData([]);
              setIsDirectionActive(false);
              setActiveRoute(0);
              setNextTurnIndex(-1);
              setSearchResults([]);
              setShowResult(false);
              router.replace(`${pathname}`);
              setNavigationState({
                matchedGpsLoc: undefined,
                matchedHeading: 0,
                distanceFromNextTurnPoint: 0,
                currentDirectionIndex: 0,
                timeSpent: 0,
                distanceTraveled: 0,
              });
            }
          }
        }

        // 2. Throttled state update for UI re-render (Marker position)
        const dist = mercatorDistance(lastLat, lastLon, curLat, curLon);

        // Threshold: 0.5m or 2 degrees to avoid overloading React
        if (dist > 0.5 || Math.abs(curH - lastH) > 2) {
          updatedState.matchedGpsLoc = { lat: curLat, lon: curLon };
          updatedState.matchedHeading = curH;
          lastLat = curLat;
          lastLon = curLon;
          lastH = curH;
          stateChanged = true;
        }

        const now = Date.now();
        if (
          stateChanged &&
          now - lastUpdateTimestamp > UPDATE_NAVIGATION_STATE_THRESHOLD_MS
        ) {
          setNavigationState((prev) => ({ ...prev, ...updatedState }));
          lastUpdateTimestamp = now;
        }
      }
      frameId = requestAnimationFrame(sync);
    };

    frameId = requestAnimationFrame(sync);
    return () => cancelAnimationFrame(frameId);
  }, [routeStarted, routeData, activeRoute, destinationLoc, pathname, router]);

  // Keep a ref to alternativeRoutesLineData so the re-routing effect can read
  // the latest value without listing it as a dependency (which caused an infinite loop).
  const alternativeRoutesLineDataRef = useRef(alternativeRoutesLineData);
  useEffect(() => {
    alternativeRoutesLineDataRef.current = alternativeRoutesLineData;
  }, [alternativeRoutesLineData]);

  /**
   * RE-ROUTING & ALTERNATIVES EFFECT
   * Watches for "Off-Route" scenarios or "Decision Points" to trigger API calls.
   */
  useEffect(() => {
    const usedRoute = routeData?.[activeRoute];

    // DYNAMIC ALTERNATIVES: Triggered when approaching the end of a road segment.
    if (matchedGpsLoc && usedRoute && routeData && destinationLoc) {
      const directionsIndex = getCurrentUserDirectionIndex({
        snappedEdgeID: snappedEdgeID,
        drivingDirections: usedRoute.driving_directions,
      });

      // If user is near the end of a step tagged as 'suggest_alternatives', fetch options.
      if (
        isNearEndOfSuggestAlternativesStep({
          snappedEdgeID: snappedEdgeID,
          drivingDirections: usedRoute.driving_directions,
          currentIndex: directionsIndex,
        }) &&
        directionsIndex !== lastFetchedAlternativesStep.current &&
        !isReroutingRef.current
      ) {
        lastFetchedAlternativesStep.current = directionsIndex;
        isReroutingRef.current = true;
        void (async () => {
          try {
            const reqBody = {
              srcLat: currentGpsLocRef.current?.lat ?? matchedGpsLoc?.lat ?? 0,
              srcLon: currentGpsLocRef.current?.lon ?? matchedGpsLoc?.lon ?? 0,
              destLat: destinationLoc.osm_object.lat,
              destLon: destinationLoc.osm_object.lon,
              reroute: true,
              startEdgeId: snappedEdgeID,
            };

            // Proactive Refresh: Fetch new alternatives but keep the main route's progress.
            const altResponse = await fetchAlternativeRoutes(reqBody);
            const newAlternatives = altResponse.data.alternative_routes;

            if (newAlternatives.length > 0) {
              // Normalize alternatives so their "Remaining Distance" works with our current trackers.
              const currentDistOffset = totalDistanceTraveledRef.current;
              const currentTimeOffset =
                (Date.now() - (startTimeRef.current?.getTime() ?? Date.now())) /
                60000;

              newAlternatives.forEach((alt: RouteCRPResponse) => {
                alt.distance = parseFloat(
                  (alt.distance / 1000 + currentDistOffset).toFixed(2),
                );
                alt.travel_time = alt.travel_time + currentTimeOffset;
              });

              const combinedRoutes = [usedRoute, ...newAlternatives];
              setRouteData(combinedRoutes);
              routeDataRef.current = combinedRoutes;

              const alternativesPolyline = newAlternatives.map((route) => {
                const coords = polyline.decode(route.path);
                return {
                  type: "Feature",
                  geometry: {
                    type: "LineString",
                    coordinates: coords.map((coord) => [coord[1], coord[0]]),
                  },
                };
              });

              const dummyRoute: LineData = {
                type: "Feature",
                geometry: {
                  type: "LineString",
                  coordinates: [
                    [-100, 40],
                    [-100, 40],
                  ],
                },
              };
              setAlternativeRoutesLineData([
                dummyRoute,
                ...alternativesPolyline,
              ]);
            }
          } catch (e) {
            console.error("Failed to fetch alternatives dynamically:", e);
          } finally {
            isReroutingRef.current = false;
          }
        })();
      }
    }

    const firstRouteEdgeID = usedRoute?.driving_directions[0]?.edge_ids[0];
    if (snappedEdgeID == firstRouteEdgeID || mapMatchStep.current == 1) {
      // skip re-route logic if current user location == source loc.
      return;
    }

    if (matchedGpsLoc && usedRoute && !isReroutingRef.current) {
      const selectedRoute = usedRoute;
      // perform a re-route if the user's current location (snapped edge id) is outside the preferred route
      void (async () => {
        let isOffTheRoute = isUserOffTheRoute({
          snappedEdgeID: snappedEdgeID,
          routeData: selectedRoute,
        });
        if (isOffTheRoute && snappedEdgeID !== -1 && routeData) {
          // Check if user moved to another existing route
          const otherRouteIndex = routeData.findIndex(
            (route, idx) =>
              idx !== activeRoute &&
              !isUserOffTheRoute({
                snappedEdgeID: snappedEdgeID,
                routeData: route,
              }),
          );

          if (otherRouteIndex !== -1) {
            setActiveRoute(otherRouteIndex);
            isOffTheRoute = false;
            toast.success(
              `Switched to alternative route ${otherRouteIndex + 1}`,
              { duration: 800 },
            );
          }
        }
        if (isOffTheRoute && snappedEdgeID !== -1) {
          if (mapMatchStep.current <= 1 && isInitialReroutePerformed.current) {
            return;
          }
          isReroutingRef.current = true;
          try {
            if (mapMatchStep.current <= 1) {
              isInitialReroutePerformed.current = true;
            }
            const reqBody = {
              srcLat: currentGpsLocRef.current?.lat ?? matchedGpsLoc?.lat ?? 0,
              srcLon: currentGpsLocRef.current?.lon ?? matchedGpsLoc?.lon ?? 0,
              destLat: destinationLoc?.osm_object.lat ?? 0,
              destLon: destinationLoc?.osm_object.lon ?? 0,
              reroute: true,
              startEdgeId: snappedEdgeID,
            };
            const processedRoutes = await routingWorker.fetchAndProcessRoutes(
              reqBody,
              true,
            );

            setRouteData(processedRoutes.combinedRoutes);
            routeDataRef.current = processedRoutes.combinedRoutes;

            setPolylineData(processedRoutes.mainLineData);
            setAlternativeRoutesLineData(
              processedRoutes.alternativeRoutesLineData,
            );

            // Reset active route to 0 after reroute
            setActiveRoute(0);
            activeRouteRef.current = 0;

            // Reset trackers for correct ETA/Distance calculation on the new route
            startTimeRef.current = new Date();
            totalDistanceTraveledRef.current = 0;
          } catch (err: unknown) {
            const message =
              err instanceof Error ? err.message : "Unknown error";
            toast.error(`Failed to fetch route (re-routing): ${message}`, {
              duration: 800,
            });
          } finally {
            isReroutingRef.current = false;
          }
        }
      })();
    }
  }, [snappedEdgeID, routeData, activeRoute, destinationLoc, matchedGpsLoc]);

  const handleSetRouteDataCRP = useCallback((data: RouteCRPResponse[]) => {
    if (data.length === 0) {
      setPolylineData(undefined);
      setAlternativeRoutesLineData([]);
      setActiveRoute(0);
    }
    setRouteData(data);
  }, []);

  // Adjust activeRoute if it's out of bounds (during render)
  const safeActiveRoute = (routeData && activeRoute >= routeData.length) ? 0 : activeRoute;
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
        destinationSearchActive={setIsDestinationFocused}
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
        handleStartRoute={handleStartRoute}
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
