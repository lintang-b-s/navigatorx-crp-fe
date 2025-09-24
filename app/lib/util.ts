export function truncateString(str: string, maxLength: number = 30) {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + "...";
}

export function getArrivalTime(etaMinutes: number) {
  const arrivalDate = new Date(Date.now() + etaMinutes * 60 * 1000);

  let hours = arrivalDate.getHours();
  const minutes = arrivalDate.getMinutes();
  const ampm = hours >= 12 ? "PM" : "AM";

  hours = hours % 12;
  if (hours === 0) hours = 12;

  const minuteStr = minutes.toString().padStart(2, "0");

  return `${hours}:${minuteStr} ${ampm}`;
}

const EARTH_RADIUS_KM = 6371.0;

function toRadians(deg: number): number {
  return deg * (Math.PI / 180);
}

function hav(angleRad: number): number {
  return (1 - Math.cos(angleRad)) / 2;
}

export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const φ1 = toRadians(lat1);
  const φ2 = toRadians(lat2);
  const Δφ = toRadians(lat2 - lat1);
  const Δλ = toRadians(lon2 - lon1);

  const a = hav(Δφ) + Math.cos(φ1) * Math.cos(φ2) * hav(Δλ);
  const c = 2 * Math.asin(Math.sqrt(a));

  return EARTH_RADIUS_KM * c;
}
