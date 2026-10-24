// Repost Cleaner – Oberfläche (läuft nur lokal unter http://localhost)

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const TOKEN = $('meta[name="rc-token"]').content;
const PAGE = 120;
const BUSY = ['running', 'paused', 'stopping'];

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
const DEFAULT_SETTINGS = {
  delayMinSec: 8, delayMaxSec: 18, breakEveryMin: 8, breakEveryMax: 15, breakMinSec: 90, breakMaxSec: 240,
  maxPerRun: 150, maxPerDay: 300, maxConsecutiveErrors: 3, removalStrategy: 'auto', dryRun: false, keepSession: false,
};

const S = {
  state: null,
  settings: null,
  items: new Map(),
  selected: new Set(),
  filters: { ...DEFAULT_FILTERS, ...local.get('filters', {}) },
  view: local.get('view', 'grid'),
  visible: [],
  renderLimit: PAGE,
  lastClickIdx: null,
  currentId: null,
  logs: [],
  logFilter: 'all',
  runDismissedAt: null,
  timeline: { startedAt: null, marks: [], breaks: [] },
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
  setTimeout(() => el.remove(), type === 'error' ? 7000 : 3500);
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nfCompact = new Intl.NumberFormat('de-DE', { notation: 'compact', maximumFractionDigits: 1 });
const nf = new Intl.NumberFormat('de-DE');
const fmtNum = (n) => nfCompact.format(n || 0);
const fmtDate = (sec) => (sec ? new Date(sec * 1000).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '–');
const fmtTime = (ms) => new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const fmtDur = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
const fmtClock = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} min` : `${s} s`;
};
function fmtEta(ms) {
  const min = Math.round(ms / 60000);
  if (min < 1) return 'unter einer Minute';
  if (min < 60) return `etwa ${min} Minuten`;
  const h = Math.floor(min / 60);
  return `etwa ${h} Std. ${min % 60} Min.`;
}
const hueOf = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 8;
const toDateInput = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const plural = (n, one, many) => `${nf.format(n)} ${n === 1 ? one : many}`;
const isBusy = () => BUSY.includes(S.state?.job.status);

const STATUS_LABEL = { removed: 'Entfernt', failed: 'Fehler', unverified: 'Unbestätigt' };

// ───────────────────────── Navigation ─────────────────────────

const ROUTES = { '': 'reposts', protokoll: 'log', einstellungen: 'settings' };
function route() {
  const key = location.hash.replace(/^#\/?/, '');
  const view = ROUTES[key] ?? 'reposts';
  $$('.view').forEach((v) => (v.hidden = v.dataset.view !== view));
  $$('.nav a').forEach((a) => (a.dataset.route === view ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  if (view === 'settings') fillSettings();
  if (view === 'log') renderLog();
  window.scrollTo(0, 0);
}

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
  renderSelection();
}

// ───────────────────────── Raster ─────────────────────────

function coverCaption(desc) {
  const text = desc.replace(/#[\p{L}\p{N}_]+/gu, '').replace(/\s+/g, ' ').trim();
  return text || desc || 'Ohne Beschreibung';
}

function cardHtml(it) {
  const sel = S.selected.has(it.id) ? ' selected' : '';
  const working = S.currentId === it.id;
  const pill = working
    ? '<span class="pill working">Wird entfernt</span>'
    : STATUS_LABEL[it.status] ? `<span class="pill ${it.status}">${STATUS_LABEL[it.status]}</span>` : '';
  const img = it.cover ? `<img src="${esc(it.cover)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : '';
  const date = fmtDate(it.createTime);
  return `<article class="item st-${it.status}${sel}" data-id="${esc(it.id)}" aria-selected="${Boolean(sel)}">
    <div class="cover cv${hueOf(it.author)}"><p class="cap">${esc(coverCaption(it.desc))}</p>${img}
      <span class="scrim"></span><span class="check" aria-hidden="true"></span>${pill}
      <span class="plays num">${fmtNum(it.plays)} Aufrufe</span>
      ${it.duration ? `<span class="dur num">${fmtDur(it.duration)}</span>` : ''}
    </div>
    <div class="meta">
      <span class="who">@${esc(it.author)}</span>
      <p class="desc" title="${esc(it.desc)}">${esc(it.desc) || 'Ohne Beschreibung'}</p>
      ${it.error && it.status !== 'removed' ? `<p class="err">${esc(it.error)}</p>` : ''}
      <div class="foot num"><span>${date}</span><a href="${esc(it.url)}" target="_blank" rel="noopener noreferrer" data-stop>Auf TikTok</a></div>
    </div>
    <span class="l-date num">${date}</span>
    <span class="l-plays num">${fmtNum(it.plays)}</span>
    <span class="l-status">${pill}</span>
    <a class="l-link" href="${esc(it.url)}" target="_blank" rel="noopener noreferrer" data-stop aria-label="Auf TikTok öffnen">↗</a>
  </article>`;
}

