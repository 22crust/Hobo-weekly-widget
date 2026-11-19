import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, MapPin, Search, X } from "lucide-react";
import {
  CitySearchResult,
  SavedWeatherLocation,
  searchWeatherCities,
} from "../../services/weatherService";

interface WeatherLocationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectLocation: (loc: SavedWeatherLocation) => void;
}

export const WeatherLocationModal: React.FC<WeatherLocationModalProps> = ({
  isOpen,
  onClose,
  onSelectLocation,
}) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CitySearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      setResults([]);
      setError(null);
      return;
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setError(null);
      setIsSearching(false);
      return;
    }

    let cancelled = false;
    setIsSearching(true);
    setError(null);

    const timer = window.setTimeout(() => {
      void searchWeatherCities(trimmed)
        .then((res) => {
          if (!cancelled) {
            setResults(res);
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : "Search failed");
          }
        })
        .finally(() => {
          if (!cancelled) {
            setIsSearching(false);
          }
        });
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <div
      onClick={onClose}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/25 select-none p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[360px] bg-hobo-paper border border-hobo-lineDark text-hobo-ink flex flex-col overflow-hidden shadow-sm"
      >
        <div className="px-4 py-2.5 border-b border-hobo-lineDark flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-[0.16em] font-normal text-hobo-ink">
            SET WEATHER LOCATION
          </span>
          <button
            type="button"
            onClick={onClose}
            className="p-0.5 text-hobo-muted hover:text-hobo-red bg-transparent border-0 outline-none"
          >
            <X className="w-3.5 h-3.5 stroke-[1.5]" />
          </button>
        </div>

        <div className="p-3.5 space-y-2.5 text-xs font-light">
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 text-hobo-muted absolute left-2 pointer-events-none stroke-[1.5]" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search city (e.g. Tokyo, Toronto, Seattle)..."
              autoFocus
              className="w-full bg-white/70 border border-hobo-lineDark pl-7 pr-7 py-1.5 text-[11px] text-hobo-ink placeholder:text-hobo-faint outline-none focus:border-hobo-red font-light"
            />
            {isSearching && (
              <Loader2 className="w-3.5 h-3.5 text-hobo-muted animate-spin absolute right-2" />
            )}
          </div>

          {error && (
            <div className="px-2 py-1 text-[10px] border border-hobo-red bg-hobo-redSoft text-hobo-red">
              {error}
            </div>
          )}

          {results.length > 0 && (
            <div className="max-h-48 overflow-y-auto border border-hobo-line divide-y divide-hobo-line bg-white/50">
              {results.map((city) => {
                const sub = [city.admin1, city.country]
                  .filter(Boolean)
                  .join(", ");
                return (
                  <button
                    key={city.id}
                    type="button"
                    onClick={() => {
                      onSelectLocation({
                        city: city.name,
                        latitude: city.latitude,
                        longitude: city.longitude,
                      });
                    }}
                    className="w-full px-2.5 py-1.5 flex items-center gap-2 text-left hover:bg-hobo-redSoft hover:text-hobo-red transition-colors bg-transparent border-0"
                  >
                    <MapPin className="w-3 h-3 shrink-0 stroke-[1.5] text-hobo-muted" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-normal text-hobo-ink truncate">
                        {city.name}
                      </div>
                      {sub && (
                        <div className="text-[10px] text-hobo-muted truncate">
                          {sub}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {query.trim().length >= 2 && !isSearching && results.length === 0 && !error && (
            <div className="text-[10px] text-hobo-muted px-1">
              No matching cities found.
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
