// Factures : scan (photo → recadrage → noir & blanc) → PDF multi-pages, ou import d'un fichier.
import { invoiceFileName, ymd } from './time.js';

const MAX_SIDE = 2000;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function loadBitmap(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = URL.createObjectURL(file);
    });
  }
}

// Filtres : 'bw' (noir & blanc, fond uniformisé), 'gray', 'color'
export function applyFilter(canvas, mode) {
  if (mode === 'color') return canvas;
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) gray[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  if (mode === 'gray') {
    for (let i = 0, p = 0; i < d.length; i += 4, p++) { d[i] = d[i + 1] = d[i + 2] = gray[p]; }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }
  // Estimation du fond (papier) par blocs, pour corriger les ombres
  const B = 24;
  const bw = Math.ceil(w / B), bh = Math.ceil(h / B);
  const bg = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const vals = [];
      for (let y = by * B; y < Math.min(h, (by + 1) * B); y += 3)
        for (let x = bx * B; x < Math.min(w, (bx + 1) * B); x += 3) vals.push(gray[y * w + x]);
      vals.sort((a, b) => a - b);
      bg[by * bw + bx] = vals[Math.floor(vals.length * 0.85)] || 255; // percentile élevé = papier
    }
  }
  for (let y = 0; y < h; y++) {
    const fy = Math.min(bh - 1, y / B), y0 = Math.floor(fy);
    for (let x = 0; x < w; x++) {
      const fx = Math.min(bw - 1, x / B), x0 = Math.floor(fx);
      const b = bg[y0 * bw + x0] + 1;
      const r = Math.min(1, gray[y * w + x] / b);
      let v;
      if (r < 0.72) v = 0;
      else if (r > 0.9) v = 255;
      else v = ((r - 0.72) / 0.18) * 255;
      const i = (y * w + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function drawCropped(src, rect, maxSide = MAX_SIDE) {
  const sw = rect.w, sh = rect.h;
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * scale));
  c.height = Math.max(1, Math.round(sh * scale));
  c.getContext('2d').drawImage(src, rect.x, rect.y, sw, sh, 0, 0, c.width, c.height);
  return c;
}

// Écran de recadrage : poignées déplaçables aux 4 coins.
function cropScreen(bitmap) {
  return new Promise((resolve) => {
    const iw = bitmap.width, ih = bitmap.height;
    const ov = document.createElement('div');
    ov.className = 'crop-overlay';
    ov.innerHTML = `<div class="crop-bar"><span>Recadre la facture</span></div>
      <div class="crop-stage"><canvas></canvas></div>
      <div class="crop-actions"><button class="btn ghost" data-a="cancel">Annuler</button><button class="btn" data-a="ok">Valider</button></div>`;
    document.body.appendChild(ov);
    const stage = ov.querySelector('.crop-stage');
    const cv = ov.querySelector('canvas');
    const maxW = stage.clientWidth || window.innerWidth, maxH = stage.clientHeight || window.innerHeight * 0.7;
    const k = Math.min(maxW / iw, maxH / ih);
    cv.width = Math.round(iw * k);
    cv.height = Math.round(ih * k);
    const ctx = cv.getContext('2d');
    // rectangle de recadrage en coordonnées canvas
    const m = 0.04;
    const R = { x1: cv.width * m, y1: cv.height * m, x2: cv.width * (1 - m), y2: cv.height * (1 - m) };
    let drag = -1;
    const corners = () => [[R.x1, R.y1], [R.x2, R.y1], [R.x2, R.y2], [R.x1, R.y2]];
    const draw = () => {
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.drawImage(bitmap, 0, 0, cv.width, cv.height);
      const { x1, y1, x2, y2 } = R;
      ctx.fillStyle = 'rgba(38,29,24,.55)';
      ctx.fillRect(0, 0, cv.width, y1);
      ctx.fillRect(0, y2, cv.width, cv.height - y2);
      ctx.fillRect(0, y1, x1, y2 - y1);
      ctx.fillRect(x2, y1, cv.width - x2, y2 - y1);
      ctx.strokeStyle = '#F5E9DE';
      ctx.lineWidth = 2;
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      ctx.fillStyle = '#9C7A54';
      for (const [x, y] of corners()) {
        ctx.beginPath(); ctx.arc(x, y, 14, 0, 7); ctx.fill(); ctx.stroke();
      }
    };
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * (cv.width / r.width), (e.clientY - r.top) * (cv.height / r.height)]; };
    cv.addEventListener('pointerdown', (e) => {
      const p = pos(e);
      let best = -1, bd = 1e9;
      corners().forEach((c, i) => { const dd = Math.hypot(c[0] - p[0], c[1] - p[1]); if (dd < bd) { bd = dd; best = i; } });
      if (bd < 70) { drag = best; cv.setPointerCapture(e.pointerId); }
    });
    cv.addEventListener('pointermove', (e) => {
      if (drag < 0) return;
      const p = pos(e);
      const x = Math.max(0, Math.min(cv.width, p[0])), y = Math.max(0, Math.min(cv.height, p[1]));
      if (drag === 0 || drag === 3) R.x1 = Math.min(x, R.x2 - 30); else R.x2 = Math.max(x, R.x1 + 30);
      if (drag === 0 || drag === 1) R.y1 = Math.min(y, R.y2 - 30); else R.y2 = Math.max(y, R.y1 + 30);
      draw();
    });
    cv.addEventListener('pointerup', () => { drag = -1; });
    draw();
    ov.addEventListener('click', (e) => {
      const a = e.target.dataset?.a;
      if (!a) return;
      if (a === 'cancel') { ov.remove(); resolve(null); return; }
      const x = R.x1 / k, y = R.y1 / k, w = (R.x2 - R.x1) / k, h = (R.y2 - R.y1) / k;
      ov.remove();
      resolve(w < 20 || h < 20 ? { x: 0, y: 0, w: iw, h: ih } : { x, y, w, h });
    });
  });
}

