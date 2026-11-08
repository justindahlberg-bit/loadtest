// IndexedDB storage: projects (JSON), pass data (typed arrays), photos (Blobs).
const DB_NAME = 'loadtest';
const DB_VERSION = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('passData')) db.createObjectStore('passData', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    const r = fn(s);
    if (r && 'onsuccess' in r) r.onsuccess = () => { result = r.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Storage transaction aborted (device storage may be full).'));
  });
}

export const db = {
  put: (store, value) => tx(store, 'readwrite', s => s.put(value)),
  get: (store, id) => tx(store, 'readonly', s => s.get(id)),
  del: (store, id) => tx(store, 'readwrite', s => s.delete(id)),
  all: (store) => tx(store, 'readonly', s => s.getAll()),
  async persist() {
    try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch { }
    return false;
  },
  async estimate() {
    try { if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate(); } catch { }
    return null;
  },
};
