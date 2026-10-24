// Landingpage – kleine Progressive-Enhancement-Schicht. Kein Tracking, keine externen Requests.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.documentElement.classList.add('js');

  // Navigation bekommt beim Scrollen einen Hintergrund
  const nav = $('#nav');
  const onScroll = () => nav.classList.toggle('scrolled', scrollY > 12);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Sanftes Einblenden beim Scrollen
  if ('IntersectionObserver' in window && !reduced) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    );
    $$('.reveal').forEach((el, i) => {
      el.style.transitionDelay = `${(i % 3) * 70}ms`;
      io.observe(el);
    });
  } else {
    $$('.reveal').forEach((el) => el.classList.add('in'));
  }

  // Betriebssystem-Tabs (vorausgewählt nach erkanntem System)
  const tabs = $$('.tabs [role="tab"]');
  const select = (os) => {
    tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.os === os)));
    $$('.tabpanel').forEach((p) => (p.hidden = p.dataset.panel !== os));
  };
  tabs.forEach((t) => t.addEventListener('click', () => select(t.dataset.os)));
  $('.tabs')?.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const i = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    select(next.dataset.os);
    next.focus();
  });
  const ua = navigator.userAgent;
  select(/Mac/i.test(ua) ? 'mac' : /Linux|X11/i.test(ua) && !/Android/i.test(ua) ? 'linux' : 'win');

  // Kopieren-Buttons
  $$('.copy').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const text = btn.parentElement.querySelector('code').innerText.replace(/\s+#.*$/gm, '');
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = 'Kopiert ✓';
        btn.classList.add('done');
      } catch {
        btn.textContent = 'Strg+C';
      }
      setTimeout(() => {
        btn.textContent = 'Kopieren';
        btn.classList.remove('done');
      }, 1800);
    }),
  );

  // Visualisierung: unregelmäßige Pausen + lange Pausen
  const track = $('#timeline');
  if (track) {
    const rand = (a, b) => a + (b - a) * ((Math.random() + Math.random()) / 2);
    const rows = 5;
    let untilBreak = Math.round(rand(3, 6));
    for (let r = 0; r < rows; r++) {
      const row = document.createElement('div');
      row.className = 'tl-row';
      let used = 0;
      while (used < 100) {
        const act = document.createElement('span');
        act.className = 'tl-act';
        row.append(act);
        used += 3;
        untilBreak -= 1;
        const seg = document.createElement('span');
        if (untilBreak <= 0 && used < 70) {
          seg.className = 'tl-break';
          seg.textContent = 'Pause';
          const w = rand(22, 30);
          seg.style.width = `${w}%`;
          used += w;
          untilBreak = Math.round(rand(3, 6));
        } else {
          seg.className = 'tl-gap';
          const w = rand(4, 11);
          seg.style.width = `${Math.min(w, Math.max(0, 100 - used))}%`;
          used += w;
        }
        row.append(seg);
      }
      track.append(row);
    }
  }

  // Countdown im App-Mockup
  const cd = $('#mockCountdown');
  if (cd && !reduced) {
    let n = 11;
    setInterval(() => {
      n = n <= 1 ? Math.round(8 + Math.random() * 10) : n - 1;
      cd.textContent = n;
    }, 1000);
  }

  // Versions- und Prüfsummeninfo des aktuellen Downloads
  fetch('/download/info.json', { headers: { accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : null))
    .then((info) => {
      if (!info?.available) return;
      const kb = info.size / 1024;
      const size = kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`;
      const date = new Date(info.builtAt).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
      $('#dlLabel').textContent = `Version ${info.version} herunterladen`;
      $('#dlMeta').textContent = `${info.file} · ${size} · Stand ${date}`;
      $('#dlSha').textContent = info.sha256;
      $('#dlChecksum').hidden = false;
    })
    .catch(() => {});
})();
