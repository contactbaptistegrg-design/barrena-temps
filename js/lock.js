// Verrouillage + chiffrement local : un code PIN de 6 chiffres donne (PBKDF2 lent) la clé AES qui chiffre
// toutes les données du téléphone. Sans le code, les données stockées sont illisibles.
import * as DB from './db.js';

const te = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const ITER = 400000; // ~0,5 s sur un téléphone : ralentit fortement l'essai de tous les codes

async function deriveKey(pin, salt) {
  const base = await crypto.subtle.importKey('raw', te.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export const isPin = (p) => /^\d{6}$/.test(p);

export async function hasPin() {
  const rec = await DB.kvGet('lock.pin');
  return !!(rec && rec.check);
}

// Crée ou change le code : rechiffre toutes les données avec la nouvelle clé.
export async function setPin(pin) {
  if (!isPin(pin)) throw new Error('Le code doit avoir 6 chiffres');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(pin, salt);
  await DB.rekey(key);
  const chk = await DB.seal('barrena-ok', key);
  await DB.kvSet('lock.pin', { salt: b64(salt), check: { iv: b64(chk.iv), ct: b64(chk.ct) } });
  await DB.kvSet('lock.fails', 0);
  DB.requireKey(true);
}

export async function checkPin(pin) {
  const rec = await DB.kvGet('lock.pin');
  if (!rec || !rec.check) return true;
  let ok = false;
  if (isPin(pin)) {
    try {
      const key = await deriveKey(pin, unb64(rec.salt));
      ok = (await DB.unseal({ __enc: 1, iv: unb64(rec.check.iv), ct: unb64(rec.check.ct) }, key)) === 'barrena-ok';
      if (ok) DB.setKey(key);
    } catch { ok = false; }
  }
  await DB.kvSet('lock.fails', ok ? 0 : ((await DB.kvGet('lock.fails', 0)) || 0) + 1);
  return ok;
}
export const failCount = () => DB.kvGet('lock.fails', 0);
