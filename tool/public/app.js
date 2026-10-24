// Repost Cleaner – Oberfläche (läuft nur lokal unter http://localhost)

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const TOKEN = $('meta[name="rc-token"]').content;
const PAGE = 120;

const local = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`rc:${key}`);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`rc:${key}`, JSON.stringify(value));
    } catch {
      /* privater Modus o. Ä. */
    }
  },
};

const DEFAULT_FILTERS = { keyword: '', from: '', to: '', preset: null, creators: [], creatorSearch: '', status: 'pending', sort: 'newest' };

const S = {
  state: null,
  settings: null,
  defaults: null,
  items: new Map(),
  selected: new Set(),
  filters: { ...DEFAULT_FILTERS, ...local.get('filters', {}) },
  view: local.get('view', 'grid'),
  visible: [],
  renderLimit: PAGE,
  lastClickIdx: null,
  currentId: null,
  jobDismissedAt: null,
};

// ───────────────────────── Helfer ─────────────────────────

async function api(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-rc-token': TOKEN },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
  return data;
}

async function run(fn) {
  try {
    return await fn();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), type === 'error' ? 7000 : 4000);
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nf = new Intl.NumberFormat('de-DE', { notation: 'compact', maximumFractionDigits: 1 });
const fmtNum = (n) => nf.format(n || 0);
const fmtDate = (sec) => (sec ? new Date(sec * 1000).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '–');
const fmtDur = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
const fmtClock = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} min` : `${s} s`;
};
function fmtEta(ms) {
  const min = Math.round(ms / 60000);
  if (min < 1) return 'unter 1 Minute';
  if (min < 60) return `ca. ${min} Min.`;
  return `ca. ${Math.floor(min / 60)} Std. ${min % 60} Min.`;
}
const hueOf = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 8;
const toDateInput = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

const STATUS_LABEL = { removed: 'Entfernt', failed: 'Fehler', unverified: 'Unbestätigt' };

// ───────────────────────── Filter ─────────────────────────

function parseQuery(q) {
  const include = [];
  const exclude = [];
  for (const raw of q.toLowerCase().match(/-?"[^"]+"|\S+/g) ?? []) {
    const neg = raw.startsWith('-') && raw.length > 1;
    const term = (neg ? raw.slice(1) : raw).replace(/^"|"$/g, '').trim();
    if (term) (neg ? exclude : include).push(term);
  }
  return { include, exclude };
}

function computeVisible() {
  const f = S.filters;
  const { include, exclude } = parseQuery(f.keyword);
  const from = f.from ? new Date(`${f.from}T00:00:00`).getTime() / 1000 : null;
  const to = f.to ? new Date(`${f.to}T23:59:59`).getTime() / 1000 : null;
  const creators = new Set(f.creators);

  const list = [...S.items.values()].filter((it) => {
    if (f.status !== 'all' && it.status !== f.status) return false;
    if (creators.size && !creators.has(it.author)) return false;
    if (from && (it.createTime ?? 0) < from) return false;
    if (to && (it.createTime ?? 0) > to) return false;
    if (include.length || exclude.length) {
      const hay = `${it.desc} ${it.hashtags.map((h) => `#${h}`).join(' ')} @${it.author} ${it.authorName}`.toLowerCase();
      if (!include.every((t) => hay.includes(t))) return false;
      if (exclude.some((t) => hay.includes(t))) return false;
    }
    return true;
  });

  const sorters = {
    newest: (a, b) => (b.createTime ?? 0) - (a.createTime ?? 0),
    oldest: (a, b) => (a.createTime ?? 0) - (b.createTime ?? 0),
    creator: (a, b) => a.author.localeCompare(b.author, 'de') || (b.createTime ?? 0) - (a.createTime ?? 0),
    plays: (a, b) => b.plays - a.plays,
  };
  list.sort(sorters[f.sort] ?? sorters.newest);
  S.visible = list;
}

function saveFilters() {
  local.set('filters', { ...S.filters, creatorSearch: '' });
}

function refresh({ keepScroll = false } = {}) {
  computeVisible();
  if (!keepScroll) S.renderLimit = PAGE;
  S.lastClickIdx = null;
  renderGrid();
  renderCreators();
  renderCounts();
  renderActionBar();
}

// ───────────────────────── Rendering ─────────────────────────

function cardHtml(it) {
  const sel = S.selected.has(it.id) ? ' selected' : '';
  const working = S.currentId === it.id;
  const badge = working
    ? '<span class="badge working">Läuft …</span>'
    : STATUS_LABEL[it.status] ? `<span class="badge ${it.status}">${STATUS_LABEL[it.status]}</span>` : '';
  const initials = esc((it.author || '?').replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase());
  const img = it.cover ? `<img src="${esc(it.cover)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : '';
  return `<article class="item st-${it.status}${sel}" data-id="${esc(it.id)}">
    <div class="thumb"><div class="ph hue-${hueOf(it.author)}">${initials}</div>${img}
      <span class="check" aria-hidden="true"></span>${badge}
      ${it.duration ? `<span class="duration">${fmtDur(it.duration)}</span>` : ''}
      <span class="plays-ov">▶ ${fmtNum(it.plays)}</span>
    </div>
    <div class="meta">
      <div class="who">@${esc(it.author)} ${it.authorName ? `<span>· ${esc(it.authorName)}</span>` : ''}</div>
      <p class="desc" title="${esc(it.desc)}">${esc(it.desc) || '<i>Keine Beschreibung</i>'}</p>
      ${it.error && it.status !== 'removed' ? `<div class="err-msg">${esc(it.error)}</div>` : ''}
      <div class="foot"><time>${fmtDate(it.createTime)}</time><span>▶ ${fmtNum(it.plays)}</span>
        <a href="${esc(it.url)}" target="_blank" rel="noopener noreferrer" title="Auf TikTok öffnen" data-stop>↗</a></div>
    </div>
  </article>`;
}

