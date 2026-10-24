// Landingpage – die Fragmente des Tools zum Ausprobieren. Kein Tracking, keine externen Anfragen.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const nf = new Intl.NumberFormat('de-DE');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const hueOf = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 8;
  document.documentElement.classList.add('js');

  // ───────── Beispieldaten (erfundene Accounts) ─────────
  const DAY = 86400;
  const now = Date.now() / 1000;
  const SAMPLE = [
    ['mara.kocht', 'Pasta in 10 Minuten, nur drei Zutaten #rezept', 9, 191206],
    ['tanzschule.nord', 'Choreo zum neuen Song, Teil 2 #dance', 31, 6247],
    ['imbiss.atlas', 'Bester Döner der Stadt? Ehrlicher Test #food', 58, 955992],
    ['haushaltstricks', 'Werbung: mein Lieblingsprodukt für den Sommer #werbung', 96, 48211],
    ['oma.backt', 'Omas Apfelkuchen, das Originalrezept #rezept', 140, 312877],
    ['jo.unterwegs', 'Versteckter Strand an der Algarve #travel', 201, 929209],
    ['katerkarl', 'Er wollte doch nur spielen #katze', 260, 137193],
    ['lena.trainiert', '15 Minuten Ganzkörper ohne Geräte #fitness', 388, 74120],
    ['gruener.daumen', 'Monstera umtopfen ohne Drama #pflanzen', 421, 22904],
    ['autos.am.sonntag', 'Sonntagsausfahrt mit dem 911er #cars', 470, 581004],
    ['lernen.mit.ben', 'So lernst du für Klausuren in der Hälfte der Zeit #lernen', 515, 96425],
    ['meme.archiv', 'Wenn Mama fragt, wer das war #meme', 602, 4997],
  ].map(([author, desc, days, plays], i) => ({ id: String(i), author, desc, created: now - days * DAY, plays, status: 'pending', selected: false }));
  const caption = (d) => d.replace(/#[\p{L}\p{N}_]+/gu, '').trim();
  const date = (sec) => new Date(sec * 1000).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const compact = new Intl.NumberFormat('de-DE', { notation: 'compact', maximumFractionDigits: 1 });

  // ───────── Hero: das Tool, bedienbar ─────────
  const hero = { query: '', preset: 'all', running: false };
  const heroGrid = $('#heroGrid');

  function heroVisible() {
    const words = hero.query.toLowerCase().match(/-?"[^"]+"|\S+/g) ?? [];
    return SAMPLE.filter((it) => {
      if (hero.preset === 'old' && it.created > now - 365 * DAY) return false;
      const hay = `${it.desc} @${it.author}`.toLowerCase();
      return words.every((w) => {
        const neg = w.startsWith('-') && w.length > 1;
        const term = (neg ? w.slice(1) : w).replace(/"/g, '');
        return neg ? !hay.includes(term) : hay.includes(term);
      });
    });
  }

  function renderHero() {
    const list = heroVisible();
    heroGrid.innerHTML = list.length
      ? list
        .map((it) => {
          const pill = it.status === 'working' ? '<span class="r-pill working">Wird entfernt</span>' : it.status === 'removed' ? '<span class="r-pill removed">Entfernt</span>' : '';
          return `<div class="r-item${it.status === 'removed' ? ' is-removed' : ''}" role="checkbox" tabindex="0" aria-checked="${it.selected}" aria-selected="${it.selected}" data-id="${it.id}" aria-label="@${esc(it.author)}: ${esc(it.desc)}">
            <div class="r-cover cv${hueOf(it.author)}"><p class="r-cap">${esc(caption(it.desc))}</p><span class="r-check"></span>${pill}<span class="r-plays num">${compact.format(it.plays)} Aufrufe</span></div>
            <div class="r-meta"><p class="r-who">@${esc(it.author)}</p><p class="r-date num">${date(it.created)}</p></div>
          </div>`;
        })
        .join('')
      : '<p class="r-empty">Kein Repost passt zu diesen Filtern.</p>';
    const open = SAMPLE.filter((i) => i.status !== 'removed');
    const old = open.filter((i) => i.created < now - 365 * DAY).length;
    $('#heroFinding').innerHTML = `<b>${open.length}</b> noch repostet, <b>${old}</b> davon älter als ein Jahr.`;
    $('.hero-app .app-count').textContent = open.length;
    const n = SAMPLE.filter((i) => i.selected && i.status === 'pending').length;
    const btn = $('#heroRemove');
    btn.disabled = n === 0 || hero.running;
    btn.textContent = hero.running ? 'Lauf läuft' : n ? `Entfernen: ${n}` : 'Auswahl entfernen';
  }

  heroGrid.addEventListener('click', (e) => {
    const card = e.target.closest('.r-item');
    if (!card) return;
    const it = SAMPLE[Number(card.dataset.id)];
    if (it.status !== 'pending') return;
    it.selected = !it.selected;
    renderHero();
  });
  heroGrid.addEventListener('keydown', (e) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    const card = e.target.closest('.r-item');
    if (!card) return;
    card.click();
    $(`.r-item[data-id="${card.dataset.id}"]`)?.focus();
  });
  $('#heroSearch').addEventListener('input', (e) => {
    hero.query = e.target.value;
    renderHero();
  });
  $$('[data-hero-preset]').forEach((b) =>
    b.addEventListener('click', () => {
      hero.preset = b.dataset.heroPreset;
      $$('[data-hero-preset]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      renderHero();
    }),
  );
  // „Entfernen“ spielt einen kurzen Lauf ab: einer nach dem anderen, mit Pausen dazwischen.
  $('#heroRemove').addEventListener('click', async () => {
    const queue = SAMPLE.filter((i) => i.selected && i.status === 'pending');
    hero.running = true;
    for (const it of queue) {
      it.status = 'working';
      renderHero();
      await wait(reduced ? 150 : 900);
      it.status = 'removed';
      it.selected = false;
      renderHero();
      await wait(reduced ? 150 : 700 + Math.random() * 900);
    }
    hero.running = false;
    renderHero();
  });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  SAMPLE[3].selected = true;
  SAMPLE[7].selected = true;
  renderHero();

  // Signatur: Bühne öffnet sich
  const stage = $('#stage');
  const openStage = () => requestAnimationFrame(() => stage.classList.add('open'));
  if (document.fonts?.ready) document.fonts.ready.then(openStage);
  else openStage();
  setTimeout(openStage, 1200);

  // ───────── Live-Demo: Pausen einstellen, Dauer sehen ─────────
  const ctl = (id) => $(id);
  const fmtMin = (sec) => {
    const m = Math.round(sec / 60);
    if (m < 1) return 'unter 1 Min.';
    return m < 60 ? `${m} Min.` : `${Math.floor(m / 60)} Std. ${m % 60} Min.`;
  };
  const fmtClock = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
  function rng(seed) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function readPlan() {
    let min = Number(ctl('#cMin').value);
    let max = Number(ctl('#cMax').value);
    if (max < min + 2) {
      max = min + 2;
      ctl('#cMax').value = max;
    }
    const every = Number(ctl('#cEvery').value);
    const brk = Number(ctl('#cBreak').value);
    const s = {
      count: Number(ctl('#cCount').value), min, max,
      everyLo: Math.max(3, every - 3), everyHi: every + 4,
      breakLo: Math.round(brk * 0.545), breakHi: Math.round(brk * 1.455),
      perRun: Number(ctl('#cRun').value), dry: ctl('#cDry').checked,
    };
    $('#oCount').textContent = s.count;
    $('#oMin').textContent = `${min} s`;
    $('#oMax').textContent = `${max} s`;
    $('#oEvery').textContent = `${s.everyLo}–${s.everyHi}`;
    $('#oBreak').textContent = `${fmtClock(s.breakLo)}–${fmtClock(s.breakHi)}`;
    $('#oRun').textContent = s.perRun;
    $('#oDry').textContent = s.dry ? 'an' : 'aus';
    return s;
  }

  // Dieselbe Logik wie im Tool (tool/src/throttle.js), mit festem Startwert für ruhige Darstellung.
  function simulate(s) {
    const r = rng(42);
    const between = (a, b) => a + (b - a) * ((r() + r()) / 2);
    const n = Math.min(s.count, s.perRun);
    const marks = [];
    const breaks = [];
    let t = 0;
    let pauses = 0;
    let since = 0;
    let breakAfter = Math.round(between(s.everyLo, s.everyHi));
    for (let i = 0; i < n; i++) {
      t += s.dry ? 1 : between(5, 9);
      marks.push(t);
      if (i === n - 1 || s.dry) continue;
      since += 1;
      if (since >= breakAfter) {
        const d = between(s.breakLo, s.breakHi);
        breaks.push([t, t + d]);
        t += d;
        pauses += d;
        since = 0;
        breakAfter = Math.round(between(s.everyLo, s.everyHi));
      } else {
        let d = between(s.min, s.max);
        if (r() < 0.12) d += between(4, 15);
        t += d;
        pauses += d;
      }
    }
    return { n, total: t, pauses, marks, breaks };
  }

  const strip = $('#dmStrip');
  let plan = null;
  let playT = null;
  let playTimer = null;

  function drawPlan() {
    const s = readPlan();
    plan = simulate(s);
    const total = plan.total;
    $('#dmCount').textContent = nf.format(s.count);
    $('#dmDuration').textContent = fmtMin(total);
    const end = new Date(Date.now() + total * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    const parts = [];
    if (!s.dry) parts.push(`davon ${fmtMin(plan.pauses)} Pausen`);
    else parts.push('Testlauf: nichts wird entfernt');
    parts.push(`fertig gegen ${end}`);
    if (s.count > s.perRun) parts.push(`die übrigen ${nf.format(s.count - s.perRun)} im nächsten Lauf`);
    $('#dmSub').textContent = parts.join(', ');
    const pct = (t) => `${(t / total) * 100}%`;
    const html = [];
    for (const [a, b] of plan.breaks) html.push(`<span class="brk" data-l="${pct(a)}" data-w="${((b - a) / total) * 100}%"></span>`);
    plan.marks.forEach((m, i) => html.push(`<span class="mk" data-i="${i}" data-l="${pct(m)}"></span>`));
    html.push('<span class="now" data-l="0%" hidden></span>');
    strip.innerHTML = html.join('');
    for (const el of strip.children) {
      el.style.left = el.dataset.l;
      if (el.dataset.w) el.style.width = el.dataset.w;
    }
    $('#dmAxis').innerHTML = `<span>Start</span><span>${fmtMin(total / 2)}</span><span>${fmtMin(total)}</span>`;
    renderQueue(-1);
    if (playT !== null) stopPlay();
  }

  function renderQueue(doneUntil) {
    const items = SAMPLE.slice(0, 5);
    $('#dmQueue').innerHTML = items
      .map((it, i) => {
        const done = i <= doneUntil;
        const on = i === doneUntil + 1 && playT !== null;
        return `<li class="${done ? 'done' : ''}${on ? ' on' : ''}"><span class="q-thumb cv${hueOf(it.author)}"></span>
          <span><span class="q-who">@${esc(it.author)}</span><span class="q-desc">${esc(it.desc)}</span></span>
          <span class="q-state">${done ? 'Entfernt' : on ? 'Als Nächstes' : 'Wartet'}</span></li>`;
      })
      .join('');
  }

  function stopPlay() {
    clearInterval(playTimer);
    playT = null;
    $('#dmPlay').textContent = 'Lauf abspielen';
    const nowEl = $('.now', strip);
    if (nowEl) nowEl.hidden = true;
    $$('.mk', strip).forEach((m) => m.classList.remove('todo'));
    renderQueue(-1);
  }

  $('#dmPlay').addEventListener('click', () => {
    if (playT !== null) return stopPlay();
    playT = 0;
    $('#dmPlay').textContent = 'Anhalten';
    $$('.mk', strip).forEach((m) => m.classList.add('todo'));
    const nowEl = $('.now', strip);
    nowEl.hidden = false;
    const step = 100;
    playTimer = setInterval(() => {
      playT += (step / 1000) * 60; // 60-mal schneller
      const done = plan.marks.filter((m) => m <= playT).length;
      $$('.mk', strip).forEach((m, i) => m.classList.toggle('todo', i >= done));
      nowEl.style.left = `${Math.min(100, (playT / plan.total) * 100)}%`;
      renderQueue(Math.min(done, 5) - 1);
      if (playT >= plan.total) {
        clearInterval(playTimer);
        playTimer = null;
        playT = null;
        $('#dmPlay').textContent = 'Nochmal abspielen';
        renderQueue(Math.min(plan.n, 5) - 1);
      }
    }, step);
  });
  $$('.demo-controls input').forEach((el) => el.addEventListener('input', drawPlan));
  drawPlan();

  // ───────── Filter-Panel mit Randnotizen ─────────
  const parts = (name) => $(`.fa-field[data-part="${name}"]`);
  $$('.note').forEach((note) => {
    const on = (v) => {
      note.classList.toggle('on', v);
      parts(note.dataset.note)?.classList.toggle('on', v);
    };
    note.addEventListener('mouseenter', () => on(true));
    note.addEventListener('mouseleave', () => on(false));
    note.addEventListener('focus', () => on(true));
    note.addEventListener('blur', () => on(false));
  });
  $$('.fa-field').forEach((field) => {
    const note = $(`.note[data-note="${field.dataset.part}"]`);
    field.addEventListener('mouseenter', () => note?.classList.add('on'));
    field.addEventListener('mouseleave', () => note?.classList.remove('on'));
  });
  const fa = $('#filterApp');
  function faCount() {
    const kw = $('#faKw').value.trim().toLowerCase();
    const creators = $$('.fa-creators [aria-selected="true"] b').reduce((a, b) => a + Number(b.textContent), 0) || 264;
    const preset = $$('.fa-field[data-part="date"] [aria-pressed="true"]')[0]?.textContent ?? '';
    const dateF = { '30 Tage': 0.08, '12 Monate': 0.55, 'Älter als 1 Jahr': 0.45 }[preset] ?? 1;
    const kwF = !kw ? 1 : kw.includes('#rezept') ? 0.5 : 0.3;
    $('.fa-result').innerHTML = `<b>${Math.max(0, Math.round(creators * dateF * kwF))}</b> von 264 angezeigt`;
  }
  fa.addEventListener('click', (e) => {
    const chip = e.target.closest('.app-chips button');
    if (chip) {
      const on = chip.getAttribute('aria-pressed') !== 'true';
      $$('button', chip.parentElement).forEach((b) => b.setAttribute('aria-pressed', 'false'));
      chip.setAttribute('aria-pressed', String(on));
    }
    const creator = e.target.closest('.fa-creators button');
    if (creator) creator.setAttribute('aria-selected', String(creator.getAttribute('aria-selected') !== 'true'));
    faCount();
  });
  $('#faKw').addEventListener('input', faCount);
  faCount();

  // ───────── Fragen: eine Antwort im großen Feld ─────────
  const pane = $('#faqPane');
  const tabs = $$('.faq-q');
  function selectQ(tab, focus) {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      $(`#${t.getAttribute('aria-controls')}`).hidden = !on;
    });
    const text = $(`#${tab.getAttribute('aria-controls')} p`).textContent;
    if (pane.textContent !== text) {
      pane.classList.add('fade');
      setTimeout(() => {
        pane.textContent = text;
        pane.classList.remove('fade');
      }, reduced ? 0 : 150);
    }
    if (focus) tab.focus();
  }
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => selectQ(t));
    t.addEventListener('mouseenter', () => matchMedia('(hover: hover)').matches && selectQ(t));
    t.addEventListener('focus', () => selectQ(t));
    t.addEventListener('keydown', (e) => {
      const d = { ArrowDown: 1, ArrowUp: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      selectQ(tabs[(i + d + tabs.length) % tabs.length], true);
    });
  });
  selectQ(tabs[0]);

  // ───────── Kopieren ─────────
  $$('.copy').forEach((btn) =>
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy);
        btn.textContent = 'Kopiert';
      } catch {
        btn.textContent = 'Strg+C';
      }
      setTimeout(() => (btn.textContent = 'Kopieren'), 1600);
    }),
  );

  // ───────── Aufnahme nur abspielen, wenn sichtbar ─────────
  const video = $('#runVideo');
  if (video && 'IntersectionObserver' in window && !reduced) {
    new IntersectionObserver(([e]) => (e.isIntersecting ? video.play().catch(() => {}) : video.pause()), { threshold: 0.25 }).observe(video);
  }

  // ───────── Einblenden: Überschrift, Text, Bild nacheinander ─────────
  if ('IntersectionObserver' in window && !reduced) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      },
      { rootMargin: '0px 0px -6% 0px', threshold: 0.05 },
    );
    const groups = new Map();
    $$('.reveal').forEach((el) => {
      const parent = el.closest('section, .how-step, footer') ?? document.body;
      const i = groups.get(parent) ?? 0;
      groups.set(parent, i + 1);
      el.style.transitionDelay = `${Math.min(i, 6) * 75}ms`;
      io.observe(el);
    });
  } else {
    $$('.reveal').forEach((el) => el.classList.add('in'));
  }

  // ───────── Download-Info ─────────
  fetch('/download/info.json', { headers: { accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : null))
    .then((info) => {
      if (!info?.available) {
        $('#dlSha').textContent = 'Erscheint, sobald ein Build veröffentlicht ist.';
        return;
      }
      const kb = info.size / 1024;
      const size = kb > 1024 ? `${(kb / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.round(kb)} KB`;
      const day = new Date(info.builtAt).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
      $('#dlMeta').textContent = `Version ${info.version}, ${size}, Stand ${day}`;
      $('#dlSha').textContent = `SHA-256: ${info.sha256}`;
    })
    .catch(() => ($('#dlSha').textContent = 'Erscheint, sobald ein Build veröffentlicht ist.'));
})();
