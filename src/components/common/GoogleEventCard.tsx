import React, { useEffect, useState } from "react";
import { EyeOff, MapPin } from "lucide-react";
import { GoogleEvent } from "../../types/planner";
import {
  formatEventTimeRange,
  getSavedTimeFormat,
  subscribeTimeFormat,
  TimeFormat,
} from "../../../shared/timeFormat";

interface GoogleEventCardProps {
  event: GoogleEvent;
  onHide?: (id: number, event?: GoogleEvent) => void;
  showLocation?: boolean;
  compact?: boolean;
}

export function formatEventTimeLabel(
  event: GoogleEvent,
  timeFormat: TimeFormat = getSavedTimeFormat()
): string {
  return formatEventTimeRange(event, timeFormat);
}

export const GoogleEventCard: React.FC<GoogleEventCardProps> = ({
  event,
  onHide,
  showLocation = false,
  compact = false,
}) => {
  const [timeFormat, setTimeFormat] = useState<TimeFormat>(() =>
    getSavedTimeFormat()
  );

  useEffect(() => {
    return subscribeTimeFormat(setTimeFormat);
  }, []);

  const timeLabel = formatEventTimeLabel(event, timeFormat);

  return (
    <div
      className={`group relative flex items-start justify-between gap-1.5 bg-transparent text-hobo-red select-none ${
        compact
          ? "px-0 py-0 text-[11px] leading-[16px]"
          : "px-0 py-1 text-xs"
      }`}
    >
      <div className="min-w-0 flex-1 flex items-baseline gap-1.5 overflow-hidden group-hover:overflow-visible">
        <span className="shrink-0 font-normal text-[10px] tracking-tight opacity-90">
          {timeLabel}
        </span>
        <span className="truncate group-hover:whitespace-normal group-hover:break-words font-light">
          {event.title}
        </span>
        {showLocation && event.location && (
          <span className="inline-flex items-center gap-0.5 text-[10px] opacity-75 shrink-0">
            <MapPin className="w-2.5 h-2.5 stroke-[1.5]" />
            <span className="truncate max-w-[120px]">{event.location}</span>
          </span>
        )}
      </div>

      {onHide && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onHide(event.id, event);
          }}
          className="mt-[2px] opacity-0 group-hover:opacity-100 transition-opacity p-0 text-hobo-red/70 hover:text-hobo-red bg-transparent border-0 shrink-0"
        >
          <EyeOff className="w-3 h-3 stroke-[1.5]" />
        </button>
      )}
    </div>
  );
};
