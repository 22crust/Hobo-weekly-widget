import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { addDays, format, getISOWeek, parseISO } from "date-fns";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import {
  BucketDefinition,
  BucketKind,
  BucketLayoutEntry,
  BucketLayoutSnapshot,
  BucketScope,
  equalizeVisibleRatios,
  findFutureExplicitOverrides,
  getBucketKind,
  getDefaultBucketDefinitions,
  MAX_VISIBLE_BUCKETS,
  MAX_VISIBLE_BUCKETS_MESSAGE,
  normalizeLayoutEntries,
  planSetDefaultLayoutFromWeek,
  planThisWeekLayoutEdit,
  resolveWeekLayout,
} from "../../../shared/buckets";
import {
  CreateWeekImageInput,
  CurrentWeatherSummary,
  DailyWeather,
  GoogleEvent,
  LocalTask,
  UpdateWeekImageInput,
  WeekImage,
} from "../../types/planner";
import { WeatherIcon } from "../common/WeatherIcon";
import { formatTemperature, TemperatureUnit } from "../../services/weatherService";
import {
  getActiveDraggedTaskId,
  setActiveDraggedTaskId,
  TaskItem,
} from "../common/TaskItem";
import { DayColumn } from "./DayColumn";
import { BucketTextEditor } from "./BucketTextEditor";
import { ManageHiddenListsModal } from "./ManageHiddenListsModal";
import { MiniMonthCalendar } from "./MiniMonthCalendar";
import { CrispSquareGrid } from "./CrispSquareGrid";
import { WeeklyImageLayer } from "./WeeklyImageLayer";

interface WeekBoardProps {
  weekStartDate: string; // Monday YYYY-MM-DD
  weekEndDate: string;   // Sunday YYYY-MM-DD
  googleEvents: GoogleEvent[];
  datedTasks: LocalTask[];
  weeklySidebarTasks: LocalTask[];
  longTermSidebarTasks: LocalTask[];
  bucketDefinitions?: BucketDefinition[];
  bucketLayouts?: BucketLayoutSnapshot[];
  bucketTextByBucketId?: Record<string, string>;
  weekImages: WeekImage[];
  dailyWeatherByDate: Record<string, DailyWeather>;
  currentWeather: CurrentWeatherSummary | null;
  temperatureUnit?: TemperatureUnit;
  onToggleTemperatureUnit?: () => void;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onResetThisWeek: () => void;
  onHideGoogleEvent: (id: number, event?: GoogleEvent) => void;
  onUnhideAllForDay: (dateStr: string) => void;
  onAddTaskInDay: (title: string, dateStr: string) => void;
  onToggleTask: (id: number, isCompleted: boolean) => void;
  onEditTaskTitle: (id: number, newTitle: string) => void;
  onDeleteTask: (id: number) => void;
  onMoveTaskToDate: (
    id: number,
    targetDateStr: string,
    insertIndex?: number
  ) => void;
  onMoveTaskToWeeklySidebar: (id: number) => void;
  onMoveTaskToLongTermSidebar: (id: number) => void;
  onMigrateTaskToPrevWeek: (id: number) => void;
  onMigrateTaskToNextWeek: (id: number) => void;
  onAddTaskInBucket?: (bucketId: string, scope: BucketScope, title: string) => void;
  onMoveTaskToBucket?: (
    taskId: number,
    bucketId: string,
    scope: BucketScope,
    insertIndex?: number
  ) => void;
  onClearCompletedInBucket?: (bucketId: string, scope: BucketScope) => void;
  onCreateBucket?: (
    title: string,
    scope: BucketScope,
    kind?: BucketKind
  ) => Promise<BucketDefinition>;
  onRenameBucket?: (bucketId: string, newTitle: string) => Promise<void> | void;
  onSaveBucketLayouts?: (snapshots: BucketLayoutSnapshot[]) => Promise<void> | void;
  onSaveBucketText?: (
    bucketId: string,
    weekStart: string,
    content: string
  ) => Promise<void> | void;
  onCountTasksInBucket?: (
    bucketId: string,
    kind: BucketKind
  ) => Promise<number>;
  onDeleteHiddenBucket?: (bucketId: string) => Promise<void> | void;
  onAddWeekImage: (input: CreateWeekImageInput) => void;
  onUpdateWeekImage: (id: string, updates: UpdateWeekImageInput) => void;
  onDeleteWeekImage: (id: string) => void;
  onOpenWeatherLocation?: () => void;
  calendarHoverRef?: React.RefObject<{ xPct: number; yPct: number } | null>;
  notesHoverRef?: React.RefObject<{
    pageId: string;
    xPct: number;
    yPct: number;
  } | null>;
}

const SIDE_BORDER_PX = 16;   // 16px side border space
const BOTTOM_BORDER_PX = 24; // 1.5 * 16px = 24px bottom border space

const CELLS_PER_DAY = 5;
const TOTAL_WEEK_GRID_ROWS = 7 * CELLS_PER_DAY; // 35
const TASKS_BOX_GRID_ROWS = 6 * CELLS_PER_DAY;  // 30
const MIN_GRID_PX = 15;
const MAX_GRID_PX = 22;

const IMAGE_EXTENSION_REGEX = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)(\?.*)?(#.*)?$/i;

function isLikelyImageUrl(text: string): boolean {
  if (!text.startsWith("http://") && !text.startsWith("https://")) {
    return false;
  }
  try {
    const parsed = new URL(text);
    return IMAGE_EXTENSION_REGEX.test(parsed.pathname);
  } catch {
    return false;
  }
}

function verifyUrlLoadsAsImage(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    let settled = false;
    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(false);
      }
    }, 5000);

    img.onload = () => {
      if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        resolve(true);
      }
    };
    img.onerror = () => {
      if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        resolve(false);
      }
    };
    img.src = url;
  });
}

