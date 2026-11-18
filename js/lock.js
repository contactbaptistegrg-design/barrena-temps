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
// Verrouillage de l'application : empreinte / schéma du téléphone (WebAuthn) + code PIN de secours.
// IMPORTANT : c'est un verrou d'accès à l'écran de l'application, pas un chiffrement des données locales.
import * as DB from './db.js';

const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

async function hashPin(pin, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, key, 256);
  return b64(bits);
}

export async function hasPin() {
  return !!(await DB.kvGet('lock.pin'));
}
export async function setPin(pin) {
  const salt = rand(16);
  await DB.kvSet('lock.pin', { salt: b64(salt), hash: await hashPin(pin, salt) });
  await DB.kvSet('lock.fails', 0);
}
export async function checkPin(pin) {
  const rec = await DB.kvGet('lock.pin');
  if (!rec) return true;
  const ok = (await hashPin(pin, unb64(rec.salt))) === rec.hash;
  if (ok) await DB.kvSet('lock.fails', 0);
  else await DB.kvSet('lock.fails', ((await DB.kvGet('lock.fails', 0)) || 0) + 1);
  return ok;
}
export const failCount = () => DB.kvGet('lock.fails', 0);

export const bioSupported = async () => {
  try {
    return !!(window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()));
  } catch {
    return false;
  }
};
export const hasBio = async () => !!(await DB.kvGet('lock.bio'));

export async function enableBio() {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: rand(32),
      rp: { name: 'Barrena Temps' },
      user: { id: rand(16), name: 'barrena', displayName: 'Barrena' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000,
    },
  });
  await DB.kvSet('lock.bio', b64(cred.rawId));
}
export const disableBio = () => DB.kvDel('lock.bio');

// Ouvre la fenêtre d'empreinte / schéma / code du téléphone.
export async function verifyBio() {
  const id = await DB.kvGet('lock.bio');
  if (!id) return false;
  try {
    await navigator.credentials.get({
      publicKey: {
        challenge: rand(32),
        allowCredentials: [{ type: 'public-key', id: unb64(id), transports: ['internal'] }],
        userVerification: 'required',
        timeout: 60000,
      },
    });
    return true;
  } catch {
    return false;
  }
}
