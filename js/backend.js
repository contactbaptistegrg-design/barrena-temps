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

export async function call(action, payload = {}) {
  if (!hasConn()) {
    const e = new Error('Connexion au script non configurée');
    e.auth = true;
    throw e;
  }
  let res;
  try {
    // Corps en texte brut : pas de pré-requête CORS, accepté par Apps Script.
    res = await fetch(conn.url, { method: 'POST', body: JSON.stringify({ ...payload, key: conn.key, action }), redirect: 'follow' });
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
