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
import { useEffect, useMemo, useState, useRef } from "react";
import maplibregl from "maplibre-gl";
import toast from "react-hot-toast";
import { LineData, MapComponentProps } from "../types/definition";
import Image from "next/image";
import { IoLocationSharp } from "react-icons/io5";
import { FaLocationArrow } from "react-icons/fa";
import polyline from "@mapbox/polyline";
import {
  fetchAlternativeRoutes,
  fetchRouteCRP,
  fetchBoundingBox,
} from "../lib/navigatorxApi";
import { haversineDistance } from "../lib/util";

const ACTIVE_ROUTE_COLOR = "#470DF9";
const ACTIVE_ROUTE_OPACITY = 0.9;
const ACTIVE_ROUTE_WIDTH_BY_ZOOM = [
  "interpolate",
  ["linear"],
  ["zoom"],
  10,
  2,
  13,
  4,
  15,
  6,
  17,
  8,
];

export const MapComponent = React.memo(function MapComponent({
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
  rawGpsLoc,
  gpsWindowPoints,
  routeStarted,
  userHeading,
  onMapClick,
  isSimulation,
  currentGpsLocRef,
  currentHeadingRef,
}: MapComponentProps) {
  const [contextMenuCoord, setContextMenuCoord] = useState<{
    lng: number;
    lat: number;
  } | null>(null);
  const mapRef = useRef<any>(null);

  const [boundingBoxGeoJSON, setBoundingBoxGeoJSON] = useState<any>(null);

  const [viewState, setViewState] = React.useState<{
    longitude: number;
    latitude: number;
    zoom: number;
    bearing: number;
    pitch: number;
  }>({
    longitude: 110.37432,
    latitude: -7.78787,
    zoom: 13,
    bearing: 0,
    pitch: 0,
  });

  useEffect(() => {
    const getBoundingBox = async () => {
      try {
        const response = await fetchBoundingBox();
        const { min_lat, min_lon, max_lat, max_lon } = response.data;

        setBoundingBoxGeoJSON({
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: [
              [min_lon, min_lat],
              [max_lon, min_lat],
              [max_lon, max_lat],
              [min_lon, max_lat],
              [min_lon, min_lat],
            ],
          },
        });

        const centerLon = (min_lon + max_lon) / 2;
        const centerLat = (min_lat + max_lat) / 2;
        setViewState((prev) => ({
          ...prev,
          longitude: centerLon,
          latitude: centerLat,
        }));
      } catch (error) {
        console.error("Failed to fetch bounding box:", error);
      }
    };
    getBoundingBox();
  }, []);

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

  // Removed easeTo useEffect here because we will handle camera movement at 60fps in ImperativeNavigationMarker

  useEffect(() => {
    if (routeStarted) return;

    const selectedCoordinates =
      activeRoute === 0
        ? lineData?.geometry.coordinates
        : alternativeRoutes?.[activeRoute]?.geometry.coordinates;

    if (!selectedCoordinates || selectedCoordinates.length === 0) {
      return;
    }

    if (mapRef.current) {
      const fittedViewport = getRouteFittedViewState(selectedCoordinates);
      mapRef.current.jumpTo({
        center: [fittedViewport.longitude, fittedViewport.latitude],
        zoom: fittedViewport.zoom,
        bearing: 0,
      });
    }
  }, [lineData, alternativeRoutes, activeRoute, routeStarted]);

  useEffect(() => {
    const turn =
      routeDataCRP?.[activeRoute]?.driving_directions?.[nextTurnIndex];
    if (nextTurnIndex != -1 && turn) {
      setViewState((prev) => ({
        ...prev,
        longitude: turn.turn_point.lon,
        latitude: turn.turn_point.lat,
        zoom: 17,
      }));
    }
  }, [nextTurnIndex, routeDataCRP, activeRoute]);

  const activeRouteCoordinates =
    activeRoute === 0
      ? lineData?.geometry.coordinates
      : alternativeRoutes?.[activeRoute]?.geometry.coordinates;

  const zoomBasedTurnScale = Math.max(
    0,
    Math.min(1, (viewState.zoom - 10) / (17 - 10)),
  );
  const turnIconSize = 40 * zoomBasedTurnScale;
  const turnOpacity = ACTIVE_ROUTE_OPACITY * zoomBasedTurnScale;

  // Memoize GeoJSON data objects so MapLibre doesn't re-parse identical data
  const spRouteGeoJSON = useMemo(() => {
    if (!lineData) return null;
    return {
      type: "Feature" as const,
      geometry: {
        type: "LineString" as const,
        coordinates: lineData.geometry.coordinates,
      },
      properties: {},
    };
  }, [lineData]);

  const activeRouteGeoJSON = useMemo(() => {
    if (activeRoute === 0 || !alternativeRoutes?.[activeRoute]) return null;
    return {
      type: "Feature" as const,
      geometry: {
        type: "LineString" as const,
        coordinates: alternativeRoutes[activeRoute].geometry.coordinates,
      },
      properties: {},
    };
  }, [activeRoute, alternativeRoutes]);

  // Memoize turn marker positions to avoid O(N×M) findClosestPointOnRoute per render
  const turnMarkers = useMemo(() => {
    if (!isDirectionActive || !routeDataCRP?.[activeRoute]?.driving_directions)
      return [];
    return routeDataCRP[activeRoute].driving_directions.map((turn) => {
      const turnIcon = getTurnIconDirection(turn.turn_type);

      const turnPointOnPolyline = findClosestPointOnRoute(
        turn.turn_point.lon,
        turn.turn_point.lat,
        activeRouteCoordinates,
      );

      return { turn, turnIcon, turnPointOnPolyline };
    });
  }, [isDirectionActive, routeDataCRP, activeRoute, activeRouteCoordinates]);

  const gpsWindowGeoJSON = useMemo(() => {
    if (!gpsWindowPoints || gpsWindowPoints.length === 0) return null;
    return {
      type: "FeatureCollection" as const,
      features: gpsWindowPoints.map((p) => ({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [p.lon, p.lat],
        },
        properties: {},
      })),
    };
  }, [gpsWindowPoints]);

  return (
    <Map
      {...viewState}
      style={{ width: "100vw", height: "100vh" }}
      onMove={(evt) => {
        setViewState(evt.viewState);
      }}
      mapStyle="https://tiles.openfreemap.org/styles/liberty"
      onContextMenu={(evt) => {
        evt.preventDefault();
        setContextMenuCoord({ lng: evt.lngLat.lng, lat: evt.lngLat.lat });
      }}
      onClick={(evt) => {
        if (contextMenuCoord) setContextMenuCoord(null);
        if (onMapClick) onMapClick(evt.lngLat.lat, evt.lngLat.lng);
      }}
      touchZoomRotate={true}
      onLoad={(e) => {
        mapRef.current = e.target;
        e.target.touchZoomRotate.enableRotation();
        e.target.touchZoomRotate.enable();
      }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {gpsWindowGeoJSON && (
        <Source id="gps-window-source" type="geojson" data={gpsWindowGeoJSON}>
          <Layer
            id="gps-window-layer"
            type="circle"
            paint={{
              "circle-radius": 5,
              "circle-color": "#FF0000",
              "circle-stroke-width": 1,
              "circle-stroke-color": "#FFFFFF",
              "circle-opacity": 0.6,
            }}
          />
        </Source>
      )}

      {isSimulation && rawGpsLoc && (
        <Source
          id="raw-gps-source"
          type="geojson"
          data={{
            type: "Feature",
            geometry: {
              type: "Point",
              coordinates: [rawGpsLoc.lon, rawGpsLoc.lat],
            },
            properties: {},
          }}
        >
          <Layer
            id="raw-gps-layer"
            type="circle"
            paint={{
              "circle-radius": 6,
              "circle-color": "#00FF00",
              "circle-stroke-width": 2,
              "circle-stroke-color": "#FFFFFF",
              "circle-opacity": 0.8,
            }}
          />
        </Source>
      )}

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
      {!isDirectionActive && activeRoute != 0 && spRouteGeoJSON && (
        <Source id="polyline-source" type="geojson" data={spRouteGeoJSON}>
          <Layer
            id="polyline-layer"
            type="line"
            source="polyline-source"
            paint={{
              "line-color": ACTIVE_ROUTE_COLOR,
              "line-width": 4,
              "line-opacity": 0.35,
            }}
          />
        </Source>
      )}

      {alternativeRoutes?.length != 0 &&
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
                    "line-color": ACTIVE_ROUTE_COLOR,
                    "line-width": 4,
                    "line-opacity": 0.35,
                  }}
                />
              </Source>
            );
          })}

      {/* active route is in alternative routes */}
      {activeRoute != 0 && activeRouteGeoJSON && (
        <>
          <Source
            id="active-route-source"
            type="geojson"
            data={activeRouteGeoJSON}
          >
            <Layer
              id="active-route-layer"
              type="line"
              source="active-route-source"
              paint={{
                "line-color": ACTIVE_ROUTE_COLOR,
                "line-width": ACTIVE_ROUTE_WIDTH_BY_ZOOM as any,
                "line-opacity": ACTIVE_ROUTE_OPACITY,
              }}
            />
          </Source>
        </>
      )}

      {isDirectionActive &&
        turnMarkers.map(({ turn, turnIcon, turnPointOnPolyline }, i) => {
          if (turnIcon === "" || turnIconSize <= 0) {
            return null;
          }
          return (
            <Marker
              key={`turn-${i}`}
              longitude={turnPointOnPolyline[0]}
              latitude={turnPointOnPolyline[1]}
              anchor="center"
            >
              <img
                src={turnIcon}
                alt="turn icon"
                width={turnIconSize}
                height={turnIconSize}
                style={{
                  display: "block",
                  opacity: turnOpacity,
                  filter: "drop-shadow(0px 0px 3px rgba(0,0,0,0.4))",
                  transform: `rotate(${
                    (turn.turn_bearing * 180) / Math.PI - userHeading
                  }deg)`,
                }}
              />
            </Marker>
          );
        })}

      {activeRoute == 0 && spRouteGeoJSON && (
        <>
          <Source id="polyline-source" type="geojson" data={spRouteGeoJSON}>
            <Layer
              id="polyline-layer"
              type="line"
              source="polyline-source"
              paint={{
                "line-color": ACTIVE_ROUTE_COLOR,
                "line-width": ACTIVE_ROUTE_WIDTH_BY_ZOOM as any,
                "line-opacity": ACTIVE_ROUTE_OPACITY,
              }}
            />
          </Source>
        </>
      )}

      {routeStarted && currentGpsLocRef && currentHeadingRef && (
        <ImperativeNavigationMarker
          currentGpsLocRef={currentGpsLocRef}
          currentHeadingRef={currentHeadingRef}
          routeStarted={routeStarted}
        />
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
      {boundingBoxGeoJSON && (
        <Source id="bounding-box" type="geojson" data={boundingBoxGeoJSON}>
          <Layer
            id="boundingbox-layer-layer"
            type="line"
            source="bounding-box"
            paint={{
              "line-color": "#2B7FFF",
              "line-width": 5,
            }}
          />
        </Source>
      )}
    </Map>
  );
});

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
    case "CONTINUE_ONTO":
      return "/icons_white/straight.png";
    case "TURN_SLIGHT_RIGHT":
      return "/icons_white/turn_slight_right.png";
    case "TURN_SLIGHT_LEFT":
      return "/icons_white/turn_slight_left.png";
    case "KEEP_RIGHT":
      return "/icons_white/fork_right.png";
    case "KEEP_LEFT":
      return "/icons_white/fork_left.png";
    case "MERGE_ONTO":
      return `/icons_white/merge_onto.png`;
  }
  return "";
}