export async function buildPdf(pages) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const PW = 210, PH = 297, M = 8;
  pages.forEach((p, i) => {
    if (i > 0) pdf.addPage();
    const ratio = Math.min((PW - 2 * M) / p.w, (PH - 2 * M) / p.h);
    const w = p.w * ratio, h = p.h * ratio;
    pdf.addImage(p.dataUrl, 'JPEG', (PW - w) / 2, M, w, h, undefined, 'FAST');
  });
  return pdf.output('blob');
}

export function mountInvoices(el, { onSave, toast }) {
  const st = { pages: [], filter: 'bw', imported: null, name: '', number: '' };

  function render() {
    const fname = invoiceFileName(st.name, st.number);
    el.innerHTML = `
      <h2>Facture à envoyer</h2>
      <p class="muted">Scanne la facture (plusieurs pages possibles) ou importe un fichier. Tape seulement le nom juridique et le numéro.</p>
      <div class="seg" role="group" aria-label="Filtre">
        ${[['bw', 'Noir & blanc'], ['gray', 'Gris'], ['color', 'Couleur']].map(([k, l]) => `<button class="${st.filter === k ? 'on' : ''}" data-act="filter" data-v="${k}">${l}</button>`).join('')}
      </div>
      <div class="pages">
        ${st.pages.map((p, i) => `<div class="thumb"><img src="${p.dataUrl}" alt="Page ${i + 1}"><button class="x" data-act="delpage" data-i="${i}" aria-label="Supprimer la page">×</button><span>${i + 1}</span></div>`).join('')}
        ${st.imported ? `<div class="thumb pdf"><b>PDF</b><small>${esc(st.imported.name)}</small><button class="x" data-act="delimport" aria-label="Retirer">×</button></div>` : ''}
      </div>
      <div class="row">
        <label class="btn" for="scan-cam">Scanner une page</label>
        <label class="btn ghost" for="scan-file">Importer</label>
      </div>
      <input id="scan-cam" type="file" accept="image/*" capture="environment" hidden>
      <input id="scan-file" type="file" accept="image/*,application/pdf" hidden>
      <label class="field">Nom juridique du fournisseur
        <input id="inv-name" type="text" autocomplete="off" autocapitalize="characters" value="${esc(st.name)}" placeholder="LARA D FLORMAN CHIARRONE">
      </label>
      <label class="field">Numéro de facture
        <input id="inv-num" type="text" autocomplete="off" autocapitalize="characters" value="${esc(st.number)}" placeholder="TM014394">
      </label>
      <div class="filename">${fname === '.pdf' ? 'Nom du fichier : …' : esc(fname)}</div>
      <button class="btn big" data-act="save" ${(st.pages.length || st.imported) && st.name.trim() && st.number.trim() ? '' : 'disabled'}>Enregistrer la facture</button>`;
    const nm = el.querySelector('#inv-name'), nu = el.querySelector('#inv-num');
    const upd = () => {
      st.name = nm.value; st.number = nu.value;
      el.querySelector('.filename').textContent = invoiceFileName(st.name, st.number) === '.pdf' ? 'Nom du fichier : …' : invoiceFileName(st.name, st.number);
      el.querySelector('[data-act=save]').disabled = !((st.pages.length || st.imported) && st.name.trim() && st.number.trim());
    };
    nm.addEventListener('input', upd);
    nu.addEventListener('input', upd);
    el.querySelector('#scan-cam').addEventListener('change', (e) => addFile(e.target.files[0]));
    el.querySelector('#scan-file').addEventListener('change', (e) => addFile(e.target.files[0]));
  }

  async function addFile(file) {
    if (!file) return;
    if (file.type === 'application/pdf') {
      st.imported = file; st.pages = [];
      render();
      return;
    }
    try {
      const bmp = await loadBitmap(file);
      const rect = await cropScreen(bmp);
      if (!rect) return;
      const c = applyFilter(drawCropped(bmp, rect), st.filter);
      st.imported = null;
      st.pages.push({ dataUrl: c.toDataURL('image/jpeg', 0.82), w: c.width, h: c.height, raw: { file, rect } });
      render();
    } catch (err) {
      toast('Image illisible : ' + err.message);
    }
  }

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || !el.contains(b)) return;
    const act = b.dataset.act;
    if (act === 'filter') {
      st.filter = b.dataset.v;
      // recalcule les pages existantes avec le nouveau filtre
      for (const p of st.pages) {
        const bmp = await loadBitmap(p.raw.file);
        const c = applyFilter(drawCropped(bmp, p.raw.rect), st.filter);
        p.dataUrl = c.toDataURL('image/jpeg', 0.82); p.w = c.width; p.h = c.height;
      }
      render();
    } else if (act === 'delpage') { st.pages.splice(+b.dataset.i, 1); render(); }
    else if (act === 'delimport') { st.imported = null; render(); }
    else if (act === 'save') {
      b.disabled = true;
      try {
        const pdf = st.imported ? st.imported : await buildPdf(st.pages);
        await onSave({ type: 'invoice', name: st.name.trim(), number: st.number.trim(), filename: invoiceFileName(st.name, st.number), pdf, date: ymd(new Date()) });
        st.pages = []; st.imported = null; st.name = ''; st.number = '';
        render();
      } catch (err) {
        toast('Erreur : ' + err.message);
        b.disabled = false;
      }
    }
  });
  render();
}
