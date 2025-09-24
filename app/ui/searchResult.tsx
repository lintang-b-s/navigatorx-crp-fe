import { Dispatch, SetStateAction } from "react";
import { Place } from "../lib/searchApi";
import { SearchSelectorProps } from "../types/definition";

export function SearchResults(props: SearchSelectorProps) {
  return (
    <div
      className="absolute left-[5%] md:left-10 top-[220px] md:top-[240px] z-10  
    w-[355px]  md:w-[380px]   mt-1 bg-white border-2 rounded-lg shadow-lg border-[#F5F5F5]  overflow-y-scroll
     max-h-80 "
    >
      {props.places.map((place, index) => (
        <div key={index} onMouseDown={() => props.select(place)}>
          <Selector place={place} index={index} />
        </div>
      ))}
    </div>
  );
}

type SelectorProps = {
  index?: number;
  place: Place;
};

function Selector(props: SelectorProps) {
  return (
    <div
      className="px-4 py-2 hover:bg-gray-100 rounded-md cursor-pointer text-black
     border-2 border-[#F5F5F5] z-10"
    >
      {`${props.place.osm_object.name}, ${props.place.osm_object.address}`}
    </div>
  );
}