function renderGrid() {
  const grid = $('#grid');
  grid.classList.toggle('list', S.view === 'list');
  grid.innerHTML = S.visible.slice(0, S.renderLimit).map(cardHtml).join('');
  const empty = $('#empty');
  empty.hidden = S.visible.length > 0;
  if (S.items.size && !S.visible.length) {
    $('#emptyTitle').textContent = 'Kein Repost passt zu diesen Filtern';
    $('#emptyText').textContent = 'Lockere die Filter oder setze sie zurück. Entfernte Reposts siehst du unter Status „Entfernt“.';
  } else if (!S.items.size) {
    $('#emptyTitle').textContent = S.state?.scan.running ? 'Reposts werden geladen' : 'Noch keine Reposts geladen';
    $('#emptyText').textContent =
      'Sobald du eingeloggt bist, lädt „Reposts laden“ die Liste aus deinem Profil. Bei einigen hundert Reposts dauert das etwa eine Minute.';
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
  for (const it of S.items.values()) counts.set(it.author, (counts.get(it.author) ?? 0) + 1);
  const active = new Set(S.filters.creators);
  const q = S.filters.creatorSearch.toLowerCase().replace(/^@/, '');
  const rows = [...counts.entries()]
    .filter(([id]) => !q || id.toLowerCase().includes(q))
    .sort((a, b) => Number(active.has(b[0])) - Number(active.has(a[0])) || b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 300);
  $('#creatorList').innerHTML = rows.length
    ? rows
      .map(
        ([id, n]) => `<button type="button" class="creator" data-creator="${esc(id)}" role="option" aria-selected="${active.has(id)}">
          <span class="box" aria-hidden="true"></span><span class="name">@${esc(id)}</span><span class="count num">${n}</span></button>`,
      )
      .join('')
    : `<p class="creator-empty">${counts.size ? 'Kein Creator gefunden.' : 'Erscheint nach dem Laden.'}</p>`;
  $('#creatorSummary').textContent = active.size ? `${active.size} gewählt` : counts.size ? `${counts.size}` : '';
}

// Die eine Erkenntnis unter dem Titel – aus den geladenen Daten berechnet.
function renderFinding() {
  const all = [...S.items.values()];
  const st = S.state;
  const el = $('#finding');
  $('#totalCount').textContent = all.length ? nf.format(all.length) : '';
  if (!all.length) {
    el.textContent = st?.scan.running
      ? `${nf.format(st.scan.found)} Reposts gefunden, Laden läuft.`
      : st?.loggedIn
        ? 'Eingeloggt. Lade jetzt deine Reposts.'
        : 'Öffne den Browser und logge dich bei TikTok ein, um deine Reposts zu laden.';
    return;
  }
  const open = all.filter((i) => i.status !== 'removed');
  const yearAgo = Date.now() / 1000 - 365 * 86400;
  const old = open.filter((i) => (i.createTime ?? 0) < yearAgo).length;
  const counts = new Map();
  for (const i of open) counts.set(i.author, (counts.get(i.author) ?? 0) + 1);
  const [topName, topN] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  const removed = all.length - open.length;
  const parts = [`<b>${nf.format(open.length)}</b> noch repostet, von ${plural(counts.size, 'Creator', 'Creatorn')}`];
  if (old) parts.push(`<b>${nf.format(old)}</b> davon älter als ein Jahr`);
  let text = `${parts.join(', ')}.`;
  if (topName && topN > 1) text += ` Am häufigsten: @${esc(topName)} mit ${nf.format(topN)}.`;
  if (removed) text += ` ${nf.format(removed)} bereits entfernt.`;
  el.innerHTML = text;
}

function renderCounts() {
  const total = S.items.size;
  $('#resultsTitle').innerHTML = total
    ? `<b>${nf.format(S.visible.length)}</b> von ${nf.format(total)} angezeigt`
    : S.state?.scan.running ? 'Wird geladen' : 'Keine Reposts geladen';
  renderFinding();
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

function renderSelection() {
  for (const id of S.selected) if (!S.items.has(id) || S.items.get(id).status === 'removed') S.selected.delete(id);
  const n = S.selected.size;
  const btn = $('#btnRemove');
  btn.disabled = n === 0 || isBusy() || S.state?.scan.running;
  btn.textContent = isBusy() ? 'Lauf läuft' : n ? `${S.settings?.dryRun ? 'Testlauf mit' : 'Entfernen:'} ${nf.format(n)}` : 'Auswahl entfernen';
  $('#btnClearSel').hidden = n === 0;
  $('#selInfo').textContent = n ? `Dauer ${fmtEta(estimateMs(n))}${S.settings && n > S.settings.maxPerRun ? `, max. ${S.settings.maxPerRun} pro Lauf` : ''}` : '';
}

// ───────────────────────── Verbindung & Einrichtung ─────────────────────────

function renderState() {
  const st = S.state;
  if (!st) return;
  $('#demoTag').hidden = !st.demo;
  const open = st.browser === 'open';
  const conn = $('#conn');
  conn.className = `conn ${open && st.loggedIn ? 'on' : st.browser === 'starting' || (open && !st.loggedIn) ? 'busy' : ''}`;
  $('#connText').textContent = st.captcha
    ? 'Captcha im Browser lösen'
    : !open ? (st.browser === 'starting' ? 'Browser startet' : 'Browser geschlossen')
      : st.loggedIn ? `@${st.username ?? 'eingeloggt'}` : 'Warte auf Login';

  for (const b of [$('#btnBrowser'), $('#btnBrowserStep')]) {
    b.disabled = st.browser === 'starting';
    b.textContent = open ? 'Browser schließen' : st.browser === 'starting' ? 'Startet …' : 'Browser öffnen';
  }
  $('#btnBrowserStep').className = `btn ${open ? 'ghost' : 'primary'}`;

  const loaded = S.items.size > 0 && !st.scan.running;
  const steps = [open, st.loggedIn, loaded];
  const done = steps.filter(Boolean).length;
  const current = steps.indexOf(false);
  ['stepBrowser', 'stepLogin', 'stepScan'].forEach((id, i) => {
    $(`#${id}`).className = steps[i] ? 'done' : i === current ? 'current' : '';
  });
  $('#setupBar').style.width = `${(done / 3) * 100}%`;
  $('#setupText').textContent = `${done} von 3 erledigt`;
  const setup = $('#setup');
  setup.classList.toggle('compact', done === 3);
  $('#setupTitle').textContent = done === 3 ? `Verbunden als @${st.username ?? '–'}` : 'Verbinden';
  $('#setupMeta').textContent = S.scannedAt ? `${plural(S.items.size, 'Repost', 'Reposts')} geladen um ${fmtTime(S.scannedAt).slice(0, 5)}` : '';
  $('#btnRescan').disabled = isBusy();

  $('#loginHint').textContent = st.loggedIn
    ? `Eingeloggt als @${st.username ?? '–'}.`
    : open
      ? 'Jetzt im Browserfenster einloggen, am einfachsten per QR-Code. Der Login wird automatisch erkannt.'
      : 'Im geöffneten Fenster, am einfachsten per QR-Code. Das Tool sieht dein Passwort nie.';

  const input = $('#username');
  if (st.username && document.activeElement !== input && !input.dataset.edited) input.value = st.username;
  const btnScan = $('#btnScan');
  btnScan.textContent = st.scan.running ? 'Stopp' : S.items.size ? 'Neu laden' : 'Laden';
  btnScan.className = `btn ${st.scan.running ? 'ghost danger' : st.loggedIn && !S.items.size ? 'primary' : 'ghost'}`;
  btnScan.disabled = !st.scan.running && (!st.loggedIn || isBusy());
  $('#scanHint').textContent = st.scan.running
    ? `${nf.format(st.scan.found)} gefunden, lädt weiter …`
    : st.scan.message || (st.loggedIn ? 'Bereit. Prüfe den Benutzernamen und lade.' : 'Der Benutzername wird nach dem Login erkannt.');

  renderRun();
  renderSelection();
  renderFinding();
}

// ───────────────────────── Lauf: Zeitleiste ─────────────────────────

function renderRun() {
  const j = S.state.job;
  const show = j.status !== 'idle' && !(S.runDismissedAt && S.runDismissedAt === j.finishedAt);
  $('#runPanel').hidden = !show;
  if (!show) return;
  const active = BUSY.includes(j.status);
  const titles = {
    running: j.dryRun ? 'Testlauf läuft' : 'Lauf läuft',
    paused: 'Lauf pausiert',
    stopping: 'Lauf wird beendet',
    finished: j.dryRun ? 'Testlauf abgeschlossen' : 'Lauf abgeschlossen',
    stopped: 'Lauf beendet',
  };
  $('#runTitle').textContent = titles[j.status] ?? 'Lauf';
  $('#runSub').textContent =
    j.message && j.status !== 'running'
      ? j.message
      : j.current
        ? `Jetzt: @${j.current.author}, ${j.current.desc || j.current.id}`
        : j.wait ? 'Wartet, damit TikTok kein Muster sieht.' : '';
  $('#btnPause').hidden = j.status !== 'running';
  $('#btnResume').hidden = j.status !== 'paused';
  $('#btnStop').hidden = !active;
  $('#btnStop').disabled = j.status === 'stopping';
  $('#btnRunClose').hidden = active;
  $('#rfProcessed').textContent = nf.format(j.processed);
  $('#rfTotal').textContent = nf.format(j.total);
  $('#rfRemoved').textContent = nf.format(j.removed);
  $('#rfSkipped').textContent = nf.format(j.skipped);
  $('#rfUnverified').textContent = nf.format(j.unverified);
  $('#rfFailed').textContent = nf.format(j.failed);

  const tl = S.timeline;
  if (j.startedAt && tl.startedAt !== j.startedAt) Object.assign(tl, { startedAt: j.startedAt, marks: [], breaks: [] });
  if (j.wait && ['break', 'cooldown'].includes(j.wait.kind) && !tl.breaks.some((b) => b.until === j.wait.until)) {
    tl.breaks.push({ from: j.wait.until - j.wait.ms, until: j.wait.until, kind: j.wait.kind });
  }
  tickRun();

  const newCurrent = j.current?.id ?? null;
  if (newCurrent !== S.currentId) {
    const prev = S.currentId;
    S.currentId = newCurrent;
    if (prev) updateCard(prev);
    if (newCurrent) updateCard(newCurrent);
  }
}

function drawStrip() {
  const tl = S.timeline;
  const strip = $('#strip');
  if (!tl.startedAt) return;
  const j = S.state.job;
  const end = j.finishedAt ?? Date.now();
  // Mindestens 3 Minuten sichtbar (im Demo-Modus mit beschleunigten Pausen: 25 Sekunden)
  const span = Math.max(end - tl.startedAt, S.state.demo ? 25_000 : 180_000);
  const x = (t) => `${((t - tl.startedAt) / span) * 100}%`;
  const parts = [];
  for (const b of tl.breaks) {
    const w = ((Math.min(b.until, end) - b.from) / span) * 100;
    parts.push(`<span class="brk" style-left="${x(b.from)}" style-width="${w}%">${b.kind === 'cooldown' ? 'Abkühlen' : 'Lange Pause'} ${fmtDur((b.until - b.from) / 1000)}</span>`);
  }
  for (const m of tl.marks) parts.push(`<span class="mk ${m.cls}" style-left="${x(m.t)}"></span>`);
  if (!j.finishedAt) parts.push(`<span class="now" style-left="${x(end)}"></span>`);
  strip.innerHTML = parts.join('');
  // Positionen per CSSOM setzen (die CSP erlaubt keine Inline-Styles im Markup)
  for (const el of strip.children) {
    el.style.left = el.getAttribute('style-left');
    if (el.hasAttribute('style-width')) el.style.width = el.getAttribute('style-width');
  }
  const mins = Math.round(span / 60000);
  $('#stripLegend').innerHTML =
    `<span><i></i>Entfernt</span><span><i class="failed"></i>Fehler</span><span><i class="brk"></i>Lange Pause</span><span class="num">Zeitachse: ${span < 120_000 ? `${Math.round(span / 1000)} s` : `${mins} Min.`} seit Start</span>`;
}

function tickRun() {
  const j = S.state?.job;
  if (!j) return;
  const el = $('#runWait');
  if (j.wait) {
    const label = { delay: 'Nächster in', break: 'Lange Pause, noch', backoff: 'Nach Fehler, noch', cooldown: 'Abkühlen, noch' }[j.wait.kind] ?? 'Noch';
    el.textContent = `${label} ${fmtClock(j.wait.until - Date.now())}`;
  } else el.textContent = '';
  if (!$('#runPanel').hidden) drawStrip();
}
setInterval(tickRun, 1000);

// ───────────────────────── Protokoll ─────────────────────────

function addLog(entry) {
  S.logs.push(entry);
  if (S.logs.length > 600) S.logs.shift();
  const errors = S.logs.filter((l) => l.level === 'error').length;
  $('#navErrors').hidden = errors === 0;
  $('#navErrors').textContent = errors;
}

function renderLog() {
  const f = S.logFilter;
  const rows = S.logs.filter((l) =>
    f === 'all' ? l.level !== 'debug' : f === 'removed' ? l.level === 'ok' && /Entfernt|Würde entfernen/.test(l.message) : ['warn', 'error'].includes(l.level),
  );
  $('#logBody').innerHTML = rows
    .slice()
    .reverse()
    .map((l) => `<tr class="${l.level}"><td class="t-time">${fmtTime(l.ts)}</td><td>${esc(l.message)}</td></tr>`)
    .join('');
  $('#logEmpty').hidden = rows.length > 0;
  const removed = S.logs.filter((l) => l.level === 'ok' && /^Entfernt:/.test(l.message)).length;
  const errors = S.logs.filter((l) => l.level === 'error').length;
  $('#logFinding').textContent = S.logs.length
    ? `${plural(removed, 'Repost', 'Reposts')} entfernt und ${plural(errors, 'Fehler', 'Fehler')} in dieser Sitzung. Die Lösch-Historie liegt zusätzlich in data/history.jsonl.`
    : 'Alles, was das Tool in dieser Sitzung tut, erscheint hier.';
}

// ───────────────────────── Einstellungen ─────────────────────────

function fillSettings() {
  if (!S.settings) return;
  const form = $('#formSettings');
  for (const [k, v] of Object.entries(S.settings)) {
    const input = form.elements[k];
    if (!input || document.activeElement === input) continue;
    if (input.type === 'checkbox') input.checked = v;
    else input.value = v;
  }
  renderSettingsPreview();
}

function renderSettingsPreview() {
  const s = S.settings;
  if (!s) return;
  $('#tempoPreview').textContent = `100 Reposts dauern damit ${fmtEta(estimateMs(Math.min(100, s.maxPerRun)))}${s.maxPerRun < 100 ? ` (Lauf endet nach ${s.maxPerRun})` : ''}.`;
  $('#limitPreview').textContent = `Ein Lauf entfernt höchstens ${nf.format(Math.min(s.maxPerRun, s.maxPerDay))}, ein Tag höchstens ${nf.format(s.maxPerDay)}.`;
}

let saveTimer;
function queueSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const form = $('#formSettings');
    const body = {};
    for (const el of form.elements) {
      if (!el.name) continue;
      body[el.name] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
    }
    const res = await run(() => api('/api/settings', body));
    if (res) {
      S.settings = res.settings;
      fillSettings();
      renderSelection();
      $('#savedStamp').textContent = `Gespeichert um ${fmtTime(Date.now()).slice(0, 5)}`;
    }
  }, 450);
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
    if (!S.items.size) return toast('Noch nichts zu exportieren.', 'error');
    const data = { exportedAt: new Date().toISOString(), username: user, items: [...S.items.values()] };
    download(`reposts-${user}-${stamp}.json`, JSON.stringify(data, null, 2), 'application/json');
    return toast(`${plural(S.items.size, 'Repost', 'Reposts')} als JSON gesichert.`);
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
  toast(`${plural(list.length, 'Repost', 'Reposts')} als CSV exportiert.`);
}

