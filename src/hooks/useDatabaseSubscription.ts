import { useEffect, useRef } from "react";
import { onDatabaseUpdated } from "../db/database";

/**
 * Subscribes to SQLite database update events with automatic disposal handling.
 */
export function useDatabaseSubscription(
  onUpdate: (source?: string) => void
): void {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    let isDisposed = false;
    let unlisten: (() => void) | undefined;

    void onDatabaseUpdated((source) => {
      if (!isDisposed) {
        onUpdateRef.current(source);
      }
    }).then((fn) => {
      if (isDisposed) fn();
      else unlisten = fn;
    });

    return () => {
      isDisposed = true;
      unlisten?.();
    };
  }, []);
}
