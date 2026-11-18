// Stockage local (IndexedDB) : cache de référence, réglages, file d'attente hors ligne.
// Tout est chiffré (AES-256-GCM) avec une clé dérivée du code PIN, sauf les éléments du verrou (sel, vérificateur, compteur).
const NAME = 'barrena-temps';
let dbp;
let KEY = null;          // clé AES en mémoire (jamais écrite sur le disque)
let REQUIRE_KEY = false; // un PIN existe : refuser toute lecture/écriture sans clé
const CLEAR = new Set(['lock.pin', 'lock.fails']);
const te = new TextEncoder();
const td = new TextDecoder();

export const setKey = (k) => { KEY = k; };
export const hasKey = () => !!KEY;
export const requireKey = (v) => { REQUIRE_KEY = !!v; };

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

// ----- sérialisation (les Blob photo / PDF passent en base64 dans la partie chiffrée) -----
const blobToB64 = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1] || '');
  r.onerror = () => rej(new Error('Lecture impossible'));
  r.readAsDataURL(blob);
});
async function pack(v) {
  if (v instanceof Blob) return { __blob: await blobToB64(v), type: v.type };
  if (Array.isArray(v)) return Promise.all(v.map(pack));
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = await pack(v[k]); return o; }
  return v;
}
function unpack(v) {
  if (Array.isArray(v)) return v.map(unpack);
  if (v && typeof v === 'object') {
    if (typeof v.__blob === 'string') return new Blob([Uint8Array.from(atob(v.__blob), (c) => c.charCodeAt(0))], { type: v.type });
    const o = {}; for (const k of Object.keys(v)) o[k] = unpack(v[k]); return o;
  }
  return v;
}

export async function seal(value, key = KEY) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify({ v: await pack(value === undefined ? null : value) })));
  return { __enc: 1, iv, ct };
}
export async function unseal(rec, key = KEY) {
  if (!rec || !rec.__enc) return rec; // ancienne donnée non chiffrée
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv }, key, rec.ct);
  return unpack(JSON.parse(td.decode(pt)).v);
}
const needKey = () => { if (!KEY && REQUIRE_KEY) throw new Error('Application verrouillée'); };

export async function kvGet(k, def = null) {
  const raw = await tx('kv', 'readonly', (s) => s.get(k));
  if (raw === undefined) return def;
  if (CLEAR.has(k)) return raw;
  needKey();
  const v = KEY ? await unseal(raw) : raw;
  return v === undefined ? def : v;
}
export async function kvSet(k, v) {
  if (CLEAR.has(k) || !KEY) { if (!CLEAR.has(k)) needKey(); return tx('kv', 'readwrite', (s) => s.put(v, k)); }
  const rec = await seal(v);
  return tx('kv', 'readwrite', (s) => s.put(rec, k));
}
export const kvDel = (k) => tx('kv', 'readwrite', (s) => s.delete(k));

const newUid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
async function toRow(op, id) {
  needKey();
  const row = KEY ? { enc: await seal(op) } : { plain: op };
  if (id != null) row.id = id;
  return row;
}
async function fromRow(r) {
  if (r.enc) return { ...(await unseal(r.enc)), id: r.id };
  return r.plain ? { ...r.plain, id: r.id } : r;
}
export async function qAll() {
  needKey();
  const rows = await tx('queue', 'readonly', (s) => s.getAll());
  return Promise.all(rows.map(fromRow));
}
export async function qAdd(op) {
  const row = await toRow({ ...op, uid: op.uid || newUid(), created: Date.now() });
  return tx('queue', 'readwrite', (s) => s.add(row));
}
export async function qPut(op) { const row = await toRow(op, op.id); return tx('queue', 'readwrite', (s) => s.put(row)); }
export const qDel = (id) => tx('queue', 'readwrite', (s) => s.delete(id));

// Rechiffre tout avec une nouvelle clé (création ou changement du PIN). L'ancienne clé (s'il y en a une) sert à lire.
export async function rekey(newKey) {
  const db = await open();
  const kvs = await new Promise((res, rej) => {
    const out = [];
    const c = db.transaction('kv', 'readonly').objectStore('kv').openCursor();
    c.onsuccess = () => { const cur = c.result; if (cur) { out.push([cur.key, cur.value]); cur.continue(); } else res(out); };
    c.onerror = () => rej(c.error);
  });
  const kvPlain = [];
  for (const [k, raw] of kvs) if (!CLEAR.has(k)) kvPlain.push([k, await unseal(raw)]);
  const rows = await tx('queue', 'readonly', (s) => s.getAll());
  const ops = [];
  for (const r of rows) ops.push(await fromRow(r));
  const kvOut = [];
  for (const [k, v] of kvPlain) kvOut.push([k, await seal(v, newKey)]);
  const qOut = [];
  for (const o of ops) { const { id, ...rest } = o; qOut.push({ id, enc: await seal(rest, newKey) }); }
  await new Promise((res, rej) => {
    const t = db.transaction(['kv', 'queue'], 'readwrite');
    kvOut.forEach(([k, rec]) => t.objectStore('kv').put(rec, k));
    qOut.forEach((r) => t.objectStore('queue').put(r));
    t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  });
  KEY = newKey;
}
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
