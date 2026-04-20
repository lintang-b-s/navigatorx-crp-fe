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
}: MapComponentProps) {
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

  const activeRouteCoordinates = React.useMemo(() => {
    if (activeRoute === 0) {
      return lineData?.geometry.coordinates ?? [];
    }

    return alternativeRoutes?.[activeRoute]?.geometry.coordinates ?? [];
  }, [activeRoute, lineData, alternativeRoutes]);

  const turnVisuals = React.useMemo(() => {
    if (!routeDataCRP?.[activeRoute]?.driving_directions?.length) {
      return [];
    }

    return routeDataCRP[activeRoute].driving_directions.map((turn) => {
      const fallbackPoint: [number, number] = [
        turn.turn_point.lon,
        turn.turn_point.lat,
      ];

      const turnPolylineCoordinates = turn.polyline
        ? polyline
            .decode(turn.polyline)
            .map(([lat, lon]) => [lon, lat] as [number, number])
        : [];
      const lastTurnPolylineCoord =
        turnPolylineCoordinates[turnPolylineCoordinates.length - 1];

      const snapFromTurnPolyline = findBestSnapPoint(
        lastTurnPolylineCoord ?? fallbackPoint,
        turnPolylineCoordinates,
      );

      const snapFromActiveRoute = findBestSnapPoint(
        snapFromTurnPolyline?.point ?? fallbackPoint,
        activeRouteCoordinates,
      );

      return {
        ...turn,
        markerPoint:
          snapFromActiveRoute?.point ??
          snapFromTurnPolyline?.point ??
          fallbackPoint,
        bearing:
          snapFromActiveRoute?.bearing ??
          snapFromTurnPolyline?.bearing ??
          (turn.turn_bearing * 180) / Math.PI,
      };
    });
  }, [activeRoute, activeRouteCoordinates, routeDataCRP]);

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
    const activeRouteData = routeDataCRP?.[activeRoute];

    if (routeStarted && matchedGpsLoc) {
      // update view state to user current matched gps location
      setViewState({
        longitude: matchedGpsLoc!.lon,
        latitude: matchedGpsLoc!.lat,
        zoom: 16,
      });
      return;
    }
    if (isDirectionActive) {
      if (!activeRouteData) {
        return;
      }

      if (activeRoute == 0) {
        let zoomLevel = 15;
        if (activeRouteData.distance > 7 && activeRouteData.distance < 15) {
          zoomLevel = 12;
        } else if (activeRouteData.distance > 15 && activeRouteData.distance < 70) {
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
        if (activeRouteData.distance > 7 && activeRouteData.distance < 50) {
          zoomLevel = 12;
        } else if (activeRouteData.distance > 50) {
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
  ]);

  useEffect(() => {
    const turn = routeDataCRP?.[activeRoute]?.driving_directions?.[nextTurnIndex];
    if (nextTurnIndex != -1 && turn) {
      setViewState({
        longitude: turn.turn_point.lon,
        latitude: turn.turn_point.lat,
        zoom: 17,
      });
    }
  }, [nextTurnIndex, routeDataCRP, activeRoute]);

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
        turnVisuals.map((turn, i) => {
          const turnIcon = getTurnIconDirection(turn.turn_type);
          const indicatorStyle = getDirectionIndicatorStyle(viewState.zoom);
          const mapBearing = routeStarted ? userHeading : 0;

          if (turnIcon == "" || indicatorStyle.opacity === 0) {
            return null;
          }

          return (
            <Marker
              key={`turn-${i}`}
              longitude={turn.markerPoint[0]}
              latitude={turn.markerPoint[1]}
              anchor="center"
            >
              <div
                style={{
                  opacity: indicatorStyle.opacity,
                  transform: `scale(${indicatorStyle.scale})`,
                  transformOrigin: "center",
                  transition: "opacity 120ms linear, transform 120ms linear",
                }}
                className="flex flex-col items-center gap-1"
              >
                <Image
                  src={turnIcon}
                  alt="turn icon"
                  width={30}
                  height={30}
                  style={{
                    transform: `rotate(${turn.bearing - mapBearing}deg)`,
                    filter: "brightness(0) invert(1)",
                  }}
                />
                <p
                  className="text-center text-white font-semibold drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]"
                  style={{
                    fontSize: `${indicatorStyle.textSizePx}px`,
                    maxWidth: `${indicatorStyle.labelWidthPx}px`,
                    lineHeight: 1.15,
                  }}
                >
                  {turn.instruction}
                </p>
              </div>
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

      {routeStarted && matchedGpsLoc && (
        <Marker
          latitude={matchedGpsLoc.lat}
          longitude={matchedGpsLoc.lon}
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
      return "/icons_white/turn_right.png";
    case "TURN_SHARP_RIGHT":
      return "/icons_white/turn_right.png";
    case "TURN_LEFT":
      return "/icons_white/turn_left.png";
    case "TURN_SHARP_LEFT":
      return "/icons_white/turn_left.png";
    case "":
      return "/icons/straight.png";
    case "TURN_SLIGHT_RIGHT":
      return "/icons_white/turn_slight_right.png";
    case "TURN_SLIGHT_LEFT":
      return "/icons_white/turn_slight_left.png";
    case "KEEP_RIGHT":
      return "/icons_white/turn_slight_right.png";
    case "KEEP_LEFT":
      return "/icons_white/turn_slight_left.png";
    case "MERGE_ONTO":
      return `/icons_white/merge_onto.png`;
  }
  return "";
}

function getDirectionIndicatorStyle(zoom: number) {
  if (zoom <= 13.4) {
    return { opacity: 0, scale: 0.4, textSizePx: 8, labelWidthPx: 100 };
  }

  if (zoom >= 17.5) {
    return { opacity: 1, scale: 1, textSizePx: 13, labelWidthPx: 170 };
  }

  const ratio = (zoom - 13.4) / (17.5 - 13.4);

  return {
    opacity: ratio,
    scale: 0.4 + ratio * 0.6,
    textSizePx: 8 + ratio * 5,
    labelWidthPx: 100 + ratio * 70,
  };
}

function findBestSnapPoint(
  point: [number, number],
  routeCoordinates: number[][],
): { point: [number, number]; bearing: number } | null {
  if (routeCoordinates.length < 2) {
    return null;
  }

  let bestDistanceSq = Infinity;
  let bestPoint: [number, number] = point;
  let bestBearing = 0;

  for (let i = 0; i < routeCoordinates.length - 1; i++) {
    const start = routeCoordinates[i] as [number, number];
    const end = routeCoordinates[i + 1] as [number, number];

    const snapped = snapPointToSegment(point, start, end);
    const dx = point[0] - snapped[0];
    const dy = point[1] - snapped[1];
    const distanceSq = dx * dx + dy * dy;

    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      bestPoint = snapped;
      bestBearing = getBearingDegrees(start, end);
    }
  }

  return { point: bestPoint, bearing: bestBearing };
}

function snapPointToSegment(
  point: [number, number],
  start: [number, number],
  end: [number, number],
): [number, number] {
  const segmentX = end[0] - start[0];
  const segmentY = end[1] - start[1];
  const segmentLengthSq = segmentX * segmentX + segmentY * segmentY;

  if (segmentLengthSq === 0) {
    return start;
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      ((point[0] - start[0]) * segmentX + (point[1] - start[1]) * segmentY) /
        segmentLengthSq,
    ),
  );

  return [start[0] + t * segmentX, start[1] + t * segmentY];
}

function getBearingDegrees(start: [number, number], end: [number, number]) {
  const startLat = (start[1] * Math.PI) / 180;
  const startLon = (start[0] * Math.PI) / 180;
  const endLat = (end[1] * Math.PI) / 180;
  const endLon = (end[0] * Math.PI) / 180;

  const dLon = endLon - startLon;
  const y = Math.sin(dLon) * Math.cos(endLat);
  const x =
    Math.cos(startLat) * Math.sin(endLat) -
    Math.sin(startLat) * Math.cos(endLat) * Math.cos(dLon);

  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return (bearing + 360) % 360;
}
