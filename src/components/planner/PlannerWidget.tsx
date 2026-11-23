import React, { useEffect, useRef, useState } from "react";
import { addWeeks, endOfWeek, format, startOfWeek, subWeeks } from "date-fns";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Update } from "@tauri-apps/plugin-updater";
import {
  getAppSettings,
  initAccentColorOnBoot,
  saveAppSettings,
} from "../../db/appSettingsRepo";
import { syncConfigToRustBackend } from "../../services/githubSyncService";
import { usePlannerData } from "../../hooks/usePlannerData";
import { subscribeMidnightRollover } from "../../../shared/plannerCore";
import {
  fetchWeatherForecast,
  getSavedTemperatureUnit,
  saveTemperatureUnit,
  saveWeatherLocation,
  TemperatureUnit,
} from "../../services/weatherService";
import {
  checkForAppUpdate,
  installAppUpdate,
  skipUpdateVersion,
} from "../../services/updaterService";
import { WeatherData } from "../../types/planner";
import { WidgetTitlebar } from "../common/WidgetTitlebar";
import { SettingsModal } from "../common/SettingsModal";
import { UpdateModal } from "../common/UpdateModal";
import { WeatherLocationModal } from "../common/WeatherLocationModal";
import { GithubAuthPromptModal } from "../common/GithubAuthPromptModal";
import { CalendarSidebar } from "../calendar/CalendarSidebar";
import { NotesSidebar } from "../notes/NotesSidebar";
import { WeekBoard } from "./WeekBoard";

const CALENDAR_SIDEBAR_LOGICAL_WIDTH = 340;
const NOTES_SIDEBAR_LOGICAL_WIDTH = 340;

/**
 * Renders a razor-sharp 1-physical-pixel window outline across all 4 visible sides
 * of the active `SetWindowRgn` region so borders never thicken or clip at any window size or DPI.
 */
const CrispWindowBorder: React.FC<{
  leftOffsetPx: number;
  rightOffsetPx: number;
}> = ({ leftOffsetPx, rightOffsetPx }) => {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setSize({ w: rect.width, h: rect.height });
    };
    update();
    const obs = new ResizeObserver(update);
    obs.observe(el);
    return () => obs.disconnect();
  }, [leftOffsetPx, rightOffsetPx]);

  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const onePx = 1 / dpr;
  const xLeft = 0.5 / dpr;
  const yTop = 0.5 / dpr;
  const xRight = Math.max(
    xLeft + onePx,
    (Math.floor(size.w * dpr) - 0.5) / dpr
  );
  const yBottom = Math.max(
    yTop + onePx,
    (Math.floor(size.h * dpr) - 0.5) / dpr
  );

  return (
    <div
      ref={boxRef}
      style={{
        left: `${leftOffsetPx}px`,
        right: `${rightOffsetPx}px`,
      }}
      className="pointer-events-none absolute top-0 bottom-0 z-50"
    >
      {size.w > 2 && size.h > 2 && (
        <svg
          width={size.w}
          height={size.h}
          viewBox={`0 0 ${size.w} ${size.h}`}
          shapeRendering="crispEdges"
          className="block w-full h-full"
        >
          <line x1={0} y1={yTop} x2={size.w} y2={yTop} stroke="#B5AFA0" strokeWidth={onePx} />
          <line x1={0} y1={yBottom} x2={size.w} y2={yBottom} stroke="#B5AFA0" strokeWidth={onePx} />
          <line x1={xLeft} y1={0} x2={xLeft} y2={size.h} stroke="#B5AFA0" strokeWidth={onePx} />
          <line x1={xRight} y1={0} x2={xRight} y2={size.h} stroke="#B5AFA0" strokeWidth={onePx} />
        </svg>
      )}
    </div>
  );
};
const DEFAULT_SQUARE_SIZE = 760;

