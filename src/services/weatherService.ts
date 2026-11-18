import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { format } from "date-fns";
import { DailyWeather, WeatherData } from "../types/planner";

interface GeoCoordinates {
  latitude: number;
  longitude: number;
  city: string;
}

const WEATHER_CACHE_KEY = "hobonichi_planner_weather_cache_v1";
const GEO_CACHE_KEY = "hobonichi_planner_geo_cache_v1";
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

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
  if (code === 66 || code === 67) return "Freezing rain";
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
    // Fallback to window.fetch if running outside Tauri webview
    const res = await window.fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  }
}

const IP_GEO_ENDPOINTS = [
  "https://get.geojs.io/v1/ip/geo.json",
  "https://ipwho.is/",
  "https://ipapi.co/json/",
];

async function resolveCoordinates(): Promise<GeoCoordinates> {
  try {
    const cachedGeo = localStorage.getItem(GEO_CACHE_KEY);
    if (cachedGeo) {
      const parsed = JSON.parse(cachedGeo) as GeoCoordinates & { ts: number };
      if (
        Date.now() - parsed.ts < 12 * 60 * 60 * 1000 &&
        parsed.city &&
        parsed.city !== "Local"
      ) {
        return {
          latitude: parsed.latitude,
          longitude: parsed.longitude,
          city: parsed.city,
        };
      }
    }
  } catch {
    // Ignore storage parse error
  }

  for (const endpoint of IP_GEO_ENDPOINTS) {
    try {
      const ipData = await safeGetJson<{
        latitude?: number | string;
        longitude?: number | string;
        city?: string;
        region?: string;
      }>(endpoint);

      const lat =
        typeof ipData.latitude === "number"
          ? ipData.latitude
          : parseFloat(String(ipData.latitude ?? ""));
      const lon =
        typeof ipData.longitude === "number"
          ? ipData.longitude
          : parseFloat(String(ipData.longitude ?? ""));
      const city = (ipData.city || ipData.region || "").trim();

      if (!Number.isNaN(lat) && !Number.isNaN(lon) && city) {
        const coords: GeoCoordinates = { latitude: lat, longitude: lon, city };
        localStorage.setItem(
          GEO_CACHE_KEY,
          JSON.stringify({ ...coords, ts: Date.now() })
        );
        return coords;
      }
    } catch {
      // Try next geolocation endpoint
    }
  }

  return {
    latitude: 43.6532,
    longitude: -79.3832,
    city: "Local",
  };
}

/**
 * Fetches current weather + 16-day daily forecast (with 7 past days) in Celsius (°C) from Open-Meteo.
 */
export async function fetchWeatherForecast(forceRefresh = false): Promise<WeatherData> {
  if (!forceRefresh) {
    try {
      const rawCache = localStorage.getItem(WEATHER_CACHE_KEY);
      if (rawCache) {
        const cached = JSON.parse(rawCache) as { ts: number; data: WeatherData };
        if (
          Date.now() - cached.ts < CACHE_TTL_MS &&
          cached.data?.current &&
          cached.data.current.city !== "Local"
        ) {
          return cached.data;
        }
      }
    } catch {
      // Ignore invalid cache
    }
  }

  try {
    const { latitude, longitude, city } = await resolveCoordinates();
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
    const currentCode = response.current?.weather_code ?? todayDaily?.weatherCode ?? 0;
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

    if (city !== "Local") {
      try {
        localStorage.setItem(
          WEATHER_CACHE_KEY,
          JSON.stringify({ ts: Date.now(), data })
        );
      } catch {
        // Ignore quota errors
      }
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
