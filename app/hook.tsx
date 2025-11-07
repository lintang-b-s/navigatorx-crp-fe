// ref: https://dev.to/trekhleb/gyro-web-accessing-the-device-orientation-in-javascript-2492
import { useCallback, useEffect, useState } from "react";

type DeviceOrientation = {
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
};

type UseDeviceOrientationData = {
  orientation: DeviceOrientation | null;
  error: Error | null;
  requestAccess: () => Promise<boolean>;
  revokeAccess: () => Promise<void>;
};

interface DeviceOrientationEventWithPermission extends DeviceOrientationEvent {
  requestPermission?: () => Promise<PermissionState>;
}

export const useDeviceOrientation = (): UseDeviceOrientationData => {
  const [error, setError] = useState<Error | null>(null);
  const [orientation, setOrientation] = useState<DeviceOrientation | null>(
    null
  );

  const onDeviceOrientation = (event: DeviceOrientationEvent): void => {
    setOrientation({
      alpha: event.alpha,
      beta: event.beta,
      gamma: event.gamma,
    });
  };

  const revokeAccessAsync = async (): Promise<void> => {
    window.removeEventListener("deviceorientation", onDeviceOrientation);
    setOrientation(null);
  };

  const requestAccessAsync = async (): Promise<boolean> => {
    const DeviceOrientationEventWithPerm =
      DeviceOrientationEvent as unknown as DeviceOrientationEventWithPermission;

    if (!DeviceOrientationEventWithPerm) {
      setError(
        new Error("Device orientation event is not supported by your browser")
      );
      return false;
    }

    if (
      typeof DeviceOrientationEventWithPerm.requestPermission === "function"
    ) {
      try {
        const permission =
          await DeviceOrientationEventWithPerm.requestPermission();
        if (permission !== "granted") {
          setError(
            new Error("Request to access the device orientation was rejected")
          );
          return false;
        }
      } catch (err: any) {
        setError(err);
        return false;
      }
    }

    window.addEventListener("deviceorientation", onDeviceOrientation);

    return true;
  };

  const requestAccess = useCallback(requestAccessAsync, []);
  const revokeAccess = useCallback(revokeAccessAsync, []);

  useEffect(() => {
    return (): void => {
      revokeAccess();
    };
  }, [revokeAccess]);

  return {
    orientation,
    error,
    requestAccess,
    revokeAccess,
  };
};