export const PlannerWidget: React.FC = () => {
  const [currentWeekDate, setCurrentWeekDate] = useState<Date>(() => new Date());
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isNotesOpen, setIsNotesOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isWeatherLocationOpen, setIsWeatherLocationOpen] = useState(false);
  const [temperatureUnit, setTemperatureUnit] = useState<TemperatureUnit>(() =>
    getSavedTemperatureUnit()
  );
  const [isGithubAuthPromptOpen, setIsGithubAuthPromptOpen] = useState(false);
  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false);
  const [updateProgressPct, setUpdateProgressPct] = useState<number | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
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

  // Automatically advance to the new current week when the real-world week rolls over
  const lastRealWeekRef = useRef<string>(
    format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd")
  );
  useEffect(() => {
    return subscribeMidnightRollover(() => {
      const now = new Date();
      const nowWeek = format(
        startOfWeek(now, { weekStartsOn: 1 }),
        "yyyy-MM-dd"
      );
      if (nowWeek !== lastRealWeekRef.current) {
        lastRealWeekRef.current = nowWeek;
        setCurrentWeekDate(now);
      }
    });
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

  // Sync visible Win32 SetWindowRgn whenever Calendar, Notes, or Collapse state changes (zero window resize!)
  useEffect(() => {
    void invoke("set_planner_visible_region", {
      showCalendar: isCalendarOpen,
      showNotes: isNotesOpen,
      isCollapsed,
    }).catch(() => {
      // Ignore outside Tauri
    });
  }, [isCalendarOpen, isNotesOpen, isCollapsed]);

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
    bucketDefinitions,
    bucketLayouts,
    bucketTextByBucketId,
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
    clearCompletedForBucket,
    createBucket,
    renameBucket,
    saveBucketLayouts,
    saveBucketText,
    countTasksInBucket,
    deleteHiddenBucket,
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

  const GITHUB_AUTH_PROMPT_STORAGE_KEY = "hobo_github_token_prompt_last_at";
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  // Prompt once per day if GitHub sync fails due to an expired/invalid Personal Access Token (401/403)
  useEffect(() => {
    if (
      githubSyncStatus.status !== "error" ||
      !githubSyncStatus.message ||
      isSettingsOpen
    ) {
      return;
    }

    const msg = githubSyncStatus.message;
    const isAuthError =
      msg.includes("401") ||
      msg.includes("403") ||
      msg.includes("Unauthorized") ||
      msg.includes("Forbidden") ||
      msg.includes("Invalid GitHub token") ||
      msg.includes("lacks permission");

    if (!isAuthError) {
      return;
    }

    try {
      const lastRaw = localStorage.getItem(GITHUB_AUTH_PROMPT_STORAGE_KEY);
      const lastTs = lastRaw ? parseInt(lastRaw, 10) : 0;
      if (!Number.isNaN(lastTs) && Date.now() - lastTs < ONE_DAY_MS) {
        return;
      }
      localStorage.setItem(GITHUB_AUTH_PROMPT_STORAGE_KEY, String(Date.now()));
    } catch {
      // Ignore storage errors
    }

    setIsGithubAuthPromptOpen(true);
  }, [githubSyncStatus, isSettingsOpen]);

  const handleSwitchToLocalFromPrompt = async () => {
    setIsGithubAuthPromptOpen(false);
    try {
      const current = await getAppSettings();
      const updated = await saveAppSettings({
        ...current,
        storage_mode: "local",
      });
      await syncConfigToRustBackend(updated);
      localStorage.removeItem(GITHUB_AUTH_PROMPT_STORAGE_KEY);
    } catch (err) {
      console.warn("[PlannerWidget] Failed to switch to local storage:", err);
    }
  };

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

  const handleToggleCalendar = () => {
    setIsCalendarOpen((v) => !v);
  };

  const handleToggleNotes = () => {
    setIsNotesOpen((v) => !v);
  };

  const startEdgeResize = (direction: "West" | "East" | "South") => {
    void getCurrentWindow()
      .startResizeDragging(direction)
      .catch(() => {
        // Ignore outside Tauri
      });
  };

  return (
    <div className="relative h-screen w-screen flex flex-col bg-hobo-paper text-hobo-ink overflow-hidden box-border">
      {/* Crisp 1-physical-pixel window outline across all 4 sides of the active clipped region */}
      <CrispWindowBorder
        leftOffsetPx={isCalendarOpen ? 0 : CALENDAR_SIDEBAR_LOGICAL_WIDTH}
        rightOffsetPx={isNotesOpen ? 0 : NOTES_SIDEBAR_LOGICAL_WIDTH}
      />

      {/* Custom Edge Resize Grips on the Visible Left, Right, and Bottom Edges */}
      {!isCollapsed && (
        <>
          <div
            onPointerDown={(e) => {
              if (e.button === 0) startEdgeResize("West");
            }}
            style={{
              left: isCalendarOpen ? "0px" : `${CALENDAR_SIDEBAR_LOGICAL_WIDTH}px`,
            }}
            className="absolute top-0 bottom-0 w-[5px] z-50 cursor-ew-resize"
          />
          <div
            onPointerDown={(e) => {
              if (e.button === 0) startEdgeResize("East");
            }}
            style={{
              right: isNotesOpen ? "0px" : `${NOTES_SIDEBAR_LOGICAL_WIDTH}px`,
            }}
            className="absolute top-0 bottom-0 w-[5px] z-50 cursor-ew-resize"
          />
          <div
            onPointerDown={(e) => {
              if (e.button === 0) startEdgeResize("South");
            }}
            style={{
              left: isCalendarOpen ? "0px" : `${CALENDAR_SIDEBAR_LOGICAL_WIDTH}px`,
              right: isNotesOpen ? "0px" : `${NOTES_SIDEBAR_LOGICAL_WIDTH}px`,
            }}
            className="absolute bottom-0 h-[5px] z-50 cursor-ns-resize"
          />
        </>
      )}

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
      />

      {!isCollapsed && (
        <div className="flex-1 min-h-0 flex flex-row overflow-hidden">
          {/* Fixed 340px Left Calendar Slot (clipped away by SetWindowRgn when closed) */}
          <div className="w-[340px] shrink-0 h-full overflow-hidden">
            {isCalendarOpen && (
              <CalendarSidebar
                onHoverChange={(cursor) => {
                  calendarHoverRef.current = cursor;
                }}
              />
            )}
          </div>

          <div className="flex-1 min-w-[620px] h-full flex flex-col overflow-hidden">
            <WeekBoard
            weekStartDate={weekStartStr}
            weekEndDate={weekEndStr}
            googleEvents={googleEvents}
            datedTasks={datedTasks}
            weeklySidebarTasks={weeklySidebarTasks}
            longTermSidebarTasks={longTermSidebarTasks}
            bucketDefinitions={bucketDefinitions}
            bucketLayouts={bucketLayouts}
            bucketTextByBucketId={bucketTextByBucketId}
            weekImages={weekImages}
            dailyWeatherByDate={weather.dailyByDate}
            currentWeather={weather.current}
            temperatureUnit={temperatureUnit}
            onToggleTemperatureUnit={() => {
              const next: TemperatureUnit = temperatureUnit === "C" ? "F" : "C";
              saveTemperatureUnit(next);
              setTemperatureUnit(next);
            }}
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
            onAddTaskInBucket={(bucketId, scope, title) =>
              addTask({
                title,
                assigned_date: null,
                assigned_week_start: scope === "persistent" ? null : weekStartStr,
                is_long_term: scope === "persistent",
                bucket_id: bucketId,
                show_in_weekly: false,
                show_in_sidebar: true,
              })
            }
            onMoveTaskToBucket={(id, bucketId, scope) =>
              moveTaskToSidebar(id, {
                weekStartDate: scope === "persistent" ? null : weekStartStr,
                isLongTerm: scope === "persistent",
                bucketId,
              })
            }
            onClearCompletedInBucket={(bucketId, scope) =>
              clearCompletedForBucket(bucketId, scope, weekStartStr, weekEndStr)
            }
            onCreateBucket={(title, scope, kind) => createBucket(title, scope, kind)}
            onRenameBucket={(id, newTitle) => renameBucket(id, newTitle)}
            onSaveBucketLayouts={(snapshots) => saveBucketLayouts(snapshots)}
            onSaveBucketText={(bucketId, weekStart, content) =>
              saveBucketText(bucketId, weekStart, content)
            }
            onCountTasksInBucket={(bucketId, kind) =>
              countTasksInBucket(bucketId, kind)
            }
            onDeleteHiddenBucket={(bucketId) => deleteHiddenBucket(bucketId)}
            onAddWeekImage={(input) => addWeekImage(input)}
            onUpdateWeekImage={(id, updates) => editWeekImage(id, updates)}
            onDeleteWeekImage={(id) => removeWeekImage(id)}
            onOpenWeatherLocation={() => setIsWeatherLocationOpen(true)}
          />
          </div>

          {/* Fixed 340px Right Notes Slot (clipped away by SetWindowRgn when closed) */}
          <div className="w-[340px] shrink-0 h-full overflow-hidden">
            {isNotesOpen && (
              <NotesSidebar
                onHoverChange={(cursor) => {
                  notesHoverRef.current = cursor;
                }}
              />
            )}
          </div>
        </div>
      )}

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onSettingsSaved={() => {
          try {
            localStorage.removeItem(GITHUB_AUTH_PROMPT_STORAGE_KEY);
          } catch {
            // Ignore
          }
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

      <WeatherLocationModal
        isOpen={isWeatherLocationOpen}
        onClose={() => setIsWeatherLocationOpen(false)}
        onSelectLocation={(loc) => {
          saveWeatherLocation(loc);
          setIsWeatherLocationOpen(false);
          void fetchWeatherForecast(true).then((data) => setWeather(data));
        }}
      />

      <GithubAuthPromptModal
        isOpen={isGithubAuthPromptOpen}
        errorMessage={githubSyncStatus.message}
        onDismiss={() => setIsGithubAuthPromptOpen(false)}
        onUpdateToken={() => {
          setIsGithubAuthPromptOpen(false);
          setIsSettingsOpen(true);
        }}
        onSwitchToLocal={() => {
          void handleSwitchToLocalFromPrompt();
        }}
      />
    </div>
  );
};