// ───────────────────────── Bestätigung ─────────────────────────

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
  const runN = Math.min(ids.length, s.maxPerRun);
  $('#confirmTitle').textContent = s.dryRun ? `Testlauf mit ${nf.format(runN)} Reposts` : `${nf.format(runN)} Reposts entfernen?`;
  $('#confirmBody').innerHTML = `
    <dl class="num">
      <dt>Ausgewählt</dt><dd>${nf.format(ids.length)}${ids.length > runN ? `, davon ${nf.format(runN)} in diesem Lauf` : ''}</dd>
      <dt>Creator</dt><dd>${top}${byCreator.size > 3 ? ` und ${byCreator.size - 3} weitere` : ''}</dd>
      <dt>Pausen</dt><dd>${s.delayMinSec}–${s.delayMaxSec} s, lange Pause nach ${s.breakEveryMin}–${s.breakEveryMax}</dd>
      <dt>Dauer</dt><dd>${fmtEta(estimateMs(ids.length))}</dd>
    </dl>
    ${s.dryRun
      ? '<p class="note">Testlauf: Es wird nichts entfernt.</p>'
      : '<p class="note">Lass das Browserfenster offen. Entfernte Reposts kommen nicht automatisch zurück; das JSON-Backup enthält den Link zu jedem Video.</p>'}`;
  $('#dlgConfirm').showModal();
}

