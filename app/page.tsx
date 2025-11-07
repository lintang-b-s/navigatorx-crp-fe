"use client";
import Image from "next/image";
import { MapComponent } from "@/app/ui/map";
import { Router } from "@/app/ui/routing";
import { SearchResults } from "./ui/searchResult";
import { MouseEvent, Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams, usePathname, useRouter } from "next/navigation";
import { fetchReverseGeocoding, fetchSearch, Place } from "@/app/lib/searchApi";
import toast from "react-hot-toast";
import {
  AlternativeRoutesResponse,
  Direction,
  fetchAlternativeRoutes,
  fetchRoute,
  fetchRouteCRP,
  RouteCRPResponse,
  RouteCRPResponseWrapper,
  RouteResponse,
} from "./lib/navigatorxApi";
import polyline from "@mapbox/polyline";
import { Layer, Source } from "@vis.gl/react-maplibre";
import { LineData } from "./types/definition";
import {
  Candidate,
  Coord,
  fetchMapMatch,
  Gps,
  MapMatchRequest,
} from "./lib/mapmatchApi";
import { haversineDistance } from "./lib/util";
import {
  getCurrentUserDirectionIndex,
  getDistanceFromUserToNextTurn,
  isUserOffTheRoute,
} from "./lib/routing";

const INVALID_LAT = 91;
const INVALID_LON = 181;

