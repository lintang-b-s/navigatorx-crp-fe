"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import toast from "react-hot-toast";
import { SimulationPanel } from "@/app/ui/simulationPanel";
import { Coord, MapMatchRequest, Candidate } from "@/app/lib/mapmatchApi";
import { haversineDistance, project, gt } from "@/app/lib/util";
import gsap from "gsap";
import { fetchRouteCRP, RouteCRPResponse, fetchAlternativeRoutes } from "@/app/lib/navigatorxApi";
import { LineData } from "@/app/types/definition";
import polyline from "@mapbox/polyline";
import { 
  getCurrentUserDirectionIndex, 
  getDistanceFromUserToNextTurn, 
  isUserOffTheRoute,
  isNearEndOfSuggestAlternativesStep 
} from "@/app/lib/routing";
import { getTurnIcon } from "@/app/ui/routing";
import Image from "next/image";
import { FaCheck } from "react-icons/fa";
import { CiStop1 } from "react-icons/ci";
import { 
  THROTTLE_DISTANCE_THRESHOLD, 
  THROTTLE_HEADING_THRESHOLD,
  INVALID_LAT,
  INVALID_LON,
  MIN_SPEED_THRESHOLD,
  UPDATE_NAVIGATION_STATE_THRESHOLD_MS
} from "@/app/lib/constants";


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

