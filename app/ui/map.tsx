"use client";

import * as React from "react";
import {
  Map,
  Marker,
  useMap,
  GeolocateControl,
  Source,
  Layer,
  NavigationControl,
  Popup,
} from "@vis.gl/react-maplibre";
// @ts-ignore
import "maplibre-gl/dist/maplibre-gl.css"; // See notes below
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { LineData, MapComponentProps } from "../types/definition";
import Image from "next/image";
import { IoLocationSharp } from "react-icons/io5";
import { FaLocationArrow } from "react-icons/fa";
import polyline from "@mapbox/polyline";

const faLocationArrowDegree = 45.0; // in degrees
const MIN_ANIMATION_DURATION_SECONDS = 0.1;
const MAX_ANIMATION_DURATION_SECONDS = 1.2;

const toRadians = (value: number) => (value * Math.PI) / 180;
const distanceInMeters = (
  from: [number, number],
  to: [number, number],
): number => {
  const earthRadiusM = 6371000;
  const dLat = toRadians(to[1] - from[1]);
  const dLon = toRadians(to[0] - from[0]);
  const lat1 = toRadians(from[1]);
  const lat2 = toRadians(to[1]);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  return 2 * earthRadiusM * Math.asin(Math.sqrt(a));
};

const getNearestPointIndex = (
  target: [number, number],
  points: [number, number][],
) => {
  let nearestIdx = 0;
  let nearestDistance = Number.MAX_SAFE_INTEGER;

  for (let i = 0; i < points.length; i++) {
    const currentDistance = distanceInMeters(target, points[i]);
    if (currentDistance < nearestDistance) {
      nearestDistance = currentDistance;
      nearestIdx = i;
    }
  }

  return nearestIdx;
};

const buildAnimationPath = (
  from: [number, number],
  to: [number, number],
  directionPolyline: [number, number][],
): [number, number][] => {
  if (directionPolyline.length < 2) {
    return [from, to];
  }

  const fromIndex = getNearestPointIndex(from, directionPolyline);
  const toIndex = getNearestPointIndex(to, directionPolyline);

  if (fromIndex <= toIndex) {
    return [from, ...directionPolyline.slice(fromIndex + 1, toIndex + 1), to];
  }

  return [from, to];
};

const getPointAtProgress = (path: [number, number][], progress: number) => {
  if (path.length === 0) {
    return undefined;
  }
  if (path.length === 1) {
    return path[0];
  }

  const segmentLengths: number[] = [];
  let totalLength = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const segmentLength = distanceInMeters(path[i], path[i + 1]);
    segmentLengths.push(segmentLength);
    totalLength += segmentLength;
  }

  if (totalLength <= 0) {
    return path[path.length - 1];
  }

  const targetDistance = Math.min(Math.max(progress, 0), 1) * totalLength;
  let traversed = 0;

  for (let i = 0; i < segmentLengths.length; i++) {
    const nextTraversed = traversed + segmentLengths[i];
    if (targetDistance <= nextTraversed) {
      const localProgress = (targetDistance - traversed) / segmentLengths[i];
      const start = path[i];
      const end = path[i + 1];
      return [
        start[0] + (end[0] - start[0]) * localProgress,
        start[1] + (end[1] - start[1]) * localProgress,
      ] as [number, number];
    }
    traversed = nextTraversed;
  }

  return path[path.length - 1];
};

declare global {
  interface Window {
    gsap?: {
      to: (target: object, vars: Record<string, unknown>) => { kill: () => void };
    };
  }
}

