'use client';

type CacheRecord<T> = {
  key: string;
  data: T;
  timestamp: number;
};

type CacheReadOptions = {
  maxAgeMs?: number;
};

const dbName = 'financial-office-client-cache';
const dbVersion = 1;
const storeName = 'responses';
const memoryCache = new Map<string, CacheRecord<unknown>>();
let activeSyncCount = 0;

function canUseIndexedDb() {
  return typeof window !== 'undefined' && 'indexedDB' in window;
}

function openCacheDb() {
  if (!canUseIndexedDb()) return Promise.resolve(null);

  return new Promise<IDBDatabase | null>((resolve) => {
    const request = window.indexedDB.open(dbName, dbVersion);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T> | void,
) {
  const db = await openCacheDb();
  if (!db) return null;

  return new Promise<T | null>((resolve) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const request = callback(store);

    if (!request) {
      transaction.oncomplete = () => {
        db.close();
        resolve(null);
      };
      transaction.onerror = () => {
        db.close();
        resolve(null);
      };
      return;
    }

    request.onsuccess = () => {
      db.close();
      resolve(request.result ?? null);
    };
    request.onerror = () => {
      db.close();
      resolve(null);
    };
  });
}

export async function readClientCache<T>(key: string, options: CacheReadOptions = {}) {
  const now = Date.now();
  const maxAgeMs = options.maxAgeMs ?? 1000 * 60 * 60 * 24;
  const memoryRecord = memoryCache.get(key) as CacheRecord<T> | undefined;

  if (memoryRecord && now - memoryRecord.timestamp <= maxAgeMs) {
    return { data: memoryRecord.data, ageMs: now - memoryRecord.timestamp, source: 'memory' as const };
  }

  const stored = await withStore<CacheRecord<T>>('readonly', (store) => store.get(key));
  if (!stored || now - stored.timestamp > maxAgeMs) return null;

  memoryCache.set(key, stored);
  return { data: stored.data, ageMs: now - stored.timestamp, source: 'indexeddb' as const };
}

export async function writeClientCache<T>(key: string, data: T) {
  const record: CacheRecord<T> = { key, data, timestamp: Date.now() };
  memoryCache.set(key, record);
  await withStore('readwrite', (store) => {
    store.put(record);
  });
}

export async function removeClientCache(key: string) {
  memoryCache.delete(key);
  await withStore('readwrite', (store) => {
    store.delete(key);
  });
}

export function runWhenIdle(task: () => void, timeout = 900) {
  if (typeof window === 'undefined') return;

  const idleWindow = window as Window &
    typeof globalThis & {
      requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
    };

  if (idleWindow.requestIdleCallback) {
    idleWindow.requestIdleCallback(task, { timeout });
    return;
  }

  window.setTimeout(task, Math.min(timeout, 250));
}

export function announceSyncStart() {
  if (typeof window === 'undefined') return;
  activeSyncCount += 1;
  window.dispatchEvent(new CustomEvent('financial-office-sync', { detail: { syncing: true } }));
}

export function announceSyncEnd() {
  if (typeof window === 'undefined') return;
  activeSyncCount = Math.max(0, activeSyncCount - 1);
  window.dispatchEvent(new CustomEvent('financial-office-sync', { detail: { syncing: activeSyncCount > 0 } }));
}
