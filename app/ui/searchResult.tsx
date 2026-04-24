import React, { Dispatch, SetStateAction } from "react";
import { Place } from "../lib/searchApi";
import { SearchSelectorProps } from "../types/definition";

export const SearchResults = React.memo(function SearchResults(props: SearchSelectorProps) {
  return (
    <div
      className="absolute left-1/2 -translate-x-1/2 sm:left-4 sm:translate-x-0 md:left-10 top-[190px] sm:top-[210px] z-10 w-[94vw] sm:w-[460px] mt-1 bg-white border border-gray-200 rounded-xl shadow-2xl overflow-y-auto max-h-80"
    >
      {props.places.map((place, index) => (
        <div key={index} onMouseDown={() => props.select(place)}>
          <Selector place={place} index={index} />
        </div>
      ))}
    </div>
  );
});

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