function renderGrid() {
  const grid = $('#grid');
  grid.classList.toggle('list', S.view === 'list');
  grid.innerHTML = S.visible.slice(0, S.renderLimit).map(cardHtml).join('');
  const empty = $('#empty');
  empty.hidden = S.visible.length > 0;
  if (S.items.size && !S.visible.length) {
    empty.querySelector('h3').textContent = 'Keine Treffer';
    empty.querySelector('p').textContent = 'Kein Repost passt zu den aktuellen Filtern. Passe die Filter an oder setze sie zurück.';
  } else if (!S.items.size) {
    empty.querySelector('h3').textContent = 'Bereit, wenn du es bist';
    empty.querySelector('p').textContent =
      'Öffne den Browser, logge dich bei TikTok ein und lade deine Reposts. Danach kannst du filtern, auswählen und gezielt entfernen.';
  }
}

function appendMore() {
  if (S.renderLimit >= S.visible.length) return;
  const start = S.renderLimit;
  S.renderLimit += PAGE;
  $('#grid').insertAdjacentHTML('beforeend', S.visible.slice(start, S.renderLimit).map(cardHtml).join(''));
}

function updateCard(id) {
  const el = $(`.item[data-id="${CSS.escape(id)}"]`);
  const it = S.items.get(id);
  if (el && it) el.outerHTML = cardHtml(it);
}

