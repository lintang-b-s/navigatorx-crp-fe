"use client";
import dynamic from "next/dynamic";
import { Router } from "@/app/ui/routing";
import { SearchResults } from "./ui/searchResult";
import { MouseEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, usePathname, useRouter } from "next/navigation";
import { fetchReverseGeocoding, fetchSearch, Place } from "@/app/lib/searchApi";
import toast from "react-hot-toast";
import {
  AlternativeRoutesResponse,
  fetchAlternativeRoutes,
  fetchRouteCRP,
  RouteCRPResponse,
  RouteCRPResponseWrapper,
} from "./lib/navigatorxApi";
import polyline from "@mapbox/polyline";
import { LineData } from "./types/definition";
import {
  Candidate,
  Coord,
  Gps,
  MapMatchRequest,
} from "./lib/mapmatchApi";
import { haversineDistance, project, gt } from "./lib/util";
import {
  getCurrentUserDirectionIndex,
  getDistanceFromUserToNextTurn,
  isUserOffTheRoute,
} from "./lib/routing";
import { useDeviceOrientation } from "./hook";
import { 
  THROTTLE_DISTANCE_THRESHOLD, 
  THROTTLE_HEADING_THRESHOLD,
  INVALID_LAT,
  INVALID_LON,
  MIN_SPEED_THRESHOLD,
  DEFAULT_CONSTANT_SPEED,
  MAP_MATCH_SAMPLING_INTERVAL,
  LOST_GPS_THRESHOLD
} from "@/app/lib/constants";
import gsap from "gsap";