async function startRemoval() {
  const res = await run(() => api('/api/remove', { ids: [...S.selected] }));
  if (res) {
    S.runDismissedAt = null;
    toast(`${plural(res.queued, 'Repost', 'Reposts')} in der Warteschlange.`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
    S.scannedAt = snap.scannedAt;
    S.logs = [];
    snap.logs.forEach(addLog);
    renderState();
    refresh();
    route();
  });
  es.addEventListener('state', (e) => {
    const wasScanning = S.state?.scan.running;
    S.state = JSON.parse(e.data);
    renderState();
    if (wasScanning && !S.state.scan.running) {
      S.scannedAt = Date.now();
      refresh({ keepScroll: true });
      renderState();
    }
  });
  es.addEventListener('settings', (e) => {
    S.settings = JSON.parse(e.data);
    renderSelection();
    if (!$('#viewSettings').hidden) fillSettings();
  });
  es.addEventListener('log', (e) => {
    const entry = JSON.parse(e.data);
    addLog(entry);
    if (!$('#viewLog').hidden) renderLog();
    if (entry.level === 'error') toast(entry.message, 'error');
  });
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
    S.timeline.marks.push({ t: Date.now(), cls: status === 'failed' ? 'failed' : status === 'removed' ? '' : 'soft' });
    if (!it) return;
    Object.assign(it, { status, error });
    if (status === 'removed') S.selected.delete(id);
    updateCard(id);
    renderCounts();
    renderSelection();
  });
}

