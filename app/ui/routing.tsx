"use client";
import { LiaSourcetree } from "react-icons/lia";
import { CiLocationOn } from "react-icons/ci";
import { BiDotsVerticalRounded } from "react-icons/bi";
import { Button } from "./button";
import { CiRoute, CiLocationArrow1 } from "react-icons/ci";
import { SearchBox } from "./search";
import { useEffect, useState } from "react";
import { RouterProps } from "../types/definition";
import { CiGps } from "react-icons/ci";
import { getArrivalTime, haversineDistance } from "@/app/lib/util";
import {
  CumulativeDirection,
  RouteCRPResponse,
  RouteResponse,
} from "../lib/navigatorxApi";
import { IoIosArrowBack } from "react-icons/io";
import Image from "next/image";
import { FaLocationArrow } from "react-icons/fa6";
import { FaCircle } from "react-icons/fa6";
import toast from "react-hot-toast";
import { AiOutlineThunderbolt } from "react-icons/ai";

import { FaCheck } from "react-icons/fa";

export function Router(props: RouterProps) {
  const [isSourceFocused, setIsSourceFocused] = useState(false);
  const [showDirections, setShowDirections] = useState(false);
  const [nowTime, setNowTime] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNowTime(new Date()), 5000);
    return () => clearInterval(id);
  }, []);

  const handleShowDirections = (show: boolean) => {
    setShowDirections(show);
  };

  useEffect(() => {
    if (props.isSourceFocused) {
      setIsSourceFocused(true);
    }
    if (props.isDestinationFocused) {
      setIsSourceFocused(false);
    }
  }, [props.isSourceFocused, props.isDestinationFocused]);

  return (
    <>
      {props.routeDataCRP?.length! > 0 &&
      !props.isSourceFocused &&
      !props.isDestinationFocused ? (
        <>
          {showRouteResultMobile(
            props,
            props.activeRoute,
            props.handleRouteClick,
            props.routeStarted,
            props.handleStartRoute,
            showDirections,
            handleShowDirections,
            props.handleSetNextTurnIndex
          )}
          {showRouteResult(
            props,
            props.activeRoute,
            props.handleRouteClick,
            showDirections,
            handleShowDirections,
            props.handleSetNextTurnIndex,
            props.handleStartRoute
          )}
          {showRouteEtaAndDistance(
            props,
            props.activeRoute,
            props.routeStarted,
            props.handleStartRoute,
            nowTime
          )}
        </>
      ) : (
        <div
          className={`${
            props.routeDataCRP?.length! > 0 &&
            !props.isSourceFocused &&
            !props.isDestinationFocused
              ? "hidden"
              : "block"
          } flex flex-col  h-[180px] w-[355px] sm:h-[200px] sm:w-[440px]  
       items-center  absolute top-10 left-[5%] md:left-10 bg-white
        rounded-lg overflow-hidden shadow-lg props.routeDataCRP`}
        >
          <div className="flex flex-row items-center gap-2 pt-8 px-4 ">
            <div className="flex flex-col gap-1 items-center ">
              <LiaSourcetree
                className="w-[20px] h-[20px] md:w-[25px] md:h-[25px] "
                color="#00A4EB"
              />
              <BiDotsVerticalRounded
                className="w-[20px] h-[20px] md:w-[25px] md:h-[25px] "
                color="#869CA7"
              />
              <CiLocationOn
                className="w-[20px] h-[20px] md:w-[25px] md:h-[25px] "
                color="#FF4B28"
              />
            </div>

            <div className="flex flex-col gap-4 items-start justify-center">
              <SearchBox isSource={true} activate={props.sourceSearchActive} />
              <SearchBox
                isSource={false}
                activate={props.destinationSearchActive}
              />
            </div>

            <Button onClick={(e) => props.onHandleGetRoutes(e)}>
              <CiRoute size={30} />
            </Button>
          </div>

          <button
            onClick={(e) => {
              props.onHandleReverseGeocoding(e, isSourceFocused);
            }}
            className={`flex flex-row px-4 mt-2  ${
              props.isSourceFocused || props.isDestinationFocused
                ? `opacity-100`
                : `opacity-0`
            }
          items-center space-x-4 cursor-pointer hover:bg-[#EDF3F6] w-full flex-1 `}
          >
            <CiGps size={25} color="#00A4EB" />{" "}
            <p className="text-sm ">Your Location</p>
          </button>
        </div>
      )}
    </>
  );
}