const MapComponent = dynamic(
  () => import("@/app/ui/map").then((mod) => mod.MapComponent),
  {
    ssr: false,
    loading: () => (
      <div style={{ width: "100vw", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f0f0f0" }}>
        <p>Loading map…</p>
      </div>
    ),
  },
);


const normalizeBearing = (bearing: number) => {
  return ((bearing % 360) + 360) % 360;
};

export default function Home() {
  // real-time map matching states
  const { orientation, requestAccess, revokeAccess, error } =
    useDeviceOrientation();

  const [snappedEdgeID, setSnappedEdgeID] = useState<number>(-1);
  const [routeStarted, setRouteStarted] = useState(false);
  const [matchedGpsLoc, setMatchedGpsLoc] = useState<Coord>();
  const [gpsHeading, setGpsHeading] = useState<number>(0); // bearing (user heading angle from North)
  const [matchedHeading, setMatchedHeading] = useState<number>();
  const [distanceFromNextTurnPoint, setDistanceFromNextTurnPoint] =
    useState<number>(0); // in meter
  const [currentDirectionIndex, setCurrentDirectionIndex] = useState(1);

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
  const [userLoc, setUserLoc] = useState<UserLocation>({
    longitude: -100,
    latitude: 40,
  });

  const candidates = useRef<Candidate[]>([]);
  const speedMeanK = useRef<number>(8.3333);
  const speedStdK = useRef<number>(8.3333);
  const lastBearing = useRef<number>(0.0);
  const prevGps = useRef<Gps>(undefined);
  const mapMatchStep = useRef<number>(1);
  const deadReckoning = useRef<boolean>(false);
  const isInitialReroutePerformed = useRef<boolean>(false);
  const currentGpsLocRef = useRef<Coord | null>(null);
  const currentHeadingRef = useRef<number>(0);

  const parseCoordinates = useCallback((input: string) => {
    const coordRegex =
      /^[-+]?([1-8]?\d(\.\d+)?|90(\.0+)?),\s*[-+]?(180(\.0+)?|((1[0-7]\d)|([1-9]?\d))(\.\d+)?)$/;
    if (coordRegex.test(input)) {
      const [lat, lon] = input.split(",").map((v) => parseFloat(v.trim()));
      if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
        return { lat, lon };
      }
    }
    return null;
  }, []);

  const { replace } = useRouter();
  // search useffect
  useEffect(() => {
    const init = async () => {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            setUserLoc({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            });
          },
          (error) => {
            toast.error(error.message);
          },
        );
      } else {
        toast.error("Geolocation is not supported by this browser.");
      }

      const allowedOrientationPerm = await requestAccess();
      if (allowedOrientationPerm) {
        toast.success("Orientation permission granted");
      } else {
        toast.error("Orientation permission not granted");
      }

      replace(`${pathname}`);
    };

    init();
  }, []);

  useEffect(() => {
    if (
      !(isSourceFocused && source) &&
      !(isDestinationFocused && destination)
    ) {
      setShowResult(false);
    }
    if (isSourceFocused && source) {
      const coords = parseCoordinates(source);
      if (!coords) {
        fetchSearch(source, userLoc.latitude, userLoc.longitude)
          .then((resp) => setSearchResults(resp.data))
          .catch((e) => toast.error(e.message));
        setShowResult(true);
      }
    }

    if (isDestinationFocused && destination) {
      const coords = parseCoordinates(destination);
      if (!coords) {
        fetchSearch(destination, userLoc.latitude, userLoc.longitude)
          .then((resp) => setSearchResults(resp.data))
          .catch((e) => toast.error(e.message));
        setShowResult(true);
      }
    }
  }, [isSourceFocused, searchParams, isDestinationFocused]);

  const pushParam = useCallback((key: "source" | "destination", place: Place) => {
    const p = new URLSearchParams(searchParams.toString());
    p.set(
      key,
      `${place.osm_object.name} ${
        place.osm_object.address != "" ? `, ${place.osm_object.address}` : ""
      }`,
    );
    replace(`${pathname}?${p.toString()}`);
  }, [searchParams, pathname, replace]);

  const handleClickAlternativeCheckbox = useCallback(() => {
    setIsAlternativeChecked((prev) => !prev);
  }, []);
  const onSelectSource = useCallback((place: Place) => {
    setSourceLoc(place);
    pushParam("source", place);
  }, [pushParam]);

  const onSelectDestination = useCallback((place: Place) => {
    setDestinationLoc(place);
    pushParam("destination", place);
  }, [pushParam]);

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
      toast.error("Please select both source and destination");
      return;
    }

    e.preventDefault();

    try {
      setIsFetchingRoutes(true);
      setRouteStarted(false);
      setNextTurnIndex(-1);
      setRouteData([]);
      const reqBody = {
        srcLat: sourceLoc?.osm_object.lat!,
        srcLon: sourceLoc?.osm_object.lon!,
        destLat: destinationLoc?.osm_object.lat!,
        destLon: destinationLoc?.osm_object.lon!,
      };

      let alternativeRouteData: AlternativeRoutesResponse | undefined =
        undefined;
      let spRouteData: RouteCRPResponseWrapper | undefined = undefined;
      if (isAlternativeChecked) {
        [spRouteData, alternativeRouteData] = await Promise.all([
          fetchRouteCRP(reqBody),
          fetchAlternativeRoutes(reqBody),
        ]);
      } else {
        [spRouteData] = await Promise.all([fetchRouteCRP(reqBody)]);
      }

      spRouteData.data.distance = parseFloat(
        (spRouteData.data.distance / 1000).toFixed(2),
      );

      setActiveRoute(0);

      const coords = polyline.decode(spRouteData.data.path);
      const linedata: LineData = {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: coords.map((coord) => [coord[1], coord[0]]),
        },
      };

      setPolylineData(linedata);

      if (
        alternativeRouteData &&
        alternativeRouteData.data.alternative_routes != null &&
        alternativeRouteData.data.alternative_routes.length > 0
      ) {
        alternativeRouteData.data.alternative_routes.map((alt) => {
          alt.distance = parseFloat((alt.distance / 1000).toFixed(2));
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

        const alternativesPolyline =
          alternativeRouteData.data.alternative_routes.map((route) => {
            const coords = polyline.decode(route.path);
            return {
              type: "Feature",
              geometry: {
                type: "LineString",
                coordinates: coords.map((coord) => [coord[1], coord[0]]),
              },
            };
          });
        setAlternativeRoutesLineData([dummyRoute, ...alternativesPolyline]);
        setRouteData([
          spRouteData.data,
          ...alternativeRouteData.data.alternative_routes,
        ]);
      } else {
        setRouteData([spRouteData.data]);
      }
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setIsFetchingRoutes(false);
    }
  };

  const onHandleReverseGeocoding = async (
    e: MouseEvent<HTMLButtonElement, MouseEvent>,
    isSource: boolean,
  ) => {
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
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const onUserLocationUpdateHandler = useCallback((lat: number, lon: number) => {
    setUserLoc({
      latitude: lat,
      longitude: lon,
    });
  }, []);

  const handleRouteClick = useCallback((index: number) => {
    setActiveRoute(index);
  }, []);

  const handleDirectionActive = useCallback((show: boolean) => {
    setIsDirectionActive(show);
  }, []);

  const handleSetNextTurnIndex = useCallback((index: number) => {
    setNextTurnIndex(index);
  }, []);

  const handleStartRoute = useCallback((start: boolean) => {
    setRouteStarted(start);
  }, []);

  useEffect(() => {
    if (orientation?.alpha != null) {
      setGpsHeading(360.0 - orientation?.alpha!);
    }
  }, [orientation]);

  const userHeading = useMemo(
    () => matchedHeading !== undefined ? matchedHeading : normalizeBearing(gpsHeading),
    [matchedHeading, gpsHeading],
  );

  const defaultConstantSpeed = 8.3333; // meter/s

  const mapMatchSamplingInterval = 1.0; // 1s
  const lostGpsThreshold = 2000; // 2s
  // route started useffect
  useEffect(() => {
    if (routeStarted) {
      if (!("geolocation" in navigator)) {
        toast.error("Geolocation not supported");
        return;
      }

      const wsUrl = process.env.NEXT_PUBLIC_MAP_MATCH_WS_URL as string;
      const ws = new WebSocket(wsUrl);

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        toast.error("WebSocket connection error");
      };

      let prevTime: Date = new Date();
      let currentGps: Gps;

      ws.onmessage = (event) => {
        try {
          const resp = JSON.parse(event.data);

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
            setMatchedHeading(0);
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
          
          const targetHeading = normalizeBearing(resp.data.edge_initial_bearing);
          const matched = resp.data.matched_gps_point.matched_coord;

          if (!currentGpsLocRef.current) {
            currentGpsLocRef.current = { lat: matched.lat, lon: matched.lon };
            setMatchedGpsLoc({ ...currentGpsLocRef.current });
            currentHeadingRef.current = targetHeading;
            setMatchedHeading(targetHeading);
          } else {
            const distance = haversineDistance(
              currentGpsLocRef.current.lat,
              currentGpsLocRef.current.lon,
              matched.lat,
              matched.lon
            ) * 1000;
            
            let duration = 0.5;
            if (speedMeanK.current > 0) {
              duration = distance / speedMeanK.current;
            }
            duration = Math.max(0.1, Math.min(duration, 3.0));

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
              }
            });

            gsap.to(currentHeadingRef, {
              current: targetHContinuous,
              duration: duration,
              ease: "none",
              onUpdate: () => {
                // No state update here, let the sync effect handle it
              }
            });
          }

          setSnappedEdgeID(resp.data.matched_gps_point.edge_id);
        } catch (err) {
          toast.error("Failed to parse WebSocket message");
        }
      };

      const watchId = navigator.geolocation.watchPosition(
        async (pos) => {
          const currentTime = new Date();
          deadReckoning.current = false;
          let deltaTime: number = 0;
          let speed = 0.0;

          if (orientation?.alpha == null) {
            // buat debugging di hp
            setGpsHeading(pos.coords.heading ? pos.coords.heading : 0);
          }

          if (pos.coords.speed !== null && pos.coords.speed !== undefined) {
            speed = pos.coords.speed;
          } else if (mapMatchStep.current > 1 && prevGps && prevGps.current) {
            deltaTime =
              (currentTime.getTime() -
                (prevGps.current?.time?.getTime() ?? 0)) /
              1000.0;
            const distance =
              haversineDistance(
                prevGps.current?.lat!,
                prevGps.current?.lon!,
                pos.coords.latitude,
                pos.coords.longitude,
              ) * 1000; //meter
            if (deltaTime > 0) {
              speed = distance / deltaTime; // meter/s
            }
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
          if (speed < MIN_SPEED_THRESHOLD && mapMatchStep.current > 1) {
            return;
          }

          let mapMatchRequest: MapMatchRequest = {
            gps_point: currentGps,
            k: mapMatchStep.current,
            candidates: candidates.current,
            speed_mean_k: speedMeanK.current,
            speed_std_k: speedStdK.current,
            last_bearing: lastBearing.current,
          };

          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(mapMatchRequest));
          }

          mapMatchStep.current += 1;

          prevGps.current = currentGps;
          prevTime = currentTime;
        },
        (err) => {
          const currentTime = new Date();
          if (err.code == err.POSITION_UNAVAILABLE || err.code == err.TIMEOUT) {
            // dead reckoning
            let now = new Date();
            if (
              prevGps &&
              prevGps.current &&
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

              let mapMatchRequest: MapMatchRequest = {
                gps_point: currentGps,
                k: mapMatchStep.current,
                candidates: candidates.current,
                speed_mean_k: speedMeanK.current,
                speed_std_k: speedStdK.current,
                last_bearing: lastBearing.current,
              };

              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(mapMatchRequest));
              }

              mapMatchStep.current += 1;

              prevTime = currentTime;
            }
          }
        },
        {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 5000,
        },
      );
      ws.onclose = (event) => {
        navigator.geolocation.clearWatch(watchId);
      };

      return () => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1000, "");
        }
      };
    } else {
      mapMatchStep.current = 1;
      candidates.current = [];
      speedMeanK.current = DEFAULT_CONSTANT_SPEED;
      speedStdK.current = DEFAULT_CONSTANT_SPEED;
      lastBearing.current = 0.0;
      prevGps.current = undefined;
      deadReckoning.current = false;
      setMatchedGpsLoc(undefined);
      setMatchedHeading(0);
      setSnappedEdgeID(0);
      isInitialReroutePerformed.current = false;
      currentGpsLocRef.current = null;
      currentHeadingRef.current = 0;
    }
  }, [routeStarted]);

  // Sync refs to state for UI updates at a controlled rate
  useEffect(() => {
    if (!routeStarted) return;
    
    let frameId: number;
    let lastLat = 0;
    let lastLon = 0;
    let lastH = 0;

    const sync = () => {
      if (currentGpsLocRef.current) {
        const curLat = currentGpsLocRef.current.lat;
        const curLon = currentGpsLocRef.current.lon;
        const curH = normalizeBearing(currentHeadingRef.current);
        
        // Only update state if values changed significantly
        const p1 = project(lastLat, lastLon);
        const p2 = project(curLat, curLon);
        const dist = Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
        
        if (gt(dist, THROTTLE_DISTANCE_THRESHOLD) || gt(Math.abs(curH - lastH), THROTTLE_HEADING_THRESHOLD)) {
          setMatchedGpsLoc({ lat: curLat, lon: curLon });
          setMatchedHeading(curH);
          lastLat = curLat;
          lastLon = curLon;
          lastH = curH;
        }
      }
      frameId = requestAnimationFrame(sync);
    };
    frameId = requestAnimationFrame(sync);
    return () => cancelAnimationFrame(frameId);
  }, [routeStarted]);

  // Keep a ref to alternativeRoutesLineData so the re-routing effect can read
  // the latest value without listing it as a dependency (which caused an infinite loop).
  const alternativeRoutesLineDataRef = useRef(alternativeRoutesLineData);
  useEffect(() => {
    alternativeRoutesLineDataRef.current = alternativeRoutesLineData;
  }, [alternativeRoutesLineData]);

  // re-routing logic useffect
  useEffect(() => {
    const usedRoute = routeData?.[activeRoute];

    if (matchedGpsLoc && usedRoute) {
      // update current driving direction & distance from turn point
      const usedRouteDirections = usedRoute.driving_directions;
      const directionsIndex = getCurrentUserDirectionIndex({
        snappedEdgeID: snappedEdgeID,
        drivingDirections: usedRouteDirections,
      });
      if (directionsIndex !== currentDirectionIndex) {
        setCurrentDirectionIndex(directionsIndex);
      }

      const newDist = getDistanceFromUserToNextTurn({
          matchedGpsLoc: matchedGpsLoc,
          nextTurnPoint: usedRouteDirections[directionsIndex].turn_point,
        }) * 1000.0;
      
      if (Math.abs(newDist - distanceFromNextTurnPoint) > 1) {
        setDistanceFromNextTurnPoint(newDist);
      }
    }

    const firstRouteEdgeID = usedRoute?.driving_directions[0]?.edge_ids[0];
    if (snappedEdgeID == firstRouteEdgeID || mapMatchStep.current == 1) {
      // skip re-route logic if current user location == source loc.
      return;
    }

    if (matchedGpsLoc && usedRoute) {
      const selectedRoute = usedRoute;
      // perform a re-route if the user's current location (snapped edge id) is outside the preferred route
      (async () => {
        const isOffTheRoute = isUserOffTheRoute({
          snappedEdgeID: snappedEdgeID,
          routeData: selectedRoute,
        });
        if (isOffTheRoute && snappedEdgeID !== -1) {
          if (mapMatchStep.current <= 5 && isInitialReroutePerformed.current) {
            return;
          }
          try {
            if (mapMatchStep.current <= 5) {
              isInitialReroutePerformed.current = true;
            }
            const reqBody = {
              srcLat: matchedGpsLoc.lat!,
              srcLon: matchedGpsLoc.lon!,
              destLat: destinationLoc?.osm_object.lat!,
              destLon: destinationLoc?.osm_object.lon!,
              reroute: true,
              startEdgeId: snappedEdgeID,
            };
            const newSpRouteData = await fetchRouteCRP(reqBody);
            setRouteData((prev) => {
              if (!prev) return [newSpRouteData.data];
              return prev.map((r, i) =>
                i === activeRoute ? newSpRouteData.data : r,
              );
            });
            const coords = polyline.decode(newSpRouteData.data.path);
            const linedata: LineData = {
              type: "Feature",
              geometry: {
                type: "LineString",
                coordinates: coords.map((coord) => [coord[1], coord[0]]),
              },
            };
            if (activeRoute == 0) {
              setPolylineData(linedata);
            } else {
              // Read from ref to avoid infinite loop (this effect must NOT depend on alternativeRoutesLineData)
              setAlternativeRoutesLineData(
                alternativeRoutesLineDataRef.current.map((r, i) =>
                  i === activeRoute ? linedata : r,
                ),
              );
            }
          } catch (e: any) {
            toast.error(
              `Failed to fetch route (re-routing): ${e?.message ?? "Unknown error"}`,
            );
          }
        }
      })();
    }
  }, [
    matchedGpsLoc,
    snappedEdgeID,
    routeData,
    activeRoute,
    destinationLoc,
  ]);

  const handleSetRouteDataCRP = useCallback((data: RouteCRPResponse[]) => {
    setRouteData(data);
  }, []);

  useEffect(() => {
    if (routeData?.length == 0) {
      setPolylineData(undefined);
      setAlternativeRoutesLineData([]);
    }
  }, [routeData]);

  useEffect(() => {
    if (!routeData || routeData.length === 0) {
      if (activeRoute !== 0) setActiveRoute(0);
      return;
    }

    if (activeRoute >= routeData.length) {
      setActiveRoute(0);
    }
  }, [routeData, activeRoute]);

  return (
    <main className="flex relative  w-full overflow-hidden">
      <MapComponent
        lineData={polylineData}
        onUserLocationUpdateHandler={onUserLocationUpdateHandler}
        alternativeRoutes={alternativeRoutesLineData}
        activeRoute={activeRoute}
        isDirectionActive={isDirectionActive}
        routeDataCRP={routeData}
        nextTurnIndex={nextTurnIndex}
        onSelectSource={onSelectSource}
        onSelectDestination={onSelectDestination}
        routeStarted={routeStarted}
        matchedGpsLoc={matchedGpsLoc}
        userHeading={userHeading}
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
        distanceFromNextTurnPoint={distanceFromNextTurnPoint}
        currentDirectionIndex={currentDirectionIndex}
        sourceLoc={sourceLoc}
        destinationLoc={destinationLoc}
        userLoc={userLoc}
        handleSetRouteDataCRP={handleSetRouteDataCRP}
        handleIsAlternativeChecked={handleClickAlternativeCheckbox}
        isAlternativeChecked={isAlternativeChecked}
        onSelectSource={onSelectSource}
        onSelectDestination={onSelectDestination}
      />

      {showResult && isSourceFocused && (
        <SearchResults places={searchResults} select={onSelectSource} />
      )}
      {showResult && isDestinationFocused && (
        <SearchResults places={searchResults} select={onSelectDestination} />
      )}
    </main>
  );
}
