// Calculs de temps et formats.
export const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export const MODES = {
  real: 'Temps réel',
  half: 'Demi-heure la plus proche',
  halfup: 'Demi-heure supérieure',
};

// h = heures décimales réelles
export function roundHours(h, mode) {
  if (mode === 'half') return Math.max(0.5, Math.round(h * 2) / 2);
  if (mode === 'halfup') return Math.max(0.5, Math.ceil(h * 2 - 1e-9) / 2);
  return Math.round(h * 100) / 100;
}

export const fmtH = (h) => `${(Math.round(h * 100) / 100).toString().replace('.', ',')} h`;

export function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

export function mondayOf(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (x.getDay() + 6) % 7; // lundi = 0
  x.setDate(x.getDate() - day);
  return x;
}

// Durée en heures entre deux "HH:MM" (gère le passage de minuit)
export function hoursBetween(a, b) {
  const [ah, am] = a.split(':').map(Number);
  const [bh, bm] = b.split(':').map(Number);
  let m = bh * 60 + bm - (ah * 60 + am);
  if (m < 0) m += 24 * 60;
  return m / 60;
}

// Nom de fichier facture : NOM JURIDIQUE + NUMERO, majuscules, sans caractères interdits.
export function invoiceFileName(name, number) {
  const clean = (s) =>
    String(s || '')
      .replace(/[\\/:*?"<>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
  return `${clean(name)} ${clean(number)}`.trim().replace(/\s+/g, ' ') + '.pdf';
}
