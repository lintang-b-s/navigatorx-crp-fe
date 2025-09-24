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
import "maplibre-gl/dist/maplibre-gl.css"; // See notes below
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { LineData, MapComponentProps } from "../types/definition";
import Image from "next/image";
import { IoLocationSharp } from "react-icons/io5";
import { FaLocationArrow } from "react-icons/fa";

const userRouteMarkerDegree = 45.0; // in degrees

export function MapComponent({
  lineData,
  onUserLocationUpdateHandler,
  alternativeRoutes,
  activeRoute,
  isDirectionActive,
  routeData,
  nextTurnIndex,
  onSelectSource,
  onSelectDestination,
  snappedGPSLoc,
  routeStarted,
  gpsHeading,
}: MapComponentProps) {
  const [contextMenuCoord, setContextMenuCoord] = useState<{
    lng: number;
    lat: number;
  } | null>(null);

  const [viewState, setViewState] = React.useState({
    longitude: -100,
    latitude: 40,
    zoom: 3.5,
  });

  useEffect(() => {
    if (routeStarted && snappedGPSLoc) {
      // update view state to user current snapped gps location
      setViewState({
        longitude: snappedGPSLoc!.lon,
        latitude: snappedGPSLoc!.lat,
        zoom: 16,
      });
      return;
    }
    if (isDirectionActive) {
      if (activeRoute == 0) {
        let zoomLevel = 15;
        if (routeData![0].distance > 7 && routeData![0].distance < 15) {
          zoomLevel = 12;
        } else if (routeData![0].distance > 15 && routeData![0].distance < 70) {
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
          routeData![activeRoute].distance > 7 &&
          routeData![activeRoute].distance < 15
        ) {
          zoomLevel = 12;
        } else if (
          routeData![activeRoute].distance > 15 &&
          routeData![activeRoute].distance < 70
        ) {
          zoomLevel = 10;
        }
        const midIndex = Math.floor(
          alternativeRoutes![activeRoute].geometry.coordinates.length / 2
        );

        setViewState({
          longitude:
            alternativeRoutes![activeRoute].geometry.coordinates[midIndex][0],
          latitude:
            alternativeRoutes![activeRoute].geometry.coordinates[midIndex][1],
          zoom: zoomLevel,
        });
      }
    } else if (lineData && routeData?.length! > 0) {
      let zoomLevel = 15;
      if (routeData![0].distance > 7 && routeData![0].distance < 15) {
        zoomLevel = 12;
      } else if (routeData![0].distance > 15 && routeData![0].distance < 70) {
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
    snappedGPSLoc,
  ]);

  useEffect(() => {
    if (nextTurnIndex != -1 && routeData) {
      const turn = routeData[activeRoute].driving_directions[nextTurnIndex];
      setViewState({
        longitude: turn.turn_point.lon,
        latitude: turn.turn_point.lat,
        zoom: 17,
      });
    }
  }, [nextTurnIndex]);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setViewState({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            zoom: 15,
          });
        },
        (error) => {
          toast.error(error.message);
        }
      );
    } else {
      toast.error("Geolocation is not supported by this browser.");
    }
  }, []);

  return (
    <Map
      {...viewState}
      bearing={gpsHeading}
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
    >
      {!routeStarted ? (
        <>
          <GeolocateControl
            position="bottom-right"
            positionOptions={{ enableHighAccuracy: true }}
            onGeolocate={(e) => {
              onUserLocationUpdateHandler(
                e.coords.latitude,
                e.coords.longitude
              );
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
                e.coords.longitude
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
        routeData &&
        routeData[activeRoute].driving_directions.map((turn, i) => {
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
                   ( (turn.turn_bearing * 180) / Math.PI) - gpsHeading
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

      {routeStarted && snappedGPSLoc && (
        <Marker
          latitude={snappedGPSLoc.lat}
          longitude={snappedGPSLoc.lon}
          rotation={gpsHeading - userRouteMarkerDegree}
          anchor="center"
        >
          <div
            className="bg-[#9CDCED]/35 flex items-center justify-center
           rounded-full w-[70px] h-[70px]  "
          >
            <FaLocationArrow size={25} color="#00B0EB" />
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
  }
  return "";
}