// ───────────────────────── Ereignisse ─────────────────────────

function toggleSelect(id, value) {
  const it = S.items.get(id);
  if (!it || it.status === 'removed') return;
  const on = value ?? !S.selected.has(id);
  if (on) S.selected.add(id);
  else S.selected.delete(id);
  const el = $(`.item[data-id="${CSS.escape(id)}"]`);
  el?.classList.toggle('selected', on);
  el?.setAttribute('aria-selected', String(on));
}

function bindEvents() {
  addEventListener('hashchange', route);
  addEventListener('scroll', () => $('.bar').classList.toggle('scrolled', scrollY > 4), { passive: true });

  const toggleBrowser = () => run(() => api(S.state?.browser === 'open' ? '/api/browser/close' : '/api/browser/open'));
  $('#btnBrowser').addEventListener('click', toggleBrowser);
  $('#btnBrowserStep').addEventListener('click', toggleBrowser);

  const input = $('#username');
  input.addEventListener('input', () => (input.dataset.edited = '1'));
  const scan = () =>
    run(async () => {
      if (S.state?.scan.running) return api('/api/scan/stop');
      await api('/api/scan', { username: input.value.trim().replace(/^@/, '') });
    });
  $('#btnScan').addEventListener('click', scan);
  $('#btnRescan').addEventListener('click', scan);
  input.addEventListener('keydown', (e) => e.key === 'Enter' && scan());

  // Filter
  const f = S.filters;
  $('#fKeyword').value = f.keyword;
  $('#fFrom').value = f.from;
  $('#fTo').value = f.to;
  $('#fStatus').value = f.status;
  $('#fSort').value = f.sort;
  const markPreset = () => $$('#datePresets button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.preset === f.preset)));
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
  $('#btnFilterToggle').addEventListener('click', (e) => {
    const open = $('#filters').classList.toggle('open');
    e.currentTarget.setAttribute('aria-expanded', String(open));
  });

  // Auswahl (Shift+Klick = Bereich)
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
    renderSelection();
  });
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
    renderSelection();
    if (n) toast(`${plural(n, 'Repost', 'Reposts')} ausgewählt.`);
  });
  $('#btnClearSel').addEventListener('click', () => {
    S.selected.clear();
    $$('.item.selected').forEach((el) => el.classList.remove('selected'));
    renderSelection();
  });

  $$('[data-view-mode]').forEach((b) =>
    b.addEventListener('click', () => {
      S.view = b.dataset.viewMode;
      local.set('view', S.view);
      $$('[data-view-mode]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      $('#grid').classList.toggle('list', S.view === 'list');
    }),
  );
  $$('[data-view-mode]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.viewMode === S.view)));

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
  $('#btnRunClose').addEventListener('click', () => {
    S.runDismissedAt = S.state.job.finishedAt;
    renderRun();
  });

  // Protokoll
  $$('[data-log-filter]').forEach((b) =>
    b.addEventListener('click', () => {
      S.logFilter = b.dataset.logFilter;
      $$('[data-log-filter]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      renderLog();
    }),
  );

  // Einstellungen: jede Änderung speichert sich selbst
  const form = $('#formSettings');
  form.addEventListener('input', queueSave);
  form.addEventListener('change', queueSave);
  form.addEventListener('submit', (e) => e.preventDefault());
  $('#btnDefaults').addEventListener('click', () => {
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
      const el = form.elements[k];
      if (!el) continue;
      if (el.type === 'checkbox') el.checked = v;
      else el.value = v;
    }
    queueSave();
  });
  $('#btnForget').addEventListener('click', async () => {
    const res = await run(() => api('/api/session/forget'));
    if (res) toast('Gespeichertes Browser-Profil gelöscht.');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.querySelector('dialog[open]') && S.selected.size) $('#btnClearSel').click();
  });
}

bindEvents();
connect();
