"use client";
import { CiSearch } from "react-icons/ci";
import { SearchBoxProps } from "../types/definition";
import { useSearchParams, usePathname, useRouter } from "next/navigation";
import { useDebouncedCallback } from "use-debounce";
import { SearchResults } from "./searchResult";
import { useEffect, useState } from "react";
import { truncateString } from "../lib/util";

export function SearchBox({
  isSource,
  activate,
  sourceLoc,
  destinationLoc,
  onSelectSource,
  onSelectDestination,
}: SearchBoxProps) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { replace } = useRouter();
  const paramName = isSource ? "source" : "destination";
  const [term, setTerm] = useState(() => searchParams.get(paramName) ?? "");

  useEffect(() => {
    if (sourceLoc != undefined && isSource) {
      setTerm(
        `${sourceLoc?.osm_object.name} ${
          sourceLoc?.osm_object.address != ""
            ? `, ${sourceLoc?.osm_object.address}`
            : ""
        }`
      );
    } else if (destinationLoc != undefined && !isSource) {
      setTerm(
        `${destinationLoc?.osm_object.name} ${
          destinationLoc?.osm_object.address != ""
            ? `, ${destinationLoc?.osm_object.address}`
            : ""
        }`
      );
    }
  }, [sourceLoc, destinationLoc]);

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

  const handleSearch = useDebouncedCallback((currTerm, isSource) => {
    const params = new URLSearchParams(searchParams);
    if (isSource) {
      if (currTerm) {
        params.set("source", currTerm);
      } else {
        params.delete("source");
      }
    } else {
      if (currTerm) {
        params.set("destination", currTerm);
      } else {
        params.delete("destination");
      }
    }
    replace(`${pathname}?${params.toString()}`);
  }, 150);

  return (
    <div className="relative">
      <input
        type="text"
        className="h-[40px] w-[220px] md:w-[280px] px-4 rounded focus:outline-none  bg-[#F2F4F7]
        text-[#869ca7] text-base z-0 "
        placeholder={`${isSource ? "Source" : "Destination"}`}
        onChange={(e) => {
          setTerm(e.target.value);
          handleSearch(e.target.value, isSource);
          const coords = parseCoordinates(e.target.value);
          if (coords) {
            if (isSource) {
              onSelectSource({
                osm_object: {
                  id: 0,
                  name: `${coords.lat}, ${coords.lon}`,
                  lat: coords.lat,
                  lon: coords.lon,
                  type: "source",
                  address: "",
                },
                distance: 0,
              });
            } else if (!isSource) {
              onSelectDestination({
                osm_object: {
                  id: 0,
                  name: `${coords.lat}, ${coords.lon}`,
                  lat: coords.lat,
                  lon: coords.lon,
                  type: "source",
                  address: "",
                },
                distance: 0,
              });
            }
          }
        }}
        value={term}
        onFocus={() => {
          activate(true);
        }}
        onBlur={() => {
          activate(false);
        }}
      />
      <div className="absolute top-2 right-4 ">
        {term == "" ? <CiSearch size={20} color="#959AA6" /> : <></>}
      </div>
    </div>
  );
}
