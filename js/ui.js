// Small UI helpers: escaping, data-bind forms, dialogs, toasts, downloads.
import { state, save } from './state.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }
export function setPath(obj, path, val) {
  const ks = path.split('.'); const last = ks.pop();
  const tgt = ks.reduce((o, k) => (o[k] ??= {}), obj); tgt[last] = val;
}

// Wire up [data-bind="path"] inputs inside root to state.project. onChange(path, value) optional.
export function bindForm(root, onChange) {
  $$('[data-bind]', root).forEach(el => {
    const path = el.dataset.bind;
    const v = getPath(state.project, path);
    if (el.type === 'checkbox') el.checked = !!v;
    else if (el.dataset.type === 'list') el.value = (v || []).join(', ');
    else el.value = v ?? '';
    const handler = () => {
      let val;
      if (el.type === 'checkbox') val = el.checked;
      else if (el.dataset.type === 'num') val = el.value === '' ? '' : Number(el.value);
      else if (el.dataset.type === 'list') val = el.value.split(/[,;\s]+/).filter(Boolean).map(Number).filter(x => isFinite(x) && x > 0);
      else val = el.value;
      setPath(state.project, path, val);
      save();
      if (onChange) onChange(path, val, el);
    };
    el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', handler);
  });
}

export const opts = (list, sel) => list.map(o => {
  const [v, l] = Array.isArray(o) ? o : [o, o];
  return `<option value="${esc(v)}"${String(v) === String(sel ?? '') ? ' selected' : ''}>${esc(l)}</option>`;
}).join('');

let toastTimer;
export function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// Modal dialog. buttons: [{label, value, primary, danger}] → resolves with value (or null on cancel)
export function dialog({ title, body, buttons = [{ label: 'Cancel', value: null }, { label: 'OK', value: true, primary: true }], onOpen, validate }) {
  const d = $('#dlg');
  d.innerHTML = `<form method="dialog"><div class="dlg-body">${title ? `<h2>${esc(title)}</h2>` : ''}${body || ''}</div>
    <div class="dlg-foot">${buttons.map((b, i) => `<button class="btn ${b.primary ? 'primary' : ''} ${b.danger ? 'danger' : ''}" value="${i}">${esc(b.label)}</button>`).join('')}</div></form>`;
  return new Promise(resolve => {
    const form = $('form', d);
    let done = false;
    form.addEventListener('submit', ev => {
      const idx = Number(ev.submitter ? ev.submitter.value : -1);
      const b = buttons[idx];
      if (b && b.value !== null && validate) {
        const err = validate(d, b.value);
        if (err) { ev.preventDefault(); toast(err); return; }
      }
      done = true;
      const result = b ? (typeof b.value === 'function' ? b.value(d) : b.value) : null;
      resolve(result);
    });
    d.addEventListener('close', () => { if (!done) resolve(null); }, { once: true });
    d.showModal();
    if (onOpen) onOpen(d);
  });
}

export async function confirmDlg(message, okLabel = 'OK', danger = false) {
  return dialog({ body: `<p>${esc(message)}</p>`, buttons: [{ label: 'Cancel', value: null }, { label: okLabel, value: true, primary: !danger, danger }] });
}

export async function promptDlg(title, value = '', label = '') {
  return dialog({
    title, body: `<label class="field">${esc(label)}<input name="v" value="${esc(value)}"></label>`,
    buttons: [{ label: 'Cancel', value: null }, { label: 'OK', primary: true, value: d => $('input', d).value.trim() }],
    onOpen: d => { const i = $('input', d); i.focus(); i.select(); },
  });
}

// Save/share a file. On iPad, the share sheet allows "Save to Files" (incl. Box).
export async function saveFile(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] }) && /iPad|iPhone|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export const fmtTime = d => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
export const fmtDate = d => new Date(d).toLocaleDateString();
export function toLocalInput(d) {
  const x = new Date(d); const pad = n => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}:${pad(x.getSeconds())}`;
}
