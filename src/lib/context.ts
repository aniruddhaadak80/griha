/**
 * Normalised, allowlisted, key-free public data.
 *
 * Two feeds, both genuinely used by the fairness engine rather than displayed
 * for atmosphere:
 *
 *   Open-Meteo  → 0–100 suitability for outdoor chores on a given day.
 *   Nager.Date  → public holidays, which move work off days nobody is home.
 *
 * Both are fetched with a hard timeout, one bounded retry, and an explicit
 * `live | fallback` status that travels with the data all the way to the UI.
 * The app never presents fallback rows as if they were fetched now.
 */

import type {
  DailyForecast,
  HouseholdContext,
  HolidaySnapshot,
  PublicHoliday,
  WeatherSnapshot,
} from "./types";

const FETCH_TIMEOUT_MS = 5_000;
const MAX_ATTEMPTS = 2;

/** Default location used when a household has not been configured yet. */
const DEFAULT_COORDS = { latitude: 28.6139, longitude: 77.209, label: "New Delhi" };

/**
 * Sealed offline fallback, recorded on a fixed date.
 *
 * This exists so a build, a first paint and a CI run never depend on the
 * network. It is labelled `fallback` everywhere it surfaces, and the API
 * response carries `status` so a client can never mistake it for live data.
 */
const FALLBACK_FORECAST: DailyForecast[] = [
  { date: "2026-10-02", precipitationProbability: 20, precipitationSum: 0, windSpeed: 3.1, temperatureMean: 29.4 },
  { date: "2026-10-03", precipitationProbability: 65, precipitationSum: 4.2, windSpeed: 4.6, temperatureMean: 27.1 },
  { date: "2026-10-04", precipitationProbability: 10, precipitationSum: 0, windSpeed: 2.4, temperatureMean: 30.2 },
  { date: "2026-10-05", precipitationProbability: 5, precipitationSum: 0, windSpeed: 2.0, temperatureMean: 31.0 },
  { date: "2026-10-06", precipitationProbability: 35, precipitationSum: 0.6, windSpeed: 3.4, temperatureMean: 28.8 },
  { date: "2026-10-07", precipitationProbability: 80, precipitationSum: 7.9, windSpeed: 5.8, temperatureMean: 25.6 },
];

const FALLBACK_HOLIDAYS: Array<PublicHoliday & { country: string; year: number }> = [
  { country: "IN", year: 2026, date: "2026-10-02", localName: "Gandhi Jayanti", name: "Gandhi Jayanti" },
  { country: "IN", year: 2026, date: "2026-10-20", localName: "Dussehra", name: "Dussehra" },
  { country: "US", year: 2026, date: "2026-10-12", localName: "Columbus Day", name: "Indigenous Peoples' Day" },
  { country: "GB", year: 2026, date: "2026-12-25", localName: "Christmas Day", name: "Christmas Day" },
  { country: "DE", year: 2026, date: "2026-10-03", localName: "Tag der Deutschen Einheit", name: "German Unity Day" },
];

