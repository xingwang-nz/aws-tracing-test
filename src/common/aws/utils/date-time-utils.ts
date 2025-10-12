import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import duration from "dayjs/plugin/duration";
dayjs.extend(duration);
dayjs.extend(utc);

/**
 * Converts an ISO date string (with timezone) to ISO 8601 format with UTC timezone (YYYY-MM-DDThh:mm:ssZ)

 *
 * @param isoDateTime - ISO date string in format like "2020-12-10T15:40:21.572+12:00" or "2024-10-14T23:15+13:00"
 * @returns date time in format "YYYY-MM-DDThh:mm:ssZ"
 */
export const toUtcDateTime = (isoDateTime: string): string => {
  if (!isoDateTime) {
    return "";
  }

  try {
    return dayjs(isoDateTime).utc().format("YYYY-MM-DDTHH:mm:ss[Z]");
  } catch (error) {
    logger.error(`Error formatting ${isoDateTime} to UTC date`, { error });
    return "";
  }
};

/**
 * Converts an ISO date string (with timezone) to a simple date format (YYYY-MM-DD) in UTC
 *
 * @param isoDateTime - ISO date string in format like "2020-12-10T15:40:21.572+12:00" or "2024-10-14T23:15+13:00"
 * @returns Simple date string in format "YYYY-MM-DD"
 */
export const toUtcSimpleDate = (isoDateTime: string): string => {
  if (!isoDateTime) {
    return "";
  }

  try {
    return dayjs(isoDateTime).utc().format("YYYY-MM-DD");
  } catch (error) {
    logger.error(`Error formatting ${isoDateTime} to simple UTC date`, {
      error,
    });
    return "";
  }
};

/**
 * Converts seconds to timestamp format with optional milliseconds
 * @param seconds - Time in seconds
 * @param withMillis - Whether to include milliseconds in the output (default: true)
 * @returns Formatted timestamp string (HH:MM:SS or HH:MM:SS.mmm)
 */
export const secondsToTime = (seconds: number, withMillis = true): string => {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;

  const totalMs = Math.round(seconds * 1000);
  const d = dayjs.duration(totalMs, "milliseconds");

  const hh = Math.floor(d.asHours()); // total hours
  const mm = d.minutes();
  const ss = d.seconds();
  const ms = d.milliseconds();

  const pad2 = (n: number) => String(n).padStart(2, "0");
  const base = `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`;

  return withMillis ? `${base}.${String(ms).padStart(3, "0")}` : base;
};

/**
 * Converts frame based timecode format (hh:mm:ss:ff) to milliseconds format (hh:mm:ss.sss)
 *
 * @param timecode - Timecode string in format "hh:mm:ss:ff"
 * @param fps - Frames per second (default: 25)
 * @returns Formatted timestamp string with milliseconds (hh:mm:ss.sss)
 */
export const framebasedTimecodeToMillis = (
  timecode: string,
  fps = 25,
): string => {
  if (!timecode || !/^\d{2}:\d{2}:\d{2}:\d{2}$/.test(timecode)) {
    logger.error(
      `Invalid timecode format: ${timecode}. Expected format: hh:mm:ss:ff`,
    );
    return "";
  }

  try {
    const [hours, minutes, seconds, frames] = timecode.split(":").map(Number);
    const fractionalSeconds = frames / fps;
    const totalSeconds =
      hours * 3600 + minutes * 60 + seconds + fractionalSeconds;
    return secondsToTime(totalSeconds);
  } catch (error) {
    logger.error(
      `Error converting timecode ${timecode} to milliseconds format`,
      { error },
    );
    return "";
  }
};

/**
 * Current date in UTC formatted as `YYYY-MM-DD`.
 *
 * Example: `"2025-08-27"`
 */
export const yyyyMmDdUtc: string = dayjs().utc().format("YYYY-MM-DD");

/**
 * Convert a duration in milliseconds into a `hh:mm:ss` formatted string.
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted string in `hh:mm:ss` format
 *
 * @example
 * ```ts
 * formatMsToHMS(91920); // "00:01:31"
 * formatMsToHMS(3661000); // "01:01:01"
 * ```
 */
export const formatMsToHMS = (ms: number): string => {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new Error(`Invalid duration: ${ms}`);
  }

  const d = dayjs.duration(ms);
  const hours = Math.floor(d.asHours()); // total hours (not mod 24)
  const minutes = d.minutes();
  const seconds = d.seconds();

  const pad = (n: number) => String(n).padStart(2, "0");
  return [pad(hours), pad(minutes), pad(seconds)].join(":");
};

/**
 * Add X days to a UTC ISO timestamp and return a UTC ISO string.
 * Works across month/year boundaries.
 */
export const addDaysUtc = (iso: string, days: number): string => {
  const d = dayjs.utc(iso);
  if (!d.isValid()) throw new Error(`Invalid ISO date: ${iso}`);
  return d.add(days, "day").toISOString();
};