function renderCreators() {
  const counts = new Map();
  for (const it of S.items.values()) {
    const c = counts.get(it.author) ?? { name: it.authorName, n: 0 };
    c.n += 1;
    counts.set(it.author, c);
  }
  const active = new Set(S.filters.creators);
  const q = S.filters.creatorSearch.toLowerCase().replace(/^@/, '');
  const rows = [...counts.entries()]
    .filter(([id, c]) => !q || id.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
    .sort((a, b) => Number(active.has(b[0])) - Number(active.has(a[0])) || b[1].n - a[1].n || a[0].localeCompare(b[0]))
    .slice(0, 300);
  $('#creatorList').innerHTML = rows
    .map(
      ([id, c]) => `<button type="button" class="creator${active.has(id) ? ' active' : ''}" data-creator="${esc(id)}" role="option" aria-selected="${active.has(id)}">
        <span class="box"></span><span class="name">@${esc(id)}</span><span class="count">${c.n}</span></button>`,
    )
    .join('');
  $('#creatorSummary').textContent = active.size ? `(${active.size} gewählt)` : counts.size ? `(${counts.size})` : '';
}

function renderCounts() {
  const total = S.items.size;
  if (!total) {
    $('#counts').textContent = S.state?.scan.running ? 'Lade Reposts …' : 'Noch keine Reposts geladen';
    return;
  }
  const removed = [...S.items.values()].filter((i) => i.status === 'removed').length;
  $('#counts').innerHTML = `<b>${S.visible.length}</b> von <b>${total}</b> Reposts angezeigt${removed ? ` · ${removed} entfernt` : ''}`;
}

function estimateMs(n) {
  const s = S.settings;
  if (!s || !n) return 0;
  if (s.dryRun) return n * 1000;
  const runN = Math.min(n, s.maxPerRun);
  const action = 7; // Seitenaufruf, Menü, Klick, Bestätigung
  const delay = (s.delayMinSec + s.delayMaxSec) / 2 + 0.12 * 9.5;
  const every = (s.breakEveryMin + s.breakEveryMax) / 2;
  const brk = (s.breakMinSec + s.breakMaxSec) / 2;
  return (runN * action + (runN - 1) * delay + Math.floor((runN - 1) / every) * (brk - delay)) * 1000;
}

function renderActionBar() {
  // Auswahl bereinigen: entfernte Reposts können nicht ausgewählt sein
  for (const id of S.selected) if (!S.items.has(id) || S.items.get(id).status === 'removed') S.selected.delete(id);
  const n = S.selected.size;
  const jobActive = ['running', 'paused', 'stopping'].includes(S.state?.job.status);
  $('#actionBar').hidden = n === 0 || jobActive;
  $('#selCount').textContent = n;
  const capped = S.settings && n > S.settings.maxPerRun ? ` · max. ${S.settings.maxPerRun} pro Lauf` : '';
  $('#selEta').textContent = n ? `Dauer ${fmtEta(estimateMs(n))}${capped}` : '';
  $('#btnRemove').textContent = S.settings?.dryRun ? 'Testlauf starten' : 'Ausgewählte entfernen';
}

function setPill(el, text, cls) {
  el.className = `pill ${cls ?? ''}`;
  el.querySelector('span').textContent = text;
}

function renderState() {
  const st = S.state;
  if (!st) return;
  $('#demoPill').hidden = !st.demo;
  setPill($('#pillBrowser'), { open: 'Browser offen', starting: 'Browser startet …', closed: 'Browser geschlossen' }[st.browser], st.browser === 'open' ? 'on' : st.browser === 'starting' ? 'busy' : '');
  setPill($('#pillLogin'), st.loggedIn ? `@${st.username ?? 'eingeloggt'}` : 'Nicht eingeloggt', st.loggedIn ? 'on' : '');
  $('#pillCaptcha').hidden = !st.captcha;

  const open = st.browser === 'open';
  const btnBrowser = $('#btnBrowser');
  btnBrowser.disabled = st.browser === 'starting';
  btnBrowser.textContent = open ? 'Schließen' : st.browser === 'starting' ? 'Startet …' : 'Öffnen';
  btnBrowser.className = `btn sm ${open ? 'ghost' : 'primary'}`;

  $('#stepBrowser').className = open ? 'done' : 'current';
  $('#stepLogin').className = st.loggedIn ? 'done' : open ? 'current' : '';
  $('#stepScan').className = S.items.size && !st.scan.running ? 'done' : st.loggedIn ? 'current' : '';
  $('#loginHint').textContent = st.loggedIn
    ? `Eingeloggt${st.username ? ` als @${st.username}` : ''}.`
    : open
      ? 'Jetzt im Browserfenster einloggen (z. B. per QR-Code). Wird automatisch erkannt.'
      : 'Manuell im geöffneten Fenster – das Tool sieht dein Passwort nie.';

  const input = $('#username');
  if (st.username && document.activeElement !== input && !input.dataset.edited) input.value = st.username;

  const btnScan = $('#btnScan');
  btnScan.textContent = st.scan.running ? 'Stopp' : S.items.size ? 'Neu laden' : 'Laden';
  btnScan.className = `btn sm ${st.scan.running ? 'danger-ghost' : 'primary'}`;
  btnScan.disabled = !st.scan.running && (!st.loggedIn || ['running', 'paused', 'stopping'].includes(st.job.status));
  $('#scanHint').textContent = st.scan.running
    ? `${st.scan.found} Reposts gefunden …`
    : st.scan.message || (st.loggedIn ? 'Bereit.' : 'Wird nach dem Login automatisch erkannt.');

  renderJob();
  renderActionBar();
}

function renderJob() {
  const j = S.state.job;
  const show = j.status !== 'idle' && !(S.jobDismissedAt && S.jobDismissedAt === j.finishedAt);
  $('#jobPanel').hidden = !show;
  if (!show) return;
  const active = ['running', 'paused', 'stopping'].includes(j.status);
  const titles = {
    running: j.dryRun ? 'Testlauf läuft' : 'Entferne Reposts',
    paused: 'Pausiert',
    stopping: 'Wird beendet …',
    finished: j.dryRun ? 'Testlauf abgeschlossen' : 'Fertig',
    stopped: 'Lauf beendet',
  };
  $('#jobTitle').textContent = titles[j.status] ?? '';
  $('#jobSub').textContent =
    j.message && j.status !== 'running'
      ? j.message
      : j.current
        ? `Aktuell: @${j.current.author} – ${j.current.desc || j.current.id}`
        : '';
  $('#btnPause').hidden = j.status !== 'running';
  $('#btnResume').hidden = j.status !== 'paused';
  $('#btnStop').hidden = !active;
  $('#btnStop').disabled = j.status === 'stopping';
  $('#btnJobClose').hidden = active;
  $('#jobBar').style.width = `${j.total ? (j.processed / j.total) * 100 : 0}%`;
  for (const k of ['processed', 'total', 'removed', 'skipped', 'unverified', 'failed']) {
    $(`#js${k[0].toUpperCase()}${k.slice(1)}`).textContent = j[k];
  }
  tickWait();

  const newCurrent = j.current?.id ?? null;
  if (newCurrent !== S.currentId) {
    const prev = S.currentId;
    S.currentId = newCurrent;
    if (prev) updateCard(prev);
    if (newCurrent) updateCard(newCurrent);
  }
}

function tickWait() {
  const j = S.state?.job;
  const el = $('#jsWait');
  if (!j?.wait) {
    el.textContent = '';
    return;
  }
  const left = j.wait.until - Date.now();
  const label = { delay: 'Nächster Schritt in', break: 'Lange Pause –', backoff: 'Warte nach Fehler –', cooldown: 'Abkühlphase –' }[j.wait.kind] ?? 'Warte';
  el.textContent = `⏱ ${label} ${fmtClock(left)}`;
}
setInterval(tickWait, 500);

// ───────────────────────── Log ─────────────────────────

function addLog(entry, { initial = false } = {}) {
  const li = document.createElement('li');
  li.className = entry.level;
  li.innerHTML = `<time>${new Date(entry.ts).toLocaleTimeString('de-DE')}</time><span class="lv"></span><span></span>`;
  li.lastChild.textContent = entry.message;
  const list = $('#logList');
  list.prepend(li);
  while (list.children.length > 400) list.lastChild.remove();
  if (!initial && entry.level === 'error') {
    if ($('#logDrawer').hidden) $('#logDot').hidden = false;
    toast(entry.message, 'error');
  }
}

// ───────────────────────── Live-Verbindung ─────────────────────────

function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('snapshot', (e) => {
    const snap = JSON.parse(e.data);
    S.state = snap.state;
    S.settings = snap.settings;
    S.items = new Map(snap.items.map((it) => [it.id, it]));
    $('#logList').innerHTML = '';
    snap.logs.forEach((l) => addLog(l, { initial: true }));
    renderState();
    refresh();
  });
  es.addEventListener('state', (e) => {
    const prevScan = S.state?.scan.running;
    S.state = JSON.parse(e.data);
    renderState();
    if (prevScan && !S.state.scan.running) refresh({ keepScroll: true });
  });
  es.addEventListener('settings', (e) => {
    S.settings = JSON.parse(e.data);
    renderActionBar();
  });
  es.addEventListener('log', (e) => addLog(JSON.parse(e.data)));
  es.addEventListener('items-reset', (e) => {
    const data = JSON.parse(e.data);
    S.items = new Map((data.items ?? []).map((it) => [it.id, it]));
    S.selected.clear();
    refresh();
  });
  let appendTimer = null;
  es.addEventListener('items-append', (e) => {
    for (const it of JSON.parse(e.data).items) S.items.set(it.id, it);
    clearTimeout(appendTimer);
    appendTimer = setTimeout(() => refresh({ keepScroll: true }), 250);
  });
  es.addEventListener('item', (e) => {
    const { id, status, error } = JSON.parse(e.data);
    const it = S.items.get(id);
    if (!it) return;
    Object.assign(it, { status, error });
    if (status === 'removed') S.selected.delete(id);
    updateCard(id);
    renderCounts();
    renderActionBar();
  });
}

