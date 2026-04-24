"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import toast from "react-hot-toast";
import { SimulationPanel } from "@/app/ui/simulationPanel";
import { Coord, MapMatchRequest, Candidate } from "@/app/lib/mapmatchApi";
import { haversineDistance } from "@/app/lib/util";
import { useDeviceOrientation } from "@/app/hook";
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

const RAD_TO_DEG = 180 / Math.PI;

const normalizeBearing = (bearing: number) => {
  return ((bearing % 360) + 360) % 360;
};

export default function SimulationPage() {
  const [matchedGpsLoc, setMatchedGpsLoc] = useState<Coord>();
  const [matchedHeading, setMatchedHeading] = useState<number>(0);
  const [isRunning, setIsRunning] = useState(false);
  const stopSimulationRef = useRef(false);
  const currentGpsLocRef = useRef<Coord | null>(null);
  const currentHeadingRef = useRef<number>(0);
  
  // Dummy data required by MapComponent props
  const [userLoc, setUserLoc] = useState({ longitude: -100, latitude: 40 });

  const onSimulationStop = useCallback(() => {
    setIsRunning(false);
    stopSimulationRef.current = true;
  }, []);

  const onSimulationStart = useCallback(async (points: any[], useWebSocket: boolean) => {
    if (points.length === 0) return;
    
    setIsRunning(true);
    stopSimulationRef.current = false;

    let candidates: Candidate[] = [];
    let speedMeanK = 8.3333;
    let speedStdK = 8.3333;

    let prev: any = null;
    let prevTime: Date | null = null;
    const defaultConstantSpeed = 8.3333; // meter/s
    let defaultSamplingInterval = 1.0; // default 1s
    let lastBearing = 0.0;

    const startTime = new Date(points[0].datetime_utc);
    const endTime = new Date(points[points.length - 1].datetime_utc);

    let ws: WebSocket | null = null;
    if (useWebSocket) {
      const wsUrl = process.env.NEXT_PUBLIC_MAP_MATCH_WS_URL || `ws://${window.location.hostname}:6767/ws`;
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

    const httpUrl = process.env.NEXT_PUBLIC_MAP_MATCH_HTTP_URL || "http://localhost:6161/api/onlineMapMatch";

    for (
      let currentTime = new Date(startTime);
      currentTime <= endTime;
      currentTime = new Date(currentTime.getTime() + 1000)
    ) {
      if (stopSimulationRef.current) break;

      const point = points.find((p) => {
        const t = new Date(p.datetime_utc);
        return Math.abs(t.getTime() - currentTime.getTime()) < 1000;
      });

      let mapMatchRequest: MapMatchRequest | null = null;
      let deadReckoning = false;

      if (point) {
        const t = new Date(point.datetime_utc);
        let speed = 0;
        let dt_seconds = 0.0;

        if (prev) {
          const prevT = new Date(prev.datetime_utc);
          dt_seconds = (t.getTime() - prevT.getTime()) / 1000.0;
          const distance = haversineDistance(
            prev.Latitude,
            prev.Longitude,
            point.Latitude,
            point.Longitude
          ) * 1000; // haversineDistance returns km, so * 1000 for meters
          if (dt_seconds > 0) {
            speed = distance / dt_seconds;
          }
        }

        mapMatchRequest = {
          gps_point: {
            lat: point.Latitude,
            lon: point.Longitude,
            time: t.toISOString() as any,
            speed: speed,
            delta_time: dt_seconds,
            dead_reckoning: false,
          },
          k: Math.round((t.getTime() - startTime.getTime()) / 1000) + 1,
          candidates: candidates,
          speed_mean_k: speedMeanK,
          speed_std_k: speedStdK,
          last_bearing: lastBearing,
        };

        prev = point;
        prevTime = t;
      } else {
        deadReckoning = true;

        mapMatchRequest = {
          gps_point: {
            lat: prev ? prev.Latitude : 0,
            lon: prev ? prev.Longitude : 0,
            time: currentTime.toISOString() as any,
            speed: defaultConstantSpeed,
            delta_time: prevTime
              ? (currentTime.getTime() - prevTime.getTime()) / 1000.0
              : defaultSamplingInterval,
            dead_reckoning: true,
          },
          k: Math.round((currentTime.getTime() - startTime.getTime()) / 1000) + 1,
          candidates: candidates,
          speed_mean_k: speedMeanK,
          speed_std_k: speedStdK,
          last_bearing: lastBearing,
        };
        prevTime = currentTime;
      }

      try {
        let apiResponse;
        const requestStartTime = performance.now();
        
        if (useWebSocket && ws && ws.readyState === WebSocket.OPEN) {
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
        
        const networkDurationSeconds = (performance.now() - requestStartTime) / 1000.0;

        if (apiResponse && apiResponse.data) {
          if (
            apiResponse.data.matched_gps_point &&
            apiResponse.data.matched_gps_point.matched_coord &&
            apiResponse.data.matched_gps_point.matched_coord.lat === 91 &&
            apiResponse.data.matched_gps_point.matched_coord.lon === 181
          ) {
            // reset
            candidates = [];
            speedMeanK = 8.3333;
            speedStdK = 8.3333;
            lastBearing = 0.0;
            setMatchedHeading(0);
            currentGpsLocRef.current = null;
            currentHeadingRef.current = 0;
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
              setMatchedGpsLoc({ ...currentGpsLocRef.current });
              currentHeadingRef.current = targetHeading;
              setMatchedHeading(targetHeading);
              // Small initial delay
              await new Promise((resolve) => setTimeout(resolve, 50));
            } else {
              const distance = haversineDistance(
                currentGpsLocRef.current.lat,
                currentGpsLocRef.current.lon,
                matched.lat,
                matched.lon
              ) * 1000;
              
              let duration = 0.5;
              if (speedMeanK > 0) {
                duration = distance / speedMeanK;
              }
              // Subtract the time it took to communicate with the server to keep the visual speed uniform
              duration = duration - networkDurationSeconds;
              
              // Keep it within reasonable bounds
              duration = Math.max(0.1, Math.min(duration, 3.0));

              // Calculate continuous target heading to avoid spinning the long way
              let diff = targetHeading - currentHeadingRef.current;
              if (diff > 180) diff -= 360;
              if (diff < -180) diff += 360;
              const targetHContinuous = currentHeadingRef.current + diff;

              await new Promise<void>((resolve) => {
                let animationsCompleted = 0;
                const checkDone = () => {
                  animationsCompleted++;
                  if (animationsCompleted === 2) resolve();
                };

                gsap.to(currentGpsLocRef.current, {
                  lat: matched.lat,
                  lon: matched.lon,
                  duration: duration,
                  ease: "none",
                  onUpdate: () => {
                    setMatchedGpsLoc({ ...currentGpsLocRef.current! });
                  },
                  onComplete: checkDone
                });

                gsap.to(currentHeadingRef, {
                  current: targetHContinuous,
                  duration: duration,
                  ease: "none",
                  onUpdate: () => {
                    setMatchedHeading(normalizeBearing(currentHeadingRef.current));
                  },
                  onComplete: checkDone
                });
              });
            }
          } else {
             await new Promise((resolve) => setTimeout(resolve, 50));
          }
          if (deadReckoning) {
            prev.Latitude = apiResponse.data.matched_gps_point.predicted_gps_coord.lat;
            prev.Longitude = apiResponse.data.matched_gps_point.predicted_gps_coord.lon;
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
    toast.success("Simulation finished");
  }, [onSimulationStop]);

  const onUserLocationUpdateHandler = useCallback((lat: number, lon: number) => {
    setUserLoc({ latitude: lat, longitude: lon });
  }, []);

  return (
    <main className="flex relative w-full overflow-hidden">
      <MapComponent
        lineData={undefined}
        onUserLocationUpdateHandler={onUserLocationUpdateHandler}
        alternativeRoutes={[]}
        activeRoute={0}
        isDirectionActive={false}
        routeDataCRP={undefined}
        nextTurnIndex={-1}
        onSelectSource={() => {}}
        onSelectDestination={() => {}}
        routeStarted={true} // Must be true to show the car marker
        matchedGpsLoc={matchedGpsLoc}
        userHeading={matchedHeading}
      />
      <SimulationPanel 
        onSimulationStart={onSimulationStart}
        onSimulationStop={onSimulationStop}
        isRunning={isRunning}
      />
    </main>
  );
}
