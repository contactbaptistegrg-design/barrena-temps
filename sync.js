// Synchronisation : envoie la file d'attente au script Google et rafraîchit les listes.
import { CONFIG } from './config.js';
import * as DB from './db.js';
import * as B from './backend.js';

const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(/[^\d,.\-]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

export async function refreshRef() {
  const r = await B.call('ref');
  return {
    at: Date.now(),
    projects: r.projects || [],
    stages: (r.stages || []).map(([n, c]) => [n, !!c]),
    hors: r.hors || [],
    products: (r.products || []).map((p) => ({ ...p, price: num(p.price) })),
    warnings: r.warnings || [],
  };
}

// Exécute une opération de la file. Renvoie un éventuel avertissement (texte).
export async function runOp(op) {
  const base = { uid: op.uid, user: CONFIG.USER };
  let r;
  if (op.type === 'time') r = await B.call('time', { ...base, row: op.row });
  else if (op.type === 'project') r = await B.call('project', { ...base, name: op.name, client: op.client, date: op.date });
  else if (op.type === 'note') {
    r = await B.call('note', {
      ...base, project: op.project, stage: op.stage, text: op.text, date: op.date, time: op.time,
      photoB64: op.photo ? await B.blobToBase64(op.photo) : '', photoName: op.photoName,
    });
  } else if (op.type === 'invoice') {
    r = await B.call('invoice', { ...base, name: op.name, number: op.number, date: op.date, filename: op.filename, pdfB64: await B.blobToBase64(op.pdf) });
  } else throw new Error('Opération inconnue : ' + op.type);
  return r.warning || null;
}

export async function flushQueue() {
  const res = { sent: 0, failed: 0, warnings: [], errors: [] };
  const ops = (await DB.qAll()).sort((a, b) => a.id - b.id);
  for (const op of ops) {
    try {
      const w = await runOp(op);
      if (w) res.warnings.push(w);
      await DB.qDel(op.id);
      res.sent++;
    } catch (e) {
      if (e.auth) throw e;
      res.failed++;
      res.errors.push(e.message);
      op.error = e.message;
      await DB.qPut(op);
    }
  }
  return res;
}
