"use client";
import React, { useRef, useState } from "react";
import { FaCheck } from "react-icons/fa";
import { CiPlay1, CiStop1 } from "react-icons/ci";
import toast from "react-hot-toast";

interface SimulationPanelProps {
  onSimulationStart: (points: any[], useWebSocket: boolean) => void;
  onSimulationStop: () => void;
  isRunning: boolean;
}

export const SimulationPanel = React.memo(function SimulationPanel({
  onSimulationStart,
  onSimulationStop,
  isRunning,
}: SimulationPanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [useWebSocket, setUseWebSocket] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
    }
  };

  const handlePlayStop = async () => {
    if (isRunning) {
      onSimulationStop();
      return;
    }

    if (!file) {
      toast.error("Please upload a GPS JSON file first.");
      return;
    }

    try {
      const text = await file.text();
      const points = JSON.parse(text);
      if (!Array.isArray(points)) {
        throw new Error("JSON is not an array of GPS points.");
      }
      onSimulationStart(points, useWebSocket);
    } catch (err: any) {
      console.error("Invalid JSON file:", err);
      toast.error("Invalid JSON file!");
    }
  };

  return (
    <div
      className={`flex flex-col h-[180px] w-[94vw] sm:h-[200px] sm:w-[460px]  
        absolute top-4 left-1/2 -translate-x-1/2 sm:left-4 sm:translate-x-0 md:left-10 bg-white
        rounded-2xl overflow-hidden shadow-2xl z-10 p-6`}
    >
      <h2 className="text-xl font-bold mb-4">Map Matching Simulation</h2>
      
      <div className="flex flex-col gap-4">
        <input 
          type="file" 
          accept=".json" 
          onChange={handleFileChange} 
          ref={fileInputRef}
          className="text-sm file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          disabled={isRunning}
        />

        <div className="flex flex-row justify-between items-center mt-2">
          <label className="flex flex-row items-center cursor-pointer select-none">
            <div
              className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all duration-200 
                ${
                  useWebSocket
                    ? "border-blue-500 bg-blue-500"
                    : "border-gray-400 bg-white"
                }`}
            >
              {useWebSocket && <FaCheck size={13} color="white" />}
            </div>
            <input 
              type="checkbox" 
              checked={useWebSocket}
              onChange={(e) => setUseWebSocket(e.target.checked)}
              className="hidden"
              disabled={isRunning}
            />
            <p className="ml-2 text-sm text-[#666f74]">Use WebSocket</p>
          </label>

          <button
            onClick={handlePlayStop}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-white transition-colors
              ${isRunning ? "bg-red-500 hover:bg-red-400" : "bg-blue-500 hover:bg-blue-400"}`}
          >
            {isRunning ? (
              <>
                <CiStop1 size={20} /> Stop
              </>
            ) : (
              <>
                <CiPlay1 size={20} /> Play
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
});
