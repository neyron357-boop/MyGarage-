/*
 * Sunrise and sunset in Dubai, for the "Auto" theme: light by day, dark by night. The sunrise
 * equation (accurate to a minute or two, which is plenty to switch a theme).
 */

const RAD = Math.PI / 180;
/** Dubai: the place and its clock (UTC+4, no summer time). */
const DUBAI = { lat: 25.2048, lon: 55.2708, utcHours: 4 };

const julian = (ms: number) => ms / 86_400_000 + 2_440_587.5;
const fromJulian = (j: number) => new Date((j - 2_440_587.5) * 86_400_000);

/** Sunrise and sunset of the place's calendar day the moment falls in. */
export function sunTimes(at: Date, place = DUBAI): { rise: Date; set: Date } {
  // The local day's noon picks the solar day (the Julian day turns at noon UTC, mid-afternoon in Dubai).
  const day = Math.floor((at.getTime() + place.utcHours * 3_600_000) / 86_400_000);
  const noon = day * 86_400_000 + (12 - place.utcHours) * 3_600_000;
  const n = Math.ceil(julian(noon) - 2_451_545 + 0.0008);
  const jStar = n - place.lon / 360;
  const m = (357.5291 + 0.98560028 * jStar) % 360;
  const c = 1.9148 * Math.sin(m * RAD) + 0.02 * Math.sin(2 * m * RAD) + 0.0003 * Math.sin(3 * m * RAD);
  const lambda = (m + c + 180 + 102.9372) % 360;
  const transit = 2_451_545 + jStar + 0.0053 * Math.sin(m * RAD) - 0.0069 * Math.sin(2 * lambda * RAD);
  const sinDecl = Math.sin(lambda * RAD) * Math.sin(23.4397 * RAD);
  const cosDecl = Math.cos(Math.asin(sinDecl));
  const cosW = (Math.sin(-0.833 * RAD) - Math.sin(place.lat * RAD) * sinDecl) / (Math.cos(place.lat * RAD) * cosDecl);
  const w = Math.acos(Math.max(-1, Math.min(1, cosW))) / RAD;
  return { rise: fromJulian(transit - w / 360), set: fromJulian(transit + w / 360) };
}

/** Is the sun up in Dubai at this moment? */
export function isDaytime(at: Date = new Date(), place = DUBAI): boolean {
  const { rise, set } = sunTimes(at, place);
  return at >= rise && at < set;
}
