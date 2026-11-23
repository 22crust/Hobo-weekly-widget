import React from "react";
import {
  eachDayOfInterval,
  endOfYear,
  format,
  isAfter,
  startOfDay,
  startOfYear,
} from "date-fns";

interface YearProgressGridProps {
  yearDate?: Date;
  onSelectDate?: (dateStr: string) => void;
}

export const YearProgressGrid: React.FC<YearProgressGridProps> = ({
  onSelectDate,
}) => {
  const today = startOfDay(new Date());
  const todayStr = format(today, "yyyy-MM-dd");
  const currentYear = today.getFullYear();
  const targetYearStart = startOfYear(new Date(currentYear, 0, 1));
  const targetYearEnd = endOfYear(targetYearStart);

  const allDaysOfYear = eachDayOfInterval({
    start: targetYearStart,
    end: targetYearEnd,
  });

  const passedDaysCount = allDaysOfYear.filter(
    (day) => !isAfter(startOfDay(day), today)
  ).length;
  const totalDaysCount = allDaysOfYear.length;
  const percentComplete = Math.round((passedDaysCount / totalDaysCount) * 100);

  return (
    <div className="shrink-0 flex flex-col justify-start px-3.5 py-2.5 select-none overflow-hidden pointer-events-none">
      {/* Header showing year progress */}
      <div className="relative z-10 flex items-baseline justify-between mb-3">
        <span className="text-[10px] uppercase tracking-[0.14em] text-hobo-muted">
          {currentYear} YEAR IN DAYS
        </span>
        <span className="text-[10px] tracking-[0.08em] text-hobo-muted">
          <strong className="font-normal text-hobo-ink">{passedDaysCount}</strong> /{" "}
          {totalDaysCount} ({percentComplete}%)
        </span>
      </div>

      {/* 10-row column-first grid of smaller squares */}
      <div className="relative z-10 flex items-center justify-center">
        <div
          className="grid grid-rows-10 grid-flow-col gap-[2px] pointer-events-auto"
          style={{
            gridAutoColumns: "6px",
          }}
        >
          {allDaysOfYear.map((day) => {
            const dateStr = format(day, "yyyy-MM-dd");
            const hasPassedOrToday = !isAfter(startOfDay(day), today);
            const isToday = dateStr === todayStr;

            return (
              <button
                key={dateStr}
                type="button"
                onClick={() => onSelectDate?.(dateStr)}
                className={`w-[6px] h-[6px] transition-colors border ${
                  isToday
                    ? "bg-hobo-red/35 border-hobo-red/70"
                    : hasPassedOrToday
                    ? "bg-hobo-muted/35 border-hobo-muted/50"
                    : "bg-transparent border-hobo-lineDark/55 hover:border-hobo-red/60"
                }`}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};
