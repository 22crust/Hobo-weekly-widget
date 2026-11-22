import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { format } from "date-fns";
import { DailyWeather, WeatherData } from "../types/planner";

export interface SavedWeatherLocation {
  city: string;
  latitude: number;
  longitude: number;
}

export interface CitySearchResult {
  id: number;
  name: string;
  admin1?: string;
  country?: string;
  latitude: number;
  longitude: number;
}

const WEATHER_CACHE_KEY = "hobonichi_planner_weather_cache_v2";
const WEATHER_LOCATION_KEY = "hobo_weather_location_v1";
const WEATHER_UNIT_KEY = "hobo_weather_unit_v1";
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export type TemperatureUnit = "C" | "F";

export function getSavedTemperatureUnit(): TemperatureUnit {
  try {
    return localStorage.getItem(WEATHER_UNIT_KEY) === "F" ? "F" : "C";
  } catch {
    return "C";
  }
}

export function saveTemperatureUnit(unit: TemperatureUnit): void {
  try {
    localStorage.setItem(WEATHER_UNIT_KEY, unit);
  } catch {
    // Ignore storage error
  }
}

export function formatTemperature(celsius: number, unit: TemperatureUnit): string {
  if (unit === "F") {
    return `${Math.round((celsius * 9) / 5 + 32)}°F`;
  }
  return `${Math.round(celsius)}°C`;
}

/**
 * Maps WMO Weather interpretation codes (WW) to concise, Hobonichi-style English descriptions.
 */
export function describeWeatherCode(code: number): string {
  if (code === 0) return "Clear sky";
  if (code === 1) return "Mainly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Foggy mist";
  if (code >= 51 && code <= 57) return "Light drizzle";
  if (code >= 61 && code <= 65) return "Rain";
  if (code >= 66 && code <= 67) return "Freezing rain";
  if (code >= 71 && code <= 77) return "Snowfall";
  if (code >= 80 && code <= 82) return "Rain showers";
  if (code === 85 || code === 86) return "Snow showers";
  if (code >= 95) return "Thunderstorm";
  return "Calm conditions";
}

async function safeGetJson<T>(url: string): Promise<T> {
  const headers = {
    "User-Agent": "Local-Planner-Desktop/1.0",
    Accept: "application/json",
  };
  try {
    const res = await tauriFetch(url, { method: "GET", headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } catch {
    const res = await window.fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  }
}

export function getSavedWeatherLocation(): SavedWeatherLocation | null {
  try {
    const raw = localStorage.getItem(WEATHER_LOCATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedWeatherLocation>;
    if (
      typeof parsed.city === "string" &&
      parsed.city.trim().length > 0 &&
      typeof parsed.latitude === "number" &&
      typeof parsed.longitude === "number"
    ) {
      return {
        city: parsed.city.trim(),
        latitude: parsed.latitude,
        longitude: parsed.longitude,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveWeatherLocation(loc: SavedWeatherLocation): void {
  try {
    localStorage.setItem(WEATHER_LOCATION_KEY, JSON.stringify(loc));
    localStorage.removeItem(WEATHER_CACHE_KEY);
  } catch {
    // Ignore storage error
  }
}

/**
 * Searches matching cities via Open-Meteo's free Geocoding API (no API key required).
 */
export async function searchWeatherCities(
  query: string
): Promise<CitySearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
    trimmed
  )}&count=6&language=en&format=json`;

  const data = await safeGetJson<{ results?: CitySearchResult[] }>(url);
  return Array.isArray(data.results) ? data.results : [];
}

/**
 * Fetches current weather + 16-day daily forecast in Celsius (°C) from Open-Meteo
 * using ONLY the user's manually saved location (zero IP geolocation requests).
 */
export async function fetchWeatherForecast(
  forceRefresh = false
): Promise<WeatherData> {
  const location = getSavedWeatherLocation();
  if (!location) {
    return {
      current: null,
      dailyByDate: {},
    };
  }

  if (!forceRefresh) {
    try {
      const rawCache = localStorage.getItem(WEATHER_CACHE_KEY);
      if (rawCache) {
        const cached = JSON.parse(rawCache) as { ts: number; data: WeatherData };
        if (
          Date.now() - cached.ts < CACHE_TTL_MS &&
          cached.data?.current &&
          cached.data.current.city === location.city
        ) {
          return cached.data;
        }
      }
    } catch {
      // Ignore invalid cache
    }
  }

  try {
    const { latitude, longitude, city } = location;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&past_days=14&forecast_days=16&temperature_unit=celsius`;

    const response = await safeGetJson<{
      current?: {
        temperature_2m: number;
        weather_code: number;
      };
      daily?: {
        time: string[];
        weather_code: number[];
        temperature_2m_max: number[];
        temperature_2m_min: number[];
      };
    }>(url);

    const dailyByDate: Record<string, DailyWeather> = {};
    const times = response.daily?.time ?? [];
    const codes = response.daily?.weather_code ?? [];
    const maxTemps = response.daily?.temperature_2m_max ?? [];
    const minTemps = response.daily?.temperature_2m_min ?? [];

    for (let i = 0; i < times.length; i++) {
      const dateStr = times[i];
      dailyByDate[dateStr] = {
        date: dateStr,
        weatherCode: codes[i] ?? 0,
        tempMax: Math.round(maxTemps[i] ?? 0),
        tempMin: Math.round(minTemps[i] ?? 0),
      };
    }

    const todayStr = format(new Date(), "yyyy-MM-dd");
    const todayDaily = dailyByDate[todayStr];
    const currentCode =
      response.current?.weather_code ?? todayDaily?.weatherCode ?? 0;
    const currentTemp = Math.round(
      response.current?.temperature_2m ?? todayDaily?.tempMax ?? 18
    );

    const data: WeatherData = {
      current: {
        city,
        temperature: currentTemp,
        weatherCode: currentCode,
        conditionLabel: describeWeatherCode(currentCode),
        tempMax: todayDaily?.tempMax ?? currentTemp,
        tempMin: todayDaily?.tempMin ?? currentTemp,
      },
      dailyByDate,
    };

    try {
      localStorage.setItem(
        WEATHER_CACHE_KEY,
        JSON.stringify({ ts: Date.now(), data })
      );
    } catch {
      // Ignore quota errors
    }

    return data;
  } catch (err) {
    console.warn("[weatherService] Weather fetch fallback:", err);
    return {
      current: null,
      dailyByDate: {},
    };
  }
}
