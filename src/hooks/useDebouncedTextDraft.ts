import { useCallback, useEffect, useRef, useState } from "react";

interface UseDebouncedTextDraftOptions {
  /** Composite key identifying the current document (e.g., pageId or `${bucketId}::${weekStart}`). */
  keyId: string | null;
  value: string;
  onSave: (keyId: string, content: string) => Promise<void> | void;
  delayMs?: number;
}

/**
 * Cursor-safe debounced text draft hook for controlled `<textarea>` elements.
 * Prevents autosaves and background reloads from overwriting `draft` while focused or dirty.
 */
export function useDebouncedTextDraft({
  keyId,
  value,
  onSave,
  delayMs = 350,
}: UseDebouncedTextDraftOptions) {
  const [draft, setDraft] = useState(value);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const dirtyKeyRef = useRef<string | null>(null);
  const latestDraftRef = useRef<string>(value);
  const lastSyncedKeyRef = useRef<string | null>(keyId);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const cancelPendingSave = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    dirtyKeyRef.current = null;
  }, []);

  const flushSaveFor = useCallback(async (targetKey: string, text: string) => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    await onSaveRef.current(targetKey, text);
    if (dirtyKeyRef.current === targetKey && latestDraftRef.current === text) {
      dirtyKeyRef.current = null;
    }
  }, []);

  const flushPendingSave = useCallback(async () => {
    if (!keyId || dirtyKeyRef.current !== keyId) return;
    await flushSaveFor(keyId, latestDraftRef.current);
  }, [flushSaveFor, keyId]);

  const resetDraft = useCallback(
    (nextVal: string) => {
      cancelPendingSave();
      latestDraftRef.current = nextVal;
      setDraft(nextVal);
    },
    [cancelPendingSave]
  );

  // Sync incoming value on document switch, or when not focused/dirty
  useEffect(() => {
    if (keyId === null) {
      lastSyncedKeyRef.current = null;
      latestDraftRef.current = "";
      setDraft("");
      return;
    }

    const switched = lastSyncedKeyRef.current !== keyId;
    if (switched) {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      dirtyKeyRef.current = null;
      lastSyncedKeyRef.current = keyId;
      latestDraftRef.current = value;
      setDraft(value);
      return;
    }

    if (
      dirtyKeyRef.current !== keyId &&
      document.activeElement !== textareaRef.current &&
      latestDraftRef.current !== value
    ) {
      latestDraftRef.current = value;
      setDraft(value);
    }
  }, [keyId, value]);

  // Flush unsaved edits on unmount or key change
  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null && keyId !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        if (dirtyKeyRef.current === keyId) {
          void onSaveRef.current(keyId, latestDraftRef.current);
        }
      }
    };
  }, [keyId]);

  const handleChange = useCallback(
    (nextVal: string) => {
      latestDraftRef.current = nextVal;
      setDraft(nextVal);
      if (keyId === null) return;

      dirtyKeyRef.current = keyId;
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
      const targetKey = keyId;
      saveTimerRef.current = window.setTimeout(() => {
        void flushSaveFor(targetKey, nextVal);
      }, delayMs);
    },
    [delayMs, flushSaveFor, keyId]
  );

  const handleBlur = useCallback(() => {
    if (keyId !== null && dirtyKeyRef.current === keyId) {
      void flushSaveFor(keyId, latestDraftRef.current);
    }
  }, [flushSaveFor, keyId]);

  const isDirtyFor = useCallback(
    (checkKeyId?: string | null) =>
      checkKeyId !== undefined
        ? dirtyKeyRef.current === checkKeyId
        : dirtyKeyRef.current !== null,
    []
  );

  return {
    draft,
    textareaRef,
    handleChange,
    handleBlur,
    flushPendingSave,
    cancelPendingSave,
    resetDraft,
    isDirtyFor,
  };
}
