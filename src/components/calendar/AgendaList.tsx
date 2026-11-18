import React, { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { MapPin, Pencil, Plus, X } from "lucide-react";
import {
  CreateLocalEventInput,
  GoogleEvent,
  LocalTask,
  RepeatType,
  RepeatUnit,
  UpdateLocalEventInput,
} from "../../types/planner";
import { formatEventTimeLabel } from "../common/GoogleEventCard";
import { TaskItem } from "../common/TaskItem";

interface AgendaListProps {
  selectedDate: string;
  events: GoogleEvent[];
  tasks: LocalTask[];
  onClearSelection: () => void;
  onCreateLocalEvent: (input: CreateLocalEventInput) => Promise<void> | void;
  onUpdateLocalEvent: (
    id: string,
    updates: UpdateLocalEventInput
  ) => Promise<void> | void;
  onUpdateLocalEventThisOnly: (
    seriesId: string,
    occurrenceDate: string,
    updates: UpdateLocalEventInput
  ) => Promise<void> | void;
  onUpdateLocalEventFuture: (
    seriesId: string,
    occurrenceDate: string,
    updates: UpdateLocalEventInput
  ) => Promise<void> | void;
  onDeleteLocalEvent: (id: string) => Promise<void> | void;
  onDeleteLocalEventThisOnly: (
    seriesId: string,
    occurrenceDate: string
  ) => Promise<void> | void;
  onDeleteLocalEventFuture: (
    seriesId: string,
    occurrenceDate: string
  ) => Promise<void> | void;
  onToggleTask: (id: number, isCompleted: boolean) => void;
  onEditTaskTitle: (id: number, newTitle: string) => void;
  onDeleteTask: (id: number) => void;
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

function minutesToTime(totalMins: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 45, totalMins));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export const AgendaList: React.FC<AgendaListProps> = ({
  selectedDate,
  events,
  tasks,
  onClearSelection,
  onCreateLocalEvent,
  onUpdateLocalEvent,
  onUpdateLocalEventThisOnly,
  onUpdateLocalEventFuture,
  onDeleteLocalEvent,
  onDeleteLocalEventThisOnly,
  onDeleteLocalEventFuture,
  onToggleTask,
  onEditTaskTitle,
  onDeleteTask,
}) => {
  const parsedDate = parseISO(selectedDate);
  const formattedHeader = format(parsedDate, "EEE, MMM d, yyyy").toUpperCase();

  // Form state for adding or editing a local event
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
  const [repeatInterval, setRepeatInterval] = useState<number>(1);
  const [repeatUnit, setRepeatUnit] = useState<RepeatUnit>("weeks");

  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);

  useEffect(() => {
    setIsFormOpen(false);
    setEditingEvent(null);
    setConfirmDeleteKey(null);
  }, [selectedDate]);

  const endTimeOptions = useMemo(() => {
    const startMins = timeToMinutes(startTime);
    return TIME_SLOTS_15M.filter((slot) => timeToMinutes(slot) > startMins);
  }, [startTime]);

  const resetForm = () => {
    setIsFormOpen(false);
    setEditingEvent(null);
    setTitle("");
    setLocation("");
    setIsAllDay(false);
    setStartTime("09:00");
    setEndTime("10:00");
    setEndTimeManuallyChanged(false);
    setIsRepeating(false);
    setRepeatType("monthly");
    setRepeatInterval(1);
    setRepeatUnit("weeks");
  };

  const openCreateForm = () => {
    resetForm();
    setIsFormOpen(true);
  };

  const openEditForm = (ev: GoogleEvent) => {
    const st = ev.local_start_hhmm || "09:00";
    const et = ev.local_end_hhmm || minutesToTime(timeToMinutes(st) + 60);
    setEditingEvent(ev);
    setTitle(ev.title);
    setLocation(ev.location ?? "");
    setIsAllDay(ev.is_all_day);
    setStartTime(st);
    setEndTime(et);
    setEndTimeManuallyChanged(
      timeToMinutes(et) - timeToMinutes(st) !== 60
    );
    setIsRepeating(Boolean(ev.is_repeating));
    setRepeatType(ev.repeat_type ?? "monthly");
    setRepeatInterval(ev.repeat_interval ?? 1);
    setRepeatUnit(ev.repeat_unit ?? "weeks");
    setConfirmDeleteKey(null);
    setIsFormOpen(true);
  };

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

  const isFormValid =
    title.trim().length > 0 &&
    (isAllDay ||
      (Boolean(startTime) &&
        Boolean(endTime) &&
        timeToMinutes(endTime) > timeToMinutes(startTime)));

  const buildUpdatesPayload = (): UpdateLocalEventInput => ({
    title: title.trim(),
    location: location.trim() || null,
    is_all_day: isAllDay,
    start_time: isAllDay ? null : startTime,
    end_time: isAllDay ? null : endTime,
    is_repeating: isRepeating,
    repeat_type: isRepeating ? repeatType : null,
    repeat_interval: isRepeating && repeatType === "custom" ? Math.max(1, repeatInterval) : 1,
    repeat_unit: isRepeating && repeatType === "custom" ? repeatUnit : null,
  });

  const handleSaveNewOrSingle = async () => {
    if (!isFormValid) return;
    if (!editingEvent) {
      await onCreateLocalEvent({
        title: title.trim(),
        location: location.trim() || null,
        event_date: selectedDate,
        is_all_day: isAllDay,
        start_time: isAllDay ? null : startTime,
        end_time: isAllDay ? null : endTime,
        is_repeating: isRepeating,
        repeat_type: isRepeating ? repeatType : null,
        repeat_interval:
          isRepeating && repeatType === "custom"
            ? Math.max(1, repeatInterval)
            : 1,
        repeat_unit: isRepeating && repeatType === "custom" ? repeatUnit : null,
      });
    } else if (editingEvent.local_event_id) {
      await onUpdateLocalEvent(
        editingEvent.local_event_id,
        buildUpdatesPayload()
      );
    }
    resetForm();
  };

  const handleSaveThisOnly = async () => {
    if (!isFormValid || !editingEvent?.local_event_id) return;
    await onUpdateLocalEventThisOnly(
      editingEvent.local_event_id,
      editingEvent.event_date,
      buildUpdatesPayload()
    );
    resetForm();
  };

  const handleSaveAllFuture = async () => {
    if (!isFormValid || !editingEvent?.local_event_id) return;
    await onUpdateLocalEventFuture(
      editingEvent.local_event_id,
      editingEvent.event_date,
      buildUpdatesPayload()
    );
    resetForm();
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 px-3.5 py-2 pointer-events-none">
      {/* Agenda Header (no bottom border line between date and events) */}
      <div className="relative z-10 flex items-center justify-between pb-1 mb-1.5 pointer-events-auto">
        <div className="flex items-baseline gap-2">
          <span className="text-[11px] tracking-[0.12em] font-normal text-hobo-ink">
            {formattedHeader}
          </span>
        </div>

        <button
          type="button"
          onClick={onClearSelection}
          className="text-hobo-muted hover:text-hobo-red bg-transparent border-0 p-0.5"
        >
          <X className="w-3.5 h-3.5 stroke-[1.5]" />
        </button>
      </div>

      {/* Scrollable Agenda Items (no red background on events) */}
      <div className="relative z-10 flex-1 overflow-y-auto pr-1 space-y-1.5 pointer-events-none">
        {events.map((ev) => {
          const isConfirmingDelete = confirmDeleteKey === ev.instance_key;
          return (
            <div
              key={ev.instance_key}
              className="group py-1 bg-transparent text-hobo-red text-xs space-y-0.5 pointer-events-auto"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex items-baseline gap-2 flex-1">
                  <span className="font-normal text-[10px] tracking-tight opacity-90 shrink-0">
                    {formatEventTimeLabel(ev)}
                  </span>
                  {ev.location && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] opacity-80 truncate">
                      <MapPin className="w-2.5 h-2.5 stroke-[1.5] shrink-0" />
                      <span className="truncate">{ev.location}</span>
                    </span>
                  )}
                </div>

                {/* Edit (Pencil) and Delete (X) icons for user-created local events */}
                {ev.is_local && ev.local_event_id && !isConfirmingDelete && (
                  <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity shrink-0">
                    <button
                      type="button"
                      onClick={() => openEditForm(ev)}
                      className="p-0.5 text-hobo-red/75 hover:text-hobo-red bg-transparent border-0"
                    >
                      <Pencil className="w-2.5 h-2.5 stroke-[1.6]" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (ev.is_repeating) {
                          setConfirmDeleteKey(ev.instance_key);
                        } else if (ev.local_event_id) {
                          void onDeleteLocalEvent(ev.local_event_id);
                        }
                      }}
                      className="p-0.5 text-hobo-red/75 hover:text-hobo-red bg-transparent border-0"
                    >
                      <X className="w-3 h-3 stroke-[1.6]" />
                    </button>
                  </div>
                )}
              </div>

              <div className="font-light text-[12px] leading-snug break-words">
                {ev.title}
              </div>

              {/* Inline delete scope choice for repeating local events */}
              {ev.is_local && ev.local_event_id && isConfirmingDelete && (
                <div className="flex items-center gap-1.5 pt-1 text-[9px] uppercase tracking-[0.08em]">
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmDeleteKey(null);
                      if (ev.local_event_id) {
                        void onDeleteLocalEventThisOnly(
                          ev.local_event_id,
                          ev.event_date
                        );
                      }
                    }}
                    className="px-1.5 py-0.5 border border-hobo-lineDark text-hobo-ink hover:border-hobo-red hover:text-hobo-red bg-transparent"
                  >
                    Delete this only
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmDeleteKey(null);
                      if (ev.local_event_id) {
                        void onDeleteLocalEventFuture(
                          ev.local_event_id,
                          ev.event_date
                        );
                      }
                    }}
                    className="px-1.5 py-0.5 border border-hobo-red text-hobo-red hover:bg-hobo-red hover:text-white bg-transparent"
                  >
                    Delete all future
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteKey(null)}
                    className="px-1 py-0.5 text-hobo-muted hover:text-hobo-ink bg-transparent border-0"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {/* "+ Add event" text button under existing events */}
        {!isFormOpen && (
          <div className="pt-0.5 pointer-events-auto">
            <button
              type="button"
              onClick={openCreateForm}
              className="inline-flex items-center gap-1 text-[11px] text-hobo-muted hover:text-hobo-red bg-transparent border-0 p-0 transition-colors"
            >
              <Plus className="w-3 h-3 stroke-[1.6]" />
              <span>Add event</span>
            </button>
          </div>
        )}

        {/* Inline Event Creation / Edit Form */}
        {isFormOpen && (
          <div className="p-2 border border-hobo-lineDark bg-hobo-paperSolid/90 space-y-2 text-[11px] pointer-events-auto">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Event title *"
              autoFocus
              className="w-full bg-white/70 border border-hobo-lineDark px-2 py-1 text-[11px] text-hobo-ink placeholder:text-hobo-faint outline-none focus:border-hobo-red font-light"
            />

            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Location (optional)"
              className="w-full bg-white/70 border border-hobo-lineDark px-2 py-1 text-[11px] text-hobo-ink placeholder:text-hobo-faint outline-none focus:border-hobo-red font-light"
            />

            {/* Time Selection (15-min intervals, default +1h) & All day checkbox */}
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
                        {slot}
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
                        {slot}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Repeating checkbox & expanded options */}
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
                        type="number"
                        min={1}
                        max={365}
                        value={repeatInterval}
                        onChange={(e) =>
                          setRepeatInterval(
                            Math.max(1, parseInt(e.target.value, 10) || 1)
                          )
                        }
                        className="w-12 bg-white/70 border border-hobo-lineDark px-1.5 py-0.5 text-[10px] text-hobo-ink outline-none focus:border-hobo-red"
                      />
                      <select
                        value={repeatUnit}
                        onChange={(e) =>
                          setRepeatUnit(e.target.value as RepeatUnit)
                        }
                        className="bg-white/70 border border-hobo-lineDark px-1.5 py-0.5 text-[10px] text-hobo-ink outline-none focus:border-hobo-red"
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

            {/* Save & Cancel Buttons */}
            <div className="flex flex-wrap items-center justify-end gap-1.5 pt-1">
              <button
                type="button"
                onClick={resetForm}
                className="px-2 py-0.5 text-[9px] uppercase tracking-[0.1em] text-hobo-muted hover:text-hobo-ink border border-hobo-lineDark bg-transparent"
              >
                Cancel
              </button>

              {editingEvent && editingEvent.is_repeating ? (
                <>
                  <button
                    type="button"
                    disabled={!isFormValid}
                    onClick={handleSaveThisOnly}
                    className="px-2 py-0.5 text-[9px] uppercase tracking-[0.08em] border border-hobo-ink text-hobo-ink hover:border-hobo-red hover:text-hobo-red disabled:opacity-40 bg-transparent"
                  >
                    Save this event only
                  </button>
                  <button
                    type="button"
                    disabled={!isFormValid}
                    onClick={handleSaveAllFuture}
                    className="px-2 py-0.5 text-[9px] uppercase tracking-[0.08em] border border-hobo-red bg-hobo-red text-white hover:opacity-90 disabled:opacity-40"
                  >
                    Save all future events
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={!isFormValid}
                  onClick={handleSaveNewOrSingle}
                  className="px-2.5 py-0.5 text-[9px] uppercase tracking-[0.1em] border border-hobo-red bg-hobo-red text-white hover:opacity-90 disabled:opacity-40"
                >
                  Save
                </button>
              )}
            </div>
          </div>
        )}

        {tasks.length > 0 && (
          <div className="pt-1.5 mt-1.5 border-t border-hobo-line/80 space-y-0.5 pointer-events-auto">
            {tasks.map((task) => (
              <TaskItem
                key={task.id}
                task={task}
                onToggleComplete={onToggleTask}
                onEditTitle={onEditTaskTitle}
                onDelete={onDeleteTask}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
