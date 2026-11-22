import React, { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import {
  formatEventTimeRange,
  formatHHmm,
  getSavedTimeFormat,
  subscribeTimeFormat,
  TimeFormat,
} from "../../../shared/timeFormat";
import { MapPin, Pencil, Plus, Repeat, Trash2, X } from "lucide-react";
import {
  CreateLocalEventInput,
  GoogleEvent,
  RepeatType,
  RepeatUnit,
  UpdateLocalEventInput,
} from "../types/planner";

interface DayEventsSectionProps {
  selectedDate: string;
  events: GoogleEvent[];
  onClose: () => void;
  onAddLocalEvent: (input: CreateLocalEventInput) => Promise<unknown>;
  onUpdateLocalEvent: (
    seriesId: string,
    occurrenceDate: string,
    updates: UpdateLocalEventInput,
    scope: "this_only" | "all_future" | "all"
  ) => Promise<void>;
  onDeleteLocalEvent: (
    seriesId: string,
    occurrenceDate: string,
    scope: "this_only" | "all_future" | "all"
  ) => Promise<void>;
}

function generate15MinIntervals(): string[] {
  const slots: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      slots.push(
        `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
      );
    }
  }
  return slots;
}

const TIME_SLOTS_15M = generate15MinIntervals();

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minutesToTime(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 45, totalMinutes));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export const DayEventsSection: React.FC<DayEventsSectionProps> = ({
  selectedDate,
  events,
  onClose,
  onAddLocalEvent,
  onUpdateLocalEvent,
  onDeleteLocalEvent,
}) => {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<GoogleEvent | null>(null);

  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [isAllDay, setIsAllDay] = useState(false);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [endTimeManuallyChanged, setEndTimeManuallyChanged] = useState(false);
  const [isRepeating, setIsRepeating] = useState(false);
  const [repeatType, setRepeatType] = useState<RepeatType>("monthly");
  const [repeatIntervalText, setRepeatIntervalText] = useState("1");
  const [repeatUnit, setRepeatUnit] = useState<RepeatUnit>("weeks");
  const [scopePrompt, setScopePrompt] = useState<"edit" | "delete" | null>(
    null
  );
  const [timeFormat, setTimeFormat] = useState<TimeFormat>(() =>
    getSavedTimeFormat()
  );

  useEffect(() => {
    return subscribeTimeFormat(setTimeFormat);
  }, []);

  const visibleEvents = events.filter((e) => !e.is_hidden);

  const endTimeOptions = useMemo(() => {
    const startMins = timeToMinutes(startTime);
    return TIME_SLOTS_15M.filter((slot) => timeToMinutes(slot) > startMins);
  }, [startTime]);

  const handleStartTimeChange = (nextStart: string) => {
    setStartTime(nextStart);
    const startMins = timeToMinutes(nextStart);
    if (!endTimeManuallyChanged) {
      const defaultEndMins = Math.min(23 * 60 + 45, startMins + 60);
      setEndTime(minutesToTime(Math.max(startMins + 15, defaultEndMins)));
    } else if (timeToMinutes(endTime) <= startMins) {
      setEndTime(minutesToTime(Math.min(23 * 60 + 45, startMins + 15)));
    }
  };

  const handleEndTimeChange = (nextEnd: string) => {
    setEndTime(nextEnd);
    setEndTimeManuallyChanged(true);
  };

  const parsedInterval = Math.max(
    1,
    parseInt(repeatIntervalText.replace(/[^0-9]/g, ""), 10) || 1
  );

  const openAddForm = () => {
    setEditingEvent(null);
    setTitle("");
    setLocation("");
    setIsAllDay(false);
    setStartTime("09:00");
    setEndTime("10:00");
    setEndTimeManuallyChanged(false);
    setIsRepeating(false);
    setRepeatType("monthly");
    setRepeatIntervalText("1");
    setRepeatUnit("weeks");
    setScopePrompt(null);
    setIsFormOpen(true);
  };

  const openEditForm = (ev: GoogleEvent) => {
    if (!ev.is_local || !ev.local_event_id) return;
    const st = ev.local_start_hhmm || "09:00";
    const et = ev.local_end_hhmm || minutesToTime(timeToMinutes(st) + 60);
    setEditingEvent(ev);
    setTitle(ev.title);
    setLocation(ev.location || "");
    setIsAllDay(ev.is_all_day);
    setStartTime(st);
    setEndTime(et);
    setEndTimeManuallyChanged(timeToMinutes(et) - timeToMinutes(st) !== 60);
    setIsRepeating(Boolean(ev.is_repeating));
    setRepeatType(ev.repeat_type ?? "monthly");
    setRepeatIntervalText(String(ev.repeat_interval ?? 1));
    setRepeatUnit(ev.repeat_unit ?? "weeks");
    setScopePrompt(null);
    setIsFormOpen(true);
  };

  const handleSave = async (
    scope: "this_only" | "all_future" | "all" = "all"
  ) => {
    if (!title.trim()) return;
    if (!editingEvent) {
      await onAddLocalEvent({
        title: title.trim(),
        location: location.trim() || null,
        event_date: selectedDate,
        start_time: isAllDay ? null : startTime,
        end_time: isAllDay ? null : endTime,
        is_all_day: isAllDay,
        is_repeating: isRepeating,
        repeat_type: isRepeating ? repeatType : null,
        repeat_interval:
          isRepeating && repeatType === "custom" ? parsedInterval : 1,
        repeat_unit:
          isRepeating && repeatType === "custom" ? repeatUnit : null,
      });
      setIsFormOpen(false);
      return;
    }

    if (editingEvent.is_repeating && !scopePrompt) {
      setScopePrompt("edit");
      return;
    }

    await onUpdateLocalEvent(
      editingEvent.local_event_id!,
      selectedDate,
      {
        title: title.trim(),
        location: location.trim() || null,
        start_time: isAllDay ? null : startTime,
        end_time: isAllDay ? null : endTime,
        is_all_day: isAllDay,
        is_repeating: isRepeating,
        repeat_type: isRepeating ? repeatType : null,
        repeat_interval:
          isRepeating && repeatType === "custom" ? parsedInterval : 1,
        repeat_unit:
          isRepeating && repeatType === "custom" ? repeatUnit : null,
      },
      scope
    );
    setScopePrompt(null);
    setIsFormOpen(false);
  };

  const handleDelete = async (
    scope: "this_only" | "all_future" | "all" = "all"
  ) => {
    if (!editingEvent?.local_event_id) return;
    if (editingEvent.is_repeating && !scopePrompt) {
      setScopePrompt("delete");
      return;
    }
    await onDeleteLocalEvent(editingEvent.local_event_id, selectedDate, scope);
    setScopePrompt(null);
    setIsFormOpen(false);
  };

  return (
    <section className="px-3.5 py-2.5 bg-hobo-paperSolid border-b border-hobo-lineDark">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium uppercase tracking-[0.1em] text-hobo-red">
          {format(parseISO(selectedDate), "EEE, MMM d, yyyy")}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={openAddForm}
            className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] border border-hobo-lineDark text-hobo-ink hover:border-hobo-red hover:text-hobo-red transition-colors"
          >
            <Plus className="w-3 h-3 stroke-[1.75]" />
            Event
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-hobo-muted hover:text-hobo-ink"
          >
            <X className="w-3.5 h-3.5 stroke-[1.75]" />
          </button>
        </div>
      </div>

      {visibleEvents.length === 0 ? (
        <p className="text-xs text-hobo-muted py-1">No events on this day.</p>
      ) : (
        <div className="space-y-0.5">
          {visibleEvents.map((ev) => (
            <div
              key={ev.instance_key}
              className="px-0 py-0.5 text-xs flex items-start justify-between gap-1.5 bg-transparent text-hobo-red select-none"
            >
              <div className="min-w-0 flex-1 flex flex-wrap items-center gap-x-1.5 leading-[16px]">
                <span className="shrink-0 font-normal text-[10px] leading-[16px] tracking-tight opacity-90">
                  {formatEventTimeRange(ev, timeFormat)}
                </span>
                <span className="font-light leading-[16px] break-words">
                  {ev.title}
                </span>
                {ev.is_repeating && (
                  <Repeat className="w-2.5 h-2.5 opacity-75 shrink-0" />
                )}
                {ev.location && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] leading-[16px] opacity-75 shrink-0">
                    <MapPin className="w-2.5 h-2.5 stroke-[1.5] shrink-0" />
                    <span className="truncate max-w-[140px]">
                      {ev.location}
                    </span>
                  </span>
                )}
              </div>

              {ev.is_local && (
                <button
                  type="button"
                  onClick={() => openEditForm(ev)}
                  className="p-0.5 text-hobo-red/70 hover:text-hobo-red shrink-0"
                >
                  <Pencil className="w-3 h-3 stroke-[1.5]" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {isFormOpen && (
        <div className="mt-2 p-2.5 border border-hobo-lineDark bg-hobo-paperSolid space-y-2 text-[11px]">
          <div className="flex items-center justify-between">
            {editingEvent ? (
              <span className="text-[10px] uppercase tracking-[0.1em] text-hobo-ink font-medium">
                Edit Local Event
              </span>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={() => setIsFormOpen(false)}
              className="text-hobo-muted hover:text-hobo-ink"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Event title *"
            autoFocus
            className="w-full px-2 py-1 border border-hobo-lineDark bg-white/70 text-[11px] text-hobo-ink placeholder:text-hobo-faint outline-none focus:border-hobo-red font-light"
          />

          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Location (optional)"
            className="w-full px-2 py-1 border border-hobo-lineDark bg-white/70 text-[11px] text-hobo-ink placeholder:text-hobo-faint outline-none focus:border-hobo-red font-light"
          />

          {/* Time Selection (15-min dropdowns matching desktop) & All day */}
          <div className="flex items-center justify-between gap-2">
            <label className="inline-flex items-center gap-1.5 text-[10px] text-hobo-ink cursor-pointer select-none shrink-0">
              <input
                type="checkbox"
                checked={isAllDay}
                onChange={(e) => setIsAllDay(e.target.checked)}
                className="accent-hobo-red"
              />
              <span>All day</span>
            </label>
            {!isAllDay && (
              <div className="flex items-center gap-1 text-[10px]">
                <select
                  value={startTime}
                  onChange={(e) => handleStartTimeChange(e.target.value)}
                  className="bg-white/70 border border-hobo-lineDark px-1 py-0.5 text-[10px] text-hobo-ink outline-none focus:border-hobo-red"
                >
                  {TIME_SLOTS_15M.slice(0, -1).map((slot) => (
                    <option key={slot} value={slot}>
                      {formatHHmm(slot, timeFormat)}
                    </option>
                  ))}
                </select>
                <span className="text-hobo-muted">–</span>
                <select
                  value={endTime}
                  onChange={(e) => handleEndTimeChange(e.target.value)}
                  className="bg-white/70 border border-hobo-lineDark px-1 py-0.5 text-[10px] text-hobo-ink outline-none focus:border-hobo-red"
                >
                  {endTimeOptions.map((slot) => (
                    <option key={slot} value={slot}>
                      {formatHHmm(slot, timeFormat)}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Repeating checkbox & segmented buttons matching desktop */}
          <div className="space-y-1.5 pt-1 border-t border-hobo-line">
            <label className="inline-flex items-center gap-1.5 text-[10px] text-hobo-ink cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isRepeating}
                onChange={(e) => setIsRepeating(e.target.checked)}
                className="accent-hobo-red"
              />
              <span>Repeating</span>
            </label>

            {isRepeating && (
              <div className="space-y-1.5 pl-4">
                <div className="grid grid-cols-3 border border-hobo-lineDark text-[9px] uppercase tracking-[0.08em]">
                  {(["monthly", "annual", "custom"] as RepeatType[]).map(
                    (mode, idx) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setRepeatType(mode)}
                        className={`py-1 px-1 transition-colors ${
                          idx < 2 ? "border-r border-hobo-lineDark" : ""
                        } ${
                          repeatType === mode
                            ? "bg-hobo-redSoft text-hobo-red font-normal"
                            : "bg-transparent text-hobo-muted hover:text-hobo-ink"
                        }`}
                      >
                        {mode}
                      </button>
                    )
                  )}
                </div>

                {repeatType === "custom" && (
                  <div className="flex items-center gap-1.5 text-[10px] text-hobo-ink">
                    <span className="text-hobo-muted">Every</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={repeatIntervalText}
                      onChange={(e) =>
                        setRepeatIntervalText(e.target.value.replace(/[^0-9]/g, ""))
                      }
                      onBlur={() => {
                        if (!repeatIntervalText) setRepeatIntervalText("1");
                      }}
                      className="w-12 bg-white/70 border border-hobo-lineDark px-1.5 py-0.5 text-[10px] text-hobo-ink outline-none focus:border-hobo-red"
                    />
                    <select
                      value={repeatUnit}
                      onChange={(e) =>
                        setRepeatUnit(e.target.value as RepeatUnit)
                      }
                      className="bg-white/70 border border-hobo-lineDark px-1 py-0.5 text-[10px] text-hobo-ink outline-none focus:border-hobo-red"
                    >
                      <option value="days">days</option>
                      <option value="weeks">weeks</option>
                      <option value="months">months</option>
                    </select>
                  </div>
                )}
              </div>
            )}
          </div>

          {scopePrompt ? (
            <div className="p-2 border border-hobo-red/40 bg-hobo-redSoft/30 space-y-1.5">
              <p className="text-[11px] text-hobo-ink">
                {scopePrompt === "delete"
                  ? "Delete repeating event:"
                  : "Apply changes to:"}
              </p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    scopePrompt === "delete"
                      ? void handleDelete("this_only")
                      : void handleSave("this_only")
                  }
                  className="px-2 py-1 border border-hobo-lineDark bg-hobo-paper text-[11px]"
                >
                  This event only
                </button>
                <button
                  type="button"
                  onClick={() =>
                    scopePrompt === "delete"
                      ? void handleDelete("all_future")
                      : void handleSave("all_future")
                  }
                  className="px-2 py-1 border border-hobo-lineDark bg-hobo-paper text-[11px]"
                >
                  This & future
                </button>
                <button
                  type="button"
                  onClick={() =>
                    scopePrompt === "delete"
                      ? void handleDelete("all")
                      : void handleSave("all")
                  }
                  className="px-2 py-1 border border-hobo-lineDark bg-hobo-paper text-[11px]"
                >
                  Entire series
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between pt-1">
              {editingEvent ? (
                <button
                  type="button"
                  onClick={() => void handleDelete("all")}
                  className="inline-flex items-center gap-1 px-2 py-1 text-hobo-red border border-hobo-red/40 hover:bg-hobo-redSoft"
                >
                  <Trash2 className="w-3 h-3" />
                  Delete
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={() => void handleSave("all")}
                className="px-3 py-1 bg-hobo-red text-white text-[11px] uppercase tracking-wider"
              >
                Save
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