// ───────────────────────── Export ─────────────────────────

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function exportItems(kind) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const user = S.state?.username ?? 'tiktok';
  if (kind === 'json-all') {
    const data = { exportedAt: new Date().toISOString(), username: user, items: [...S.items.values()] };
    download(`reposts-${user}-${stamp}.json`, JSON.stringify(data, null, 2), 'application/json');
    return toast(`${S.items.size} Reposts als JSON exportiert.`, 'ok');
  }
  const list = kind === 'csv-selected' ? [...S.selected].map((id) => S.items.get(id)).filter(Boolean) : S.visible;
  if (!list.length) return toast('Nichts zu exportieren.', 'error');
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['id', 'url', 'creator', 'name', 'beschreibung', 'video_datum', 'aufrufe', 'likes', 'hashtags', 'status'];
  const rows = list.map((it) =>
    [it.id, it.url, it.author, it.authorName, it.desc, it.createTime ? new Date(it.createTime * 1000).toISOString() : '', it.plays, it.likes, it.hashtags.join(' '), it.status]
      .map(cell)
      .join(';'),
  );
  download(`reposts-${user}-${stamp}.csv`, `﻿${header.join(';')}\n${rows.join('\n')}`, 'text/csv;charset=utf-8');
  toast(`${list.length} Reposts als CSV exportiert.`, 'ok');
}

