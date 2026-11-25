export type DropIndicatorPosition = "before" | "after";

export interface TaskDropInsertionResult {
  insertIndex: number;
  indicatorTarget: HTMLElement | null;
  indicatorPosition: DropIndicatorPosition | null;
}

/**
 * Computes the insertion index within a `[data-task-drop-zone]` container,
 * scoped to items matching `draggedCompleted` so unchecked tasks always sort
 * within the unchecked group and checked tasks within the checked group.
 */
export function computeTaskDropInsertion(
  zoneEl: HTMLElement,
  clientY: number,
  attrName: "data-task-id" | "data-task-sync-id",
  draggedKey: string,
  draggedCompleted: boolean
): TaskDropInsertionResult {
  const allItems = Array.from(
    zoneEl.querySelectorAll<HTMLElement>(`[${attrName}]`)
  );
  const candidates = allItems.filter((el) => {
    if (el.getAttribute(attrName) === draggedKey) return false;
    const isCompleted = el.getAttribute("data-task-completed") === "1";
    return isCompleted === draggedCompleted;
  });

  for (let i = 0; i < candidates.length; i++) {
    const el = candidates[i];
    const rect = el.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (clientY < midY) {
      return {
        insertIndex: i,
        indicatorTarget: el,
        indicatorPosition: "before",
      };
    }
  }

  return {
    insertIndex: candidates.length,
    indicatorTarget:
      candidates.length > 0 ? candidates[candidates.length - 1] : null,
    indicatorPosition: candidates.length > 0 ? "after" : null,
  };
}

export function clearTaskDropIndicator(prevTarget: HTMLElement | null): void {
  if (prevTarget) {
    prevTarget.removeAttribute("data-drop-indicator");
  }
}

export function applyTaskDropIndicator(
  prevTarget: HTMLElement | null,
  nextTarget: HTMLElement | null,
  position: DropIndicatorPosition | null
): HTMLElement | null {
  if (prevTarget && prevTarget !== nextTarget) {
    prevTarget.removeAttribute("data-drop-indicator");
  }
  if (nextTarget && position) {
    nextTarget.setAttribute("data-drop-indicator", position);
    return nextTarget;
  }
  if (nextTarget) {
    nextTarget.removeAttribute("data-drop-indicator");
  }
  return null;
}

/**
 * Inserts `movedItem` into `groupItems` at `insertIndex` (excluding any existing
 * occurrence of `movedItem` by `getKey`), returning the new ordered array.
 */
export function insertItemAtOrderIndex<T>(
  groupItems: T[],
  movedItem: T,
  getKey: (item: T) => string,
  insertIndex?: number
): T[] {
  const movedKey = getKey(movedItem);
  const filtered = groupItems.filter((item) => getKey(item) !== movedKey);
  const clampedIndex =
    insertIndex === undefined
      ? filtered.length
      : Math.max(0, Math.min(insertIndex, filtered.length));
  const next = [...filtered];
  next.splice(clampedIndex, 0, movedItem);
  return next;
}

/**
 * Replaces a reordered completion group inside a task list while keeping
 * unchecked tasks ordered before checked tasks (matching DB sort order).
 */
export function mergeReorderedTaskGroup<T extends { is_completed: boolean }>(
  prev: T[],
  movedKey: string,
  getKey: (item: T) => string,
  isTargetGroup: (item: T) => boolean,
  reorderedGroup: T[]
): T[] {
  const remaining = prev.filter(
    (t) => getKey(t) !== movedKey && !isTargetGroup(t)
  );
  return [...remaining, ...reorderedGroup].sort(
    (a, b) => Number(a.is_completed) - Number(b.is_completed)
  );
}
