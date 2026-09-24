// Persistent, bounded browser cache for optimized Reverie assets.
// IndexedDB is best-effort: private browsing/locked-down browsers simply fall
// back to the procedural runtime without breaking the game.

const DB = 'reverie-assets-v1';
const STORE = 'assets';

function openDB() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

export class AssetCache {
  constructor({ maxBytes = 768 * 1024 * 1024 } = {}) { this.maxBytes = maxBytes; }

  async get(key) {
    const db = await openDB();
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const req = store.get(key);
      req.onsuccess = () => {
        const value = req.result ?? null;
        if (value) { value.lastUsed = Date.now(); store.put(value); }
        resolve(value?.manifest ?? null);
      };
      req.onerror = () => resolve(null);
    });
  }

  async put(key, manifest, bytes = 0) {
    const db = await openDB();
    if (!db) return;
    await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ key, manifest, bytes: Math.max(0, bytes), lastUsed: Date.now() });
      tx.oncomplete = tx.onerror = () => resolve();
    });
    await this.prune();
  }

  async prune() {
    const db = await openDB();
    if (!db) return;
    const rows = await new Promise((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => resolve([]);
    });
    let total = rows.reduce((n, r) => n + (r.bytes || 0), 0);
    if (total <= this.maxBytes) return;
    rows.sort((a, b) => a.lastUsed - b.lastUsed);
    const tx = db.transaction(STORE, 'readwrite');
    for (const row of rows) {
      tx.objectStore(STORE).delete(row.key);
      total -= row.bytes || 0;
      if (total <= this.maxBytes) break;
    }
  }
}
