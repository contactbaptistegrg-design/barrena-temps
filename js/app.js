import { CONFIG } from './config.js';
import * as DB from './db.js';
import * as B from './backend.js';
import * as Lock from './lock.js';
import * as Sync from './sync.js';
import { mountInvoices } from './invoice.js';
import { MODES, roundHours, fmtH, fmtClock, ymd, hm, pad, mondayOf, hoursBetween } from './time.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const S = {
  tab: 'chrono',
  ref: { projects: [], stages: CONFIG.DEFAULT_STAGES, hors: CONFIG.DEFAULT_HORS, products: [], at: null },
  settings: { round: 'half', reminder: CONFIG.REMINDER_HOURS ?? 4 },
  timer: null,
  entries: [],
  sel: { mode: 'project', project: null, stage: null, cat: null },
  showDone: false,
  queueCount: 0,
  syncing: false,
  lastSync: null,
  noteDraft: null,
  lockedAt: null,
};
S.settings.reminder = CONFIG.REMINDER_HOURS ?? 4;

// ---------- utilitaires UI ----------
function toast(msg, ms = 3200) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  const box = $('#toasts');
  while (box.children.length >= 2) box.firstChild.remove();
  box.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

function modal(html, { onClose } = {}) {
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(m);
  m.close = () => { m.remove(); onClose && onClose(); };
  m.addEventListener('click', (e) => { if (e.target === m && !m.dataset.sticky) m.close(); });
  return m;
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const isHorsName = (n) => n === CONFIG.HORS_PROJET_NAME;

async function persist() {
  await DB.kvSet('timer', S.timer);
  await DB.kvSet('settings', S.settings);
  await DB.kvSet('entries', S.entries);
}

async function updateQueueCount() {
  S.queueCount = (await DB.qAll()).length;
  const b = $('#syncbadge');
  if (b) { b.textContent = S.queueCount || ''; b.hidden = !S.queueCount; }
}

// ---------- compteurs ----------
function sums() {
  const today = ymd(new Date());
  const mon = ymd(mondayOf(new Date()));
  let d = 0, w = 0;
  for (const e of S.entries) {
    if (e.date === today) d += e.hours;
    if (e.date >= mon) w += e.hours;
  }
  if (S.timer && S.timer.mode !== 'none') {
    const h = elapsed(S.timer) / 3600000;
    const sd = ymd(new Date(S.timer.startTs));
    if (sd === today) d += h;
    if (sd >= mon) w += h;
  }
  return { d, w };
}

const elapsed = (t, now = Date.now()) => (t.pausedAt || now) - t.startTs - t.pausedMs;

// ---------- navigation ----------
const TABS = [
  ['chrono', 'Chrono', '<path d="M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18zM9 1h6"/>'],
  ['manual', 'Après coup', '<path d="M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4"/>'],
  ['notes', 'Notes', '<path d="M5 4h14v12H9l-4 4V4zM8 9h8M8 12h5"/>'],
  ['invoices', 'Factures', '<path d="M6 3h9l4 4v14H6V3zM9 12h7M9 16h7M9 8h3"/>'],
  ['bilan', 'Bilan', '<path d="M5 20V10M12 20V4M19 20v-7"/>'],
];

function renderShell() {
  $('#app').innerHTML = `
    <header class="top">
      <img src="icons/logo.png" alt="" class="logo">
      <div class="brand"><b>BARRENA</b><span>Suivi du temps</span></div>
      <button id="synctop" class="iconbtn" aria-label="Synchroniser">
        <svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 01-14 5.3M4 12a8 8 0 0114-5.3M18 3v4h-4M6 21v-4h4"/></svg>
        <span id="syncbadge" class="badge" hidden></span>
      </button>
    </header>
    <div id="netbar" class="netbar" hidden>Hors ligne : tes saisies sont gardées sur le téléphone</div>
    <main id="view"></main>
    <nav class="tabs">${TABS.map(([k, l, p]) => `<button data-tab="${k}" class="${S.tab === k ? 'on' : ''}"><svg viewBox="0 0 24 24">${p}</svg><span>${l}</span></button>`).join('')}</nav>`;
  $('#netbar').hidden = navigator.onLine;
  updateQueueCount();
}

function setTab(t) {
  S.tab = t;
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  renderView();
}

function renderView() {
  const v = $('#view');
  if (!v) return;
  v.innerHTML = '';
  const fn = { chrono: viewChrono, manual: viewManual, notes: viewNotes, invoices: viewInvoices, bilan: viewBilan }[S.tab];
  fn(v);
}

// ---------- CHRONO ----------
function counterBar() {
  const { d, w } = sums();
  return `<div class="counters"><div><small>Aujourd'hui</small><b id="cnt-d">${fmtH(d)}</b></div><div><small>Cette semaine</small><b id="cnt-w">${fmtH(w)}</b></div></div>`;
}

function viewChrono(v) {
  if (S.timer) return viewRunning(v);
  const { ref, sel } = S;
  const projects = ref.projects.filter((p) => S.showDone || !/termin|clos|annul/i.test(p.status));
  v.innerHTML = `
    ${counterBar()}
    <div class="seg" role="group"><button class="${sel.mode === 'project' ? 'on' : ''}" data-act="mode" data-v="project">Projet</button><button class="${sel.mode === 'hors' ? 'on' : ''}" data-act="mode" data-v="hors">Hors projet</button></div>
    ${sel.mode === 'project' ? `
      <input id="psearch" class="search" type="search" placeholder="Chercher un projet…" autocomplete="off">
      <div class="chips" id="plist">
        ${projects.map((p) => `<button class="chip ${sel.project === p.name ? 'on' : ''}" data-act="pick-project" data-v="${esc(p.name)}" data-s="${esc(p.name.toLowerCase())}">${esc(p.name)}${p.client ? `<small>${esc(p.client)}</small>` : ''}</button>`).join('') || '<p class="muted">Aucun projet en cache. Synchronise ou ajoute un projet.</p>'}
      </div>
      <div class="row"><button class="btn ghost sm" data-act="new-project">+ Nouveau projet</button><label class="check"><input type="checkbox" id="showdone" ${S.showDone ? 'checked' : ''}> Projets terminés</label></div>
      <h3>Étape</h3>
      <div class="grid">${ref.stages.map(([n, c]) => `<button class="stage ${sel.stage === n ? 'on' : ''}" data-act="pick-stage" data-v="${esc(n)}">${esc(n)}${c ? '<i title="Produit consommé">●</i>' : ''}</button>`).join('')}</div>`
    : `
      <h3>Catégorie</h3>
      <div class="grid one">${ref.hors.map((n) => `<button class="stage ${sel.cat === n ? 'on' : ''}" data-act="pick-cat" data-v="${esc(n)}">${esc(n)}</button>`).join('')}</div>`}
    <button id="startbtn" class="btn big" data-act="start" ${canStart() ? '' : 'disabled'}>Démarrer</button>`;
  const ps = $('#psearch');
  if (ps) ps.addEventListener('input', () => {
    const q = ps.value.trim().toLowerCase();
    document.querySelectorAll('#plist .chip').forEach((c) => { c.hidden = q && !c.dataset.s.includes(q); });
  });
  const sd = $('#showdone');
  if (sd) sd.addEventListener('change', () => { S.showDone = sd.checked; renderView(); });
}

const canStart = () => (S.sel.mode === 'project' ? S.sel.project && S.sel.stage : S.sel.cat);

function viewRunning(v) {
  const t = S.timer;
  const start = new Date(t.startTs);
  v.innerHTML = `
    ${counterBar()}
    <div class="running ${t.pausedAt ? 'paused' : ''}">
      <div class="who">${esc(t.project)}</div>
      <div class="what">${esc(t.stage)}</div>
      <div class="clock" id="clock">${fmtClock(elapsed(t))}</div>
      <div class="since">Démarré à ${hm(start)} · ${t.pausedAt ? 'en pause' : 'en cours'}</div>
    </div>
    <div class="row two">
      <button class="btn ghost" data-act="pause">${t.pausedAt ? 'Reprendre' : 'Pause'}</button>
      <button class="btn ghost" data-act="quicknote">Note / photo</button>
    </div>
    <button class="btn big" data-act="stop">Arrêter</button>
    <button class="link" data-act="discard">Annuler ce chrono</button>`;
}

function startTimer() {
  const { sel } = S;
  const now = Date.now();
  S.timer = sel.mode === 'project'
    ? { mode: 'project', project: sel.project, stage: sel.stage, startTs: now, pausedAt: null, pausedMs: 0, remindedAt: 0 }
    : { mode: 'hors', project: CONFIG.HORS_PROJET_NAME, stage: sel.cat, startTs: now, pausedAt: null, pausedMs: 0, remindedAt: 0 };
  DB.kvSet('lastSel', S.sel);
  persist();
  renderView();
}

function togglePause() {
  const t = S.timer;
  if (t.pausedAt) { t.pausedMs += Date.now() - t.pausedAt; t.pausedAt = null; }
  else t.pausedAt = Date.now();
  persist();
  renderView();
}

// ---------- saisie du produit consommé ----------
const stageConsumes = (name) => !!S.ref.stages.find(([n]) => n === name)?.[1];

function productBlock(stage) {
  if (!stageConsumes(stage)) return '';
  const opts = S.ref.products.map((p, i) => `<option value="${i}">${esc(p.name)}${p.ref ? ' · ' + esc(p.ref) : ''} (${p.price.toFixed(2).replace('.', ',')} €/L)</option>`).join('');
  return `<fieldset class="prod"><legend>Produit consommé (option)</legend>
    <select id="prod-sel"><option value="">Aucun produit</option>${opts}</select>
    <div class="inline"><input id="prod-qty" type="text" inputmode="decimal" autocomplete="off" placeholder="Quantité (L), ex. 0,8"><span id="prod-cost" class="muted"></span></div>
    ${S.ref.products.length ? '' : '<small class="muted">Aucun produit dans l\'onglet « App » du tableau de bord.</small>'}
  </fieldset>`;
}

function readProduct(root, stage) {
  if (!stageConsumes(stage)) return {};
  const i = $('#prod-sel', root)?.value;
  const qty = parseFloat(String($('#prod-qty', root)?.value || '').replace(',', '.'));
  if (i === '' || i === undefined || !qty) return {};
  const p = S.ref.products[+i];
  return { product: p.ref ? `${p.name} ${p.ref}` : p.name, qty, cost: Math.round(qty * p.price * 100) / 100 };
}

function bindProduct(root) {
  const upd = () => {
    const i = $('#prod-sel', root)?.value;
    const qty = parseFloat(String($('#prod-qty', root)?.value || '').replace(',', '.'));
    const c = $('#prod-cost', root);
    if (c) c.textContent = i !== '' && qty ? `≈ ${(qty * S.ref.products[+i].price).toFixed(2).replace('.', ',')} €` : '';
  };
  $('#prod-sel', root)?.addEventListener('change', upd);
  $('#prod-qty', root)?.addEventListener('input', upd);
}

// ---------- enregistrement d'une session ----------
async function saveSession({ date, project, stage, start, end, realH, mode, desc, prod }) {
  const hours = roundHours(realH, mode);
  const row = {
    date, project, stage, start, end,
    realH: Math.round(realH * 100) / 100,
    hours, modeLabel: MODES[mode], desc: desc || '',
    product: prod.product || '', qty: prod.qty, cost: prod.cost,
  };
  const id = uid();
  await DB.qAdd({ type: 'time', uid: id, row });
  S.entries.push({ uid: id, date, project, stage, hours });
  S.entries = S.entries.slice(-400);
  await persist();
  await updateQueueCount();
  toast(`Enregistré : ${fmtH(hours)} · ${stage}`);
  maybeAutoSync();
}

function openStopSheet() {
  const t = S.timer;
  const now = Date.now();
  const realMs = elapsed(t, now);
  const realH = realMs / 3600000;
  const m = modal(`
    <h2>Terminer</h2>
    <p class="muted">${esc(t.project)} · ${esc(t.stage)}<br>${hm(new Date(t.startTs))} → ${hm(new Date(now))} · temps réel ${fmtClock(realMs)}</p>
    <div class="radios">${Object.entries(MODES).map(([k, l]) => `<label><input type="radio" name="mode" value="${k}" ${S.settings.round === k ? 'checked' : ''}><span>${l}</span><b>${fmtH(roundHours(realH, k))}</b></label>`).join('')}</div>
    <label class="field">Description (option)<input id="desc" type="text" autocomplete="off" placeholder="Ex. portes cuisine"></label>
    ${productBlock(t.stage)}
    <div class="row two"><button class="btn ghost" data-x="close">Continuer le chrono</button><button class="btn" data-x="save">Enregistrer</button></div>`);
  m.dataset.sticky = '1';
  bindProduct(m);
  if (t.pausedAt === null) { /* le temps continue de courir tant que la fenêtre est ouverte : on fige à l'ouverture */ }
  m.addEventListener('click', async (e) => {
    const x = e.target.dataset?.x;
    if (x === 'close') m.close();
    if (x === 'save') {
      const mode = $('input[name=mode]:checked', m).value;
      S.settings.round = mode;
      if (realMs < 30000 && !confirm('Moins de 30 secondes. Enregistrer quand même ?')) return;
      await saveSession({
        date: ymd(new Date(t.startTs)), project: t.project, stage: t.stage,
        start: hm(new Date(t.startTs)), end: hm(new Date(now)), realH, mode,
        desc: $('#desc', m).value.trim(), prod: readProduct(m, t.stage),
      });
      if (t.mode === 'project') { S.sel = { mode: 'project', project: t.project, stage: null, cat: null }; }
      S.timer = null;
      await persist();
      m.close();
      renderView();
    }
  });
}

// ---------- nouveau projet ----------
function openNewProject() {
  const m = modal(`
    <h2>Nouveau projet</h2>
    <label class="field">Nom du projet<input id="np-name" type="text" autocomplete="off" placeholder="Ex. Cocina Marta"></label>
    <label class="field">Client (option)<input id="np-client" type="text" autocomplete="off"></label>
    <p class="muted">Il sera ajouté à l'onglet « Projets » du tableau de bord à la prochaine synchronisation, avec le statut « En cours ».</p>
    <div class="row two"><button class="btn ghost" data-x="close">Annuler</button><button class="btn" data-x="ok">Ajouter</button></div>`);
  setTimeout(() => $('#np-name', m).focus(), 50);
  m.addEventListener('click', async (e) => {
    const x = e.target.dataset?.x;
    if (x === 'close') m.close();
    if (x === 'ok') {
      const name = $('#np-name', m).value.trim().replace(/\s+/g, ' ');
      if (!name) return toast('Donne un nom au projet');
      if (S.ref.projects.some((p) => p.name.toLowerCase() === name.toLowerCase())) return toast('Ce projet existe déjà');
      S.ref.projects.unshift({ name, client: $('#np-client', m).value.trim(), status: 'En cours', local: true });
      await DB.kvSet('ref', S.ref);
      await DB.qAdd({ type: 'project', name, client: $('#np-client', m).value.trim(), date: ymd(new Date()) });
      S.sel.project = name;
      await updateQueueCount();
      m.close();
      renderView();
      maybeAutoSync();
    }
  });
}

// ---------- SAISIE APRÈS COUP ----------
function projectOptions(selected) {
  return `<option value="">Choisir…</option><option value="${esc(CONFIG.HORS_PROJET_NAME)}" ${selected === CONFIG.HORS_PROJET_NAME ? 'selected' : ''}>— ${CONFIG.HORS_PROJET_NAME} —</option>` +
    S.ref.projects.map((p) => `<option ${selected === p.name ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
}

function viewManual(v) {
  const now = new Date();
  v.innerHTML = `
    <h2>Saisie après coup</h2>
    <label class="field">Date<input id="m-date" type="date" value="${ymd(now)}"></label>
    <label class="field">Projet<select id="m-proj">${projectOptions(S.sel.project)}</select></label>
    <label class="field"><span id="m-stage-l">Étape</span><select id="m-stage"></select></label>
    <div class="two-col">
      <label class="field">Début<input id="m-start" type="time" value="08:00"></label>
      <label class="field">Fin<input id="m-end" type="time" value="${hm(now)}"></label>
    </div>
    <div class="muted" id="m-dur"></div>
    <label class="field">Calcul du temps<select id="m-mode">${Object.entries(MODES).map(([k, l]) => `<option value="${k}" ${S.settings.round === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="field">Description (option)<input id="m-desc" type="text" autocomplete="off"></label>
    <div id="m-prod"></div>
    <button class="btn big" data-act="manual-save">Enregistrer</button>`;
  const stageSel = $('#m-stage', v);
  const fillStages = () => {
    const hors = $('#m-proj', v).value === CONFIG.HORS_PROJET_NAME;
    $('#m-stage-l', v).textContent = hors ? 'Catégorie' : 'Étape';
    const list = hors ? S.ref.hors : S.ref.stages.map(([n]) => n);
    stageSel.innerHTML = '<option value="">Choisir…</option>' + list.map((n) => `<option ${n === S.sel.stage && !hors ? 'selected' : ''}>${esc(n)}</option>`).join('');
    fillProd();
  };
  const fillProd = () => {
    const box = $('#m-prod', v);
    box.innerHTML = $('#m-proj', v).value === CONFIG.HORS_PROJET_NAME ? '' : productBlock(stageSel.value);
    bindProduct(box);
  };
  const dur = () => {
    const h = hoursBetween($('#m-start', v).value || '00:00', $('#m-end', v).value || '00:00');
    const mode = $('#m-mode', v).value;
    $('#m-dur', v).textContent = `Durée réelle ${fmtH(h)} → comptée ${fmtH(roundHours(h, mode))}`;
  };
  $('#m-proj', v).addEventListener('change', fillStages);
  stageSel.addEventListener('change', fillProd);
  ['m-start', 'm-end', 'm-mode'].forEach((id) => $('#' + id, v).addEventListener('input', dur));
  fillStages();
  dur();
}

async function manualSave() {
  const v = $('#view');
  const project = $('#m-proj', v).value, stage = $('#m-stage', v).value;
  if (!project || !stage) return toast('Choisis un projet et une étape');
  const start = $('#m-start', v).value, end = $('#m-end', v).value;
  if (!start || !end) return toast('Renseigne début et fin');
  const realH = hoursBetween(start, end);
  if (realH <= 0) return toast('Durée nulle');
  const mode = $('#m-mode', v).value;
  S.settings.round = mode;
  await saveSession({ date: $('#m-date', v).value, project, stage, start, end, realH, mode, desc: $('#m-desc', v).value.trim(), prod: readProduct($('#m-prod', v), stage) });
  if (S.tab === 'manual') renderView();
}

// ---------- NOTES + PHOTO ----------
async function compressPhoto(file, max = 1600) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { bmp = await new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = URL.createObjectURL(file); }); }
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
}

function viewNotes(v) {
  const d = S.noteDraft || {};
  const proj = d.project || (S.timer && !isHorsName(S.timer.project) ? S.timer.project : S.sel.project) || '';
  v.innerHTML = `
    <h2>Note ou photo</h2>
    <p class="muted">Difficulté, défaut de matière… La note arrive dans l'onglet « Notes projets » ; la photo est rangée dans Drive.</p>
    <label class="field">Projet<select id="n-proj">${projectOptions(proj)}</select></label>
    <label class="field">Étape (option)<select id="n-stage"><option value="">—</option>${S.ref.stages.map(([n]) => `<option ${(d.stage || S.timer?.stage) === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
    <label class="field">Note<textarea id="n-text" rows="4" placeholder="Ex. planche fendue, panneau reçu rayé…">${esc(d.text || '')}</textarea></label>
    <div id="n-prev" class="photoprev"></div>
    <div class="row"><label class="btn ghost" for="n-cam">Prendre une photo</label><label class="btn ghost" for="n-file">Galerie</label></div>
    <input id="n-cam" type="file" accept="image/*" capture="environment" hidden><input id="n-file" type="file" accept="image/*" hidden>
    <button class="btn big" data-act="note-save">Enregistrer la note</button>`;
  let photo = null;
  const setPhoto = async (f) => {
    if (!f) return;
    photo = await compressPhoto(f);
    $('#n-prev', v).innerHTML = `<img src="${URL.createObjectURL(photo)}" alt="Photo jointe"><button class="x" data-act="photo-x">×</button>`;
  };
  $('#n-cam', v).addEventListener('change', (e) => setPhoto(e.target.files[0]));
  $('#n-file', v).addEventListener('change', (e) => setPhoto(e.target.files[0]));
  v.__getPhoto = () => photo;
  v.__clearPhoto = () => { photo = null; $('#n-prev', v).innerHTML = ''; };
}

async function noteSave() {
  const v = $('#view');
  const project = $('#n-proj', v).value, text = $('#n-text', v).value.trim(), photo = v.__getPhoto();
  if (!project) return toast('Choisis un projet');
  if (!text && !photo) return toast('Ajoute une note ou une photo');
  const now = new Date();
  await DB.qAdd({ type: 'note', project, stage: $('#n-stage', v).value, text, photo, photoName: photo ? `${ymd(now)}_${pad(now.getHours())}h${pad(now.getMinutes())}.jpg` : null, date: ymd(now), time: hm(now) });
  S.noteDraft = null;
  await updateQueueCount();
  toast('Note enregistrée');
  if (S.tab === 'notes') renderView();
  maybeAutoSync();
}

// ---------- FACTURES ----------
function viewInvoices(v) {
  const box = document.createElement('div');
  v.appendChild(box);
  mountInvoices(box, {
    toast,
    onSave: async (op) => {
      await DB.qAdd(op);
      await updateQueueCount();
      toast('Facture enregistrée (envoi à la synchro)');
      maybeAutoSync();
    },
  });
}

// ---------- BILAN / RÉGLAGES ----------
async function viewBilan(v) {
  const { d, w } = sums();
  const q = await DB.qAll();
  const recent = S.entries.slice(-8).reverse();
  const bio = await Lock.hasBio();
  const bioOk = await Lock.bioSupported();
  v.innerHTML = `
    ${counterBar()}
    <h3>À envoyer</h3>
    ${q.length ? `<ul class="list">${q.map((o) => `<li><b>${{ time: 'Temps', project: 'Projet', note: 'Note', invoice: 'Facture' }[o.type]}</b> ${esc(o.type === 'time' ? `${o.row.project} · ${o.row.stage} · ${fmtH(o.row.hours)}` : o.type === 'project' ? o.name : o.type === 'note' ? o.project : o.filename)}${o.error ? `<em class="err">${esc(o.error)}</em>` : ''}</li>`).join('')}</ul>` : '<p class="muted">Tout est synchronisé.</p>'}
    <button class="btn big" data-act="sync">Synchroniser maintenant</button>
    <p class="muted small">${S.lastSync ? 'Dernière synchro : ' + new Date(S.lastSync).toLocaleString('fr-FR') : 'Jamais synchronisé'}${B.hasConn() ? ' · script connecté' : ' · script non configuré'}</p>
    <h3>Dernières saisies</h3>
    ${recent.length ? `<ul class="list">${recent.map((e) => `<li><b>${fmtH(e.hours)}</b> ${esc(e.project)} · ${esc(e.stage)} <small>${e.date}</small></li>`).join('')}</ul>` : '<p class="muted">Rien pour l\'instant.</p>'}
    <h3>Réglages</h3>
    <label class="field">Calcul du temps par défaut<select id="s-round">${Object.entries(MODES).map(([k, l]) => `<option value="${k}" ${S.settings.round === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="field">Rappel si le chrono dépasse (heures)<input id="s-rem" type="number" min="0.5" step="0.5" value="${S.settings.reminder}"></label>
    <div class="row"><button class="btn ghost sm" data-act="notif">Autoriser les notifications</button><button class="btn ghost sm" data-act="chgpin">Changer le code</button></div>
    ${bioOk ? `<div class="row"><button class="btn ghost sm" data-act="bio">${bio ? 'Désactiver' : 'Activer'} l'empreinte / schéma du téléphone</button></div>` : ''}
    <div class="row"><button class="btn ghost sm" data-act="lock">Verrouiller maintenant</button><button class="btn ghost sm" data-act="conn">Connexion au script</button></div>
    <p class="muted small">Version ${CONFIG.VERSION}. Les compteurs ne comptent que les saisies faites avec cette app.</p>`;
  $('#s-round', v).addEventListener('change', (e) => { S.settings.round = e.target.value; persist(); });
  $('#s-rem', v).addEventListener('change', (e) => { S.settings.reminder = Math.max(0.5, +e.target.value || 4); persist(); });
}

// ---------- SYNCHRO ----------
let autoTimer = null;
function maybeAutoSync() {
  if (!navigator.onLine || !B.hasConn()) return;
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => doSync(false), 800);
}

async function doSync(manual = true) {
  if (S.syncing) return;
  if (!navigator.onLine) { if (manual) toast('Pas de réseau pour l\'instant'); return; }
  S.syncing = true;
  $('#synctop')?.classList.add('spin');
  try {
    if (!B.hasConn()) { S.syncing = false; $('#synctop')?.classList.remove('spin'); openConn(); return; }
    const res = await Sync.flushQueue();
    const ref = await Sync.refreshRef();
    S.ref = { ...S.ref, projects: ref.projects.length ? mergeLocal(ref.projects) : S.ref.projects, at: ref.at };
    if (ref.stages?.length) S.ref.stages = ref.stages;
    if (ref.hors) S.ref.hors = ref.hors.length ? ref.hors : S.ref.hors;
    if (ref.products) S.ref.products = ref.products;
    await DB.kvSet('ref', S.ref);
    S.lastSync = Date.now();
    await DB.kvSet('lastSync', S.lastSync);
    const msgs = [];
    if (res.sent) msgs.push(`${res.sent} envoyé${res.sent > 1 ? 's' : ''}`);
    if (res.failed) msgs.push(`${res.failed} en erreur`);
    res.warnings.concat(ref.warnings).forEach((w) => toast(w, 7000));
    toast(msgs.length ? 'Synchro : ' + msgs.join(', ') : 'Synchro terminée', 3500);
    if (res.failed) toast(res.errors[0], 6000);
  } catch (e) {
    toast(e.auth || /Réseau/.test(e.message) ? e.message : 'Synchro impossible : ' + e.message, 5000);
  } finally {
    S.syncing = false;
    $('#synctop')?.classList.remove('spin');
    await updateQueueCount();
    if (S.tab !== 'notes' && S.tab !== 'invoices' && S.tab !== 'manual') renderView();
  }
}

// garde les projets créés localement pas encore présents dans la feuille
function mergeLocal(remote) {
  const names = new Set(remote.map((p) => p.name.toLowerCase()));
  const locals = S.ref.projects.filter((p) => p.local && !names.has(p.name.toLowerCase()));
  return [...locals, ...remote];
}

// ---------- CONNEXION AU SCRIPT ----------
function openConn() {
  const c = B.getConn() || {};
  const m = modal(`
    <h2>Connexion au script</h2>
    <p class="muted">Adresse de l'application Web (déploiement du script) et ta clé personnelle. Voir le guide, étape 2.</p>
    <label class="field">Adresse du script<input id="c-url" type="url" autocomplete="off" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(c.url || '')}"></label>
    <label class="field">Clé<input id="c-key" type="password" autocomplete="off" value="${esc(c.key || '')}"></label>
    <div class="row two"><button class="btn ghost" data-x="c">Annuler</button><button class="btn" data-x="ok">Tester et enregistrer</button></div>`);
  m.dataset.sticky = '1';
  m.addEventListener('click', async (e) => {
    const x = e.target.dataset?.x;
    if (x === 'c') m.close();
    if (x === 'ok') {
      const url = $('#c-url', m).value.trim(), key = $('#c-key', m).value.trim();
      if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) return toast("L'adresse doit commencer par https://script.google.com/");
      if (!key) return toast('Saisis ta clé');
      const prev = B.getConn();
      await B.saveConn({ url, key });
      try {
        await B.call('ping');
        toast('Connexion réussie');
        m.close();
        renderView();
        doSync(false);
      } catch (err) {
        if (prev) await B.saveConn(prev); else await B.clearConn();
        toast(err.message, 6000);
      }
    }
  });
}

// ---------- RAPPELS ----------
function tick() {
  const t = S.timer;
  const c = $('#clock');
  if (t && c) c.textContent = fmtClock(elapsed(t));
  if (t) {
    const { d, w } = sums();
    if ($('#cnt-d')) $('#cnt-d').textContent = fmtH(d);
    if ($('#cnt-w')) $('#cnt-w').textContent = fmtH(w);
    checkReminder();
  }
}

function checkReminder() {
  const t = S.timer;
  if (!t || t.pausedAt) return;
  const limit = S.settings.reminder * 3600000;
  const e = elapsed(t);
  const next = (t.remindedAt || 0) + limit;
  if (e >= Math.max(limit, next) && !document.querySelector('.modal.reminder')) {
    t.remindedAt = e;
    persist();
    const m = modal(`<h2>Chrono long</h2><p>« ${esc(t.project)} · ${esc(t.stage)} » tourne depuis ${fmtClock(e)}. Tu l'as peut-être oublié.</p><div class="row two"><button class="btn ghost" data-x="c">Je continue</button><button class="btn" data-x="s">Arrêter</button></div>`);
    m.classList.add('reminder');
    m.addEventListener('click', (ev) => { const x = ev.target.dataset?.x; if (x) { m.close(); if (x === 's') { setTab('chrono'); openStopSheet(); } } });
    try { navigator.vibrate?.([200, 100, 200]); } catch {}
    if (Notification?.permission === 'granted' && document.hidden) {
      navigator.serviceWorker?.ready.then((r) => r.showNotification('Barrena · chrono long', { body: `${t.project} · ${t.stage} depuis ${fmtClock(e)}`, icon: 'icons/icon-192.png', tag: 'long' }));
    }
  }
}

// ---------- ACTIONS (délégation) ----------
document.addEventListener('click', async (e) => {
  const tab = e.target.closest('[data-tab]');
  if (tab) return setTab(tab.dataset.tab);
  if (e.target.closest('#synctop')) return doSync(true);
  const b = e.target.closest('[data-act]');
  if (!b || b.closest('.crop-overlay') || b.closest('#invoices-root')) return;
  const act = b.dataset.act, val = b.dataset.v;
  switch (act) {
    case 'mode': S.sel.mode = val; renderView(); break;
    case 'pick-project': S.sel.project = val; renderView(); break;
    case 'pick-stage': S.sel.stage = val; renderView(); break;
    case 'pick-cat': S.sel.cat = val; renderView(); break;
    case 'new-project': openNewProject(); break;
    case 'start': startTimer(); break;
    case 'pause': togglePause(); break;
    case 'stop': openStopSheet(); break;
    case 'discard': if (confirm('Annuler ce chrono sans l\'enregistrer ?')) { S.timer = null; persist(); renderView(); } break;
    case 'quicknote': S.noteDraft = { project: S.timer.project, stage: S.timer.stage }; setTab('notes'); break;
    case 'manual-save': manualSave(); break;
    case 'note-save': noteSave(); break;
    case 'photo-x': $('#view').__clearPhoto(); break;
    case 'sync': doSync(true); break;
    case 'notif': { const p = await Notification.requestPermission(); toast(p === 'granted' ? 'Notifications autorisées' : 'Notifications refusées'); break; }
    case 'lock': showLock(); break;
    case 'conn': openConn(); break;
    case 'chgpin': changePin(); break;
    case 'bio': {
      try {
        if (await Lock.hasBio()) await Lock.disableBio(); else await Lock.enableBio();
        toast('Réglage enregistré');
      } catch (err) { toast('Impossible : ' + err.message); }
      renderView();
      break;
    }
  }
});

// ---------- VERROUILLAGE ----------
function lockScreen(html) {
  let el = $('#lock');
  if (!el) { el = document.createElement('div'); el.id = 'lock'; document.body.appendChild(el); }
  el.innerHTML = `<div class="lockbox"><img src="icons/logo.png" alt="" class="biglogo"><h1>BARRENA</h1><p class="muted">Suivi du temps</p>${html}</div>`;
  return el;
}
const unlock = () => { $('#lock')?.remove(); S.lockedAt = null; };

async function showLock(autoBio = true) {
  const hasBio = await Lock.hasBio();
  const el = lockScreen(`
    <input id="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="Code" autocomplete="off" aria-label="Code">
    <button class="btn big" id="pin-ok">Ouvrir</button>
    ${hasBio ? '<button class="btn ghost" id="bio-ok">Empreinte / schéma du téléphone</button>' : ''}
    <p id="lock-msg" class="err"></p>`);
  const msg = $('#lock-msg', el);
  const tryPin = async () => {
    const fails = await Lock.failCount();
    if (fails >= 5) { msg.textContent = 'Trop d\'essais. Utilise l\'empreinte ou attends.'; await new Promise((r) => setTimeout(r, Math.min(30000, fails * 2000))); }
    if (await Lock.checkPin($('#pin', el).value)) unlock();
    else { msg.textContent = 'Code incorrect'; $('#pin', el).value = ''; }
  };
  $('#pin-ok', el).onclick = tryPin;
  $('#pin', el).addEventListener('keydown', (e) => { if (e.key === 'Enter') tryPin(); });
  if (hasBio) {
    const go = async () => { if (await Lock.verifyBio()) unlock(); else msg.textContent = 'Empreinte non reconnue'; };
    $('#bio-ok', el).onclick = go;
    if (autoBio) go();
  }
}

async function firstSetup() {
  const el = lockScreen(`
    <h2>Protège l'application</h2>
    <p class="muted">Choisis un code de 4 à 6 chiffres. Il sert de secours à l'empreinte.</p>
    <input id="pin1" type="password" inputmode="numeric" maxlength="6" placeholder="Code" autocomplete="off">
    <input id="pin2" type="password" inputmode="numeric" maxlength="6" placeholder="Confirmer le code" autocomplete="off">
    <button class="btn big" id="pin-set">Valider</button><p id="lock-msg" class="err"></p>`);
  $('#pin-set', el).onclick = async () => {
    const a = $('#pin1', el).value, b = $('#pin2', el).value;
    if (!/^\d{4,6}$/.test(a)) return ($('#lock-msg', el).textContent = '4 à 6 chiffres');
    if (a !== b) return ($('#lock-msg', el).textContent = 'Les codes ne correspondent pas');
    await Lock.setPin(a);
    if (await Lock.bioSupported()) {
      try { await Lock.enableBio(); toast('Empreinte / schéma activé'); } catch { toast('Empreinte non activée (réglable dans Bilan)'); }
    }
    unlock();
  };
}

async function changePin() {
  const m = modal(`<h2>Nouveau code</h2><input id="np1" type="password" inputmode="numeric" maxlength="6" placeholder="4 à 6 chiffres"><div class="row two"><button class="btn ghost" data-x="c">Annuler</button><button class="btn" data-x="ok">Enregistrer</button></div>`);
  m.addEventListener('click', async (e) => {
    const x = e.target.dataset?.x;
    if (x === 'c') m.close();
    if (x === 'ok') { const p = $('#np1', m).value; if (!/^\d{4,6}$/.test(p)) return toast('4 à 6 chiffres'); await Lock.setPin(p); m.close(); toast('Code modifié'); }
  });
}

// ---------- DÉMARRAGE ----------
async function boot() {
  await B.loadConn();
  S.ref = { ...S.ref, ...(await DB.kvGet('ref', {})) };
  if (!S.ref.stages?.length) S.ref.stages = CONFIG.DEFAULT_STAGES;
  if (!S.ref.hors?.length) S.ref.hors = CONFIG.DEFAULT_HORS;
  S.settings = { ...S.settings, ...(await DB.kvGet('settings', {})) };
  S.timer = await DB.kvGet('timer', null);
  S.entries = await DB.kvGet('entries', []);
  S.lastSync = await DB.kvGet('lastSync', null);
  const last = await DB.kvGet('lastSel', null);
  if (last) S.sel = { ...S.sel, ...last };
  renderShell();
  renderView();
  if (await Lock.hasPin()) showLock(); else await firstSetup();

  setInterval(tick, 1000);
  window.addEventListener('online', () => { $('#netbar').hidden = true; maybeAutoSync(); });
  window.addEventListener('offline', () => { $('#netbar').hidden = false; });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) S.lockedAt = Date.now();
    else {
      if (S.lockedAt && Date.now() - S.lockedAt > CONFIG.LOCK_AFTER_BACKGROUND_SECONDS * 1000 && !$('#lock')) showLock();
      tick();
    }
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

boot();
window.__barrena = { S, doSync }; // pour les tests