// ───────────────────────── Dialoge ─────────────────────────

function openSettings() {
  const form = $('#formSettings');
  for (const [k, v] of Object.entries(S.settings)) {
    const input = form.elements[k];
    if (!input) continue;
    if (input.type === 'checkbox') input.checked = v;
    else input.value = v;
  }
  $('#dlgSettings').showModal();
}

async function saveSettings() {
  const form = $('#formSettings');
  const body = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    body[el.name] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
  }
  const res = await run(() => api('/api/settings', body));
  if (res) {
    S.settings = res.settings;
    renderActionBar();
    toast('Einstellungen gespeichert.', 'ok');
  }
}

function openConfirm() {
  const ids = [...S.selected];
  if (!ids.length) return;
  const s = S.settings;
  const byCreator = new Map();
  for (const id of ids) {
    const a = S.items.get(id)?.author;
    byCreator.set(a, (byCreator.get(a) ?? 0) + 1);
  }
  const top = [...byCreator.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a, n]) => `@${esc(a)} (${n})`).join(', ');
  const capped = ids.length > s.maxPerRun;
  $('#confirmTitle').textContent = s.dryRun ? 'Testlauf starten?' : `${ids.length} Reposts entfernen?`;
  $('#confirmBody').innerHTML = `
    ${s.dryRun ? '<p class="note info"><b>Testlauf aktiv:</b> Es wird nichts entfernt. Ideal, um Auswahl und Ablauf zu prüfen.</p>' : ''}
    <div class="confirm-list"><dl>
      <dt>Anzahl</dt><dd>${ids.length}${capped ? ` (in diesem Lauf: ${s.maxPerRun})` : ''}</dd>
      <dt>Creator</dt><dd>${top}${byCreator.size > 3 ? ` und ${byCreator.size - 3} weitere` : ''}</dd>
      <dt>Pausen</dt><dd>${s.delayMinSec}–${s.delayMaxSec} s, lange Pause alle ${s.breakEveryMin}–${s.breakEveryMax}</dd>
      <dt>Dauer</dt><dd>${fmtEta(estimateMs(ids.length))}</dd>
    </dl></div>
    ${s.dryRun ? '' : '<p class="note">Das Browserfenster muss geöffnet bleiben. Entfernte Reposts lassen sich nicht automatisch wiederherstellen – das JSON-Backup enthält aber alle Links.</p>'}`;
  $('#dlgConfirm').showModal();
}

