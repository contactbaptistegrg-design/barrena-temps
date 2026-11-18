// Liaison avec le script Google (Apps Script) installé dans ton tableau de bord.
import * as DB from './db.js';

let conn = null;

export async function loadConn() {
  conn = await DB.kvGet('conn', null);
  return conn;
}
export const hasConn = () => !!(conn && conn.url && conn.key);
export const getConn = () => conn;
export async function saveConn(c) {
  conn = { url: String(c.url || '').trim(), key: String(c.key || '').trim() };
  await DB.kvSet('conn', conn);
}
export async function clearConn() {
  conn = null;
  await DB.kvDel('conn');
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('Lecture du fichier impossible'));
    r.readAsDataURL(blob);
  });
}

const te = new TextEncoder();
async function hmacHex(key, text) {
  const k = await crypto.subtle.importKey('raw', te.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, te.encode(text));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function call(action, payload = {}) {
  if (!hasConn()) {
    const e = new Error('Connexion au script non configurée');
    e.auth = true;
    throw e;
  }
  let res;
  try {
    // Corps en texte brut : pas de pré-requête CORS, accepté par Apps Script.
    // La clé n'est jamais envoyée : chaque requête est signée (HMAC) avec l'heure et un numéro à usage unique.
    const ts = Date.now();
    const nonce = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');
    const msg = JSON.stringify({ ...payload, action });
    const sig = await hmacHex(conn.key, `${ts}.${nonce}.${msg}`);
    res = await fetch(conn.url, { method: 'POST', body: JSON.stringify({ ts, nonce, msg, sig }), redirect: 'follow' });
  } catch {
    throw new Error(navigator.onLine ? "Script injoignable : vérifie l'adresse et l'accès « Tout le monde »" : 'Réseau indisponible');
  }
  if (!res.ok) throw new Error(`Script injoignable (${res.status})`);
  let j;
  try {
    j = await res.json();
  } catch {
    throw new Error("Réponse inattendue : vérifie l'adresse du script et son accès « Tout le monde »");
  }
  if (!j.ok) {
    const e = new Error(j.error || 'Erreur du script');
    e.auth = !!j.auth;
    throw e;
  }
  return j;
}
