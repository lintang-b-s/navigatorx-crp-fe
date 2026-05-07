"use client";
import React from "react";

interface SpeedometerProps {
  speed: number; // in m/s
}

export const Speedometer: React.FC<SpeedometerProps> = ({ speed }) => {
  // Convert m/s to km/h
  const speedKmh = Math.round(speed * 3.6);

  return (
    <div className="flex flex-col items-center justify-center w-17 h-17 bg-white/95 rounded-full shadow-[0_8px_32px_rgba(0,0,0,0.15)] border-4 border-blue-500/10 backdrop-blur-md transition-all duration-300 animate-in fade-in zoom-in duration-500">
      <div className="flex flex-col items-center justify-center -mt-1">
        <span className="text-4xl font-black text-[#0f172a] leading-none tracking-tighter">
          {speedKmh}
        </span>
        <span className="text-[10px] font-extrabold text-blue-600 uppercase tracking-wider mt-0.5">
          km/h
        </span>
      </div>
      
      {/* Decorative inner ring */}
      <div className="absolute inset-2 border border-blue-500/5 rounded-full pointer-events-none" />
    </div>
  );
};