function isoDateInDays(days: number, from = new Date()): string {
  const base = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/** Time-bounded fetch with one retry. Never throws; callers get null on failure. */
async function fetchJson(url: string): Promise<unknown | null> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error(`upstream responded ${response.status}`);
      return (await response.json()) as unknown;
    } catch {
      if (attempt === MAX_ATTEMPTS) return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/**
 * Resolve a city name to coordinates with a tiny built-in table.
 *
 * Geo-coding needs either a key or a local dataset. Griha ships a short
 * allowlist of well-known cities instead of shipping a 100MB gazetteer or
 * calling an unauthenticated geocoder, and falls back to the default location
 * with an honest status when the city is unknown.
 */
const KNOWN_CITIES: Record<string, { latitude: number; longitude: number }> = {
  "new delhi": { latitude: 28.6139, longitude: 77.209 },
  delhi: { latitude: 28.6139, longitude: 77.209 },
  mumbai: { latitude: 19.076, longitude: 72.8777 },
  bengaluru: { latitude: 12.9716, longitude: 77.5946 },
  bangalore: { latitude: 12.9716, longitude: 77.5946 },
  hyderabad: { latitude: 17.385, longitude: 78.4867 },
  chennai: { latitude: 13.0827, longitude: 80.2707 },
  kolkata: { latitude: 22.5726, longitude: 88.3639 },
  pune: { latitude: 18.5204, longitude: 73.8567 },
  ahmedabad: { latitude: 23.0225, longitude: 72.5714 },
  london: { latitude: 51.5072, longitude: -0.1276 },
  "new york": { latitude: 40.7128, longitude: -74.006 },
  "san francisco": { latitude: 37.7749, longitude: -122.4194 },
  berlin: { latitude: 52.52, longitude: 13.405 },
  toronto: { latitude: 43.6532, longitude: -79.3832 },
  sydney: { latitude: -33.8688, longitude: 151.2093 },
};

function resolveCoordinates(city: string): { latitude: number; longitude: number; label: string } {
  const key = city.trim().toLowerCase();
  const hit = KNOWN_CITIES[key];
  if (hit) return { ...hit, label: city.trim() };
  return { ...DEFAULT_COORDS, label: DEFAULT_COORDS.label };
}

function normaliseForecastPayload(payload: unknown, label: string): DailyForecast[] | null {
  if (typeof payload !== "object" || payload === null) return null;
  const root = payload as Record<string, unknown>;

  const time = root.time;
  const precipProb = (root.precipitation_probability_max as unknown[]) ?? [];
  const precipSum = (root.precipitation_sum as unknown[]) ?? [];
  const wind = (root.wind_speed_10m_max as unknown[]) ?? [];
  const temp = (root.temperature_2m_mean as unknown[]) ?? [];

  if (!Array.isArray(time) || time.length === 0) return null;

  const days: DailyForecast[] = [];
  const byDate = new Map<string, DailyForecast>();

  time.forEach((raw, index) => {
    if (typeof raw !== "string") return;
    const date = raw.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;

    const num = (source: unknown[]): number => {
      const value = source[index];
      return typeof value === "number" && Number.isFinite(value) ? value : 0;
    };

    const entry = byDate.get(date) ?? {
      date,
      precipitationProbability: 0,
      precipitationSum: 0,
      windSpeed: 0,
      temperatureMean: 0,
    };

    entry.precipitationProbability = Math.max(entry.precipitationProbability, num(precipProb));
    entry.precipitationSum += num(precipSum);
    entry.windSpeed = Math.max(entry.windSpeed, num(wind));
    entry.temperatureMean = Math.max(entry.temperatureMean, num(temp));

    byDate.set(date, entry);
    days.push(entry);
  });

  void label;
  return days.length > 0 ? days : null;
}

export async function getWeather(city: string): Promise<WeatherSnapshot> {
  const coords = resolveCoordinates(city);
  const params = new URLSearchParams({
    latitude: String(coords.latitude),
    longitude: String(coords.longitude),
    daily: [
      "temperature_2m_mean",
      "precipitation_sum",
      "precipitation_probability_max",
      "wind_speed_10m_max",
    ].join(","),
    timezone: "auto",
    forecast_days: "7",
  });
  const sourceUrl = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;

  const payload = await fetchJson(sourceUrl);
  const days = normaliseForecastPayload(payload, coords.label);

  if (!days) {
    return {
      status: "fallback",
      city: coords.label,
      latitude: coords.latitude,
      longitude: coords.longitude,
      fetchedAt: new Date().toISOString(),
      source: "Griha sealed offline sample",
      sourceUrl: "https://open-meteo.com/",
      days: FALLBACK_FORECAST.map((day) => ({ ...day, date: relabelFallbackDate(day.date) })),
    };
  }

  return {
    status: "live",
    city: coords.label,
    latitude: coords.latitude,
    longitude: coords.longitude,
    fetchedAt: new Date().toISOString(),
    source: "Open-Meteo",
    sourceUrl,
    days,
  };
}

/**
 * Shift the sealed sample forward so it always covers the next seven days.
 *
 * The sample is relative, not absolute: without this, a visitor in November
 * would see a forecast for October and reasonably conclude the product is
 * broken. The `fallback` status still tells the truth about provenance.
 */
function relabelFallbackDate(iso: string): string {
  const index = FALLBACK_FORECAST.findIndex((day) => day.date === iso);
  if (index < 0) return iso;
  return isoDateInDays(index);
}

export async function getHolidays(country: string, year: number): Promise<HolidaySnapshot> {
  const iso = country.trim().toUpperCase();
  const sourceUrl = `https://date.nager.at/api/v3/PublicHolidays/${year}/${encodeURIComponent(iso)}`;
  const payload = await fetchJson(sourceUrl);

  if (Array.isArray(payload) && payload.length > 0) {
    const days: PublicHoliday[] = payload
      .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
      .map((entry) => ({
        date: String(entry.date ?? "").slice(0, 10),
        localName: String(entry.localName ?? entry.name ?? "Holiday"),
        name: String(entry.name ?? entry.localName ?? "Holiday"),
      }))
      .filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry.date));

    if (days.length > 0) {
      return {
        status: "live",
        country: iso,
        year,
        fetchedAt: new Date().toISOString(),
        source: "Nager.Date",
        sourceUrl,
        days,
      };
    }
  }

  const fallback = FALLBACK_HOLIDAYS.filter((entry) => entry.country === iso);
  const pool = fallback.length > 0 ? fallback : FALLBACK_HOLIDAYS.slice(0, 2);

  return {
    status: "fallback",
    country: iso,
    year,
    fetchedAt: new Date().toISOString(),
    source: "Griha sealed offline sample",
    sourceUrl: "https://date.nager.at/",
    days: pool.map((entry) => ({ date: entry.date, localName: entry.localName, name: entry.name })),
  };
}

