"use client";
import React, { useRef, useState, useEffect } from "react";
import { FaCheck } from "react-icons/fa";
import { CiPlay1, CiStop1 } from "react-icons/ci";
import toast from "react-hot-toast";
import { scanTracks, getTrackPoints, GpxPoint } from "@/app/lib/gpxParser";
import { scanCsvTracks, getCsvTrackPoints } from "@/app/lib/csvParser";

interface SimulationPanelProps {
  onSimulationStart: (
    points: any[], 
    useWebSocket: boolean, 
    samplingRate: number, 
    showGpsWindow: boolean, 
    drivingDirection: boolean,
    writeToLog: boolean,
    fileName: string,
    trackName: string
  ) => void;
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
  const [gpxTracks, setGpxTracks] = useState<string[]>([]);
  const [selectedTrack, setSelectedTrack] = useState<string>("");
  const [isScanning, setIsScanning] = useState(false);
  const [samplingRate, setSamplingRate] = useState(1.0);
  const [showGpsWindow, setShowGpsWindow] = useState(false);
  const [drivingDirection, setDrivingDirection] = useState(false);
  const [writeToLog, setWriteToLog] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      setGpxTracks([]);
      setSelectedTrack("");

      if (selectedFile.name.endsWith(".gpx")) {
        setIsScanning(true);
        const toastId = toast.loading("Scanning GPX tracks...");
        try {
          const tracks = await scanTracks(selectedFile);
          setGpxTracks(tracks);
          if (tracks.length > 0) {
            setSelectedTrack(tracks[0]);
          }
          toast.success(`Found ${tracks.length} tracks`, { id: toastId });
        } catch (err) {
          console.error("Error scanning GPX:", err);
          toast.error("Failed to scan GPX file", { id: toastId });
        } finally {
          setIsScanning(false);
        }
      } else if (selectedFile.name.endsWith(".csv")) {
        setIsScanning(true);
        const toastId = toast.loading("Scanning CSV tracks...");
        try {
          const tracks = await scanCsvTracks(selectedFile);
          setGpxTracks(tracks);
          if (tracks.length > 0) {
            setSelectedTrack(tracks[0]);
          }
          toast.success(`Found ${tracks.length} tracks`, { id: toastId });
        } catch (err) {
          console.error("Error scanning CSV:", err);
          toast.error("Failed to scan CSV file", { id: toastId });
        } finally {
          setIsScanning(false);
        }
      }
    }
  };

  const handlePlayStop = async () => {
    if (isRunning) {
      onSimulationStop();
      return;
    }

    if (!file) {
      toast.error("Please upload a GPS JSON, GPX or CSV file first.");
      return;
    }

    try {
      let points: any[] = [];
      if (file.name.endsWith(".json")) {
        const text = await file.text();
        points = JSON.parse(text);
        if (!Array.isArray(points)) {
          throw new Error("JSON is not an array of GPS points.");
        }
      } else if (file.name.endsWith(".gpx")) {
        if (!selectedTrack) {
          toast.error("Please select a track first.");
          return;
        }
        const toastId = toast.loading("Extracting track points...");
        points = await getTrackPoints(file, selectedTrack);
        toast.success(`Extracted ${points.length} points`, { id: toastId });
      } else if (file.name.endsWith(".csv")) {
        if (!selectedTrack) {
          toast.error("Please select a track first.");
          return;
        }
        const toastId = toast.loading("Extracting CSV track points...");
        points = await getCsvTrackPoints(file, selectedTrack);
        toast.success(`Extracted ${points.length} points`, { id: toastId });
      }

      if (points.length === 0) {
        toast.error("No points found in the selected track.");
        return;
      }

      onSimulationStart(
        points, 
        useWebSocket, 
        samplingRate, 
        showGpsWindow, 
        drivingDirection,
        writeToLog,
        file.name,
        selectedTrack
      );
    } catch (err: any) {
      console.error("Invalid file:", err);
      toast.error(`Error: ${err.message || "Invalid file"}`);
    }
  };

  return (
    <div
      className={`flex flex-col ${gpxTracks.length > 0 ? "h-[430px]" : "h-[360px]"} w-[94vw] sm:${gpxTracks.length > 0 ? "h-[450px]" : "h-[380px]"} sm:w-[460px]  
        absolute top-4 left-1/2 -translate-x-1/2 sm:left-4 sm:translate-x-0 md:left-10 bg-white
        rounded-2xl overflow-hidden shadow-2xl z-10 p-6 transition-all duration-300`}
    >
      <h2 className="text-xl font-bold mb-4">Map Matching Simulation</h2>
      
      <div className="flex flex-col gap-4">
        <input 
          type="file" 
          accept=".json,.gpx,.csv" 
          onChange={handleFileChange} 
          ref={fileInputRef}
          className="text-sm file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          disabled={isRunning || isScanning}
        />

        {gpxTracks.length > 0 && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-500 ml-1">Select Track</label>
            <select
              value={selectedTrack}
              onChange={(e) => setSelectedTrack(e.target.value)}
              className="text-sm p-2 rounded-lg border border-gray-200 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isRunning}
            >
              {gpxTracks.map((name, idx) => (
                <option key={`${name}-${idx}`} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex flex-col gap-1">
          <div className="flex justify-between items-center ml-1">
            <label className="text-xs font-semibold text-gray-500">Sampling Rate</label>
            <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">{samplingRate.toFixed(1)}s</span>
          </div>
          <input 
            type="range" 
            min="0.2" 
            max="10.0" 
            step="0.1" 
            value={samplingRate}
            onChange={(e) => setSamplingRate(parseFloat(e.target.value))}
            className="w-full h-1.5 bg-gray-100 rounded-lg appearance-none cursor-pointer accent-blue-500"
            disabled={isRunning}
          />
        </div>

        <div className="flex flex-col gap-2 mt-1">
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

          <label className="flex flex-row items-center cursor-pointer select-none">
            <div
              className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all duration-200 
                ${
                  showGpsWindow
                    ? "border-blue-500 bg-blue-500"
                    : "border-gray-400 bg-white"
                }`}
            >
              {showGpsWindow && <FaCheck size={13} color="white" />}
            </div>
            <input 
              type="checkbox" 
              checked={showGpsWindow}
              onChange={(e) => setShowGpsWindow(e.target.checked)}
              className="hidden"
              disabled={isRunning}
            />
            <p className="ml-2 text-sm text-[#666f74]">Show GPS Window (±10 points)</p>
          </label>

          <label className="flex flex-row items-center cursor-pointer select-none">
            <div
              className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all duration-200 
                ${
                  drivingDirection
                    ? "border-blue-500 bg-blue-500"
                    : "border-gray-400 bg-white"
                }`}
            >
              {drivingDirection && <FaCheck size={13} color="white" />}
            </div>
            <input 
              type="checkbox" 
              checked={drivingDirection}
              onChange={(e) => setDrivingDirection(e.target.checked)}
              className="hidden"
              disabled={isRunning}
            />
            <p className="ml-2 text-sm text-[#666f74]">Driving Direction</p>
          </label>

          <label className="flex flex-row items-center cursor-pointer select-none">
            <div
              className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all duration-200 
                ${
                  writeToLog
                    ? "border-blue-500 bg-blue-500"
                    : "border-gray-400 bg-white"
                }`}
            >
              {writeToLog && <FaCheck size={13} color="white" />}
            </div>
            <input 
              type="checkbox" 
              checked={writeToLog}
              onChange={(e) => setWriteToLog(e.target.checked)}
              className="hidden"
              disabled={isRunning}
            />
            <p className="ml-2 text-sm text-[#666f74]">Write Map Match Result to File</p>
          </label>
        </div>

        <div className="flex flex-row justify-end items-center mt-2">
          <button
            onClick={handlePlayStop}
            className={`flex items-center gap-2 px-6 py-2 rounded-lg font-medium text-white shadow-md transition-all
              ${isRunning ? "bg-red-500 hover:bg-red-400" : "bg-blue-600 hover:bg-blue-500"}`}
            disabled={isScanning}
          >
            {isRunning ? (
              <>
                <CiStop1 size={20} strokeWidth={1.5} /> Stop
              </>
            ) : (
              <>
                <CiPlay1 size={20} strokeWidth={1.5} /> Play
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
});