export default function Home() {
  // real-time map matching states
  const [snappedEdgeID, setSnappedEdgeID] = useState<number>(-1);
  const [routeStarted, setRouteStarted] = useState(false);
  const [matchedGpsLoc, setMatchedGpsLoc] = useState<Coord>();
  const [gpsHeading, setGpsHeading] = useState<number>(0); // bearing (user heading angle from North)
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

  const [showResult, setShowResult] = useState(false);
  const [nextTurnIndex, setNextTurnIndex] = useState(-1);
  const pathname = usePathname();
  const [userLoc, setUserLoc] = useState<UserLocation>({
    longitude: -100,
    latitude: 40,
  });

  const candidates = useRef<Candidate[]>([]);
  const speedMeanK = useRef<number>(500.0);
  const speedStdK = useRef<number>(500.0);
  const lastBearing = useRef<number>(0.0);
  const prevGps = useRef<Gps>(undefined);
  const mapMatchStep = useRef<number>(1);
  const deadReckoning = useRef<boolean>(false);

  const parseCoordinates = (input: string) => {
    const coordRegex =
      /^[-+]?([1-8]?\d(\.\d+)?|90(\.0+)?),\s*[-+]?(180(\.0+)?|((1[0-7]\d)|([1-9]?\d))(\.\d+)?)$/;
    if (coordRegex.test(input)) {
      const [lat, lon] = input.split(",").map((v) => parseFloat(v.trim()));
      if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
        return { lat, lon };
      }
    }
    return null;
  };

  const { replace } = useRouter();
  // search useffect
  useEffect(() => {
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
        }
      );
    } else {
      toast.error("Geolocation is not supported by this browser.");
    }
    replace(`${pathname}`);
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
          .catch((e) => toast.error(e.error));
        setShowResult(true);
      }
    }

    if (isDestinationFocused && destination) {
      const coords = parseCoordinates(destination);
      if (!coords) {
        fetchSearch(destination, userLoc.latitude, userLoc.longitude)
          .then((resp) => setSearchResults(resp.data))
          .catch((e) => toast.error(e.error));
        setShowResult(true);
      }
    }
  }, [isSourceFocused, searchParams, isDestinationFocused]);

  const pushParam = (key: "source" | "destination", place: Place) => {
    const p = new URLSearchParams(searchParams.toString());
    p.set(
      key,
      `${place.osm_object.name} ${
        place.osm_object.address != "" ? `, ${place.osm_object.address}` : ""
      }`
    );
    replace(`${pathname}?${p.toString()}`);
  };

  const handleClickAlternativeCheckbox = () => {
    setIsAlternativeChecked((prev) => !prev);
  };
  const onSelectSource = (place: Place) => {
    setSourceLoc(place);
    pushParam("source", place);
  };

  const onSelectDestination = (place: Place) => {
    setDestinationLoc(place);
    pushParam("destination", place);
  };

  const handleFocusSourceSearch = (val: boolean) => {
    setIsSourceFocused(val);
  };

  const onHandleGetRoutes = async (
    e: MouseEvent<HTMLButtonElement, MouseEvent>
  ) => {
    if (!sourceLoc || !destinationLoc) {
      toast.error("Please select both source and destination");
    }

    e.preventDefault();

    try {
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
        (spRouteData.data.distance / 1000).toFixed(2)
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
    }
  };

  const onHandleReverseGeocoding = async (
    e: MouseEvent<HTMLButtonElement, MouseEvent>,
    isSource: boolean
  ) => {
    if (!userLoc) {
      toast.error("Please select both source and destination");
    }
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

  const onUserLocationUpdateHandler = (lat: number, lon: number) => {
    setUserLoc({
      latitude: lat,
      longitude: lon,
    });
  };

  const handleRouteClick = (index: number) => {
    setActiveRoute(index);
  };

  const handleDirectionActive = (show: boolean) => {
    setIsDirectionActive(show);
  };

  const handleSetNextTurnIndex = (index: number) => {
    setNextTurnIndex(index);
  };

  const handleStartRoute = (start: boolean) => {
    setRouteStarted(start);
  };
  const defaultConstantSpeed = 500.0; // meter/min

  const mapMatchSamplingInterval = 80; // 80ms
  const lostGpsThreshold = 2000; // 2s
  // route started useffect
  useEffect(() => {
    if (routeStarted) {
      if (!("geolocation" in navigator)) {
        toast.error("Geolocation not supported");
        return;
      }

      const ws = new WebSocket("wss://navigatorx.lintangbs.my.id/ws");

      ws.onerror = (error) => {
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
            speedMeanK.current = 500.0;
            speedStdK.current = 500.0;
            lastBearing.current = 0.0;
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

          setMatchedGpsLoc(resp.data.matched_gps_point.matched_coord);
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

          if (mapMatchStep.current > 1 && prevGps && prevGps.current) {
            deltaTime =
              (currentTime.getTime() -
                (prevGps.current?.time?.getTime() ?? 0)) /
              60000.0;
            const distance =
              haversineDistance(
                prevGps.current?.lat!,
                prevGps.current?.lon!,
                pos.coords.latitude,
                pos.coords.longitude
              ) * 1000; //meter
            if (deltaTime > 0) {
              speed = distance / deltaTime; // meter/minute
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
          setGpsHeading(pos.coords.heading ? pos.coords.heading : 0);

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
                lostGpsThreshold
            ) {
              deadReckoning.current = true;
              currentGps = {
                lat: prevGps.current.lat,
                lon: prevGps.current.lon,
                speed: defaultConstantSpeed,
                delta_time: prevTime
                  ? (currentTime.getTime() - prevTime.getTime()) / 60000.0
                  : mapMatchSamplingInterval,
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
        }
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
      speedMeanK.current = 500.0;
      speedStdK.current = 500.0;
      lastBearing.current = 0.0;
      prevGps.current = undefined;
      deadReckoning.current = false;
      setMatchedGpsLoc(undefined);
      setSnappedEdgeID(0);
    }
  }, [routeStarted]);

  // re-routing logic useffect
  useEffect(() => {
    const usedRoute = routeData?.[activeRoute];

    if (matchedGpsLoc) {
      // update current driving direction & distance from turn point
      const usedRouteDirections = usedRoute!.driving_directions;
      const directionsIndex = getCurrentUserDirectionIndex({
        snappedEdgeID: snappedEdgeID,
        drivingDirections: usedRouteDirections!,
      });
      setCurrentDirectionIndex(directionsIndex);

      setDistanceFromNextTurnPoint(
        getDistanceFromUserToNextTurn({
          matchedGpsLoc: matchedGpsLoc,
          nextTurnPoint: usedRouteDirections![directionsIndex].turn_point,
        }) * 1000.0
      );
    }

    // const firstRouteEdgeID = usedRoute?.driving_directions[0].edge_ids[0];
    const firstRouteEdgeID = 0;
    if (snappedEdgeID == firstRouteEdgeID || mapMatchStep.current == 1) {
      // skip re-route logic if current user location == source loc.
      return;
    }

    if (matchedGpsLoc) {
      // perform a re-route if the user's current location (snapped edge id) is outside the preferred route
      (async () => {
        const isOffTheRoute = isUserOffTheRoute({
          snappedEdgeID: snappedEdgeID,

          routeData: usedRoute!,
        });
        if (isOffTheRoute) {
          // driver keluar jalur selected route -> do re-routing
          try {
            const reqBody = {
              srcLat: matchedGpsLoc.lat!,
              srcLon: matchedGpsLoc.lon!,
              destLat: destinationLoc?.osm_object.lat!,
              destLon: destinationLoc?.osm_object.lon!,
            };
            const newSpRouteData = await fetchRouteCRP(reqBody);
            setRouteData((prev) => {
              if (!prev) return [newSpRouteData.data];
              return prev.map((r, i) =>
                i === activeRoute ? newSpRouteData.data : r
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
              setAlternativeRoutesLineData([
                ...alternativeRoutesLineData.map((r, i) => {
                  if (i == activeRoute) {
                    return linedata;
                  }
                  return r;
                }),
              ]);
            }
          } catch (e: any) {
            toast.error("Failed to fetch route (re-routing): ", e);
          }
        }
      })();
    }
  }, [matchedGpsLoc, snappedEdgeID, routeData]);

  const handleSetRouteDataCRP = (data: RouteCRPResponse[]) => {
    setRouteData(data);
  };

  useEffect(() => {
    if (routeData?.length == 0) {
      setPolylineData(undefined);
      setAlternativeRoutesLineData([]);
    }
  }, [routeData]);

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
        gpsHeading={gpsHeading}
      />
      <Router
        sourceSearchActive={handleFocusSourceSearch}
        destinationSearchActive={setIsDestinationFocused}
        onHandleGetRoutes={onHandleGetRoutes}
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