function showRouteResultMobile(
  props: RouterProps,
  activeRoute: number,
  handleRouteClick: (index: number) => void,
  routeStarted: boolean = false,
  handleStartRoute: (show: boolean) => void,
  showDirections: boolean = false,
  handleShowDirections: (show: boolean) => void,
  handleSetNextTurnIndex: (index: number) => void
) {
  const routeDirections = props.routeDataCRP![
    activeRoute
  ].driving_directions.reduce<CumulativeDirection[]>(
    (acc, currentDirection) => {
      const lastDirection = acc[acc.length - 1];
      const cumulativeEta = lastDirection
        ? lastDirection.cumulativeEta + currentDirection.travel_time
        : currentDirection.travel_time;
      const cumulativeDistance = lastDirection
        ? lastDirection.cumulativeDistance + currentDirection.distance
        : currentDirection.distance;

      return [
        ...acc,
        {
          ...currentDirection,
          cumulativeEta,
          cumulativeDistance,
        },
      ];
    },
    []
  );
  return (
    <div
      className={`sm:hidden flex  flex-col  ${
        routeStarted
          ? " h-[150px] bg-[#222831] w-full  rounded-md"
          : " h-[300px] bg-white ml-[2%] mt-[2%] w-[400px]  rounded-lg "
      } 
   absolute top-0 md:left-0 
 overflow-y-scroll  shadow-lg props.routeDataCRP`}
    >
      {!routeStarted ? (
        showDirections ? (
          <div className="flex flex-col py-2 flex-1 overflow-y-scroll">
            <div className="flex flex-row pr-3 items-center justify-between pb-2">
              <button
                className={`flex  h-[20px] items-center rounded-md bg-purple-600 px-3 
            text-sm font-medium text-white transition-colors
             hover:bg-purple-400 focus-visible:outline 
               focus-visible:outline-offset-2 focus-visible:outline-purple-500 active:bg-purple-600 
               cursor-pointer aria-disabled:opacity-50  ml-2  py-3 `}
                onClick={(e) => {
                  handleShowDirections(false);
                  props.handleDirectionActive(true);
                }}
              >
                <IoIosArrowBack size={20} color="white" />

                <p> Back</p>
              </button>
              <button
                className={`${
                  haversineDistance(
                    props.sourceLoc?.osm_object.lat!,
                    props.sourceLoc?.osm_object.lon!,
                    props.userLoc.latitude,
                    props.userLoc.longitude
                  ) < 0.15 // distance antara source point & gps location user < 150 meter
                    ? "flex"
                    : "hidden"
                }  ml-8 h-[30px] items-center rounded-lg bg-blue-500 px-3
                  text-sm font-mRouteedium text-white font-bold transition-colors
                   hover:bg-blue-400 focus-visible:outline 
                     focus-visible:outline-offset-2 focus-visible:outline-blue-500 active:bg-blue-600 
                     cursor-pointer aria-disabled:opacity-50 space-x-2 gap-x-1`}
                onClick={(e) => {
                  handleStartRoute(true);
                  props.handleDirectionActive(true);
                }}
              >
                <AiOutlineThunderbolt size={18} color="white" />
                Start Route{" "}
              </button>
            </div>
            {routeDirections.map((direction, index) => (
              <div
                key={`route-${index}`}
                className={`flex flex-row gap-2 items-center border-t-[1px] ${
                  index == routeDirections!.length - 1
                    ? "border-b-[1px] mb-10"
                    : ""
                }  border-[#D3DAE0] cursor-pointer group py2 `}
                onClick={() => {
                  handleSetNextTurnIndex(index);
                }}
              >
                <div
                  className={`w-1  h-full mr-1 bg-blue-500 group-hover:bg-[#B7BABF]`}
                ></div>
                <Image
                  src={getTurnIcon(direction.turn_type, "icons")}
                  width={24}
                  height={24}
                  alt={`turn-${index}`}
                  key={`turn-${index}`}
                />
                <div className="flex flex-col  py-4 gap-2  justify-start">
                  <div className="flex flex-row items-center gap-2">
                    <p className="text-base font-regular  ">
                      {direction.instruction}
                    </p>
                  </div>
                  <p className="text-sm font-light">
                    {direction.cumulativeEta.toPrecision(2)} menit (
                    {Math.round(direction.cumulativeDistance)} m)
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col py-2 flex-1">
            <div className="flex flex-row gap-2 items-center">
              <button
                className={`flex  h-[20px] items-center rounded-md bg-purple-600 px-3
            text-sm font-medium text-white transition-colors
             hover:bg-purple-400 focus-visible:outline 
               focus-visible:outline-offset-2 focus-visible:outline-purple-500 active:bg-purple-600 
               cursor-pointer aria-disabled:opacity-50  ml-2   py-3 `}
                onClick={(e) => {
                  props.handleSetRouteDataCRP([]);

                  props.handleDirectionActive(false);
                }}
              >
                <IoIosArrowBack size={20} color="white" />

                <p> Back</p>
              </button>
              <p className="ml-2 text-left text-base text-[#0a0a0a] mt-2 mb-2">
                Rute
              </p>
            </div>

            {props.routeDataCRP &&
              props.routeDataCRP.map((route, index) => (
                <div
                  key={`route-${index}`}
                  className={`flex flex-row items-center border-t-[1px] ${
                    index == props.routeDataCRP!.length - 1
                      ? "border-b-[1px]"
                      : ""
                  }  border-[#D3DAE0] cursor-pointer group `}
                  onClick={() => {
                    handleRouteClick(index);
                  }}
                >
                  <div
                    className={`w-1  h-full mr-4 ${
                      activeRoute == index && "bg-blue-500"
                    }  group-hover:bg-[#B7BABF]`}
                  ></div>
                  <div className="flex flex-col  py-2 gap-2  justify-start">
                    <p className="text-xs font-semibold  ">
                      <span className="text-lg font-bold">
                        {Math.round(route.travel_time).toPrecision(2)} Menit
                      </span>
                      <span>&nbsp;&nbsp;&nbsp;</span>
                      Tiba pada {getArrivalTime(route.travel_time)}{" "}
                    </p>
                    <p className="text-sm text-[#4C4C4C] ">
                      {route.distance} KM
                    </p>
                  </div>

                  <button
                    className={`flex ml-8 h-[30px] items-center rounded-lg bg-blue-500 px-2 
                  text-sm font-mRouteedium text-white transition-colors
                   hover:bg-blue-400 focus-visible:outline 
                     focus-visible:outline-offset-2 focus-visible:outline-blue-500 active:bg-blue-600 
                     cursor-pointer aria-disabled:opacity-50 space-x-2`}
                    onClick={(e) => {
                      handleShowDirections(true);
                    }}
                  >
                    <p>Show Directions</p>
                    <FaLocationArrow size={20} color="white" />
                  </button>
                </div>
              ))}
          </div>
        )
      ) : (
        <div className="flex flex-row mt-6 items-center ">
          <div className="mr-4">
            {" "}
            <Image
              // src={getTurnIcon(
              //   props.routeDataCRP![activeRoute].driving_directions[
              //     props.currentDirectionIndex
              //   ].turn_type,
              //   "icons_white"
              // )}
              src={getTurnIcon("TURN_RIGHT", "icons_white")}
              width={60}
              height={60}
              alt={`turn-start-route`}
              key={`turn-start-route`}
            />
          </div>
          <div className="flex flex-col gap-2   items-start justify-center">
            <p className="text-2xl font-bold text-white ">
              {props.distanceFromNextTurnPoint.toPrecision(4)} m
            </p>
            <p className="text-2xl font-bold text-[#1DA1F2]  ">
              {/* {
                props.routeDataCRP![activeRoute].driving_directions[
                  props.currentDirectionIndex
                ].street_name
              } */}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function showRouteEtaAndDistance(
  props: RouterProps,
  activeRoute: number,
  routeStarted: boolean = false,
  handleStartRoute: (show: boolean) => void,
  nowTime: Date
) {
  return (
    <div
      className={`${
        routeStarted ? "" : "hidden"
      }  z-10 absolute bottom-0 flex flex-row h-[100px] w-full bg-white items-center justify-between 
         px-2`}
    >
      {/* biar eta & distance ditengah */}
      <div></div>
      <div className="flex flex-col space-y-2 items-center justify-center">
        <p className="font-bold text-xl tracking-wide ">
          {new Date(
            nowTime.getTime() +
              props.routeDataCRP![activeRoute].travel_time * 60000
          ).toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
          })}
        </p>
        <div className="flex flex-row space-x-2 items-center">
          <p className="text-base ">
            {Math.round(props.routeDataCRP![activeRoute].travel_time)} menit
          </p>
          <FaCircle size={14} color="#dedfe0" />
          <p className="text-base ">
            {props.routeDataCRP![activeRoute].distance.toPrecision(1)} km
          </p>
        </div>
      </div>
      <button
        className="flex flex-row justify-center items-center  h-14 w-14  bg-[#dedfe0]
       rounded-full"
        onClick={() => {
          handleStartRoute(false);
        }}
      >
        <FaCheck size={15} color="#222831" />
      </button>
    </div>
  );
}

function showRouteResult(
  props: RouterProps,
  activeRoute: number,
  handleRouteClick: (index: number) => void,
  showDirections: boolean = false,
  handleShowDirections: (show: boolean) => void,
  handleSetNextTurnIndex: (index: number) => void,
  handleStartRoute: (start: boolean) => void
) {
  return (
    <div
      className={`hidden sm:flex  sm:flex-col  h-[150px] w-[355px] sm:h-full sm:w-[400px]  
   absolute top-0 md:left-0 bg-white
  rounded-lg overflow-hidden  shadow-lg props.routeDataCRP`}
    >
      <div className="flex  px-4 flex-col items-center py-2">
        <h3 className="text-center text-lg font-bold text-[#202124] tracking-wide">
          Rute Jalan
        </h3>
        <div className="flex flex-row items-center gap-2 pt-8 px-4 ">
          <div className="flex flex-col gap-1 items-center ">
            <LiaSourcetree
              className="w-[20px] h-[20px] md:w-[25px] md:h-[25px] "
              color="#00A4EB"
            />
            <BiDotsVerticalRounded
              className="w-[20px] h-[20px] md:w-[25px] md:h-[25px] "
              color="#869CA7"
            />
            <CiLocationOn
              className="w-[20px] h-[20px] md:w-[25px] md:h-[25px] "
              color="#FF4B28"
            />
          </div>

          <div className="flex flex-col gap-4 items-start justify-center">
            <SearchBox isSource={true} activate={props.sourceSearchActive} />
            <SearchBox
              isSource={false}
              activate={props.destinationSearchActive}
            />
          </div>

          <Button onClick={(e) => props.onHandleGetRoutes(e)}>
            <CiRoute size={30} />
          </Button>
        </div>
      </div>

      <div className="h-[20px] mt-8 w-full bg-[#E8EAED] "></div>

      {!showDirections ? (
        <div className="flex flex-col  py-2 flex-1">
          <p className="ml-2 text-left text-base text-[#666666] mt-2 mb-2">
            Rute
          </p>

          {props.routeDataCRP &&
            props.routeDataCRP.map((route, index) => (
              <div
                key={`route-${index}`}
                className={`flex flex-row items-center border-t-[1px] ${
                  index == props.routeDataCRP!.length - 1
                    ? "border-b-[1px]"
                    : ""
                }  border-[#D3DAE0] cursor-pointer group `}
                onClick={() => {
                  handleRouteClick(index);
                }}
              >
                <div
                  className={`w-1  h-full mr-4 ${
                    activeRoute == index && "bg-blue-500"
                  }  group-hover:bg-[#B7BABF]`}
                ></div>
                <div className="flex flex-col  py-2 gap-2  justify-start">
                  <p className="text-xs font-semibold  ">
                    <span className="text-lg font-bold">
                      {Math.round(route.travel_time)} Menit
                    </span>
                    <span>&nbsp;&nbsp;&nbsp;</span>
                    Tiba pada {getArrivalTime(route.travel_time)}{" "}
                  </p>
                  <p className="text-sm text-[#4C4C4C] ">{route.distance} KM</p>
                </div>

                <button
                  className={`flex ml-8 h-[30px] items-center rounded-lg bg-blue-500 px-2 
                  text-sm font-medium text-white transition-colors
                   hover:bg-blue-400 focus-visible:outline 
                     focus-visible:outline-offset-2 focus-visible:outline-blue-500 active:bg-blue-600 
                     cursor-pointer aria-disabled:opacity-50`}
                  onClick={(e) => {
                    handleShowDirections(true);
                    props.handleDirectionActive(true);
                  }}
                >
                  Directions
                </button>
              </div>
            ))}
        </div>
      ) : (
        showRouteDirectionsComponent(
          props.routeDataCRP![activeRoute],
          showDirections,
          handleShowDirections,
          props.handleDirectionActive,
          handleSetNextTurnIndex,
          handleStartRoute
        )
      )}
    </div>
  );
}

function showRouteDirectionsComponent(
  route: RouteCRPResponse,
  showDirections: boolean = false,
  handleShowDirections: (show: boolean) => void,
  handleDirectionActive: (show: boolean) => void,
  handleSetNextTurnIndex: (index: number) => void,
  handleStartRoute: (start: boolean) => void
) {
  const routeDirections = route.driving_directions.reduce<
    CumulativeDirection[]
  >((acc, currentDirection) => {
    const lastDirection = acc[acc.length - 1];
    const cumulativeEta = lastDirection
      ? lastDirection.cumulativeEta + currentDirection.travel_time
      : currentDirection.travel_time;
    const cumulativeDistance = lastDirection
      ? lastDirection.cumulativeDistance + currentDirection.distance
      : currentDirection.distance;

    return [
      ...acc,
      {
        ...currentDirection,
        cumulativeEta,
        cumulativeDistance,
      },
    ];
  }, []);

  return (
    <div className="flex flex-col  py-2 flex-1 overflow-y-scroll">
      <div className="flex flex-row gap-2 w-full ">
        <button
          className={`flex ml-1 mt-2 h-[20px] items-center rounded-md bg-purple-600 px-3 
                  text-sm font-medium text-white transition-colors
                   hover:bg-purple-400 focus-visible:outline 
                     focus-visible:outline-offset-2 focus-visible:outline-purple-500 active:bg-purple-600 
                     cursor-pointer aria-disabled:opacity-50 py-2`}
          onClick={(e) => {
            handleShowDirections(false);
            handleDirectionActive(false);
          }}
        >
          <IoIosArrowBack size={20} />
        </button>
        <p className="text-left text-base text-[#666666] mt-2 mb-2">
          Directions
        </p>

        <button
          className={`flex mt-2 h-[20px] items-center rounded-md bg-purple-600 px-3 
                  text-sm font-medium text-white transition-colors
                   hover:bg-purple-400 focus-visible:outline 
                     focus-visible:outline-offset-2 focus-visible:outline-purple-500 active:bg-purple-600 
                     cursor-pointer aria-disabled:opacity-50 ml-auto mr-2 py-3 `}
          onClick={(e) => {
            toast.error(
              "start route feature only avalable on mobile device view! "
            );
          }}
        >
          <p>Start Route</p>
          <FaLocationArrow size={20} color="white" />
        </button>
      </div>

      {routeDirections.map((direction, index) => (
        <div
          key={`route-${index}`}
          className={`flex flex-row gap-2 items-center border-t-[1px] ${
            index == routeDirections!.length - 1 ? "border-b-[1px] mb-10" : ""
          }  border-[#D3DAE0] cursor-pointer group py2 `}
          onClick={() => {
            handleSetNextTurnIndex(index);
          }}
        >
          <div
            className={`w-1  h-full mr-1 bg-blue-500 group-hover:bg-[#B7BABF]`}
          ></div>
          <Image
            src={getTurnIcon(direction.turn_type, "icons")}
            width={24}
            height={24}
            alt={`turn-${index}`}
            key={`turn-${index}`}
          />
          <div className="flex flex-col  py-4 gap-2  justify-start">
            <div className="flex flex-row items-center gap-2">
              <p className="text-base font-regular  ">
                {direction.instruction}
              </p>
            </div>
            <p className="text-sm font-light">
              {direction.cumulativeEta.toPrecision(2)} menit (
              {Math.round(direction.cumulativeDistance)} m)
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function getTurnIcon(turnType: string, directory: string): string {
  switch (turnType) {
    case "TURN_RIGHT":
      return `/${directory}/turn_right.png`;
    case "TURN_SHARP_RIGHT":
      return `/${directory}/turn_right.png`;
    case "TURN_LEFT":
      return `/${directory}/turn_left.png`;
    case "TURN_SHARP_LEFT":
      return `/${directory}/turn_left.png`;
    case "U_TURN_RIGHT":
      return `/${directory}/u_turn_right.png`;
    case "U_TURN_LEFT":
      return `/${directory}/u_turn_left.png`;
    case "":
      return `/${directory}/straight.png`;
    case "TURN_SLIGHT_RIGHT":
      return `/${directory}/turn_slight_right.png`;
    case "TURN_SLIGHT_LEFT":
      return `/${directory}/turn_slight_left.png`;
    case "ROUNDABOUT":
      return `/${directory}/roundabout_right.png`;
    case "KEEP_LEFT":
      return `/${directory}/fork_left.png`;
    case "KEEP_RIGHT":
      return `/${directory}/fork_right.png`;
  }
  return "";
}