export default function SimulationPage() {
  const [simulationState, setSimulationState] = useState<{
    matchedGpsLoc: Coord | undefined;
    matchedHeading: number;
    distanceFromNextTurnPoint: number;
    currentDirectionIndex: number;
  }>({
    matchedGpsLoc: undefined,
    matchedHeading: 0,
    distanceFromNextTurnPoint: 0,
    currentDirectionIndex: 0,
  });
  const [rawGpsLoc, setRawGpsLoc] = useState<Coord | undefined>(undefined);
  const { matchedGpsLoc, matchedHeading, distanceFromNextTurnPoint, currentDirectionIndex } = simulationState;
  const [isRunning, setIsRunning] = useState(false);
  const stopSimulationRef = useRef(false);
  const currentGpsLocRef = useRef<Coord | null>(null);
  const currentHeadingRef = useRef<number>(0);
  const logResultsRef = useRef<{ edge_id: number; lat: number; lon: number }[]>([]);
  
  // Dummy data required by MapComponent props
  const [userLoc, setUserLoc] = useState({ longitude: -100, latitude: 40 });

  const [gpsWindowPoints, setGpsWindowPoints] = useState<Coord[]>([]);

  // Routing states
  const [routeData, setRouteData] = useState<RouteCRPResponse[]>([]);
  const [activeRoute, setActiveRoute] = useState(0);
  const [snappedEdgeID, setSnappedEdgeID] = useState<number>(-1);
  const [polylineData, setPolylineData] = useState<LineData>();
  const [alternativeRoutesLineData, setAlternativeRoutesLineData] = useState<LineData[]>([]);
  const [isDrivingDirectionEnabled, setIsDrivingDirectionEnabled] = useState(false);
  
  // States for simplified UI
  const [isUsingWebSocket, setIsUsingWebSocket] = useState(false);
  const [isShowingGpsWindow, setIsShowingGpsWindow] = useState(false);
  const isShowingGpsWindowRef = useRef(false);
  const isUsingWebSocketRef = useRef(false);
  const routeDataRef = useRef<RouteCRPResponse[]>([]);
  const activeRouteRef = useRef(0);
  const snappedEdgeIDRef = useRef(-1);

  useEffect(() => { routeDataRef.current = routeData; }, [routeData]);
  useEffect(() => { activeRouteRef.current = activeRoute; }, [activeRoute]);
  useEffect(() => { snappedEdgeIDRef.current = snappedEdgeID; }, [snappedEdgeID]);

  // Memoized props for MapComponent to prevent unnecessary re-renders
  const handleSelectSource = useCallback(() => {}, []);
  const handleSelectDestination = useCallback(() => {}, []);

  const onSimulationStop = useCallback(() => {
    setIsRunning(false);
    stopSimulationRef.current = true;
    setGpsWindowPoints([]);
    setRawGpsLoc(undefined);
  }, []);

  const onSimulationStart = useCallback(async (
    points: any[], 
    useWebSocket: boolean, 
    showGpsWindow: boolean, 
    drivingDirection: boolean,
    writeToLog: boolean,
    fileName: string,
    trackName: string
  ) => {
    if (points.length === 0 || isRunning) return;
    
    const simulationId = Date.now().toString();
    logResultsRef.current = [];

    setIsRunning(true);
    stopSimulationRef.current = false;
    setGpsWindowPoints([]);
    setIsDrivingDirectionEnabled(drivingDirection);
    setIsUsingWebSocket(useWebSocket);
    setIsShowingGpsWindow(showGpsWindow);
    isShowingGpsWindowRef.current = showGpsWindow;
    isUsingWebSocketRef.current = useWebSocket;
    setRouteData([]);
    routeDataRef.current = [];
    setPolylineData(undefined);
    setSnappedEdgeID(-1);
    
    // Refs to track last updated values to avoid redundant state updates
    let lastSnappedEdgeID = -1;
    let lastDirectionIndex = -1;
    let lastDist = -1;
    let lastGpsWindowStr = "";
    let lastFetchedAlternativesStep = -1;

    setSimulationState({
      matchedGpsLoc: undefined,
      matchedHeading: 0,
      distanceFromNextTurnPoint: 0,
      currentDirectionIndex: 0,
    });
    setRawGpsLoc(undefined);

    if (drivingDirection) {
      try {
        const firstPoint = points[0];
        const lastPoint = points[points.length - 1];
        const reqBody = {
          srcLat: firstPoint.Latitude,
          srcLon: firstPoint.Longitude,
          destLat: lastPoint.Latitude,
          destLon: lastPoint.Longitude,
        };
        const [newSpRouteData, alternativeRouteData] = await Promise.all([
          fetchRouteCRP(reqBody),
          fetchAlternativeRoutes(reqBody),
        ]);

        const combinedRoutes = [
          newSpRouteData.data,
          ...(alternativeRouteData.data.alternative_routes || []),
        ];

        setRouteData(combinedRoutes);
        routeDataRef.current = combinedRoutes;
        
        const coords = polyline.decode(newSpRouteData.data.path);
        const linedata: LineData = {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: coords.map((coord) => [coord[1], coord[0]]),
          },
        };
        setPolylineData(linedata);

        const alternativesPolyline = (alternativeRouteData.data.alternative_routes || []).map((route) => {
          const coords = polyline.decode(route.path);
          return {
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: coords.map((coord) => [coord[1], coord[0]]),
            },
          } as LineData;
        });
        
        // In simulation, alternativeRoutesLineData includes a dummy at index 0 
        // to align with routeData (where index 0 is the main route)
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
        setAlternativeRoutesLineData([dummyRoute, ...alternativesPolyline]);

        setActiveRoute(0);
        activeRouteRef.current = 0;
      } catch (error: any) {
        toast.error("Failed to fetch initial route: " + error.message);
      }
    }

    let candidates: Candidate[] = [];
    let speedMeanK = 8.3333;
    let speedStdK = 8.3333;

    let prev: any = null;
    let prevTime: Date | null = null;
    let lastBearing = 0.0;

    let ws: WebSocket | null = null;
    if (useWebSocket) {
      const wsUrl = process.env.NEXT_PUBLIC_MAP_MATCH_WS_URL as string;
      ws = new WebSocket(wsUrl);
      ws.onerror = (e) => {
        console.error("WebSocket Error", e);
        toast.error("WebSocket connection failed.");
        onSimulationStop();
      }
      
      await new Promise((resolve) => {
        if (ws) {
          ws.onopen = () => resolve(true);
        }
      });
    }

    const httpUrl = process.env.NEXT_PUBLIC_MAP_MATCH_HTTP_URL || "http://localhost:6060/api/onlineMapMatch";

    let accumulatedDt = 0;
    for (let i = 0; i < points.length; i++) {
      if (stopSimulationRef.current) break;

      const point = points[i];
      const t = new Date(point.datetime_utc);

      if (isShowingGpsWindowRef.current) {
        const startIdx = Math.max(0, i - 10);
        const endIdx = Math.min(points.length - 1, i + 10);
        const window = points.slice(startIdx, endIdx + 1).map(p => ({
          lat: p.Latitude,
          lon: p.Longitude
        }));
        const windowStr = JSON.stringify(window);
        if (windowStr !== lastGpsWindowStr) {
          setGpsWindowPoints(window);
          lastGpsWindowStr = windowStr;
        }
      } else if (lastGpsWindowStr !== "empty") {
        setGpsWindowPoints([]);
        lastGpsWindowStr = "empty";
      }

      let mapMatchRequest: MapMatchRequest | null = null;
      let speed = 0;
      let dt_seconds = 0.0;

      if (prev) {
        const prevT = new Date(prev.datetime_utc);
        dt_seconds = (t.getTime() - prevT.getTime()) / 1000.0;
        
        if (point.speed !== undefined) {
          speed = point.speed;
        } else {
          const distance = haversineDistance(
            prev.Latitude,
            prev.Longitude,
            point.Latitude,
            point.Longitude
          ) * 1000;
            
          if (dt_seconds > 0) {
            speed = distance / dt_seconds;
          }
        }
      }

      accumulatedDt += dt_seconds;
      prev = point;
      prevTime = t;

      // Speed threshold check: skip if stationary (but not the first point)
      if (speed < MIN_SPEED_THRESHOLD && i !== 0) {
        const delay = Math.max(0.001, dt_seconds);
        await new Promise((resolve) => setTimeout(resolve, delay * 1000));
        continue;
      }
      // Only send request if accumulatedDt >= 1.0 or it's the first point
      if (i === 0 || accumulatedDt >= 1.0) {
        setRawGpsLoc({ lat: point.Latitude, lon: point.Longitude });
        mapMatchRequest = {
          gps_point: {
            lat: point.Latitude,
            lon: point.Longitude,
            time: t.toISOString() as any,
            speed: speed,
            delta_time: accumulatedDt || 1.0,
            dead_reckoning: false,
          },
          k: i + 1,
          candidates: candidates,
          speed_mean_k: speedMeanK,
          speed_std_k: speedStdK,
          last_bearing: lastBearing,
        };
        
        accumulatedDt = 0;
      } else {
        // Skip request, but wait for the native dt to keep sync
        // IMPORTANT: Always await even if dt is 0 to prevent synchronous infinite loops
        const delay = Math.max(0.001, dt_seconds);
        await new Promise((resolve) => setTimeout(resolve, delay * 1000));
        continue;
      }

      try {
        let apiResponse;

        
        if (isUsingWebSocketRef.current && ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(mapMatchRequest));
          apiResponse = await new Promise((resolve) => {
            ws!.onmessage = (event) => {
              resolve(JSON.parse(event.data));
            };
          });
        } else {
          const response = await fetch(httpUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(mapMatchRequest),
          });
          apiResponse = await response.json();
        }
        

        if (apiResponse && apiResponse.data) {
          if (
            apiResponse.data.matched_gps_point &&
            apiResponse.data.matched_gps_point.matched_coord &&
            apiResponse.data.matched_gps_point.matched_coord.lat === INVALID_LAT &&
            apiResponse.data.matched_gps_point.matched_coord.lon === INVALID_LON
          ) {
            // reset
            candidates = [];
            speedMeanK = 8.3333;
            speedStdK = 8.3333;
            lastBearing = 0.0;
            // No state update here, let the sync effect handle it
            currentGpsLocRef.current = null;
            currentHeadingRef.current = 0;
            // Ensure we await to prevent sync loop
            await new Promise((resolve) => setTimeout(resolve, 10));
            continue;
          }

          candidates = apiResponse.data.candidates || [];
          speedMeanK = apiResponse.data.speed_mean_k;
          speedStdK = apiResponse.data.speed_std_k;
          lastBearing = apiResponse.data.edge_initial_bearing;
          const targetHeading = normalizeBearing(lastBearing);

          if (
            apiResponse.data.matched_gps_point &&
            apiResponse.data.matched_gps_point.matched_coord
          ) {
            const matched = apiResponse.data.matched_gps_point.matched_coord;
            
            if (!currentGpsLocRef.current) {
              currentGpsLocRef.current = { lat: matched.lat, lon: matched.lon };
              currentHeadingRef.current = targetHeading;
              // No state update here, let the sync effect handle it
              // Small initial delay
              await new Promise((resolve) => setTimeout(resolve, 50));
            } else {
              const distance = haversineDistance(
                currentGpsLocRef.current.lat,
                currentGpsLocRef.current.lon,
                matched.lat,
                matched.lon
              ) * 1000;
              
              let duration = dt_seconds;
              
            
              // Calculate continuous target heading to avoid spinning the long way
              let diff = targetHeading - currentHeadingRef.current;
              if (diff > 180) diff -= 360;
              if (diff < -180) diff += 360;
              const targetHContinuous = currentHeadingRef.current + diff;

              await new Promise<void>((resolve) => {
                const animationData = {
                  lat: currentGpsLocRef.current!.lat,
                  lon: currentGpsLocRef.current!.lon,
                  heading: currentHeadingRef.current
                };

                gsap.to(animationData, {
                  lat: matched.lat,
                  lon: matched.lon,
                  heading: targetHContinuous,
                  duration: duration,
                  ease: "none",
                  onUpdate: () => {
                    currentGpsLocRef.current = { lat: animationData.lat, lon: animationData.lon };
                    currentHeadingRef.current = animationData.heading;
                    // No state update here, let the sync effect handle it
                  },
                  onComplete: () => resolve()
                });
              });
            }

            // Update routing info if enabled
            const currentMatchedLoc = { lat: matched.lat, lon: matched.lon };
            const currentEdgeID = apiResponse.data.matched_gps_point.edge_id;
            
            if (currentEdgeID !== lastSnappedEdgeID) {
              setSnappedEdgeID(currentEdgeID);
              lastSnappedEdgeID = currentEdgeID;
            }


            if (drivingDirection && routeDataRef.current.length > 0) {
              const usedRoute = routeDataRef.current[activeRouteRef.current];
              if (usedRoute && usedRoute.driving_directions.length > 0) {
                const directionsIndex = getCurrentUserDirectionIndex({
                  snappedEdgeID: currentEdgeID,
                  drivingDirections: usedRoute.driving_directions,
                });
                
                // Ensure directionsIndex is valid
                const safeIndex = Math.min(Math.max(0, directionsIndex), usedRoute.driving_directions.length - 1);
                if (safeIndex !== lastDirectionIndex) {
                  setSimulationState(prev => ({
                    ...prev,
                    currentDirectionIndex: safeIndex
                  }));
                  lastDirectionIndex = safeIndex;
                }

                const nextTurn = usedRoute.driving_directions[safeIndex];
                if (nextTurn && nextTurn.turn_point) {
                  const newDist = getDistanceFromUserToNextTurn({
                    matchedGpsLoc: currentMatchedLoc,
                    nextTurnPoint: nextTurn.turn_point,
                  }) * 1000.0;
                  
                  // Only update distance if it changed significantly (e.g. > 1m) to reduce re-renders
                  if (Math.abs(newDist - lastDist) > 1) {
                    setSimulationState(prev => ({
                      ...prev,
                      distanceFromNextTurnPoint: newDist
                    }));
                    lastDist = newDist;
                  }
                }

                // Check for dynamic alternatives trigger
                if (isNearEndOfSuggestAlternativesStep({
                  snappedEdgeID: currentEdgeID,
                  drivingDirections: usedRoute.driving_directions,
                  currentIndex: safeIndex
                }) && safeIndex !== lastFetchedAlternativesStep) {
                  lastFetchedAlternativesStep = safeIndex;
                  (async () => {
                    try {
                      const lastPoint = points[points.length - 1];
                      const altResponse = await fetchAlternativeRoutes({
                        srcLat: currentMatchedLoc.lat,
                        srcLon: currentMatchedLoc.lon,
                        destLat: lastPoint.Latitude,
                        destLon: lastPoint.Longitude,
                        reroute: true,
                        startEdgeId: currentEdgeID,
                      });

                      const newAlternatives = altResponse.data.alternative_routes || [];
                      if (newAlternatives.length > 0) {
                        const mainRoute = routeDataRef.current[0];
                        const combinedRoutes = [mainRoute, ...newAlternatives];
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
                          } as LineData;
                        });

                        const dummyRoute: LineData = {
                          type: "Feature",
                          geometry: {
                            type: "LineString",
                            coordinates: [[-100, 40], [-100, 40]],
                          },
                        };
                        setAlternativeRoutesLineData([dummyRoute, ...alternativesPolyline]);
                      }
                    } catch (e) {
                      console.error("Failed to fetch alternatives dynamically:", e);
                    }
                  })();
                }

                // Re-routing logic: trigger only if the user is on a valid edge and off the route
                let isOffTheRoute = isUserOffTheRoute({
                  snappedEdgeID: currentEdgeID,
                  routeData: usedRoute,
                });

                if (isOffTheRoute && currentEdgeID !== -1) {
                  // Check if the user moved to another existing route
                  const otherRouteIndex = routeDataRef.current.findIndex((route, idx) => 
                    idx !== activeRouteRef.current && !isUserOffTheRoute({ snappedEdgeID: currentEdgeID, routeData: route })
                  );

                  if (otherRouteIndex !== -1) {
                    setActiveRoute(otherRouteIndex);
                    activeRouteRef.current = otherRouteIndex;
                    isOffTheRoute = false; // Not actually off all routes
                    toast.success(`Switched to alternative route ${otherRouteIndex + 1}`);
                    
                    // Reset direction tracking for the new route
                    lastDirectionIndex = -1;
                  }
                }

                if (isOffTheRoute && currentEdgeID !== -1) {
                  try {
                    const lastPoint = points[points.length - 1];
                    const reqBody = {
                      srcLat: currentMatchedLoc.lat,
                      srcLon: currentMatchedLoc.lon,
                      destLat: lastPoint.Latitude,
                      destLon: lastPoint.Longitude,
                      reroute: true,
                      startEdgeId: currentEdgeID,
                    };
                    const [newSpRouteData, alternativeRouteData] = await Promise.all([
                      fetchRouteCRP(reqBody),
                      fetchAlternativeRoutes(reqBody),
                    ]);

                    const combinedRoutes = [
                      newSpRouteData.data,
                      ...(alternativeRouteData.data.alternative_routes || []),
                    ];

                    setRouteData(combinedRoutes);
                    routeDataRef.current = combinedRoutes;
                    const coords = polyline.decode(newSpRouteData.data.path);
                    const newLinedata: LineData = {
                      type: "Feature",
                      geometry: {
                        type: "LineString",
                        coordinates: coords.map((coord) => [coord[1], coord[0]]),
                      },
                    };
                    setPolylineData(newLinedata);

                    const alternativesPolyline = (alternativeRouteData.data.alternative_routes || []).map((route) => {
                      const coords = polyline.decode(route.path);
                      return {
                        type: "Feature",
                        geometry: {
                          type: "LineString",
                          coordinates: coords.map((coord) => [coord[1], coord[0]]),
                        },
                      } as LineData;
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
                    setAlternativeRoutesLineData([dummyRoute, ...alternativesPolyline]);
                    
                    // Reset active route to 0 after reroute
                    setActiveRoute(0);
                    activeRouteRef.current = 0;
                    
                    if (writeToLog) {
                      logResultsRef.current.push({
                        edge_id: currentEdgeID,
                        lat: matched.lat,
                        lon: matched.lon,
                      });
                    }
                  } catch (e: any) {
                    console.error("Re-routing failed:", e);
                  }
                }
              }
            }
          } else {
             const delay = Math.max(0.05, dt_seconds);
             await new Promise((resolve) => setTimeout(resolve, delay * 1000));
          }
        }
      } catch (error) {
        console.error("Error during map matching:", error);
        toast.error("Error during map matching");
        onSimulationStop();
        break;
      }
    }
    
    if (ws) {
      ws.close();
    }
    setIsRunning(false);

    if (writeToLog && logResultsRef.current.length > 0) {
      const content = logResultsRef.current
        .map((res) => `${res.edge_id},${res.lat},${res.lon}`)
        .join("\n");
       
      const blob = new Blob([content], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${simulationId}_${trackName}_${fileName}.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }

    toast.success("Simulation finished");
  }, [onSimulationStop, isRunning]);

  const onUserLocationUpdateHandler = useCallback((lat: number, lon: number) => {
    setUserLoc({ latitude: lat, longitude: lon });
  }, []);

  // Sync refs to state for UI updates at a controlled rate
  useEffect(() => {
    if (!isRunning) return;
    
    let frameId: number;
    let lastLat = 0;
    let lastLon = 0;
    let lastH = 0;
    let lastDistToTurn = 0;
    let lastDirIndex = -1;
    let lastUpdateTimestamp = 0;

    const sync = () => {
      if (currentGpsLocRef.current) {
        const curLat = currentGpsLocRef.current.lat;
        const curLon = currentGpsLocRef.current.lon;
        const curH = normalizeBearing(currentHeadingRef.current);
        
        // 1. Calculate routing state
        let updatedState: any = {};
        let stateChanged = false;

        const usedRoute = routeDataRef.current?.[activeRouteRef.current];
        if (usedRoute) {
          const usedRouteDirections = usedRoute.driving_directions;
          const directionsIndex = getCurrentUserDirectionIndex({
            snappedEdgeID: snappedEdgeIDRef.current,
            drivingDirections: usedRouteDirections,
          });
          
          if (directionsIndex !== lastDirIndex) {
            updatedState.currentDirectionIndex = directionsIndex;
            lastDirIndex = directionsIndex;
            stateChanged = true;
          }

          const dToTurn = getDistanceFromUserToNextTurn({
            matchedGpsLoc: { lat: curLat, lon: curLon },
            nextTurnPoint: usedRouteDirections[directionsIndex].turn_point,
          }) * 1000.0;
          
          if (Math.abs(dToTurn - lastDistToTurn) > 1) {
            updatedState.distanceFromNextTurnPoint = dToTurn;
            lastDistToTurn = dToTurn;
            stateChanged = true;
          }
        }

        // 2. Throttled position update
        const p1 = project(lastLat, lastLon);
        const p2 = project(curLat, curLon);
        const dist = Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
        
        // Threshold: 0.5m or 2 degrees
        if (dist > 0.5 || Math.abs(curH - lastH) > 2) {
          updatedState.matchedGpsLoc = { lat: curLat, lon: curLon };
          updatedState.matchedHeading = curH;
          lastLat = curLat;
          lastLon = curLon;
          lastH = curH;
          stateChanged = true;
        }

        const now = Date.now();
        if (stateChanged && now - lastUpdateTimestamp > UPDATE_NAVIGATION_STATE_THRESHOLD_MS) {
          setSimulationState(prev => ({ ...prev, ...updatedState }));
          lastUpdateTimestamp = now;
        }
      }
      frameId = requestAnimationFrame(sync);
    };
    frameId = requestAnimationFrame(sync);
    return () => cancelAnimationFrame(frameId);
  }, [isRunning]);

  return (
    <main className="flex relative w-full overflow-hidden">
      <MapComponent
        lineData={polylineData}
        onUserLocationUpdateHandler={onUserLocationUpdateHandler}
        alternativeRoutes={alternativeRoutesLineData}
        activeRoute={activeRoute}
        isDirectionActive={isDrivingDirectionEnabled && isRunning}
        routeDataCRP={routeData || []}
        nextTurnIndex={-1}
        onSelectSource={handleSelectSource}
        onSelectDestination={handleSelectDestination}
        routeStarted={true} // Must be true to show the car marker
        matchedGpsLoc={matchedGpsLoc}
        rawGpsLoc={rawGpsLoc}
        gpsWindowPoints={gpsWindowPoints}
        userHeading={matchedHeading}
        isSimulation={true}
        currentGpsLocRef={currentGpsLocRef}
        currentHeadingRef={currentHeadingRef}
      />
      
      {isRunning && isDrivingDirectionEnabled && (
        <div className="sm:hidden absolute top-4 left-1/2 -translate-x-1/2 w-[94vw] z-20 flex flex-col gap-2">
          <div className="bg-white/90 backdrop-blur-sm rounded-xl p-3 shadow-lg flex items-center justify-between">
            <div className="flex gap-4">
              <button 
                onClick={() => {
                  const newVal = !isUsingWebSocket;
                  setIsUsingWebSocket(newVal);
                  isUsingWebSocketRef.current = newVal;
                  toast.success(newVal ? "WebSocket enabled (will apply on next request if possible)" : "WebSocket disabled");
                }}
                className="flex items-center gap-1.5 cursor-pointer"
              >
                <div className={`w-3.5 h-3.5 rounded-full flex items-center justify-center transition-all ${isUsingWebSocket ? "bg-blue-500" : "border border-gray-400"}`}>
                  {isUsingWebSocket && <FaCheck size={8} color="white" />}
                </div>
                <span className="text-[10px] font-medium text-gray-600">WS</span>
              </button>
              <button 
                onClick={() => {
                  const newVal = !isShowingGpsWindow;
                  setIsShowingGpsWindow(newVal);
                  isShowingGpsWindowRef.current = newVal;
                }}
                className="flex items-center gap-1.5 cursor-pointer"
              >
                <div className={`w-3.5 h-3.5 rounded-full flex items-center justify-center transition-all ${isShowingGpsWindow ? "bg-blue-500" : "border border-gray-400"}`}>
                  {isShowingGpsWindow && <FaCheck size={8} color="white" />}
                </div>
                <span className="text-[10px] font-medium text-gray-600">GPS Win</span>
              </button>
            </div>
            <button 
              onClick={onSimulationStop}
              className="bg-red-500 hover:bg-red-600 text-white px-4 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors"
            >
              <CiStop1 size={14} /> STOP
            </button>
          </div>

          {routeData.length > 0 && routeData[activeRoute] && routeData[activeRoute].driving_directions[currentDirectionIndex] && (
            <div className="bg-[#222831]/95 backdrop-blur-md rounded-2xl p-4 shadow-xl flex items-center gap-4 border border-white/10">
              <div className="bg-white/10 p-2 rounded-xl">
                <Image
                  src={getTurnIcon(
                    routeData[activeRoute].driving_directions[currentDirectionIndex].turn_type,
                    "icons_white"
                  )}
                  width={42}
                  height={42}
                  alt="turn icon"
                />
              </div>
              <div className="flex flex-col">
                <p className="text-xl font-black text-white leading-tight">
                  {distanceFromNextTurnPoint.toFixed(0)} <span className="text-sm font-normal opacity-70">m</span>
                </p>
                <p className="text-sm font-bold text-blue-400 line-clamp-1">
                  {routeData[activeRoute].driving_directions[currentDirectionIndex].street_name}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      <div className={isRunning && isDrivingDirectionEnabled ? "hidden sm:block" : "block"}>
        <SimulationPanel 
          onSimulationStart={onSimulationStart}
          onSimulationStop={onSimulationStop}
          isRunning={isRunning}
        />
      </div>
    </main>
  );
}