function findClosestPointOnRoute(
  lon: number,
  lat: number,
  coordinates?: number[][],
): [number, number] {
  if (!coordinates || coordinates.length === 0) {
    return [lon, lat];
  }

  const R = 6371e3; // Earth radius in meters
  const lat1 = (lat * Math.PI) / 180;
  const cosLat = Math.cos(lat1);

  let minDistance = Number.POSITIVE_INFINITY;
  let closestPoint: [number, number] = [lon, lat];

  for (let i = 0; i < coordinates.length - 1; i++) {
    const p1 = coordinates[i];
    const p2 = coordinates[i + 1];

    // Convert degrees to approximate local meters
    const x1 = p1[0] * cosLat * R;
    const y1 = p1[1] * R;
    const x2 = p2[0] * cosLat * R;
    const y2 = p2[1] * R;
    const x0 = lon * cosLat * R;
    const y0 = lat * R;

    const dx = x2 - x1;
    const dy = y2 - y1;
    const dx0 = x0 - x1;
    const dy0 = y0 - y1;

    const lenSq = dx * dx + dy * dy;
    let t = 0;
    if (lenSq > 0) {
      t = Math.max(0, Math.min(1, (dx0 * dx + dy0 * dy) / lenSq));
    }

    const projX = x1 + t * dx;
    const projY = y1 + t * dy;

    const distSq = (x0 - projX) ** 2 + (y0 - projY) ** 2;
    if (distSq < minDistance) {
      minDistance = distSq;
      // Interpolate the exact closest point on the segment
      closestPoint = [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])];
    }
  }

  // If the polyline only has 1 point, the loop doesn't run, fallback to vertex
  if (coordinates.length === 1) {
    return [coordinates[0][0], coordinates[0][1]];
  }

  return closestPoint;
}