export function MapComponent({
  lineData,
  onUserLocationUpdateHandler,
  alternativeRoutes,
  activeRoute,
  isDirectionActive,
  routeDataCRP,
  nextTurnIndex,
  onSelectSource,
  onSelectDestination,
  matchedGpsLoc,
  routeStarted,
  userHeading,
  matchedSpeedMpm,
  currentDirectionIndex,
}: MapComponentProps) {
  const [animatedMatchedGpsLoc, setAnimatedMatchedGpsLoc] = useState(matchedGpsLoc);
  const animationRef = React.useRef<{ kill: () => void } | null>(null);

  const [contextMenuCoord, setContextMenuCoord] = useState<{
    lng: number;
    lat: number;
  } | null>(null);

  const [viewState, setViewState] = React.useState({
    longitude: 110.37432,
    latitude: -7.78787,
    zoom: 13,
  });

  const [touchStartTime, setTouchStartTime] = useState<number | null>(null);

  function handleTouchStart(evt: any) {
    setTouchStartTime(Date.now());
  }

  function handleTouchEnd(evt: any) {
    if (touchStartTime && Date.now() - touchStartTime > 500) {
      setContextMenuCoord({ lng: evt.lngLat.lng, lat: evt.lngLat.lat });
    }
    setTouchStartTime(null);
  }

  useEffect(() => {
    if (!routeStarted) {
      animationRef.current?.kill();
      animationRef.current = null;
      setAnimatedMatchedGpsLoc(matchedGpsLoc);
    }
  }, [routeStarted, matchedGpsLoc]);

  useEffect(() => {
    if (!routeStarted || !matchedGpsLoc) {
      return;
    }

    const fromCoord = animatedMatchedGpsLoc ?? matchedGpsLoc;
    const toCoord: [number, number] = [matchedGpsLoc.lon, matchedGpsLoc.lat];
    const usedRoute = routeDataCRP?.[activeRoute];
    const currentDirection = usedRoute?.driving_directions[currentDirectionIndex];
    const decodedDirectionPolyline = currentDirection?.polyline
      ? polyline
          .decode(currentDirection.polyline)
          .map((coord) => [coord[1], coord[0]] as [number, number])
      : [];

    const path = buildAnimationPath(
      [fromCoord.lon, fromCoord.lat],
      toCoord,
      decodedDirectionPolyline,
    );
    const distance = path.reduce((total, _, index) => {
      if (index === 0) {
        return total;
      }
      return total + distanceInMeters(path[index - 1], path[index]);
    }, 0);
    const speedMps = Math.max(matchedSpeedMpm / 60, 2);
    const duration = Math.min(
      MAX_ANIMATION_DURATION_SECONDS,
      Math.max(MIN_ANIMATION_DURATION_SECONDS, distance / speedMps),
    );

    animationRef.current?.kill();

    const gsap = window.gsap;
    if (!gsap) {
      setAnimatedMatchedGpsLoc(matchedGpsLoc);
      return;
    }

    const tweenState = { progress: 0 };
    animationRef.current = gsap.to(tweenState, {
      progress: 1,
      duration,
      ease: "none",
      onUpdate: () => {
        const point = getPointAtProgress(path, tweenState.progress);
        if (!point) return;
        setAnimatedMatchedGpsLoc({ lon: point[0], lat: point[1] });
      },
    });
  }, [
    matchedGpsLoc,
    routeStarted,
    matchedSpeedMpm,
    routeDataCRP,
    activeRoute,
    currentDirectionIndex,
  ]);

  useEffect(() => {
    return () => {
      animationRef.current?.kill();
    };
  }, []);

  useEffect(() => {
    if (routeStarted && matchedGpsLoc) {
      // update view state to user current matched gps location
      setViewState({
        longitude: animatedMatchedGpsLoc?.lon ?? matchedGpsLoc!.lon,
        latitude: animatedMatchedGpsLoc?.lat ?? matchedGpsLoc!.lat,
        zoom: 16,
      });
      return;
    }
    if (isDirectionActive) {
      if (activeRoute == 0) {
        let zoomLevel = 15;
        if (routeDataCRP![0].distance > 7 && routeDataCRP![0].distance < 15) {
          zoomLevel = 12;
        } else if (
          routeDataCRP![0].distance > 15 &&
          routeDataCRP![0].distance < 70
        ) {
          zoomLevel = 10;
        }
        const midIndex = Math.floor(lineData!.geometry.coordinates.length / 2);
        setViewState({
          longitude: lineData!.geometry.coordinates[midIndex][0],
          latitude: lineData!.geometry.coordinates[midIndex][1],
          zoom: zoomLevel,
        });
      } else {
        let zoomLevel = 15;
        if (
          routeDataCRP![activeRoute].distance > 7 &&
          routeDataCRP![activeRoute].distance < 50
        ) {
          zoomLevel = 12;
        } else if (routeDataCRP![activeRoute].distance > 50) {
          zoomLevel = 10;
        }
        const midIndex = Math.floor(
          alternativeRoutes![activeRoute].geometry.coordinates.length / 2,
        );

        setViewState({
          longitude:
            alternativeRoutes![activeRoute].geometry.coordinates[midIndex][0],
          latitude:
            alternativeRoutes![activeRoute].geometry.coordinates[midIndex][1],
          zoom: zoomLevel,
        });
      }
    } else if (lineData && routeDataCRP?.length! > 0) {
      let zoomLevel = 15;
      if (routeDataCRP![0].distance > 7 && routeDataCRP![0].distance < 15) {
        zoomLevel = 12;
      } else if (
        routeDataCRP![0].distance > 15 &&
        routeDataCRP![0].distance < 50
      ) {
        zoomLevel = 11;
      } else if (routeDataCRP![0].distance > 50) {
        zoomLevel = 10;
      }
      const midIndex = Math.floor(lineData!.geometry.coordinates.length / 2);
      setViewState({
        longitude: lineData!.geometry.coordinates[midIndex][0],
        latitude: lineData!.geometry.coordinates[midIndex][1],
        zoom: zoomLevel,
      });
    }
  }, [
    isDirectionActive,
    lineData,
    alternativeRoutes,
    routeStarted,
    matchedGpsLoc,
    animatedMatchedGpsLoc,
  ]);

  useEffect(() => {
    if (nextTurnIndex != -1 && routeDataCRP) {
      const turn = routeDataCRP[activeRoute].driving_directions[nextTurnIndex];
      setViewState({
        longitude: turn.turn_point.lon,
        latitude: turn.turn_point.lat,
        zoom: 17,
      });
    }
  }, [nextTurnIndex]);

  return (
    <Map
      {...viewState}
      bearing={routeStarted ? userHeading : 0}
      style={{ width: "100vw", height: "100vh" }}
      onMove={(evt) => setViewState(evt.viewState)}
      mapStyle="https://tiles.openfreemap.org/styles/liberty"
      onContextMenu={(evt) => {
        evt.preventDefault();
        setContextMenuCoord({ lng: evt.lngLat.lng, lat: evt.lngLat.lat });
      }}
      onClick={() => {
        if (contextMenuCoord) setContextMenuCoord(null);
      }}
      touchZoomRotate={true}
      onLoad={(e) => {
        e.target.touchZoomRotate.enableRotation();
      }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {!routeStarted ? (
        <>
          <GeolocateControl
            position="bottom-right"
            positionOptions={{ enableHighAccuracy: true }}
            onGeolocate={(e) => {
              onUserLocationUpdateHandler(
                e.coords.latitude,
                e.coords.longitude,
              );
              setViewState((prev) => ({
                ...prev,
                latitude: e.coords.latitude,
                longitude: e.coords.longitude,
                zoom: 17,
              }));
            }}
            showAccuracyCircle={!routeStarted}
            showUserLocation={!routeStarted}
          />
          <NavigationControl position="bottom-right" />
        </>
      ) : (
        <>
          <GeolocateControl
            style={{ position: "absolute", bottom: "100px", right: "5px" }}
            positionOptions={{ enableHighAccuracy: true }}
            onGeolocate={(e) => {
              onUserLocationUpdateHandler(
                e.coords.latitude,
                e.coords.longitude,
              );
            }}
            showAccuracyCircle={false}
            showUserLocation={false}
          />
          <NavigationControl
            style={{ position: "absolute", bottom: "140px", right: "5px" }}
          />
        </>
      )}

      {/* show shortest path route on below of active route  if sp path not activeRoute*/}
      {!isDirectionActive && activeRoute != 0 && lineData && (
        <Source
          id="polyline-source"
          type="geojson"
          data={{
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: lineData.geometry.coordinates,
            },
            properties: {},
          }}
        >
          <Layer
            id="polyline-layer"
            type="line"
            source="polyline-source"
            paint={{
              "line-color": "#D5ACFF",
              "line-width": 5,
            }}
          />
        </Source>
      )}

      {!isDirectionActive &&
        alternativeRoutes?.length != 0 &&
        alternativeRoutes
          ?.filter((_, i) => i !== 0 && i !== activeRoute)
          .map((route, index) => {
            return (
              <Source
                key={`route-${index}`}
                id={`polyline-source-${index}`}
                type="geojson"
                data={{
                  type: "Feature",
                  geometry: {
                    type: "LineString",
                    coordinates: route.geometry.coordinates,
                  },
                  properties: {},
                }}
              >
                <Layer
                  id={`polyline-layer-${index}`}
                  type="line"
                  source={`polyline-source-${index}`}
                  paint={{
                    "line-color": "#D5ACFF",
                    "line-width": 4,
                  }}
                />
              </Source>
            );
          })}

      {/* active route is in alternative routes */}
      {activeRoute != 0 && alternativeRoutes?.[activeRoute] && (
        <>
          <Source
            id="active-route-source"
            type="geojson"
            data={{
              type: "Feature",
              geometry: {
                type: "LineString",
                coordinates:
                  alternativeRoutes[activeRoute].geometry.coordinates,
              },
              properties: {},
            }}
          >
            <Layer
              id="active-route-layer"
              type="line"
              source="active-route-source"
              paint={{
                "line-color": "#6111C1",
                "line-width": 5,
              }}
            />
          </Source>
        </>
      )}

      {isDirectionActive &&
        routeDataCRP &&
        routeDataCRP[activeRoute].driving_directions.map((turn, i) => {
          const turnIcon = getTurnIconDirection(turn.turn_type);

          if (turnIcon == "") {
            return null;
          }
          return (
            <Marker
              key={`turn-${i}`}
              longitude={turn.turn_point.lon}
              latitude={turn.turn_point.lat}
              anchor="center"
              scale={0.55}
            >
              <Image
                src={turnIcon}
                alt="turn icon"
                width={30}
                height={30}
                style={{
                  transform: `rotate(${
                    (turn.turn_bearing * 180) / Math.PI - userHeading
                  }deg)`,
                }}
              />
            </Marker>
          );
        })}

      {/* active route is shortest path route */}
      {activeRoute == 0 && lineData && (
        <>
          <Source
            id="polyline-source"
            type="geojson"
            data={{
              type: "Feature",
              geometry: {
                type: "LineString",
                coordinates: lineData.geometry.coordinates,
              },
              properties: {},
            }}
          >
            <Layer
              id="polyline-layer"
              type="line"
              source="polyline-source"
              paint={{
                "line-color": "#6111C1",
                "line-width": 5,
              }}
            />
          </Source>
        </>
      )}

      {routeStarted && (animatedMatchedGpsLoc ?? matchedGpsLoc) && (
        <Marker
          latitude={(animatedMatchedGpsLoc ?? matchedGpsLoc)!.lat}
          longitude={(animatedMatchedGpsLoc ?? matchedGpsLoc)!.lon}
          rotation={userHeading - faLocationArrowDegree}
          anchor="center"
        >
          <div
            className="bg-[#F7FBFA]/50 flex items-center justify-center
           rounded-full w-[50px] h-[50px]  "
          >
            <Image
              src={"navigation_material.svg"}
              alt="navigation icon"
              width={30}
              height={30}
            />
          </div>
        </Marker>
      )}

      {contextMenuCoord && (
        <Popup
          longitude={contextMenuCoord.lng}
          latitude={contextMenuCoord.lat}
          anchor="bottom"
          onClose={() => setContextMenuCoord(null)}
        >
          <div className="py-2 flex flex-col gap-2 justify-center">
            <div className="flex flex-row gap-2 items-center">
              <div className="flex items-center justify-center rounded-lg h-[35px] w-[35px] bg-[#FFE1DF]">
                <IoLocationSharp size={24} color="#FF3528" />
              </div>
              <p>
                {contextMenuCoord.lat.toPrecision(5)}, &nbsp;
                {contextMenuCoord.lng.toPrecision(6)}
              </p>
            </div>

            <ul>
              <li
                onClick={() => {
                  onSelectSource({
                    osm_object: {
                      id: 0,
                      name: `${contextMenuCoord.lat}, ${contextMenuCoord.lng}`,
                      lat: contextMenuCoord.lat,
                      lon: contextMenuCoord.lng,
                      type: "source",
                      address: "",
                    },
                    distance: 0,
                  });
                  setContextMenuCoord(null);
                }}
                className="text-lg  hover:bg-[#F2F4F7] py-2 rounded-lg"
              >
                Set as source point
              </li>
              <li
                onClick={() => {
                  onSelectDestination({
                    osm_object: {
                      id: 0,
                      name: `${contextMenuCoord.lat}, ${contextMenuCoord.lng}`,
                      lat: contextMenuCoord.lat,
                      lon: contextMenuCoord.lng,
                      type: "source",
                      address: "",
                    },
                    distance: 0,
                  });
                  setContextMenuCoord(null);
                }}
                className="text-lg hover:bg-[#F2F4F7] py-2 rounded-lg"
              >
                Set as destination point
              </li>
            </ul>
          </div>
        </Popup>
      )}
      <Source
        id="bounding-box"
        type="geojson"
        data={{
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [110.132, -8.2618],
              [110.9221, -8.2618],
              [110.9221, -6.888],
              [110.132, -6.888],
              [110.132, -8.2618],
            ],
          },
          properties: {},
        }}
      >
        <Layer
          id="boundingbox-layer-layer"
          type="line"
          source="boundingbox-layer-source"
          paint={{
            "line-color": "#2B7FFF",
            "line-width": 5,
          }}
        />
      </Source>
    </Map>
  );
}

function getTurnIconDirection(turnType: string): string {
  switch (turnType) {
    case "TURN_RIGHT":
      return "/icons2/turn-right.png";
    case "TURN_SHARP_RIGHT":
      return "/icons2/turn-right.png";
    case "TURN_LEFT":
      return "/icons2/turn-left.png";
    case "TURN_SHARP_LEFT":
      return "/icons2/turn-left.png";
    case "":
      return "/icons2/straight.png";
    case "TURN_SLIGHT_RIGHT":
      return "/icons2/turn-slight-right.png";
    case "TURN_SLIGHT_LEFT":
      return "/icons2/turn-slight-left.png";
    case "KEEP_RIGHT":
      return "/icons2/turn-slight-right.png";
    case "KEEP_LEFT":
      return "/icons2/turn-slight-left.png";
    case "MERGE_ONTO":
      return `/icons2/merge_onto.png`;
  }
  return "";
}
