// Stockage local (IndexedDB) : cache de référence, réglages, file d'attente hors ligne.
const NAME = 'barrena-temps';
let dbp;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open(NAME, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('kv');
      db.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const req = fn(s);
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const kvGet = (k, def = null) => tx('kv', 'readonly', (s) => s.get(k)).then((v) => (v === undefined ? def : v));
export const kvSet = (k, v) => tx('kv', 'readwrite', (s) => s.put(v, k));
export const kvDel = (k) => tx('kv', 'readwrite', (s) => s.delete(k));
export const qAll = () => tx('queue', 'readonly', (s) => s.getAll());
export const qAdd = (op) => tx('queue', 'readwrite', (s) => s.add({ ...op, uid: op.uid || Date.now().toString(36) + Math.random().toString(36).slice(2, 8), created: Date.now() }));
export const qPut = (op) => tx('queue', 'readwrite', (s) => s.put(op));
export const qDel = (id) => tx('queue', 'readwrite', (s) => s.delete(id));
