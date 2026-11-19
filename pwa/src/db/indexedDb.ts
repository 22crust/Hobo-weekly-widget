const DB_NAME = "local-planner-pwa";
const DB_VERSION = 1;

export type StoreName =
  | "tasks"
  | "local_events"
  | "note_pages"
  | "calendar_events"
  | "meta";

let dbPromise: Promise<IDBDatabase> | null = null;
const updateListeners = new Set<(source?: string) => void>();

export function onDatabaseUpdated(
  callback: (source?: string) => void
): () => void {
  updateListeners.add(callback);
  return () => {
    updateListeners.delete(callback);
  };
}

export function notifyDatabaseUpdated(source?: string): void {
  for (const listener of updateListeners) {
    try {
      listener(source);
    } catch {
      // Ignore listener error
    }
  }
}

export function openIndexedDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("tasks")) {
        db.createObjectStore("tasks", { keyPath: "sync_id" });
      }
      if (!db.objectStoreNames.contains("local_events")) {
        db.createObjectStore("local_events", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("note_pages")) {
        db.createObjectStore("note_pages", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("calendar_events")) {
        db.createObjectStore("calendar_events", { keyPath: "instance_key" });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return dbPromise;
}

export async function getAllFromStore<T>(storeName: StoreName): Promise<T[]> {
  const db = await openIndexedDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as T[]) ?? []);
    req.onerror = () => reject(req.error);
  });
}

export async function getByKeyFromStore<T>(
  storeName: StoreName,
  key: IDBValidKey
): Promise<T | undefined> {
  const db = await openIndexedDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function putInStore<T>(
  storeName: StoreName,
  value: T
): Promise<void> {
  const db = await openIndexedDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    store.put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteFromStore(
  storeName: StoreName,
  key: IDBValidKey
): Promise<void> {
  const db = await openIndexedDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    store.delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function replaceStoreContents<T>(
  storeName: StoreName,
  items: T[]
): Promise<void> {
  const db = await openIndexedDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    store.clear();
    for (const item of items) {
      store.put(item);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
