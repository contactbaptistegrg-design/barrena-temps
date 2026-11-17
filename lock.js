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
