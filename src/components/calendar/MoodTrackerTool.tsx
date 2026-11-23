import React, { useCallback, useEffect, useState } from "react";
import { getDaysInMonth } from "date-fns";
import { ChevronLeft, ChevronRight, Eraser } from "lucide-react";
import type { MoodColorKey } from "../../../shared/calendarTools";
import { useDatabaseSubscription } from "../../hooks/useDatabaseSubscription";
import {
  getMoodEntriesForYear,
  setMoodEntry,
} from "../../db/calendarToolsRepo";

const MONTH_INITIALS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

const MOOD_SWATCHES: { key: MoodColorKey; hex: string }[] = [
  { key: "grey", hex: "rgba(74, 72, 69, 0.5)" },
  { key: "red", hex: "rgba(201, 74, 56, 0.5)" },
  { key: "orange", hex: "rgba(217, 119, 54, 0.5)" },
  { key: "yellow", hex: "rgba(224, 180, 67, 0.5)" },
  { key: "green", hex: "rgba(91, 138, 90, 0.5)" },
];

const COLOR_HEX_BY_KEY: Record<MoodColorKey, string> = {
  grey: "rgba(74, 72, 69, 0.5)",
  red: "rgba(201, 74, 56, 0.5)",
  orange: "rgba(217, 119, 54, 0.5)",
  yellow: "rgba(224, 180, 67, 0.5)",
  green: "rgba(91, 138, 90, 0.5)",
};

interface MoodTrackerToolProps {
  initialYear?: number;
}

export const MoodTrackerTool: React.FC<MoodTrackerToolProps> = ({
  initialYear,
}) => {
  const [year, setYear] = useState<number>(
    () => initialYear ?? new Date().getFullYear()
  );
  const [selectedColor, setSelectedColor] = useState<MoodColorKey | "erase">(
    "green"
  );
  const [entriesByDate, setEntriesByDate] = useState<
    Record<string, MoodColorKey>
  >({});

  const loadYearEntries = useCallback(async (targetYear: number) => {
    try {
      const map = await getMoodEntriesForYear(targetYear);
      setEntriesByDate(map);
    } catch (err) {
      console.warn("[MoodTrackerTool] Failed to load mood entries:", err);
    }
  }, []);

  useEffect(() => {
    void loadYearEntries(year);
  }, [year, loadYearEntries]);

  useDatabaseSubscription((source) => {
    if (
      source?.startsWith("mood_entries:") ||
      source?.startsWith("calendar_tools:") ||
      source?.startsWith("github_sync:")
    ) {
      void loadYearEntries(year);
    }
  });

  const handlePaintDay = (dateStr: string) => {
    const current = entriesByDate[dateStr];
    const nextColor: MoodColorKey | null =
      selectedColor === "erase" || current === selectedColor
        ? null
        : selectedColor;

    setEntriesByDate((prev) => {
      const copy = { ...prev };
      if (nextColor === null) delete copy[dateStr];
      else copy[dateStr] = nextColor;
      return copy;
    });

    void setMoodEntry(dateStr, nextColor);
  };

  return (
    <div className="px-3.5 py-2.5 select-none">
      {/* Compact Header: Left-aligned Year Switcher + 5 Unlabelled Swatches + Eraser */}
      <div className="flex items-center justify-start gap-3 mb-2">
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setYear((y) => y - 1)}
            className="p-0.5 text-hobo-muted hover:text-hobo-red bg-transparent border-0"
          >
            <ChevronLeft className="w-3 h-3 stroke-[1.5]" />
          </button>
          <span className="text-[10px] tracking-[0.06em] text-hobo-ink font-normal">
            {year}
          </span>
          <button
            type="button"
            onClick={() => setYear((y) => y + 1)}
            className="p-0.5 text-hobo-muted hover:text-hobo-red bg-transparent border-0"
          >
            <ChevronRight className="w-3 h-3 stroke-[1.5]" />
          </button>
        </div>

        {/* 5-colour palette + eraser (no text labels) */}
        <div className="flex items-center gap-1">
          {MOOD_SWATCHES.map((swatch) => {
            const active = selectedColor === swatch.key;
            return (
              <button
                key={swatch.key}
                type="button"
                onClick={() => setSelectedColor(swatch.key)}
                style={{ backgroundColor: swatch.hex }}
                className={`w-3 h-3 rounded-[2px] border transition-transform ${
                  active
                    ? "border-hobo-ink scale-115 ring-1 ring-hobo-ink/60"
                    : "border-black/20 hover:scale-105"
                }`}
              />
            );
          })}
          <button
            type="button"
            onClick={() => setSelectedColor("erase")}
            title="Clear day"
            className={`ml-0.5 p-0.5 rounded-[2px] border transition-colors ${
              selectedColor === "erase"
                ? "border-hobo-ink text-hobo-ink bg-white/70"
                : "border-transparent text-hobo-muted hover:text-hobo-ink bg-transparent"
            }`}
          >
            <Eraser className="w-2.5 h-2.5 stroke-[1.5]" />
          </button>
        </div>
      </div>

      {/* 12x31 Year-in-Pixels Grid (non-existent dates omitted, left-aligned) */}
      <div className="flex flex-col items-start">
        <div
          className="grid gap-[1.5px]"
          style={{
            gridTemplateColumns: "14px repeat(12, 9px)",
          }}
        >
          {/* Month Header Row */}
          <div />
          {MONTH_INITIALS.map((m, mIdx) => (
            <div
              key={mIdx}
              className="text-[8px] leading-none text-center text-hobo-muted pb-0.5"
            >
              {m}
            </div>
          ))}

          {/* Days 1..31 */}
          {Array.from({ length: 31 }, (_, dayIdx) => {
            const dayNum = dayIdx + 1;
            return (
              <React.Fragment key={dayNum}>
                <div className="text-[7.5px] leading-[9px] text-right pr-1 text-hobo-faint tabular-nums">
                  {dayNum}
                </div>
                {Array.from({ length: 12 }, (_, monthIdx) => {
                  const daysInMonth = getDaysInMonth(new Date(year, monthIdx, 1));
                  if (dayNum > daysInMonth) {
                    return <div key={`${monthIdx}-${dayNum}`} className="w-[9px] h-[9px]" />;
                  }

                  const dateStr = `${year}-${String(monthIdx + 1).padStart(
                    2,
                    "0"
                  )}-${String(dayNum).padStart(2, "0")}`;
                  const paintedKey = entriesByDate[dateStr];
                  const fillHex = paintedKey ? COLOR_HEX_BY_KEY[paintedKey] : undefined;

                  return (
                    <button
                      key={dateStr}
                      type="button"
                      onClick={() => handlePaintDay(dateStr)}
                      style={fillHex ? { backgroundColor: fillHex } : undefined}
                      className={`w-[9px] h-[9px] border transition-colors ${
                        fillHex
                          ? "border-black/25 hover:opacity-85"
                          : "bg-transparent border-hobo-lineDark/65 hover:border-hobo-ink"
                      }`}
                    />
                  );
                })}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
};