export const WeekBoard: React.FC<WeekBoardProps> = ({
  weekStartDate,
  weekEndDate,
  googleEvents,
  datedTasks,
  weeklySidebarTasks,
  longTermSidebarTasks,
  bucketDefinitions = [],
  bucketLayouts = [],
  bucketTextByBucketId = {},
  weekImages,
  dailyWeatherByDate,
  currentWeather,
  temperatureUnit = "C",
  onToggleTemperatureUnit,
  onPrevWeek,
  onNextWeek,
  onResetThisWeek,
  onHideGoogleEvent,
  onUnhideAllForDay,
  onAddTaskInDay,
  onToggleTask,
  onEditTaskTitle,
  onDeleteTask,
  onMoveTaskToDate,
  onMoveTaskToWeeklySidebar,
  onMoveTaskToLongTermSidebar,
  onMigrateTaskToPrevWeek,
  onMigrateTaskToNextWeek,
  onAddTaskInBucket,
  onMoveTaskToBucket,
  onClearCompletedInBucket,
  onCreateBucket,
  onRenameBucket,
  onSaveBucketLayouts,
  onSaveBucketText,
  onCountTasksInBucket,
  onDeleteHiddenBucket,
  onAddWeekImage,
  onUpdateWeekImage,
  onDeleteWeekImage,
  onOpenWeatherLocation,
  calendarHoverRef,
  notesHoverRef,
}) => {
  const startObj = parseISO(weekStartDate);
  const weekDays = Array.from({ length: 7 }, (_, i) =>
    format(addDays(startObj, i), "yyyy-MM-dd")
  );

  const [draftsByBucket, setDraftsByBucket] = useState<Record<string, string>>({});
  const [renamingBucketId, setRenamingBucketId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState<string>("");
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  const [headerContextMenu, setHeaderContextMenu] = useState<{
    x: number;
    y: number;
    bucketId: string;
    title: string;
  } | null>(null);
  const [pageContextMenu, setPageContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [weatherContextMenu, setWeatherContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [isManageListsOpen, setIsManageListsOpen] = useState(false);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const [futureConflictPromptOpen, setFutureConflictPromptOpen] = useState(false);

  const spreadContainerRef = useRef<HTMLDivElement | null>(null);
  const tasksBoxRef = useRef<HTMLDivElement | null>(null);

  // Track last cursor (x%, y%) over the planner spread for Ctrl+V / Cmd+V sticker placement
  const lastCursorPctRef = useRef<{ xPct: number; yPct: number } | null>(null);

  const [gridSizePx, setGridSizePx] = useState<number>(17);
  const [tasksBoxWidthPx, setTasksBoxWidthPx] = useState<number>(400);
  // Draggable vertical separator percentage (default 50% center, double-click to reset to 50%)
  const [leftSplitPct, setLeftSplitPct] = useState<number>(50);

  const activeDefs = useMemo(
    () =>
      bucketDefinitions.length > 0
        ? bucketDefinitions
        : getDefaultBucketDefinitions(),
    [bucketDefinitions]
  );

  const defById = useMemo(
    () => new Map(activeDefs.map((d) => [d.id, d])),
    [activeDefs]
  );

  const resolvedLayout = useMemo(
    () => resolveWeekLayout(weekStartDate, bucketLayouts, activeDefs),
    [weekStartDate, bucketLayouts, activeDefs]
  );

  const [liveEntries, setLiveEntries] = useState<BucketLayoutEntry[] | null>(
    null
  );
  const [swapCueBucketId, setSwapCueBucketId] = useState<string | null>(null);

  useEffect(() => {
    setLiveEntries(null);
  }, [weekStartDate, bucketLayouts, activeDefs]);

  useEffect(() => {
    if (renamingBucketId) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renamingBucketId]);

  // Close context menus on window click/escape
  useEffect(() => {
    if (!headerContextMenu && !pageContextMenu && !weatherContextMenu) return;
    const closeAll = () => {
      setHeaderContextMenu(null);
      setPageContextMenu(null);
      setWeatherContextMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAll();
    };
    window.addEventListener("mousedown", closeAll);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", closeAll);
      window.removeEventListener("keydown", onKey);
    };
  }, [headerContextMenu, pageContextMenu, weatherContextMenu]);

  const effectiveEntries = liveEntries ?? resolvedLayout;
  const visibleEntries = useMemo(
    () => effectiveEntries.filter((e) => e.visible && defById.has(e.bucket_id)),
    [effectiveEntries, defById]
  );

  const commitWeekLayoutChange = async (nextEntries: BucketLayoutEntry[]) => {
    const snapshots = planThisWeekLayoutEdit(
      weekStartDate,
      nextEntries,
      bucketLayouts,
      activeDefs
    );
    await onSaveBucketLayouts?.(snapshots);
  };

  const handleHeaderDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("input")) return;
    e.preventDefault();
    e.stopPropagation();
    const equalized = equalizeVisibleRatios(effectiveEntries);
    void commitWeekLayoutChange(equalized);
  };

  const handleHeaderPointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    startVisibleIdx: number
  ) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("input")) return;
    if (renamingBucketId) return;

    e.preventDefault();
    e.stopPropagation();

    const tasksEl = tasksBoxRef.current;
    if (!tasksEl) return;
    const totalHeight = tasksEl.getBoundingClientRect().height;
    if (totalHeight <= 0) return;

    const MIN_H = 56;
    const SWAP_OVERFLOW_PX = 24;

    let workingEntries = effectiveEntries.map((item) => ({ ...item }));
    const initialRatiosByBucketId = new Map<string, number>();
    for (const entry of workingEntries) {
      initialRatiosByBucketId.set(entry.bucket_id, entry.height_ratio);
    }
    let currentVIdx = startVisibleIdx;
    let anchorY = e.clientY;
    let didChange = false;

    const getVisibleIndices = (arr: BucketLayoutEntry[]): number[] => {
      const indices: number[] = [];
      for (let i = 0; i < arr.length; i++) {
        if (arr[i].visible && defById.has(arr[i].bucket_id)) {
          indices.push(i);
        }
      }
      return indices;
    };

    const getVisibleHeightsPx = (arr: BucketLayoutEntry[]): number[] => {
      const vIndices = getVisibleIndices(arr);
      if (vIndices.length === 0) return [];
      const heights: number[] = [];
      let used = 0;
      for (let i = 0; i < vIndices.length; i++) {
        if (i === vIndices.length - 1) {
          heights.push(Math.max(MIN_H, totalHeight - used));
        } else {
          const h = Math.max(
            MIN_H,
            Math.round(totalHeight * arr[vIndices[i]].height_ratio)
          );
          heights.push(h);
          used += h;
        }
      }
      return heights;
    };

    let anchorHeights = getVisibleHeightsPx(workingEntries);

    const swapVisibleAt = (vA: number, vB: number, newClientY: number) => {
      const vIndices = getVisibleIndices(workingEntries);
      const idxA = vIndices[vA];
      const idxB = vIndices[vB];
      if (idxA === undefined || idxB === undefined) return;
      const tmp = workingEntries[idxA];
      workingEntries[idxA] = workingEntries[idxB];
      workingEntries[idxB] = tmp;

      // Restore each list's own pre-drag height_ratio so intermediate resize
      // distortion doesn't stick and push replaced lists down the page.
      workingEntries = workingEntries.map((entry) => ({
        ...entry,
        height_ratio:
          initialRatiosByBucketId.get(entry.bucket_id) ?? entry.height_ratio,
      }));

      anchorHeights = getVisibleHeightsPx(workingEntries);
      anchorY = newClientY;
      didChange = true;
      setSwapCueBucketId(null);
      setLiveEntries([...workingEntries]);
    };

    const onPointerMove = (moveEv: PointerEvent) => {
      const vIndices = getVisibleIndices(workingEntries);
      const vLen = vIndices.length;
      if (vLen <= 1) return;

      const dy = moveEv.clientY - anchorY;

      if (currentVIdx === 0) {
        // Top header: dragging downward past first section swaps with 2nd list
        const swapThreshold = Math.min(anchorHeights[0], 72) + SWAP_OVERFLOW_PX;
        if (dy > swapThreshold - 10) {
          setSwapCueBucketId(workingEntries[vIndices[1]].bucket_id);
        } else {
          setSwapCueBucketId(null);
        }
        if (dy >= swapThreshold) {
          swapVisibleAt(0, 1, moveEv.clientY);
          currentVIdx = 1;
        }
        return;
      }

      const aboveVIdx = currentVIdx - 1;
      const pairH = anchorHeights[aboveVIdx] + anchorHeights[currentVIdx];
      const rawAboveH = anchorHeights[aboveVIdx] + dy;
      const rawCurrH = pairH - rawAboveH;

      // Check swap upward with list above
      if (rawAboveH < MIN_H - SWAP_OVERFLOW_PX) {
        swapVisibleAt(aboveVIdx, currentVIdx, moveEv.clientY);
        currentVIdx = aboveVIdx;
        return;
      }

      // Check swap downward with list below (or into top of next list)
      if (rawCurrH < MIN_H - SWAP_OVERFLOW_PX) {
        if (currentVIdx < vLen - 1) {
          swapVisibleAt(currentVIdx, currentVIdx + 1, moveEv.clientY);
          currentVIdx = currentVIdx + 1;
        } else {
          swapVisibleAt(aboveVIdx, currentVIdx, moveEv.clientY);
          currentVIdx = aboveVIdx;
        }
        return;
      }

      if (rawAboveH <= MIN_H + 4 || rawCurrH <= MIN_H + 4) {
        setSwapCueBucketId(workingEntries[vIndices[currentVIdx]].bucket_id);
      } else {
        setSwapCueBucketId(null);
      }

      // Normal resize between aboveVIdx and currentVIdx
      const maxAboveH = Math.max(MIN_H, pairH - MIN_H);
      const clampedAboveH = Math.max(MIN_H, Math.min(maxAboveH, rawAboveH));
      const clampedCurrH = Math.max(MIN_H, pairH - clampedAboveH);

      const nextHeights = [...anchorHeights];
      nextHeights[aboveVIdx] = clampedAboveH;
      nextHeights[currentVIdx] = clampedCurrH;
      const sumH = nextHeights.reduce((a, b) => a + b, 0) || totalHeight;

      for (let i = 0; i < vIndices.length; i++) {
        workingEntries[vIndices[i]] = {
          ...workingEntries[vIndices[i]],
          height_ratio: nextHeights[i] / sumH,
        };
      }
      didChange = true;
      setLiveEntries([...workingEntries]);
    };

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      setSwapCueBucketId(null);
      if (didChange) {
        void commitWeekLayoutChange(workingEntries);
      } else {
        setLiveEntries(null);
      }
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  const handleDividerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const container = spreadContainerRef.current;
    if (!container) return;

    const MIN_PANE_WIDTH_PX = 250;

    const onPointerMove = (moveEv: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      if (rect.width <= MIN_PANE_WIDTH_PX * 2) return;
      const minPct = (MIN_PANE_WIDTH_PX / rect.width) * 100;
      const maxPct = 100 - minPct;
      const rawPct = ((moveEv.clientX - rect.left) / rect.width) * 100;
      const clampedPct = Math.max(minPct, Math.min(maxPct, rawPct));
      setLeftSplitPct(clampedPct);
    };

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  const handleDividerDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setLeftSplitPct(50);
  };

  useEffect(() => {
    const el = spreadContainerRef.current;
    const tasksEl = tasksBoxRef.current;
    if (!el) return;

    const updateLayout = () => {
      const availableH = el.clientHeight - BOTTOM_BORDER_PX;
      if (availableH > 140) {
        const rawGrid = availableH / TOTAL_WEEK_GRID_ROWS;
        const clampedGrid = Math.max(MIN_GRID_PX, Math.min(MAX_GRID_PX, rawGrid));
        setGridSizePx(clampedGrid);
        document.documentElement.style.setProperty(
          "--hobo-grid-size",
          `${clampedGrid}px`
        );
      }
      if (tasksEl) {
        setTasksBoxWidthPx(tasksEl.clientWidth);
      }
    };

    updateLayout();
    const observer = new ResizeObserver(updateLayout);
    observer.observe(el);
    if (tasksEl) observer.observe(tasksEl);
    return () => observer.disconnect();
  }, []);

  // Global Paste-Anywhere Listener (`Ctrl+V` / `Cmd+V`) for Weekly Stickers
  const weekStartRef = useRef(weekStartDate);
  weekStartRef.current = weekStartDate;
  const weekImagesRef = useRef(weekImages);
  weekImagesRef.current = weekImages;
  const onAddWeekImageRef = useRef(onAddWeekImage);
  onAddWeekImageRef.current = onAddWeekImage;

  useEffect(() => {
    const handleGlobalPaste = async (e: ClipboardEvent) => {
      const activeEl = document.activeElement as HTMLElement | null;
      if (
        activeEl &&
        (activeEl.tagName === "INPUT" ||
          activeEl.tagName === "TEXTAREA" ||
          activeEl.isContentEditable)
      ) {
        return;
      }

      const rawText = e.clipboardData?.getData("text")?.trim() ?? "";
      if (!rawText.startsWith("http://") && !rawText.startsWith("https://")) {
        return;
      }

      const isImageExt = isLikelyImageUrl(rawText);
      const isValidImage = isImageExt || (await verifyUrlLoadsAsImage(rawText));
      if (!isValidImage) {
        return;
      }

      // If the cursor is currently over the Calendar sidebar, paste into the permanent calendar sticker layer!
      const calCursor = calendarHoverRef?.current;
      if (calCursor) {
        onAddWeekImageRef.current({
          week_start: "calendar-permanent",
          image_url: rawText,
          pos_x: Number(Math.max(2, Math.min(82, calCursor.xPct)).toFixed(2)),
          pos_y: Number(Math.max(2, Math.min(85, calCursor.yPct)).toFixed(2)),
          width: 140,
          height: null,
          z_index: 15,
          is_locked: false,
        });
        return;
      }

      // If the cursor is currently over the Notes sidebar, paste onto that specific note page!
      const notesCursor = notesHoverRef?.current;
      if (notesCursor) {
        onAddWeekImageRef.current({
          week_start: `note:${notesCursor.pageId}`,
          image_url: rawText,
          pos_x: Number(Math.max(2, Math.min(82, notesCursor.xPct)).toFixed(2)),
          pos_y: Number(Math.max(2, Math.min(92, notesCursor.yPct)).toFixed(2)),
          width: 140,
          height: null,
          z_index: 15,
          is_locked: false,
        });
        return;
      }

      const coords = lastCursorPctRef.current ?? { xPct: 40, yPct: 30 };
      const maxZ = weekImagesRef.current.reduce(
        (m, img) => Math.max(m, img.z_index || 10),
        10
      );

      onAddWeekImageRef.current({
        week_start: weekStartRef.current,
        image_url: rawText,
        pos_x: Number(Math.max(2, Math.min(85, coords.xPct)).toFixed(2)),
        pos_y: Number(Math.max(2, Math.min(85, coords.yPct)).toFixed(2)),
        width: 180,
        height: null,
        z_index: maxZ + 1,
        is_locked: false,
      });
    };

    window.addEventListener("paste", handleGlobalPaste);
    return () => window.removeEventListener("paste", handleGlobalPaste);
  }, []);

  const moveBucketRef = useRef(onMoveTaskToBucket);
  moveBucketRef.current = onMoveTaskToBucket;
  const moveWeeklyRef = useRef(onMoveTaskToWeeklySidebar);
  moveWeeklyRef.current = onMoveTaskToWeeklySidebar;
  const moveLongTermRef = useRef(onMoveTaskToLongTermSidebar);
  moveLongTermRef.current = onMoveTaskToLongTermSidebar;
  const defByIdRef = useRef(defById);
  defByIdRef.current = defById;

  // Delegated pointer-based drop listener for all dynamic task list buckets
  useEffect(() => {
    const tasksEl = tasksBoxRef.current;
    if (!tasksEl) return;

    const handleBucketPointerDrop = (e: Event) => {
      const custom = e as CustomEvent<{ taskId: number; insertIndex?: number }>;
      const taskId = custom.detail?.taskId ?? getActiveDraggedTaskId();
      if (!taskId || taskId <= 0) return;

      const targetEl = e.target as HTMLElement | null;
      const zoneEl = targetEl?.closest("[data-task-drop-zone]");
      const zoneAttr = zoneEl?.getAttribute("data-task-drop-zone") || "";

      if (zoneAttr.startsWith("bucket:")) {
        const bucketId = zoneAttr.slice("bucket:".length);
        const def = defByIdRef.current.get(bucketId);
        const scope: BucketScope =
          def?.scope ?? (bucketId === "long_term" ? "persistent" : "weekly");
        if (moveBucketRef.current) {
          moveBucketRef.current(
            taskId,
            bucketId,
            scope,
            custom.detail?.insertIndex
          );
        } else if (scope === "persistent") {
          moveLongTermRef.current(taskId);
        } else {
          moveWeeklyRef.current(taskId);
        }
        setActiveDraggedTaskId(null);
      }
    };

    tasksEl.addEventListener("planner:task-pointer-drop", handleBucketPointerDrop);
    return () => {
      tasksEl.removeEventListener(
        "planner:task-pointer-drop",
        handleBucketPointerDrop
      );
    };
  }, []);

  const handleSpreadMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = spreadContainerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;
    lastCursorPctRef.current = { xPct, yPct };
  };

  const dayRowHeightPx = CELLS_PER_DAY * gridSizePx;
  const totalSevenDaysHeightPx = TOTAL_WEEK_GRID_ROWS * gridSizePx;
  const tasksBoxHeightPx = TASKS_BOX_GRID_ROWS * gridSizePx;

  const allSidebarTasks = useMemo(
    () => [...weeklySidebarTasks, ...longTermSidebarTasks],
    [weeklySidebarTasks, longTermSidebarTasks]
  );

  const visibleHeightsPx = useMemo(() => {
    if (visibleEntries.length === 0) return [];
    const heights: number[] = [];
    let used = 0;
    for (let i = 0; i < visibleEntries.length; i++) {
      if (i === visibleEntries.length - 1) {
        heights.push(Math.max(56, tasksBoxHeightPx - used));
      } else {
        const h = Math.max(
          56,
          Math.round(tasksBoxHeightPx * visibleEntries[i].height_ratio)
        );
        heights.push(h);
        used += h;
      }
    }
    return heights;
  }, [visibleEntries, tasksBoxHeightPx]);

  const handleHideBucketOnCurrentPage = (bucketId: string) => {
    const next = effectiveEntries.map((entry) =>
      entry.bucket_id === bucketId
        ? { ...entry, visible: false, height_ratio: 0 }
        : entry
    );
    void commitWeekLayoutChange(normalizeLayoutEntries(next, activeDefs));
  };

  const handleToggleBucketVisibilityFromModal = (
    bucketId: string,
    nextVisible: boolean
  ) => {
    const next = effectiveEntries.map((entry) =>
      entry.bucket_id === bucketId
        ? {
            ...entry,
            visible: nextVisible,
            height_ratio: nextVisible ? 0 : 0,
          }
        : entry
    );
    void commitWeekLayoutChange(normalizeLayoutEntries(next, activeDefs));
  };

  const handleAddNewBucket = async (
    scope: BucketScope,
    kind: BucketKind = "tasks"
  ) => {
    if (visibleEntries.length >= MAX_VISIBLE_BUCKETS) {
      setAlertMessage(MAX_VISIBLE_BUCKETS_MESSAGE);
      return;
    }
    if (!onCreateBucket) return;
    const defaultTitle =
      kind === "text"
        ? "New Text Section"
        : scope === "persistent"
        ? "New Long-Term List"
        : "New Weekly List";
    const created = await onCreateBucket(defaultTitle, scope, kind);
    const nextDefs = [...activeDefs, created];
    const nextEntries: BucketLayoutEntry[] = [
      ...effectiveEntries,
      { bucket_id: created.id, visible: true, height_ratio: 0 },
    ];
    const normalized = normalizeLayoutEntries(nextEntries, nextDefs);
    const snapshots = planThisWeekLayoutEdit(
      weekStartDate,
      normalized,
      bucketLayouts,
      nextDefs
    );
    await onSaveBucketLayouts?.(snapshots);
    setRenameDraft(created.title);
    setRenamingBucketId(created.id);
  };

  const handleSetDefaultFromThisWeek = async () => {
    const futureOverrides = findFutureExplicitOverrides(
      weekStartDate,
      bucketLayouts
    );
    if (futureOverrides.length > 0) {
      setFutureConflictPromptOpen(true);
      return;
    }
    const snapshots = planSetDefaultLayoutFromWeek(
      weekStartDate,
      effectiveEntries,
      bucketLayouts,
      activeDefs,
      "overwrite_all"
    );
    await onSaveBucketLayouts?.(snapshots);
  };

  const handleResolveFutureDefaultConflict = async (
    mode: "overwrite_all" | "keep_overrides"
  ) => {
    setFutureConflictPromptOpen(false);
    const snapshots = planSetDefaultLayoutFromWeek(
      weekStartDate,
      effectiveEntries,
      bucketLayouts,
      activeDefs,
      mode
    );
    await onSaveBucketLayouts?.(snapshots);
  };

  const commitHeaderRename = async (bucketId: string, originalTitle: string) => {
    setRenamingBucketId(null);
    const trimmed = renameDraft.trim();
    if (!trimmed || trimmed === originalTitle) return;
    await onRenameBucket?.(bucketId, trimmed);
  };

  const monthNameUpper = format(startObj, "MMMM").toUpperCase();
  const monthNum = format(startObj, "M");
  const yearStr = format(startObj, "yyyy");
  const isoWeekNum = getISOWeek(startObj);

  const getOrdinalSuffix = (n: number) => {
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
    switch (n % 10) {
      case 1:
        return `${n}st`;
      case 2:
        return `${n}nd`;
      case 3:
        return `${n}rd`;
      default:
        return `${n}th`;
    }
  };

  return (
    <div
      style={{ "--hobo-grid-size": `${gridSizePx}px` } as React.CSSProperties}
      className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden"
    >
      {/* Top Headers Row (Left: Month + Week # | Right: Week Range + < This Week >) */}
      <div
        style={{
          gridTemplateColumns: `${leftSplitPct}% ${100 - leftSplitPct}%`,
        }}
        className="relative grid shrink-0"
      >
        <div
          style={{
            paddingLeft: `${SIDE_BORDER_PX}px`,
            paddingRight: `${SIDE_BORDER_PX}px`,
          }}
          className="min-w-0 pt-1 pb-1.5 flex items-center justify-between select-none border-r border-hobo-lineDark"
        >
          <div className="flex items-baseline gap-2">
            <span className="text-lg leading-none tracking-[0.06em] font-normal text-hobo-ink">
              {monthNameUpper}
            </span>
            <span className="text-[11px] leading-none text-hobo-muted tracking-wide">
              {monthNum}月 {yearStr}
            </span>
          </div>

          <span className="text-[10px] leading-none tracking-[0.12em] uppercase text-hobo-ink">
            {getOrdinalSuffix(isoWeekNum)} WEEK
          </span>
        </div>

        <div
          style={{
            paddingLeft: `${SIDE_BORDER_PX}px`,
            paddingRight: `${SIDE_BORDER_PX}px`,
          }}
          className="min-w-0 pt-1 pb-1.5 flex items-center justify-between select-none"
        >
          <span className="text-[11px] leading-none tracking-[0.1em] uppercase text-hobo-muted truncate">
            {format(parseISO(weekStartDate), "MMM d")} –{" "}
            {format(parseISO(weekEndDate), "MMM d, yyyy")}
          </span>

          {/* Week Switcher with vertically centered arrows */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={onPrevWeek}
              className="inline-flex items-center justify-center p-0.5 -translate-y-[0.5px] text-hobo-muted hover:text-hobo-red transition-colors bg-transparent border-0"
            >
              <ChevronLeft className="w-3.5 h-3.5 stroke-[1.5]" />
            </button>
            <button
              type="button"
              onClick={onResetThisWeek}
              className="inline-flex items-center justify-center px-1 py-0 text-[10px] leading-none uppercase tracking-[0.12em] text-hobo-ink hover:text-hobo-red bg-transparent border-0 transition-colors"
            >
              This Week
            </button>
            <button
              type="button"
              onClick={onNextWeek}
              className="inline-flex items-center justify-center p-0.5 -translate-y-[0.5px] text-hobo-muted hover:text-hobo-red transition-colors bg-transparent border-0"
            >
              <ChevronRight className="w-3.5 h-3.5 stroke-[1.5]" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Two-Column Spread with Weekly Sticker Layer UNDER all text */}
      <div
        ref={spreadContainerRef}
        data-sticker-drop-zone="weekly"
        onMouseMove={handleSpreadMouseMove}
        style={{
          paddingBottom: `${BOTTOM_BORDER_PX}px`,
          gridTemplateColumns: `${leftSplitPct}% ${100 - leftSplitPct}%`,
        }}
        className="relative flex-1 min-h-0 grid overflow-hidden"
      >
        {/* Draggable Vertical Center Separator Hit Zone (double-click to reset to 50% center) */}
        <div
          style={{ left: `calc(${leftSplitPct}% - 4px)` }}
          onPointerDown={handleDividerPointerDown}
          onDoubleClick={handleDividerDoubleClick}
          className="absolute top-0 bottom-0 w-[8px] z-30 cursor-ew-resize select-none"
        />

        {/* Weekly Sticker Layer rendered underneath the text layer */}
        <WeeklyImageLayer
          images={weekImages}
          containerRef={spreadContainerRef}
          onUpdateImage={onUpdateWeekImage}
          onDeleteImage={onDeleteWeekImage}
        />

        {/* LEFT PAGE: 7-Day Horizontal Rows */}
        <div
          style={{
            paddingLeft: `${SIDE_BORDER_PX}px`,
            paddingRight: `${SIDE_BORDER_PX}px`,
          }}
          className="min-w-0 h-full flex flex-col justify-start min-h-0 overflow-hidden border-r border-hobo-lineDark pointer-events-none"
        >
          <div
            style={{ height: `${totalSevenDaysHeightPx}px` }}
            className="border-t border-b border-hobo-lineDark flex flex-col shrink-0 pointer-events-none"
          >
            {weekDays.map((dStr, idx) => {
              const dayEvents = googleEvents.filter(
                (ev) => ev.event_date === dStr
              );
              const dayTasks = datedTasks.filter(
                (t) => t.assigned_date === dStr && t.show_in_weekly
              );

              return (
                <DayColumn
                  key={dStr}
                  dateStr={dStr}
                  dayIndex={idx}
                  rowHeightPx={dayRowHeightPx}
                  events={dayEvents}
                  tasks={dayTasks}
                  weather={dailyWeatherByDate[dStr]}
                  temperatureUnit={temperatureUnit}
                  onHideGoogleEvent={onHideGoogleEvent}
                  onUnhideAllForDay={onUnhideAllForDay}
                  onAddTask={onAddTaskInDay}
                  onToggleTask={onToggleTask}
                  onEditTaskTitle={onEditTaskTitle}
                  onDeleteTask={onDeleteTask}
                  onMoveTaskToDate={onMoveTaskToDate}
                  onMoveTaskToWeeklySidebar={onMoveTaskToWeeklySidebar}
                  onMoveTaskToLongTermSidebar={onMoveTaskToLongTermSidebar}
                />
              );
            })}
          </div>
        </div>

        {/* RIGHT PAGE: Tasks Box (30 * gridSizePx, aligned with Sat/Sun divider) + Footer (5 * gridSizePx, aligned with Sunday row) */}
        <div
          style={{
            paddingLeft: `${SIDE_BORDER_PX}px`,
            paddingRight: `${SIDE_BORDER_PX}px`,
          }}
          className="min-w-0 h-full flex flex-col justify-start min-h-0 overflow-hidden pointer-events-none"
        >
          <div
            style={{ height: `${totalSevenDaysHeightPx}px` }}
            className="flex flex-col justify-between shrink-0 pointer-events-none"
          >
            {/* Tasks Box with 100% Square Crisp SVG Grid */}
            <div
              ref={tasksBoxRef}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setHeaderContextMenu(null);
                setPageContextMenu({ x: e.clientX, y: e.clientY });
              }}
              style={{ height: `${tasksBoxHeightPx}px` }}
              className="border-t border-b border-hobo-lineDark relative flex flex-col shrink-0 overflow-hidden pointer-events-auto"
            >
              <CrispSquareGrid
                cellSizePx={gridSizePx}
                rows={TASKS_BOX_GRID_ROWS}
                widthPx={tasksBoxWidthPx}
              />

              {visibleEntries.map((entry, vIdx) => {
                const def = defById.get(entry.bucket_id);
                if (!def) return null;
                const sectionHeightPx = visibleHeightsPx[vIdx] ?? 100;
                const bucketTasks = allSidebarTasks.filter((t) => {
                  const tBucket =
                    t.bucket_id || (t.is_long_term ? "long_term" : "weekly");
                  return tBucket === def.id;
                });
                const completedCount = bucketTasks.filter(
                  (t) => t.is_completed
                ).length;
                const draft = draftsByBucket[def.id] ?? "";
                const isRenaming = renamingBucketId === def.id;
                const isSwapTarget = swapCueBucketId === def.id;

                return (
                  <div
                    key={def.id}
                    data-task-drop-zone={`bucket:${def.id}`}
                    style={{ height: `${sectionHeightPx}px` }}
                    className={`relative z-10 shrink-0 flex flex-col px-3 py-1.5 overflow-hidden pointer-events-none ${
                      isSwapTarget ? "border-t-2 border-hobo-red" : ""
                    }`}
                  >
                    {/* Draggable / Double-Clickable / Right-Clickable List Header */}
                    <div
                      onPointerDown={(e) => handleHeaderPointerDown(e, vIdx)}
                      onDoubleClick={handleHeaderDoubleClick}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setPageContextMenu(null);
                        setHeaderContextMenu({
                          x: e.clientX,
                          y: e.clientY,
                          bucketId: def.id,
                          title: def.title,
                        });
                      }}
                      className="flex items-center justify-between mb-1 select-none pointer-events-auto cursor-ns-resize"
                    >
                      {isRenaming ? (
                        <input
                          ref={renameInputRef}
                          type="text"
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onBlur={() => void commitHeaderRename(def.id, def.title)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void commitHeaderRename(def.id, def.title);
                            } else if (e.key === "Escape") {
                              setRenamingBucketId(null);
                            }
                          }}
                          className="bg-white/80 border border-hobo-red px-1.5 py-0 text-[10px] uppercase tracking-[0.14em] text-hobo-ink outline-none"
                        />
                      ) : (
                        <span className="text-[10px] uppercase tracking-[0.16em] font-normal text-hobo-ink">
                          {def.title}
                        </span>
                      )}

                      {completedCount > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            onClearCompletedInBucket?.(def.id, def.scope);
                          }}
                          className="text-[9px] uppercase tracking-[0.1em] text-hobo-muted hover:text-hobo-red bg-transparent border-0 p-0 transition-colors"
                        >
                          Clear completed
                        </button>
                      )}
                    </div>

                    {getBucketKind(def) === "text" ? (
                      <BucketTextEditor
                        bucketId={def.id}
                        weekStartDate={weekStartDate}
                        value={bucketTextByBucketId[def.id] ?? ""}
                        onSave={(bId, wStart, content) =>
                          onSaveBucketText?.(bId, wStart, content)
                        }
                      />
                    ) : (
                      <div className="flex-1 min-h-0 overflow-y-auto space-y-0.5 pr-1 pointer-events-none">
                        <div className="space-y-0.5 pointer-events-auto">
                          {bucketTasks.map((task) => (
                            <TaskItem
                              key={task.id}
                              task={task}
                              onToggleComplete={onToggleTask}
                              onEditTitle={onEditTaskTitle}
                              onDelete={onDeleteTask}
                              onMoveToDate={onMoveTaskToDate}
                              onMigratePrevWeek={
                                def.scope === "weekly"
                                  ? onMigrateTaskToPrevWeek
                                  : undefined
                              }
                              onMigrateNextWeek={
                                def.scope === "weekly"
                                  ? onMigrateTaskToNextWeek
                                  : undefined
                              }
                              showMigrationArrows={def.scope === "weekly"}
                            />
                          ))}
                        </div>

                        {/* "+" Task prompt directly underneath existing tasks */}
                        <div className="flex items-center gap-1 py-[1px] pointer-events-auto">
                          <Plus className="w-2.5 h-2.5 text-hobo-muted shrink-0 stroke-[1.5]" />
                          <input
                            type="text"
                            value={draft}
                            onChange={(e) =>
                              setDraftsByBucket((prev) => ({
                                ...prev,
                                [def.id]: e.target.value,
                              }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && draft.trim()) {
                                e.preventDefault();
                                onAddTaskInBucket?.(
                                  def.id,
                                  def.scope,
                                  draft.trim()
                                );
                                setDraftsByBucket((prev) => ({
                                  ...prev,
                                  [def.id]: "",
                                }));
                              }
                            }}
                            placeholder=""
                            className="w-full bg-transparent text-[12px] leading-[16px] text-hobo-ink outline-none border-0 p-0 font-light"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Right Page Bottom Footer: Sits inside the 7th slot (`height = dayRowHeightPx`), aligned at the bottom above the 24px border */}
            <div
              style={{ height: `${dayRowHeightPx}px` }}
              className="relative z-10 shrink-0 pt-1 flex items-end justify-between gap-2 select-none overflow-hidden pointer-events-none"
            >
              <div
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setHeaderContextMenu(null);
                  setPageContextMenu(null);
                  setWeatherContextMenu({ x: e.clientX, y: e.clientY });
                }}
                className="min-w-0 flex-1 text-[10px] leading-snug text-hobo-muted pointer-events-auto cursor-context-menu"
              >
                {currentWeather ? (
                  <div className="group/curweather flex items-start gap-2">
                    <WeatherIcon
                      code={currentWeather.weatherCode}
                      className="mt-0.5 w-3.5 h-3.5 shrink-0 stroke-[1.4] text-hobo-ink group-hover/curweather:text-hobo-red transition-colors"
                    />
                    <span className="group-hover/curweather:text-hobo-red transition-colors">
                      Today in{" "}
                      <strong className="font-normal text-hobo-ink group-hover/curweather:text-hobo-red">
                        {currentWeather.city}
                      </strong>
                      :{" "}
                      <strong className="font-normal text-hobo-ink group-hover/curweather:text-hobo-red">
                        {formatTemperature(currentWeather.temperature, temperatureUnit)}
                      </strong>
                      , {currentWeather.conditionLabel.toLowerCase()}.
                      <br />
                      High {formatTemperature(currentWeather.tempMax, temperatureUnit)} · Low{" "}
                      {formatTemperature(currentWeather.tempMin, temperatureUnit)}.
                    </span>
                  </div>
                ) : (
                  <span className="hover:text-hobo-red transition-colors">
                    Right click to set your location for weather updates
                  </span>
                )}
              </div>

              <div className="shrink-0">
                <MiniMonthCalendar
                  weekStartDate={weekStartDate}
                  weekEndDate={weekEndDate}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Weather Right-Click Menu: Set location | Show in °C / °F */}
      {weatherContextMenu &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left: `${Math.min(weatherContextMenu.x, window.innerWidth - 120)}px`,
              top: `${Math.min(weatherContextMenu.y, window.innerHeight - 90)}px`,
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className="z-[80] w-fit bg-hobo-paperSolid border border-hobo-lineDark shadow-md py-1 text-[11px] font-light select-none"
          >
            <button
              type="button"
              onClick={() => {
                setWeatherContextMenu(null);
                onOpenWeatherLocation?.();
              }}
              className="block w-full text-left px-2.5 py-1 whitespace-nowrap text-hobo-ink hover:bg-hobo-paperHover hover:text-hobo-red bg-transparent border-0 transition-colors"
            >
              Set location
            </button>
            <button
              type="button"
              onClick={() => {
                setWeatherContextMenu(null);
                onToggleTemperatureUnit?.();
              }}
              className="block w-full text-left px-2.5 py-1 whitespace-nowrap text-hobo-ink hover:bg-hobo-paperHover hover:text-hobo-red bg-transparent border-0 transition-colors"
            >
              {temperatureUnit === "C" ? "Show in °F" : "Show in °C"}
            </button>
          </div>,
          document.body
        )}

      {/* Header Right-Click Menu: Rename | Hide list */}
      {headerContextMenu &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left: `${Math.min(headerContextMenu.x, window.innerWidth - 110)}px`,
              top: `${Math.min(headerContextMenu.y, window.innerHeight - 90)}px`,
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className="z-[80] w-fit bg-hobo-paperSolid border border-hobo-lineDark shadow-md py-1 text-[11px] font-light select-none"
          >
            <button
              type="button"
              onClick={() => {
                const { bucketId, title } = headerContextMenu;
                setHeaderContextMenu(null);
                setRenameDraft(title);
                setRenamingBucketId(bucketId);
              }}
              className="block w-full text-left px-2.5 py-1 whitespace-nowrap text-hobo-ink hover:bg-hobo-paperHover hover:text-hobo-red bg-transparent border-0 transition-colors"
            >
              Rename
            </button>
            <button
              type="button"
              onClick={() => {
                const { bucketId } = headerContextMenu;
                setHeaderContextMenu(null);
                handleHideBucketOnCurrentPage(bucketId);
              }}
              className="block w-full text-left px-2.5 py-1 whitespace-nowrap text-hobo-ink hover:bg-hobo-paperHover hover:text-hobo-red bg-transparent border-0 transition-colors"
            >
              Hide list
            </button>
          </div>,
          document.body
        )}

      {/* Tasks Page Right-Click Menu */}
      {pageContextMenu &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left: `${Math.min(pageContextMenu.x, window.innerWidth - 150)}px`,
              top: `${Math.min(pageContextMenu.y, window.innerHeight - 150)}px`,
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className="z-[80] w-fit bg-hobo-paperSolid border border-hobo-lineDark shadow-md py-1 text-[11px] font-light select-none"
          >
            <button
              type="button"
              onClick={() => {
                setPageContextMenu(null);
                setIsManageListsOpen(true);
              }}
              className="block w-full text-left px-2.5 py-1 whitespace-nowrap text-hobo-ink hover:bg-hobo-paperHover hover:text-hobo-red bg-transparent border-0 transition-colors"
            >
              Manage lists
            </button>
            <button
              type="button"
              onClick={() => {
                setPageContextMenu(null);
                void handleAddNewBucket("weekly");
              }}
              className="block w-full text-left px-2.5 py-1 whitespace-nowrap text-hobo-ink hover:bg-hobo-paperHover hover:text-hobo-red bg-transparent border-0 transition-colors"
            >
              New weekly list
            </button>
            <button
              type="button"
              onClick={() => {
                setPageContextMenu(null);
                void handleAddNewBucket("persistent");
              }}
              className="block w-full text-left px-2.5 py-1 whitespace-nowrap text-hobo-ink hover:bg-hobo-paperHover hover:text-hobo-red bg-transparent border-0 transition-colors"
            >
              New long-term list
            </button>
            <button
              type="button"
              onClick={() => {
                setPageContextMenu(null);
                void handleAddNewBucket("weekly", "text");
              }}
              className="block w-full text-left px-2.5 py-1 whitespace-nowrap text-hobo-ink hover:bg-hobo-paperHover hover:text-hobo-red bg-transparent border-0 transition-colors"
            >
              New text section
            </button>
            <div className="my-0.5 border-t border-hobo-line" />
            <button
              type="button"
              onClick={() => {
                setPageContextMenu(null);
                void handleSetDefaultFromThisWeek();
              }}
              className="block w-full text-left px-2.5 py-1 whitespace-nowrap text-hobo-ink hover:bg-hobo-paperHover hover:text-hobo-red bg-transparent border-0 transition-colors"
            >
              Set default forward
            </button>
          </div>,
          document.body
        )}

      {/* Manage Hidden Lists Modal */}
      <ManageHiddenListsModal
        isOpen={isManageListsOpen}
        bucketDefinitions={activeDefs}
        layoutEntries={effectiveEntries}
        onClose={() => setIsManageListsOpen(false)}
        onToggleVisibility={handleToggleBucketVisibilityFromModal}
        onRenameBucket={(id, newTitle) => onRenameBucket?.(id, newTitle)}
        onCountTasksInBucket={async (id, kind) =>
          (await onCountTasksInBucket?.(id, kind)) ?? 0
        }
        onDeleteHiddenBucket={(id) => onDeleteHiddenBucket?.(id)}
      />

      {/* Max 4 Visible Lists Alert Modal */}
      {alertMessage && (
        <div
          className="fixed inset-0 z-[75] bg-black/30 flex items-center justify-center p-4 select-none pointer-events-auto"
          onClick={() => setAlertMessage(null)}
        >
          <div
            className="w-full max-w-[320px] bg-hobo-paperSolid border border-hobo-lineDark shadow-lg p-4 space-y-3 text-xs font-light"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-[11px] leading-relaxed text-hobo-ink">
                {alertMessage}
              </p>
              <button
                type="button"
                onClick={() => setAlertMessage(null)}
                className="p-0.5 text-hobo-muted hover:text-hobo-red bg-transparent border-0 shrink-0"
              >
                <X className="w-3.5 h-3.5 stroke-[1.5]" />
              </button>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setAlertMessage(null)}
                className="px-3 py-1 text-[10px] uppercase tracking-[0.12em] border border-hobo-lineDark text-hobo-ink hover:border-hobo-red hover:text-hobo-red bg-transparent"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Future Explicit Override Conflict Modal */}
      {futureConflictPromptOpen && (
        <div
          className="fixed inset-0 z-[75] bg-black/30 flex items-center justify-center p-4 select-none pointer-events-auto"
          onClick={() => setFutureConflictPromptOpen(false)}
        >
          <div
            className="w-full max-w-[360px] bg-hobo-paperSolid border border-hobo-lineDark shadow-lg p-4 space-y-3 text-xs font-light"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-hobo-line pb-2">
              <h4 className="text-[11px] uppercase tracking-[0.14em] text-hobo-ink font-normal">
                Future Custom Layouts Found
              </h4>
              <button
                type="button"
                onClick={() => setFutureConflictPromptOpen(false)}
                className="p-0.5 text-hobo-muted hover:text-hobo-red bg-transparent border-0"
              >
                <X className="w-3.5 h-3.5 stroke-[1.5]" />
              </button>
            </div>
            <p className="text-[11px] leading-relaxed text-hobo-ink">
              One or more future weeks already have a custom layout. How should
              this new default apply?
            </p>
            <div className="flex flex-col gap-1.5 pt-1">
              <button
                type="button"
                onClick={() =>
                  void handleResolveFutureDefaultConflict("keep_overrides")
                }
                className="w-full py-1.5 px-2.5 text-left text-[10px] uppercase tracking-[0.1em] border border-hobo-red bg-hobo-redSoft text-hobo-red hover:bg-hobo-red hover:text-white transition-colors"
              >
                Keep custom future weeks
              </button>
              <button
                type="button"
                onClick={() =>
                  void handleResolveFutureDefaultConflict("overwrite_all")
                }
                className="w-full py-1.5 px-2.5 text-left text-[10px] uppercase tracking-[0.1em] border border-hobo-lineDark text-hobo-ink hover:border-hobo-red hover:text-hobo-red bg-transparent transition-colors"
              >
                Overwrite all future weeks
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