function getRouteFittedViewState(coordinates: number[][]): {
  longitude: number;
  latitude: number;
  zoom: number;
} {
  const [minLon, minLat, maxLon, maxLat] = coordinates.reduce(
    (acc, [lon, lat]) => [
      Math.min(acc[0], lon),
      Math.min(acc[1], lat),
      Math.max(acc[2], lon),
      Math.max(acc[3], lat),
    ],
    [
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ],
  );

  const centerLon = (minLon + maxLon) / 2;
  const centerLat = (minLat + maxLat) / 2;

  const mapWidth = typeof window !== "undefined" ? window.innerWidth : 1024;
  const mapHeight = typeof window !== "undefined" ? window.innerHeight : 768;
  const padding = 120;

  const safeWidth = Math.max(1, mapWidth - padding * 2);
  const safeHeight = Math.max(1, mapHeight - padding * 2);

  const lngDiff = Math.max(0.0001, maxLon - minLon);
  const zoomLng = Math.log2((360 * safeWidth) / (lngDiff * 256));

  const latFraction = Math.max(
    0.0001,
    (latToMercator(maxLat) - latToMercator(minLat)) / Math.PI,
  );
  const zoomLat = Math.log2(safeHeight / (256 * latFraction));

  const zoom = Math.max(9, Math.min(16, Math.min(zoomLng, zoomLat)));

  return {
    longitude: centerLon,
    latitude: centerLat,
    zoom,
  };
}