async function startRemoval() {
  const ids = [...S.selected];
  const res = await run(() => api('/api/remove', { ids }));
  if (res) {
    S.jobDismissedAt = null;
    toast(`${res.queued} Reposts in der Warteschlange.`, 'ok');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

// ───────────────────────── Events ─────────────────────────

function toggleSelect(id, value) {
  const it = S.items.get(id);
  if (!it || it.status === 'removed') return;
  const on = value ?? !S.selected.has(id);
  if (on) S.selected.add(id);
  else S.selected.delete(id);
  $(`.item[data-id="${CSS.escape(id)}"]`)?.classList.toggle('selected', on);
}

function bindEvents() {
  $('#btnBrowser').addEventListener('click', () =>
    run(() => api(S.state?.browser === 'open' ? '/api/browser/close' : '/api/browser/open')),
  );

  const input = $('#username');
  input.addEventListener('input', () => (input.dataset.edited = '1'));
  const scan = () =>
    run(async () => {
      if (S.state?.scan.running) return api('/api/scan/stop');
      await api('/api/scan', { username: input.value.trim().replace(/^@/, '') });
    });
  $('#btnScan').addEventListener('click', scan);
  input.addEventListener('keydown', (e) => e.key === 'Enter' && scan());

  // Filter
  const f = S.filters;
  $('#fKeyword').value = f.keyword;
  $('#fFrom').value = f.from;
  $('#fTo').value = f.to;
  $('#fStatus').value = f.status;
  $('#fSort').value = f.sort;
  const markPreset = () => $$('#datePresets button').forEach((b) => b.classList.toggle('active', b.dataset.preset === f.preset));
  markPreset();

  let kwTimer;
  $('#fKeyword').addEventListener('input', (e) => {
    clearTimeout(kwTimer);
    kwTimer = setTimeout(() => {
      f.keyword = e.target.value;
      saveFilters();
      refresh();
    }, 160);
  });
  for (const [id, key] of [['#fFrom', 'from'], ['#fTo', 'to'], ['#fStatus', 'status'], ['#fSort', 'sort']]) {
    $(id).addEventListener('change', (e) => {
      f[key] = e.target.value;
      if (key === 'from' || key === 'to') {
        f.preset = null;
        markPreset();
      }
      saveFilters();
      refresh();
    });
  }
  $('#datePresets').addEventListener('click', (e) => {
    const p = e.target.closest('button')?.dataset.preset;
    if (!p) return;
    if (f.preset === p) {
      Object.assign(f, { preset: null, from: '', to: '' });
    } else {
      const d = new Date();
      if (p === 'older365') {
        d.setFullYear(d.getFullYear() - 1);
        Object.assign(f, { preset: p, from: '', to: toDateInput(d) });
      } else {
        d.setDate(d.getDate() - Number(p));
        Object.assign(f, { preset: p, from: toDateInput(d), to: '' });
      }
    }
    $('#fFrom').value = f.from;
    $('#fTo').value = f.to;
    markPreset();
    saveFilters();
    refresh();
  });
  $('#fCreatorSearch').addEventListener('input', (e) => {
    f.creatorSearch = e.target.value;
    renderCreators();
  });
  $('#creatorList').addEventListener('click', (e) => {
    const id = e.target.closest('[data-creator]')?.dataset.creator;
    if (id === undefined) return;
    const set = new Set(f.creators);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    f.creators = [...set];
    saveFilters();
    refresh();
  });
  $('#btnResetFilters').addEventListener('click', () => {
    Object.assign(f, { ...DEFAULT_FILTERS, creators: [] });
    $('#fKeyword').value = '';
    $('#fFrom').value = '';
    $('#fTo').value = '';
    $('#fCreatorSearch').value = '';
    $('#fStatus').value = f.status;
    $('#fSort').value = f.sort;
    markPreset();
    saveFilters();
    refresh();
  });

  // Auswahl im Raster (Shift+Klick = Bereich)
  const grid = $('#grid');
  grid.addEventListener('click', (e) => {
    if (e.target.closest('[data-stop]')) return;
    const card = e.target.closest('.item');
    if (!card) return;
    const id = card.dataset.id;
    const idx = S.visible.findIndex((it) => it.id === id);
    if (e.shiftKey && S.lastClickIdx !== null && idx >= 0) {
      const on = !S.selected.has(id);
      const [a, b] = [Math.min(idx, S.lastClickIdx), Math.max(idx, S.lastClickIdx)];
      for (let i = a; i <= b; i++) toggleSelect(S.visible[i].id, on);
    } else {
      toggleSelect(id);
    }
    S.lastClickIdx = idx;
    renderActionBar();
  });
  // Defekte/abgelaufene Cover → Platzhalter darunter wird sichtbar
  grid.addEventListener('error', (e) => e.target.tagName === 'IMG' && e.target.remove(), true);

  new IntersectionObserver((entries) => entries[0].isIntersecting && appendMore(), { rootMargin: '800px' }).observe($('#sentinel'));

  $('#btnSelectVisible').addEventListener('click', () => {
    let n = 0;
    for (const it of S.visible) {
      if (it.status === 'removed') continue;
      S.selected.add(it.id);
      n += 1;
    }
    renderGrid();
    renderActionBar();
    if (n) toast(`${n} Reposts ausgewählt.`);
  });
  const clearSel = () => {
    S.selected.clear();
    $$('.item.selected').forEach((el) => el.classList.remove('selected'));
    renderActionBar();
  };
  $('#btnClearSel').addEventListener('click', clearSel);
  $('#btnClearSel2').addEventListener('click', clearSel);

  $$('.seg button').forEach((b) =>
    b.addEventListener('click', () => {
      S.view = b.dataset.view;
      local.set('view', S.view);
      $$('.seg button').forEach((x) => x.classList.toggle('active', x === b));
      $('#grid').classList.toggle('list', S.view === 'list');
    }),
  );
  $$('.seg button').forEach((x) => x.classList.toggle('active', x.dataset.view === S.view));

  document.addEventListener('click', (e) => {
    const kind = e.target.closest('[data-export]')?.dataset.export;
    if (!kind) return;
    exportItems(kind);
    e.target.closest('details')?.removeAttribute('open');
  });

  // Lauf
  $('#btnRemove').addEventListener('click', openConfirm);
  $('#dlgConfirm').addEventListener('close', () => $('#dlgConfirm').returnValue === 'ok' && startRemoval());
  $('#btnPause').addEventListener('click', () => run(() => api('/api/job/pause')));
  $('#btnResume').addEventListener('click', () => run(() => api('/api/job/resume')));
  $('#btnStop').addEventListener('click', () => run(() => api('/api/job/stop')));
  $('#btnJobClose').addEventListener('click', () => {
    S.jobDismissedAt = S.state.job.finishedAt;
    renderJob();
  });

  // Einstellungen
  $('#btnSettings').addEventListener('click', openSettings);
  $('#dlgSettings').addEventListener('close', () => $('#dlgSettings').returnValue === 'save' && saveSettings());
  $('#btnDefaults').addEventListener('click', () => {
    const form = $('#formSettings');
    const d = {
      delayMinSec: 8, delayMaxSec: 18, breakEveryMin: 8, breakEveryMax: 15, breakMinSec: 90, breakMaxSec: 240,
      maxPerRun: 150, maxPerDay: 300, maxConsecutiveErrors: 3, removalStrategy: 'auto',
    };
    for (const [k, v] of Object.entries(d)) form.elements[k].value = v;
  });
  $('#btnForget').addEventListener('click', async () => {
    const res = await run(() => api('/api/session/forget'));
    if (res) toast('Gespeichertes Browser-Profil gelöscht.', 'ok');
  });

  // Log
  $('#btnLog').addEventListener('click', () => {
    $('#logDrawer').hidden = !$('#logDrawer').hidden;
    $('#logDot').hidden = true;
  });
  $('#btnLogClose').addEventListener('click', () => ($('#logDrawer').hidden = true));

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
    if (!$('#logDrawer').hidden) $('#logDrawer').hidden = true;
    else clearSel();
  });
}

bindEvents();
connect();
