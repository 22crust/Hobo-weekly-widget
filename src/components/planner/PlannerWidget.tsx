import React, { useEffect, useRef, useState } from "react";
import { addWeeks, endOfWeek, format, startOfWeek, subWeeks } from "date-fns";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";
import { Update } from "@tauri-apps/plugin-updater";
import { initAccentColorOnBoot } from "../../db/appSettingsRepo";
import { usePlannerData } from "../../hooks/usePlannerData";
import { fetchWeatherForecast } from "../../services/weatherService";
import {
  checkForAppUpdate,
  installAppUpdate,
  skipUpdateVersion,
} from "../../services/updaterService";
import { WeatherData } from "../../types/planner";
import { WidgetTitlebar } from "../common/WidgetTitlebar";
import { SettingsModal } from "../common/SettingsModal";
import { UpdateModal } from "../common/UpdateModal";
import { CalendarSidebar } from "../calendar/CalendarSidebar";
import { NotesSidebar } from "../notes/NotesSidebar";
import { WeekBoard } from "./WeekBoard";

const CALENDAR_SIDEBAR_LOGICAL_WIDTH = 340;
const NOTES_SIDEBAR_LOGICAL_WIDTH = 340;
const DEFAULT_SQUARE_SIZE = 760;

export const PlannerWidget: React.FC = () => {
  const [currentWeekDate, setCurrentWeekDate] = useState<Date>(() => new Date());
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isNotesOpen, setIsNotesOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false);
  const [updateProgressPct, setUpdateProgressPct] = useState<number | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [isAnimatingDrawer, setIsAnimatingDrawer] = useState(false);
  const calendarHoverRef = useRef<{ xPct: number; yPct: number } | null>(null);
  const notesHoverRef = useRef<{
    pageId: string;
    xPct: number;
    yPct: number;
  } | null>(null);
  const [weather, setWeather] = useState<WeatherData>({
    current: null,
    dailyByDate: {},
  });

  // Load saved accent colour once on boot
  useEffect(() => {
    void initAccentColorOnBoot();
  }, []);

  // Check for app updates on launch, then once every 24 hours while running
  useEffect(() => {
    let isDisposed = false;
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;

    const runUpdateCheck = async () => {
      const { update, isSkipped } = await checkForAppUpdate();
      if (isDisposed || !update) return;
      setAvailableUpdate(update);
      if (!isSkipped) {
        setIsUpdateModalOpen(true);
      }
    };

    void runUpdateCheck();
    const timerId = window.setInterval(() => {
      void runUpdateCheck();
    }, ONE_DAY_MS);

    return () => {
      isDisposed = true;
      window.clearInterval(timerId);
    };
  }, []);

  const handleInstallAvailableUpdate = async () => {
    if (!availableUpdate || isInstallingUpdate) return;
    setIsInstallingUpdate(true);
    setUpdateError(null);
    setUpdateProgressPct(null);
    try {
      await installAppUpdate(availableUpdate, (pct) => {
        setUpdateProgressPct(pct);
      });
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : String(err));
      setIsInstallingUpdate(false);
    }
  };

  const handleSkipAvailableUpdate = () => {
    if (availableUpdate) {
      skipUpdateVersion(availableUpdate.version);
    }
    setIsUpdateModalOpen(false);
  };

  // Ensure the window starts square (matching its current height, default 760x760)
  useEffect(() => {
    void (async () => {
      try {
        const win = getCurrentWindow();
        const size = await win.innerSize();
        if (size.height > 200 && Math.abs(size.width - size.height) > 4) {
          await win.setSize(new PhysicalSize(size.height, size.height));
        }
      } catch {
        // Ignore outside Tauri
      }
    })();
  }, []);

  const weekStart = startOfWeek(currentWeekDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(currentWeekDate, { weekStartsOn: 1 });
  const weekStartStr = format(weekStart, "yyyy-MM-dd");
  const weekEndStr = format(weekEnd, "yyyy-MM-dd");
  const prevWeekStartStr = format(subWeeks(weekStart, 1), "yyyy-MM-dd");
  const nextWeekStartStr = format(addWeeks(weekStart, 1), "yyyy-MM-dd");

  const {
    googleEvents,
    datedTasks,
    weeklySidebarTasks,
    longTermSidebarTasks,
    weekImages,
    syncStatus,
    githubSyncStatus,
    manualSync,
    hideGoogleEvent,
    unhideAllGoogleEventsInDateRange,
    addTask,
    editTask,
    toggleTask,
    moveTaskToDate,
    moveTaskToSidebar,
    migrateTaskToWeek,
    clearCompletedForWeekSidebar,
    clearCompletedForLongTermSidebar,
    removeTask,
    addWeekImage,
    editWeekImage,
    removeWeekImage,
  } = usePlannerData(weekStartStr, weekEndStr, true);

  const weekStartRef = useRef(weekStartStr);
  weekStartRef.current = weekStartStr;
  const addWeekImageRef = useRef(addWeekImage);
  addWeekImageRef.current = addWeekImage;

  // Handle OS file drag-and-drop (local images & GIFs) onto Weekly Planner, Calendar, or Notes
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let isDisposed = false;
    const LOCAL_IMG_EXT = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i;

    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (isDisposed || event.payload.type !== "drop") return;
        const { paths, position } = event.payload;
        const imagePaths = paths.filter((p) => LOCAL_IMG_EXT.test(p));
        if (imagePaths.length === 0) return;

        const dpr = window.devicePixelRatio || 1;
        const clientX = position.x / dpr;
        const clientY = position.y / dpr;

        const zones = Array.from(
          document.querySelectorAll<HTMLElement>("[data-sticker-drop-zone]")
        );
        let matchedZone: HTMLElement | null = null;
        for (const z of zones) {
          const r = z.getBoundingClientRect();
          if (
            clientX >= r.left &&
            clientX <= r.right &&
            clientY >= r.top &&
            clientY <= r.bottom
          ) {
            matchedZone = z;
            break;
          }
        }
        if (!matchedZone) return;

        const zoneType = matchedZone.dataset.stickerDropZone;
        const rect = matchedZone.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        let targetScope = weekStartRef.current;
        let defaultWidth = 180;
        if (zoneType === "calendar") {
          targetScope = "calendar-permanent";
          defaultWidth = 140;
        } else if (zoneType === "notes") {
          const notePageId = matchedZone.dataset.notePageId;
          if (!notePageId) return;
          targetScope = `note:${notePageId}`;
          defaultWidth = 140;
        }

        const baseXPct = ((clientX - rect.left) / rect.width) * 100;
        const baseYPct = ((clientY - rect.top) / rect.height) * 100;

        imagePaths.forEach((filePath, idx) => {
          const xPct = Math.max(2, Math.min(82, baseXPct + idx * 3));
          const yPct = Math.max(2, Math.min(88, baseYPct + idx * 3));
          void addWeekImageRef.current({
            week_start: targetScope,
            image_url: filePath,
            pos_x: Number(xPct.toFixed(2)),
            pos_y: Number(yPct.toFixed(2)),
            width: defaultWidth,
            height: null,
            z_index: 15 + idx,
            is_locked: false,
            is_local_only: true,
          });
        });
      })
      .then((fn) => {
        if (isDisposed) fn();
        else unlisten = fn;
      })
      .catch(() => {
        // Ignore outside Tauri
      });

    return () => {
      isDisposed = true;
      unlisten?.();
    };
  }, []);

  // Listen for "Settings..." clicked in the System Tray menu
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let isDisposed = false;

    void listen("open-settings", () => {
      if (!isDisposed) {
        setIsCollapsed(false);
        setIsSettingsOpen(true);
      }
    })
      .then((fn) => {
        if (isDisposed) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch(() => {
        // Ignore outside Tauri
      });

    return () => {
      isDisposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    void fetchWeatherForecast(false).then((data) => {
      if (isMounted) setWeather(data);
    });

    const interval = window.setInterval(() => {
      void fetchWeatherForecast(true).then((data) => {
        if (isMounted) setWeather(data);
      });
    }, 30 * 60 * 1000);

    return () => {
      isMounted = false;
      window.clearInterval(interval);
    };
  }, []);

  const handleManualSyncAll = async () => {
    await Promise.all([
      manualSync(),
      fetchWeatherForecast(true).then((data) => setWeather(data)),
    ]);
  };

  const handleToggleCalendar = async () => {
    if (isAnimatingDrawer) return;
    setIsAnimatingDrawer(true);
    const nextOpen = !isCalendarOpen;
    setIsCalendarOpen(nextOpen);

    try {
      const win = getCurrentWindow();
      const factor = await win.scaleFactor();
      const pos = await win.outerPosition();
      const size = await win.innerSize();
      const deltaPhysicalWidth = Math.round(CALENDAR_SIDEBAR_LOGICAL_WIDTH * factor);

      if (nextOpen) {
        const nextX = pos.x - deltaPhysicalWidth;
        const nextWidth = size.width + deltaPhysicalWidth;
        await win.setPosition(new PhysicalPosition(nextX, pos.y));
        await win.setSize(new PhysicalSize(nextWidth, size.height));
      } else {
        const nextWidth = Math.max(Math.round(620 * factor), size.width - deltaPhysicalWidth);
        const nextX = pos.x + deltaPhysicalWidth;
        await win.setSize(new PhysicalSize(nextWidth, size.height));
        await win.setPosition(new PhysicalPosition(nextX, pos.y));
      }
    } catch {
      // Fallback in standard browser preview
    } finally {
      setIsAnimatingDrawer(false);
    }
  };

  const handleToggleNotes = async () => {
    if (isAnimatingDrawer) return;
    setIsAnimatingDrawer(true);
    const nextOpen = !isNotesOpen;
    setIsNotesOpen(nextOpen);

    try {
      const win = getCurrentWindow();
      const factor = await win.scaleFactor();
      const size = await win.innerSize();
      const deltaPhysicalWidth = Math.round(NOTES_SIDEBAR_LOGICAL_WIDTH * factor);

      if (nextOpen) {
        const nextWidth = size.width + deltaPhysicalWidth;
        await win.setSize(new PhysicalSize(nextWidth, size.height));
      } else {
        const minTotalWidth = Math.round(
          (620 + (isCalendarOpen ? CALENDAR_SIDEBAR_LOGICAL_WIDTH : 0)) * factor
        );
        const nextWidth = Math.max(minTotalWidth, size.width - deltaPhysicalWidth);
        await win.setSize(new PhysicalSize(nextWidth, size.height));
      }
    } catch {
      // Fallback in standard browser preview
    } finally {
      setIsAnimatingDrawer(false);
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-hobo-paper window-frame-border text-hobo-ink overflow-hidden box-border">
      <WidgetTitlebar
        title="WEEKLY PLANNER"
        isSyncing={syncStatus.isSyncing}
        onManualSync={handleManualSyncAll}
        isCollapsed={isCollapsed}
        onToggleCollapse={setIsCollapsed}
        isCalendarOpen={isCalendarOpen}
        onToggleCalendar={handleToggleCalendar}
        isNotesOpen={isNotesOpen}
        onToggleNotes={handleToggleNotes}
        onOpenSettings={() => setIsSettingsOpen(true)}
        githubSyncStatus={githubSyncStatus}
        defaultExpandedHeight={760}
      />

      {!isCollapsed && (
        <div className="flex-1 min-h-0 flex flex-row overflow-hidden p-[1px]">
          {isCalendarOpen && (
            <CalendarSidebar
              onHoverChange={(cursor) => {
                calendarHoverRef.current = cursor;
              }}
            />
          )}

          <WeekBoard
            weekStartDate={weekStartStr}
            weekEndDate={weekEndStr}
            googleEvents={googleEvents}
            datedTasks={datedTasks}
            weeklySidebarTasks={weeklySidebarTasks}
            longTermSidebarTasks={longTermSidebarTasks}
            weekImages={weekImages}
            dailyWeatherByDate={weather.dailyByDate}
            currentWeather={weather.current}
            calendarHoverRef={calendarHoverRef}
            notesHoverRef={notesHoverRef}
            onPrevWeek={() => setCurrentWeekDate((d) => subWeeks(d, 1))}
            onNextWeek={() => setCurrentWeekDate((d) => addWeeks(d, 1))}
            onResetThisWeek={() => setCurrentWeekDate(new Date())}
            onHideGoogleEvent={hideGoogleEvent}
            onUnhideAllForDay={(dateStr) =>
              unhideAllGoogleEventsInDateRange(dateStr, dateStr)
            }
            onAddTaskInDay={(title, dateStr) =>
              addTask({
                title,
                assigned_date: dateStr,
                assigned_week_start: weekStartStr,
                is_long_term: false,
                show_in_weekly: true,
                show_in_sidebar: false,
              })
            }
            onAddWeeklySidebarTask={(title) =>
              addTask({
                title,
                assigned_date: null,
                assigned_week_start: weekStartStr,
                is_long_term: false,
                show_in_weekly: false,
                show_in_sidebar: true,
              })
            }
            onAddLongTermSidebarTask={(title) =>
              addTask({
                title,
                assigned_date: null,
                assigned_week_start: null,
                is_long_term: true,
                show_in_weekly: false,
                show_in_sidebar: true,
              })
            }
            onToggleTask={toggleTask}
            onEditTaskTitle={(id, title) => editTask(id, { title })}
            onDeleteTask={removeTask}
            onMoveTaskToDate={(id, targetDateStr) =>
              moveTaskToDate(id, targetDateStr)
            }
            onMoveTaskToWeeklySidebar={(id) =>
              moveTaskToSidebar(id, {
                weekStartDate: weekStartStr,
                isLongTerm: false,
              })
            }
            onMoveTaskToLongTermSidebar={(id) =>
              moveTaskToSidebar(id, {
                weekStartDate: null,
                isLongTerm: true,
              })
            }
            onMigrateTaskToPrevWeek={(id) =>
              migrateTaskToWeek(id, prevWeekStartStr)
            }
            onMigrateTaskToNextWeek={(id) =>
              migrateTaskToWeek(id, nextWeekStartStr)
            }
            onClearCompletedWeeklySidebar={() =>
              clearCompletedForWeekSidebar(weekStartStr, weekEndStr)
            }
            onClearCompletedLongTermSidebar={() =>
              clearCompletedForLongTermSidebar()
            }
            onAddWeekImage={(input) => addWeekImage(input)}
            onUpdateWeekImage={(id, updates) => editWeekImage(id, updates)}
            onDeleteWeekImage={(id) => removeWeekImage(id)}
          />

          {isNotesOpen && (
            <NotesSidebar
              onHoverChange={(cursor) => {
                notesHoverRef.current = cursor;
              }}
            />
          )}
        </div>
      )}

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onSettingsSaved={() => {
          void manualSync();
        }}
        availableUpdate={availableUpdate}
        isInstallingUpdate={isInstallingUpdate}
        updateProgressPct={updateProgressPct}
        updateError={updateError}
        onInstallUpdate={() => {
          void handleInstallAvailableUpdate();
        }}
      />

      <UpdateModal
        update={availableUpdate}
        isOpen={isUpdateModalOpen}
        isInstalling={isInstallingUpdate}
        progressPct={updateProgressPct}
        error={updateError}
        onUpdate={() => {
          void handleInstallAvailableUpdate();
        }}
        onSkip={handleSkipAvailableUpdate}
      />
    </div>
  );
};
