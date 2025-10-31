"use client";
import Image from "next/image";
import { MapComponent } from "@/app/ui/map";
import { Router } from "@/app/ui/routing";
import { SearchResults } from "./ui/searchResult";
import { MouseEvent, Suspense, useEffect, useState } from "react";
import { useSearchParams, usePathname, useRouter } from "next/navigation";
import { fetchReverseGeocoding, fetchSearch, Place } from "@/app/lib/searchApi";
import toast from "react-hot-toast";
import {
  Direction,
  fetchAlternativeRoutes,
  fetchRoute,
  fetchRouteCRP,
  RouteCRPResponse,
  RouteResponse,
} from "./lib/navigatorxApi";
import polyline from "@mapbox/polyline";
import { Layer, Source } from "@vis.gl/react-maplibre";
import { GPSTrace, LineData } from "./types/definition";
import { fetchMapMatch } from "./lib/mapmatchApi";
import { haversineDistance } from "./lib/util";
import {
  getCurrentUserDirectionIndex,
  getDistanceFromUserToNextTurn,
  isUserOffTheRoute,
} from "./lib/routing";

export default function Home() {
  // real-time map matching states
  const [snappedEdgeID, setSnappedEdgeID] = useState<number>(-1);
  const [routeStarted, setRouteStarted] = useState(false);
  const [snappedGpsLoc, setSnappedGpsLoc] = useState<GPSTrace>();
  const [gpsHeading, setGpsHeading] = useState<number>(0); // bearing (user heading angle from North)
  const [distanceFromNextTurnPoint, setDistanceFromNextTurnPoint] =
    useState<number>(0); // in meter
  const [currentDirectionIndex, setCurrentDirectionIndex] = useState(1);
  const [gpsTraces, setGpsTraces] = useState<GPSTrace[]>([]);

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
  const [showResult, setShowResult] = useState(false);
  const [nextTurnIndex, setNextTurnIndex] = useState(-1);
  const pathname = usePathname();
  const [userLoc, setUserLoc] = useState<UserLocation>({
    longitude: -100,
    latitude: 40,
  });
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
      fetchSearch(source, userLoc.latitude, userLoc.longitude)
        .then((resp) => setSearchResults(resp.data))
        .catch((e) => toast.error(e.error));
      setShowResult(true);
    }

    if (isDestinationFocused && destination) {
      fetchSearch(destination, userLoc.latitude, userLoc.longitude)
        .then((resp) => setSearchResults(resp.data))
        .catch((e) => toast.error(e.error));
      setShowResult(true);
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
      const reqBody = {
        srcLat: sourceLoc?.osm_object.lat!,
        srcLon: sourceLoc?.osm_object.lon!,
        destLat: destinationLoc?.osm_object.lat!,
        destLon: destinationLoc?.osm_object.lon!,
      };
      const spCRPRouteData = await fetchRouteCRP(reqBody);
      const spRouteData = {
        travel_time: spCRPRouteData.data.travel_time,
        path: spCRPRouteData.data.path,
        distance: parseFloat((spCRPRouteData.data.distance / 1000).toFixed(2)),
        driving_directions: spCRPRouteData.data.driving_directions,
      };

      // const [spRouteData, alternativeRouteData] = await Promise.all([
      //   fetchRoute(reqBody),
      //   fetchAlternativeRoutes(reqBody),
      // ]);

      setActiveRoute(0);

      const coords = polyline.decode(spRouteData.path);
      const linedata: LineData = {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: coords.map((coord) => [coord[1], coord[0]]),
        },
      };

      setPolylineData(linedata);

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

      // const alternativesPolyline = alternativeRouteData.routes
      //   .slice(1)
      //   .map((route) => {
      //     const coords = polyline.decode(route.path);
      //     return {
      //       type: "Feature",
      //       geometry: {
      //         type: "LineString",
      //         coordinates: coords.map((coord) => [coord[1], coord[0]]),
      //       },
      //     };
      //   });
      // setAlternativeRoutesLineData([dummyRoute, ...alternativesPolyline]);
      // setAlternativeRoutesLineData([dummyRoute]);
      setRouteData([spRouteData]);

      // setRouteData([spRouteData, ...alternativeRouteData.routes.slice(1)]);
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

  // route started useffect
  useEffect(() => {
    if (routeStarted) {
      if (!("geolocation" in navigator)) {
        console.error("Geolocation not supported");
        return;
      }
      toast.error(
        "online map-matching and route start features are still in development"
      );
      let currentGpsTraces: GPSTrace[] = [];

      const intervalId = setInterval(async () => {
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            if (currentGpsTraces.length > 0) {
              const currLastDistance = haversineDistance(
                pos.coords.latitude,
                pos.coords.longitude,
                currentGpsTraces[currentGpsTraces.length - 1].lat,
                currentGpsTraces[currentGpsTraces.length - 1].lon
              );
              // skip this logic if dist( current gps trace , last gps trace) < 8.14 meter
              if (currLastDistance * 1000 < 8.14) {
                return;
              }
              if (currentGpsTraces.length == 100) {
                // only save last 100 gps traces
                currentGpsTraces = currentGpsTraces.slice(1);
              }
            }

            currentGpsTraces.push({
              lat: pos.coords.latitude,
              lon: pos.coords.longitude,
            });

            try {
              // fetch map match api to get last snapped edge id on road network & projcetion of current gps trace
              const resp = await fetchMapMatch(currentGpsTraces);
              const lastProjectedLoc =
                resp.projection_coordinates[
                  resp.projection_coordinates.length - 1
                ];

              setSnappedEdgeID(
                resp.observations[resp.observations.length - 1].snapped_edge_id
              );

              if (
                snappedGpsLoc?.lat == lastProjectedLoc.lat &&
                snappedGpsLoc.lon == lastProjectedLoc.lon
              ) {
                // skip if current projection loc == prev projection loc
                return;
              }

              // update current heading & current snapped gps loc
              setGpsHeading(pos.coords.heading ? pos.coords.heading : 0);
              setGpsTraces(currentGpsTraces);
              setSnappedGpsLoc({
                lat: lastProjectedLoc.lat,
                lon: lastProjectedLoc.lon,
              });
            } catch (e: any) {
              console.log("Failed to fetch map match: ", e);
              toast.error("Failed to fetch map match: ", e);
            }
          },
          (err) => {
            // hmm break
            currentGpsTraces = [];
          },
          {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 5000,
          }
        );
      }, 1000);

      return () => {
        clearInterval(intervalId);
      };
    }
  }, [routeStarted]);

  // re-routing logic useffect
  useEffect(() => {
    const usedRoute = routeData?.[activeRoute];

    if (snappedGpsLoc) {
      // update current driving direction & distance from turn point
      // const usedRouteDirections = usedRoute!.driving_directions;
      const usedRouteDirections: Direction[] = [];
      const directionsIndex = getCurrentUserDirectionIndex({
        snappedEdgeID: snappedEdgeID,
        snappedGPSLoc: snappedGpsLoc,
        drivingDirections: usedRouteDirections!,
      });
      setCurrentDirectionIndex(directionsIndex);

      setDistanceFromNextTurnPoint(
        getDistanceFromUserToNextTurn({
          snappedGPSLoc: snappedGpsLoc,
          nextTurnPoint: usedRouteDirections![directionsIndex].turn_point,
        }) * 1000.0
      );
    }

    // const firstRouteEdgeID = usedRoute?.driving_directions[0].edge_ids[0];
    const firstRouteEdgeID = 0;
    if (snappedEdgeID == firstRouteEdgeID || gpsTraces.length == 1) {
      // skip re-route logic if current user location == source loc.
      return;
    }

    if (snappedGpsLoc) {
      // perform a re-route if the user's current location (snapped edge id) is outside the preferred route
      (async () => {
        // const isOffTheRoute = isUserOffTheRoute({
        //   snappedEdgeID: snappedEdgeID,
        //   snappedGPSLoc: {
        //     lat: snappedGpsLoc.lat,
        //     lon: snappedGpsLoc.lon,
        //   },
        //   routeData: usedRoute!,
        // });
        // if (isOffTheRoute) {
        //   // driver keluar jalur selected route -> do re-routing
        //   try {
        //     const reqBody = {
        //       srcLat: snappedGpsLoc.lat!,
        //       srcLon: snappedGpsLoc.lon!,
        //       destLat: destinationLoc?.osm_object.lat!,
        //       destLon: destinationLoc?.osm_object.lon!,
        //     };
        //     const newSpRouteData = await fetchRoute(reqBody);
        //     setRouteData((prev) => {
        //       if (!prev) return [newSpRouteData];
        //       return prev.map((r, i) =>
        //         i === activeRoute ? newSpRouteData : r
        //       );
        //     });
        //     const coords = polyline.decode(newSpRouteData.path);
        //     const linedata: LineData = {
        //       type: "Feature",
        //       geometry: {
        //         type: "LineString",
        //         coordinates: coords.map((coord) => [coord[1], coord[0]]),
        //       },
        //     };
        //     if (activeRoute == 0) {
        //       setPolylineData(linedata);
        //     } else {
        //       setAlternativeRoutesLineData([
        //         ...alternativeRoutesLineData.map((r, i) => {
        //           if (i == activeRoute) {
        //             return linedata;
        //           }
        //           return r;
        //         }),
        //       ]);
        //     }
        //   } catch (e: any) {
        //     console.log("Failed to fetch route (re-routing): ", e);
        //     toast.error("Failed to fetch route (re-routing): ", e);
        //   }
        // }
      })();
    }
  }, [snappedGpsLoc, snappedEdgeID, routeData]);

  // const handleSetRouteData = (data: RouteResponse[]) => {
  //   setRouteData(data);
  // };

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
        snappedGPSLoc={snappedGpsLoc}
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
        userLoc={userLoc}
        handleSetRouteDataCRP={handleSetRouteDataCRP}
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