/** Assemble both feeds plus the lookup the engine uses. */
export async function getHouseholdContext(city: string, country: string): Promise<HouseholdContext> {
  const year = new Date().getUTCFullYear();
  const [weather, holidays] = await Promise.all([
    cached("weather", `${city}|${year}`, () => getWeather(city)),
    cached("holidays", `${country}|${year}`, () => getHolidays(country, year)),
  ]);

  const holidayIndex: Record<string, string> = {};
  for (const day of holidays.days) holidayIndex[day.date] = day.localName;

  const coveredThrough = weather.days.length > 0 ? weather.days[weather.days.length - 1]!.date : null;

  return { weather, holidays, holidayIndex, coveredThrough };
}

/**
 * Short-lived in-process cache for upstream feeds.
 *
 * A forecast does not change every few minutes, and re-fetching it on every page
 * render made an ordinary board visit pay the full upstream latency. Entries
 * live for ten minutes, which is short enough that nobody will see a stale
 * reading for long and long enough to absorb a burst of traffic.
 *
 * This is per-instance and deliberately so: on serverless it improves the warm
 * case and simply misses on a cold start, which costs one fetch and no
 * correctness. It never caches an error, and it never caches across tenants —
 * the key includes the city and country.
 */
const CACHE_TTL_MS = 10 * 60 * 1000;

const contextCache = new Map<string, { expires: number; value: WeatherSnapshot | HolidaySnapshot }>();

async function cached<T extends WeatherSnapshot | HolidaySnapshot>(
  kind: "weather" | "holidays",
  key: string,
  produce: () => Promise<T>,
): Promise<T> {
  const fullKey = `${kind}:${key}`;
  const hit = contextCache.get(fullKey);
  if (hit && hit.expires > Date.now()) return hit.value as T;

  const value = await produce();
  contextCache.set(fullKey, { expires: Date.now() + CACHE_TTL_MS, value });

  // Bound the map on a long-lived instance.
  if (contextCache.size > 500) {
    const now = Date.now();
    for (const [existing, entry] of contextCache) {
      if (entry.expires <= now) contextCache.delete(existing);
    }
  }

  return value;
}