function latToMercator(lat: number): number {
  const sin = Math.sin((lat * Math.PI) / 180);
  return Math.log((1 + sin) / (1 - sin)) / 2;
}

const ImperativeNavigationMarker = ({
  currentGpsLocRef,
  currentHeadingRef,
  routeStarted,
}: {
  currentGpsLocRef: React.RefObject<any>;
  currentHeadingRef: React.RefObject<number>;
  routeStarted: boolean;
}) => {
  const mapContext = useMap();
  const markerRef = useRef<maplibregl.Marker | null>(null);

  useEffect(() => {
    const map = mapContext?.current;
    if (!routeStarted || !map) return;

    const el = document.createElement("div");
    el.className =
      "bg-[#F7FBFA]/50 flex items-center justify-center rounded-full w-[50px] h-[50px]";
    const img = document.createElement("img");
    img.src = "/navigation_material.svg";
    img.alt = "navigation icon";
    img.width = 30;
    img.height = 30;
    img.style.transition = "none";
    el.appendChild(img);

    const mapInstance = (map as any).getMap ? (map as any).getMap() : map;

    markerRef.current = new maplibregl.Marker({
      element: el,
      rotationAlignment: "map",
    })
      .setLngLat([
        currentGpsLocRef.current?.lon || 0,
        currentGpsLocRef.current?.lat || 0,
      ])
      .setRotation(currentHeadingRef.current || 0)
      .addTo(mapInstance);

    let frameId: number;
    let isUserInteracting = false;
    let interactionTimeout: NodeJS.Timeout;

    const onUserInteractionStart = () => {
      isUserInteracting = true;
      clearTimeout(interactionTimeout);
    };

    const onUserInteractionEnd = () => {
      clearTimeout(interactionTimeout);
      interactionTimeout = setTimeout(() => {
        isUserInteracting = false;
      }, 3000); // Resume tracking after 3 seconds of inactivity
    };

    mapInstance.on('dragstart', onUserInteractionStart);
    mapInstance.on('zoomstart', onUserInteractionStart);
    mapInstance.on('pitchstart', onUserInteractionStart);
    mapInstance.on('dragend', onUserInteractionEnd);
    mapInstance.on('zoomend', onUserInteractionEnd);
    mapInstance.on('pitchend', onUserInteractionEnd);

    const update = () => {
      if (currentGpsLocRef.current && markerRef.current) {
        const newLon = currentGpsLocRef.current.lon;
        const newLat = currentGpsLocRef.current.lat;
        const newHeading = currentHeadingRef.current || 0;

        if (newLon !== 0 && newLat !== 0) {
          markerRef.current.setLngLat([newLon, newLat]);
          markerRef.current.setRotation(newHeading);

          if (!isUserInteracting) {
            mapInstance.jumpTo({
              center: [newLon, newLat],
              bearing: newHeading,
              zoom: 17,
              padding: {
                top: window.innerHeight * (2 / 3),
                bottom: 0,
                left: 0,
                right: 0,
              }
            });
          }
        }
      }
      frameId = requestAnimationFrame(update);
    };
    frameId = requestAnimationFrame(update);

    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(interactionTimeout);
      mapInstance.off('dragstart', onUserInteractionStart);
      mapInstance.off('zoomstart', onUserInteractionStart);
      mapInstance.off('pitchstart', onUserInteractionStart);
      mapInstance.off('dragend', onUserInteractionEnd);
      mapInstance.off('zoomend', onUserInteractionEnd);
      mapInstance.off('pitchend', onUserInteractionEnd);
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
    };
  }, [routeStarted, currentGpsLocRef, currentHeadingRef, mapContext]);

  return null;
};
