/* ============================================================================
   scroll-world — portable scroll-scrubbed camera-flight engine
   ----------------------------------------------------------------------------
   Framework-agnostic. Vanilla JS, zero dependencies. It builds its own DOM and
   injects its own (namespaced) CSS into a container you give it, so it drops into
   plain HTML, Next.js (call from a ref/useEffect), Vue (onMounted), a server-
   rendered page, anything.

   USAGE
     mountScrollWorld(document.getElementById('world'), {
       brand: { name: 'Pearl & Co.', href: '#top', logo: 'brand/logo.svg' },  // logo image replaces
                                                                               // the generic mark+name
       diveScroll: 1.3,   // viewport-heights of scroll per dive clip
       connScroll: 0.9,   // ...per connector clip
       hint: 'scroll to fly in',
       nav: true,         // show the top section nav
       atmosphere: true,  // subtle gradient + drifting particles behind the clips
       controls: { play: 'Play', skip: 'Skip', speed: 0.28 },
                          // optional — replaces the per-section pills in the top nav with
                          // two buttons: a play/pause toggle that auto-scrolls the page at
                          // `speed` viewport-heights/sec (any wheel/touch/key input
                          // cancels it), and a text button that fast-scrolls to the end.
                          // The side dot nav (route) is untouched either way.
                          // Omit to keep the default per-section pill nav.
       sections: [
         { id, label, still, stillMobile, clip, clipMobile, accent,
           scroll: 1.6,   // optional per-section override of diveScroll — more scroll
                          // distance = a slower, longer dwell in this scene
           linger: 0.5,   // optional 0..1 — remaps time so the camera settles mid-scene
                          // (exactly where the copy peaks) and moves quicker at the
                          // edges. 0 = linear (default). Keep ≤ 0.6; 1 = full pause.
           eyebrow, title, body, tags:[…],
           cta:{ primary:{label,href}, secondary:{label,href} } }, // last section only
         …
       ],
       connectors: [clipUrl, …],          // length = sections.length - 1 (nulls allowed)
       connectorsMobile: [clipUrl, …],    // optional lighter connectors for phones (same length)

   MOBILE (the clipMobile/connectorsMobile variants are the opt-in mobile version;
   the rest of the phone handling below is always on)
     The engine is phone-aware out of the box: on a coarse-pointer / ≤860px viewport it
       - loads `clipMobile` / `connectorsMobile` when provided (encode these smaller +
         tighter-GOP — seek cost on a phone decoder is dominated by frames-from-keyframe,
         so a 720p, -g 4 file scrubs far smoother than the 1080p desktop master; see
         pipeline.md). Falls back to the desktop `clip` if no mobile variant is given.
       - uses `stillMobile` as the scene poster when provided (pair it with native 9:16
         clipMobile renders so the poster matches the portrait video's first frame instead
         of flashing from a landscape crop). Chosen once at mount; a desktop resize into
         phone width keeps the desktop poster (clips still switch via isMobile()).
       - coalesces seeks (never issues a new currentTime while the decoder is still
         `seeking`) so fast flicks can't pile up and freeze the video.
       - keeps the still as a live poster until the clip actually paints its first frame,
         and primes each video (muted play→pause) on first touch — this is what stops iOS
         from showing a blank scene before the first seek.
       - drops the drifting particles and ignores URL-bar-only resizes (no scroll jump).
     Nothing here is required — a config with only `clip`/`connectors` still works on
     phones; the mobile variants just make it lighter and smoother.

   THEME (CSS custom properties; set on the container or :root to override)
     --sw-bg         page background (match your scene bg for seamless posters)
     --sw-ink        primary text
     --sw-ink-soft   secondary text
     --sw-accent     default accent (each section overrides via its `accent`)
     --sw-font-display / --sw-font-body

   REQUIREMENTS ON YOUR ASSETS
     - clips encoded native-res, crf~20, -g 8, +faststart, no audio (see pipeline.md)
     - connectors' endpoints are the neighbouring dives' ACTUAL frames (see SKILL Step 5)
     - (optional) mobile variants at ~720p, -g 4 for smoother phone scrubbing
   The engine loads each clip as a Blob (always seekable) and scrubs currentTime; it does
   NOT depend on HTTP byte-range support.

   PHONE DECODER BUDGET (always on)
     Phones allow only a handful of hardware video decoders at once. Blobs are fetched
     for every nearby segment (nearest-first, `maxFetchMobile` at a time, default 2), but
     a <video> element only exists for the current segment ± `liveRadius` (default 1);
     the rest are detached and fall back to their still. A seek that stays pending for
     >0.7 s is treated as a wedged decoder: re-issued once, then the <video> is rebuilt
     from the cached blob.
   ========================================================================== */

function mountScrollWorld(container, config) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Phone detection. `coarse` is captured once (input type doesn't change mid-session);
  // the ≤860px query is read live via isMobile() so a desktop resize/DevTools toggle
  // switches sources and seek behaviour without a reload.
  const coarse = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  const smallMQ = window.matchMedia('(max-width: 860px)');
  const isMobile = () => coarse || smallMQ.matches;
  const SECTIONS = config.sections || [];
  const CONNECTORS = config.connectors || [];
  const CONNECTORS_M = config.connectorsMobile || [];
  const DIVE_W = config.diveScroll || 1.3;
  const CONN_W = config.connScroll || 0.9;
  const CROSSFADE = (config.crossfade != null) ? config.crossfade : 0.12;  // seam dissolve width (vh)
  const N = SECTIONS.length;
  if (!N) return;

  injectCSS();
  container.classList.add('sw-root');

  // ---- build the interleaved segment chain: dive0, conn0, dive1, … diveN-1 ----
  const SEGMENTS = [];
  SECTIONS.forEach((s, i) => {
    const dive = { kind: 'dive', si: i, clip: s.clip, clipM: s.clipMobile, still: s.still, stillM: s.stillMobile,
                   accent: s.accent, w: s.scroll || DIVE_W, linger: s.linger || 0 };
    SEGMENTS.push(dive);
    s._seg = dive;
    // A connector is optional: if connectors[i] is falsy, the two dives simply
    // crossfade directly (no fly-over). Lets a page complete even when a
    // connector can't be generated (e.g. a content-filter false-positive).
    if (i < N - 1 && CONNECTORS[i]) {
      SEGMENTS.push({ kind: 'conn', si: i, clip: CONNECTORS[i], clipM: CONNECTORS_M[i],
                      still: SECTIONS[i + 1].still, stillM: SECTIONS[i + 1].stillMobile,
                      accent: SECTIONS[i + 1].accent, w: CONN_W });
    }
  });
  const NSEG = SEGMENTS.length;

  // ---- DOM ----
  const sky = el('div', 'sw-sky');
  if (config.atmosphere !== false) {
    sky.appendChild(el('div', 'sw-sky__grad'));
    sky.appendChild(el('div', 'sw-sky__glow'));
  }
  const particles = el('div', 'sw-particles'); sky.appendChild(particles);

  const scrollbar = el('div', 'sw-scrollbar');
  const scrollbarFill = el('span'); scrollbar.appendChild(scrollbarFill);

  const topbar = el('div', 'sw-topbar');
  if (config.brand) {
    const brand = el('a', 'sw-brand'); brand.href = (config.brand.href || '#');
    if (config.brand.logo) {
      const lg = el('img', 'sw-brand__logo');
      lg.src = config.brand.logo; lg.alt = config.brand.name || ''; lg.decoding = 'async';
      brand.appendChild(lg);
    } else {
      brand.appendChild(el('span', 'sw-brand__mark'));
      const nm = el('span', 'sw-brand__name'); nm.textContent = config.brand.name || ''; brand.appendChild(nm);
    }
    topbar.appendChild(brand);
  }
  const nav = el('nav', 'sw-nav'); if (config.nav !== false) topbar.appendChild(nav);
  if (config.cta && config.cta.label) {
    const c = el('a', 'sw-topcta'); c.href = config.cta.href || '#'; c.textContent = config.cta.label;
    topbar.appendChild(c);
  }

  const stage = el('div', 'sw-stage');
  const copylayer = el('div', 'sw-copylayer');
  const route = el('div', 'sw-route');
  const routeFill = el('div', 'sw-route__fill'); route.appendChild(routeFill);
  const hint = el('div', 'sw-hint');
  const hintText = el('span'); hintText.textContent = config.hint || 'scroll'; hint.appendChild(hintText);
  hint.appendChild(el('i'));
  const track = el('div', 'sw-track');

  [sky, scrollbar, topbar, stage, copylayer, route, hint, track].forEach(n => container.appendChild(n));

  // segment scenes
  SEGMENTS.forEach(s => {
    const scene = el('div', 'sw-scene'); scene.style.setProperty('--sw-accent', s.accent || '');
    const img = el('img', 'sw-scene__still'); img.alt = ''; img.decoding = 'async'; img.loading = 'lazy';
    const poster = (isMobile() && s.stillM) ? s.stillM : s.still;
    if (poster) img.src = poster;
    scene.appendChild(img); stage.appendChild(scene);
    s.el = scene; s.img = img; s.video = null; s.hasClip = false; s.blobUrl = null;
    s.loading = false; s.ready = false; s.cur = 0; s.target = 0; s.visible = false;
    s.idx = SEGMENTS.indexOf(s); s.seekSince = 0; s.stalls = 0;
  });

  // per-section copy / route / nav
  const copies = [], dots = [];
  SECTIONS.forEach((s, i) => {
    const c = el('article', 'sw-copy'); c.style.setProperty('--sw-accent', s.accent || '');
    c.innerHTML =
      (s.eyebrow ? `<span class="sw-copy__eyebrow">${esc(s.eyebrow)}</span>` : '') +
      (s.title ? `<h2 class="sw-copy__title">${esc(s.title)}</h2>` : '') +
      (s.body ? `<p class="sw-copy__body">${esc(s.body)}</p>` : '') +
      (s.tags && s.tags.length ? `<ul class="sw-copy__tags">${s.tags.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : '') +
      (s.cta ? `<div class="sw-copy__cta">${ctaBtns(s.cta)}</div>` : '');
    copylayer.appendChild(c); copies.push(c);

    const dot = el('button', 'sw-route__dot'); dot.style.setProperty('--sw-accent', s.accent || '');
    dot.innerHTML = `<span class="sw-route__label">${esc(s.label || '')}</span><i></i>`;
    dot.addEventListener('click', () => jumpTo(i)); route.appendChild(dot); dots.push(dot);

    if (config.nav !== false && !config.controls) {
      const b = el('button', 'sw-nav__item'); b.textContent = s.label || '';
      b.addEventListener('click', () => jumpTo(i)); nav.appendChild(b);
    }
  });

  // ---- math ----
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };
  // Per-section dwell: monotone remap of scroll→time so the camera settles mid-scene
  // (where the copy peaks) and moves quicker near the seams. L=0 linear, L=1 full
  // mid-scene pause. f(0)=0, f(1)=1 always, so seam frames are untouched.
  const lingerEase = (x, L) => { L = clamp(L); const c = x - 0.5; return (1 - L) * x + L * (4 * c * c * c + 0.5); };
  let vh = window.innerHeight, stageX = 0, totalW = 0, activeIndex = -1, ticking = false;
  let laidOutW = window.innerWidth;   // width the current layout was computed at (see onResize)

  // ---- top-nav playback controls (opt-in via config.controls; replaces the pill nav) ----
  if (config.controls && config.nav !== false) {
    nav.classList.add('sw-nav--controls');
    const playBtn = el('button', 'sw-nav__play');
    playBtn.type = 'button';
    playBtn.setAttribute('aria-label', config.controls.play || 'Play');
    playBtn.appendChild(el('span', 'sw-nav__play-icon'));
    playBtn.appendChild(el('span', 'sw-nav__pause-icon'));
    nav.appendChild(playBtn);

    const skipBtn = el('button', 'sw-nav__item');
    skipBtn.type = 'button';
    skipBtn.textContent = config.controls.skip || 'Skip';
    nav.appendChild(skipBtn);

    const AUTOPLAY_VH_S = config.controls.speed || 0.28;   // viewport-heights/sec — matched
                                                            // to a ~5s clip covering a ~1.4vh segment
    let autoplayId = null, autoplayLast = null, skipId = null;

    function stopAutoplay() {
      if (autoplayId != null) { cancelAnimationFrame(autoplayId); autoplayId = null; }
      autoplayLast = null;
      playBtn.classList.remove('is-playing');
    }
    function stopSkip() { if (skipId != null) { cancelAnimationFrame(skipId); skipId = null; } }
    function stopAutoNav() { stopAutoplay(); stopSkip(); }

    function stepAutoplay(now) {
      if (autoplayLast == null) autoplayLast = now;
      const dt = (now - autoplayLast) / 1000; autoplayLast = now;
      const max = document.documentElement.scrollHeight - innerHeight;
      if (window.scrollY >= max - 1) { stopAutoplay(); return; }
      window.scrollBy(0, AUTOPLAY_VH_S * vh * dt);
      autoplayId = requestAnimationFrame(stepAutoplay);
    }
    playBtn.addEventListener('click', () => {
      if (autoplayId != null) { stopAutoplay(); return; }
      stopSkip();
      playBtn.classList.add('is-playing');
      autoplayId = requestAnimationFrame(stepAutoplay);
    });

    // Fast-forwards to the end of the scroll-world flight itself (totalW * vh — not the
    // full document, which may run on past the track into trailing static content the
    // host page appended) over `dur` ms, eased — a quick flight rather than a jump cut —
    // so whatever reveals as the flight lands (e.g. a product shot gated on scroll
    // fraction) comes in the same way it would naturally.
    function fastSkip() {
      stopAutoNav();
      const max = Math.min(totalW * vh, document.documentElement.scrollHeight - innerHeight);
      const startY = window.scrollY, dist = max - startY;
      if (dist <= 1) return;
      if (reduce) { window.scrollTo(0, max); return; }
      const dur = 1500, t0 = performance.now();
      (function tick(now) {
        const p = clamp((now - t0) / dur, 0, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        window.scrollTo(0, startY + dist * eased);
        skipId = p < 1 ? requestAnimationFrame(tick) : null;
      })(t0);
    }
    skipBtn.addEventListener('click', fastSkip);

    // Any manual input hands control back to the user.
    ['wheel', 'touchstart', 'keydown'].forEach(evt =>
      window.addEventListener(evt, stopAutoNav, { passive: true }));
  }

  // The route rail's fill (progress line) is measured in real pixels off the
  // actual dot layout rather than assumed CSS offsets, so it's exact
  // whatever the gap/padding/dot size end up being at this viewport width.
  let routeDotTop = 0, routeDotSpan = 0;
  function measureRoute() {
    if (!dots.length) return;
    const top = dots[0].offsetTop + dots[0].offsetHeight / 2;
    const bottom = dots[dots.length - 1].offsetTop + dots[dots.length - 1].offsetHeight / 2;
    routeDotTop = top; routeDotSpan = bottom - top;
    routeFill.style.top = top + 'px';
  }
  function updateRouteFill(near) {
    const frac = dots.length > 1 ? near / (dots.length - 1) : 0;
    routeFill.style.height = Math.max(0, routeDotSpan * frac) + 'px';
  }

  function layout() {
    vh = window.innerHeight;
    laidOutW = window.innerWidth;
    stageX = window.innerWidth > 860 ? 4 : 0;
    let off = 0;
    SEGMENTS.forEach(s => { s.start = off * vh; off += s.w; s.end = off * vh; });
    totalW = off;
    track.style.height = (totalW * vh + vh) + 'px';   // +1vh so the last flight completes
    measureRoute();
    read();
  }

  function jumpTo(i) {
    const seg = SECTIONS[i]._seg;
    window.scrollTo({ top: seg.start + (seg.end - seg.start) * 0.5, behavior: reduce ? 'auto' : 'smooth' });
  }

  // ---- clip loading: download (blob) is decoupled from decoding (<video>) ----
  // Phones cap the number of hardware video decoders alive at once (typically 2–4).
  // The old code attached a <video> for every nearby segment and never let go, so
  // from the second clip on the decoder never came up, `seeking` stuck true and the
  // frame froze. Now: blobs are fetched for every nearby segment (cheap, just memory),
  // but on a phone a <video> only exists for the current segment and its two
  // neighbours (LIVE_RADIUS); anything further is detached and shows its still.
  // Downloads are also queued nearest-first with a small concurrency so the clip
  // you are actually looking at isn't starved by its neighbours.
  const LIVE_RADIUS = (config.liveRadius != null) ? config.liveRadius : 1;
  const MAX_FETCH_MOBILE = (config.maxFetchMobile != null) ? config.maxFetchMobile : 2;
  let curSeg = 0, fetching = 0;
  const fetchQueue = [];

  function loadClip(s) {
    // Under prefers-reduced-motion we never load the clips at all — the stills stay up
    // and simply cross-dissolve as you scroll. No scrubbed video motion, no decode cost.
    if (reduce || s.loading || !s.clip) return;
    s.loading = true;
    fetchQueue.push(s);
    pumpFetch();
  }

  function pumpFetch() {
    const max = isMobile() ? MAX_FETCH_MOBILE : Infinity;
    while (fetching < max && fetchQueue.length) {
      // nearest to the current segment first
      let bi = 0;
      for (let k = 1; k < fetchQueue.length; k++) {
        if (Math.abs(fetchQueue[k].idx - curSeg) < Math.abs(fetchQueue[bi].idx - curSeg)) bi = k;
      }
      const s = fetchQueue.splice(bi, 1)[0];
      fetching++;
      // Serve the lighter mobile encode on phones when one was provided.
      const url = (isMobile() && s.clipM) ? s.clipM : s.clip;
      fetch(url).then(r => r.ok ? r.blob() : Promise.reject(new Error('404')))
        .then(blob => { s.blobUrl = URL.createObjectURL(blob); syncLive(); })
        .catch(() => { s.loading = false; })
        .then(() => { fetching--; pumpFetch(); });
    }
  }

  function wantLive(s) { return !isMobile() || Math.abs(s.idx - curSeg) <= LIVE_RADIUS; }

  // Attach/detach <video> elements so that only the wanted segments hold a decoder.
  function syncLive() {
    // Detach first so the decoder is free before a neighbour claims it.
    for (let i = 0; i < NSEG; i++) { const s = SEGMENTS[i]; if (s.video && !wantLive(s)) detachVideo(s); }
    // Attach current first, then the neighbours.
    const order = [];
    for (let i = 0; i < NSEG; i++) order.push(SEGMENTS[i]);
    order.sort((a, b) => Math.abs(a.idx - curSeg) - Math.abs(b.idx - curSeg));
    order.forEach(s => { if (!s.video && s.blobUrl && wantLive(s)) attachVideo(s); });
  }

  function attachVideo(s) {
    const v = document.createElement('video');
    v.className = 'sw-scene__video';
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
    v.src = s.blobUrl;
    v.addEventListener('loadedmetadata', () => { if (s.video === v) { s.ready = true; s.cur = s.target; read(); } });
    // Reveal the video (hide the still poster) only once a real frame has
    // painted — on iOS a seeked-but-never-played muted video stays blank, so
    // hiding the still on metadata alone would flash an empty scene.
    v.addEventListener('seeked', () => { if (s.video === v) s.el.classList.add('has-clip'); }, { once: true });
    v.addEventListener('loadeddata', () => { try { v.pause(); } catch (e) {} primeVideo(v); });
    v.addEventListener('error', () => { if (s.video === v) reattachVideo(s); });
    s.el.appendChild(v); s.video = v; s.hasClip = true; s.ready = false;
    s.seekSince = 0; s.stalls = 0;
  }

  function detachVideo(s) {
    const v = s.video; if (!v) return;
    s.video = null; s.hasClip = false; s.ready = false;
    s.el.classList.remove('has-clip');
    try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) {}
    v.remove();
  }

  function reattachVideo(s) { detachVideo(s); if (s.blobUrl && wantLive(s)) attachVideo(s); }

  function read() {
    const y = window.scrollY || window.pageYOffset;
    const fade = CROSSFADE * vh;
    let ci = 0;
    for (let i = 0; i < NSEG; i++) if (y >= SEGMENTS[i].start) ci = i;
    if (ci !== curSeg) { curSeg = ci; syncLive(); }

    for (let i = 0; i < NSEG; i++) {
      const s = SEGMENTS[i];
      if (y > s.start - 1.6 * vh && y < s.end + 1.6 * vh) loadClip(s);
      const local = clamp((y - s.start) / (s.end - s.start), 0, 1);
      s.target = s.linger ? lingerEase(local, s.linger) : local;
      let outside = 0;
      if (y < s.start) outside = s.start - y; else if (y > s.end) outside = y - s.end;
      const op = smooth(1 - outside / fade);
      s.el.style.opacity = op; s.visible = op > 0.001;
      s.el.style.zIndex = (i === ci) ? '120' : String(100 + Math.round(op * 10));
      if (!s.hasClip || !s.ready) {
        const sc = reduce ? 1 : 1.03 + local * 0.14;
        s.img.style.transform = `translateX(${stageX - 2}vw) scale(${sc.toFixed(3)})`;
      }
    }

    for (let i = 0; i < N; i++) {
      const seg = SECTIONS[i]._seg;
      const pr = clamp((y - seg.start) / (seg.end - seg.start), 0, 1);
      const before = y < seg.start, after = y > seg.end;
      let cop;
      if (i === 0) cop = after ? 0 : smooth(1 - pr / 0.62);            // greets on landing
      else if (i === N - 1) cop = before ? 0 : smooth(pr / 0.4);       // holds CTA at the end
      else cop = (before || after) ? 0 : smooth(1 - Math.abs(pr - 0.5) / 0.5);
      const c = copies[i];
      c.style.opacity = cop;
      c.style.transform = reduce ? 'none' : `translateY(${(0.5 - pr) * 4}vh)`;
      c.style.pointerEvents = cop > 0.5 ? 'auto' : 'none';
    }

    const cur = SEGMENTS[ci];
    const near = clamp(cur.kind === 'dive' ? cur.si
      : (((y - cur.start) / (cur.end - cur.start)) > 0.5 ? cur.si + 1 : cur.si), 0, N - 1);
    if (near !== activeIndex) {
      activeIndex = near;
      dots.forEach((d, k) => d.classList.toggle('is-active', k === near));
      updateRouteFill(near);
      // In controls mode the lone .sw-nav__item is the "ABAWA" skip button, not a
      // per-section pill — it has no scroll-position-based active state.
      if (!config.controls) {
        nav.querySelectorAll('.sw-nav__item').forEach((n, k) => n.classList.toggle('is-active', k === near));
      }
      container.style.setProperty('--sw-accent', SECTIONS[near].accent || '');
    }
    scrollbarFill.style.transform = `scaleX(${clamp(y / (totalW * vh))})`;
    hint.style.opacity = clamp(1 - y / (0.5 * vh));
    if (particles) particles.style.transform = `translate3d(0, ${-y * 0.05}px, 0)`;
    ticking = false;
  }

  const STALL_MS = 700;   // a seek older than this on a phone means the decoder is wedged
  function raf(now) {
    const eps = isMobile() ? 0.02 : 0.008;   // coarser seek step on phones = fewer decodes
    for (let i = 0; i < NSEG; i++) {
      const s = SEGMENTS[i];
      if (!s.hasClip || !s.ready || !s.video) continue;
      // Never queue a seek while the decoder is still resolving the last one.
      // On phones a fast flick would otherwise pile up seeks and freeze the clip;
      // cur keeps lerping, so we snap to the latest target the moment it's free.
      if (s.video.seeking) {
        // Watchdog: a seek that never resolves is a wedged decoder (phone evicted it
        // or never granted one). First strike: re-issue the seek. Second: rebuild the
        // <video> from the cached blob so it claims a fresh decoder.
        if (!s.seekSince) s.seekSince = now;
        else if (now - s.seekSince > STALL_MS) {
          s.seekSince = 0; s.stalls++;
          if (s.stalls >= 2) { s.stalls = 0; reattachVideo(s); }
          else { try { s.video.currentTime = clamp(s.target, 0, 0.999) * (s.video.duration || 1); } catch (e) {} }
        }
        continue;
      }
      s.seekSince = 0;
      if (!s.visible && Math.abs(s.cur - s.target) < 0.002) continue;
      s.cur += (s.target - s.cur) * (reduce ? 1 : 0.18);
      const dur = s.video.duration || 1;
      const t = clamp(s.cur, 0, 0.999) * dur;
      if (Math.abs(s.video.currentTime - t) > eps) { try { s.video.currentTime = t; } catch (e) {} }
    }
    requestAnimationFrame(raf);
  }

  // iOS needs a user gesture before a muted video will decode/paint reliably. On the
  // first touch we prime every loaded clip (muted play→pause) so the first seek is
  // instant instead of showing a blank frame. `userReady` also makes freshly-loaded
  // clips prime themselves (see loadClip).
  let userReady = false;
  function primeVideo(v) {
    if (!isMobile() || !v) return;
    // Muted inline playback is allowed without a gesture on modern phones; when it
    // isn't, the promise rejects harmlessly and onFirstGesture retries for the live set.
    try { const p = v.play(); if (p && p.then) p.then(() => { try { v.pause(); } catch (e) {} }).catch(() => {}); }
    catch (e) {}
  }
  function onFirstGesture() {
    if (userReady) return;
    userReady = true;
    SEGMENTS.forEach(s => { if (s.video) primeVideo(s.video); });
  }
  window.addEventListener('pointerdown', onFirstGesture, { once: true, passive: true });
  window.addEventListener('touchstart', onFirstGesture, { once: true, passive: true });

  // Particles are a per-frame cost we can't afford alongside video scrubbing on a phone.
  seedParticles(particles, reduce || coarse);
  window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(read); } }, { passive: true });
  // Mobile browsers fire `resize` every time the URL bar slides in/out. Re-running
  // layout() there rebuilds the track height and yanks the scroll position, so on
  // touch we ignore height-only changes and only relayout when the width actually
  // changes (rotation still comes through orientationchange). layout() records the
  // width it laid out at.
  function onResize() {
    if (coarse && window.innerWidth === laidOutW) return;
    layout();
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', layout);
  window.addEventListener('load', layout);
  layout();
  requestAnimationFrame(raf);

  // ---- helpers ----
  function el(tag, cls) { const n = document.createElement(tag); if (cls) n.className = cls; return n; }
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function ctaBtns(cta) {
    let h = '';
    if (cta.primary) h += `<a class="sw-btn sw-btn--primary" href="${esc(cta.primary.href || '#')}">${esc(cta.primary.label)}</a>`;
    if (cta.secondary) h += `<a class="sw-btn sw-btn--ghost" href="${esc(cta.secondary.href || '#')}">${esc(cta.secondary.label)}</a>`;
    return h;
  }
}

function seedParticles(host, reduce) {
  if (!host || reduce) return;
  const kinds = ['dot', 'dot', 'ring'];
  const seeds = [7, 23, 41, 58, 71, 88, 12, 34, 52, 66, 83, 95, 18, 29, 47, 63, 77, 91, 5, 38, 55, 69, 82, 97];
  for (let k = 0; k < 20; k++) {
    const s = document.createElement('span');
    s.className = 'sw-pt sw-pt--' + kinds[k % kinds.length];
    s.style.left = seeds[k % seeds.length] + 'vw';
    s.style.top = ((seeds[(k * 3) % seeds.length] * 1.3) % 100) + 'vh';
    s.style.setProperty('--sw-sc', (0.5 + ((seeds[(k * 5) % seeds.length] % 60) / 60) * 1.1).toFixed(2));
    const dur = 14 + (seeds[(k * 7) % seeds.length] % 22);
    s.style.animationDuration = dur + 's';
    s.style.animationDelay = (-(seeds[(k * 2) % seeds.length] % dur)) + 's';
    host.appendChild(s);
  }
}

function injectCSS() {
  if (document.getElementById('sw-css')) return;
  const css = `
  .sw-root{--sw-bg:#F5EDE0;--sw-ink:#241d2b;--sw-ink-soft:#6a6072;--sw-accent:#8a7bb5;
    --sw-font-display:ui-rounded,"SF Pro Rounded","Segoe UI",system-ui,sans-serif;
    --sw-font-body:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif;
    color:var(--sw-ink);font-family:var(--sw-font-body);}
  html,body{margin:0;background:var(--sw-bg,#F5EDE0);overflow-x:hidden;}
  .sw-sky{position:fixed;inset:0;z-index:0;overflow:hidden;pointer-events:none;background:var(--sw-bg);}
  .sw-sky__grad{position:absolute;inset:-10%;background:linear-gradient(178deg,color-mix(in srgb,var(--sw-accent) 12%,var(--sw-bg)) 0%,var(--sw-bg) 55%,color-mix(in srgb,var(--sw-accent) 6%,var(--sw-bg)) 100%);}
  .sw-sky__glow{position:absolute;inset:0;background:radial-gradient(60% 42% at 74% 16%,color-mix(in srgb,var(--sw-accent) 22%,transparent),transparent 70%),radial-gradient(46% 34% at 50% 50%,color-mix(in srgb,#fff 45%,transparent),transparent 70%);}
  .sw-particles{position:absolute;inset:-6% -2%;will-change:transform;}
  .sw-pt{position:absolute;width:13px;height:13px;transform:scale(var(--sw-sc,1));opacity:0;animation:sw-drift linear infinite;}
  .sw-pt::before{content:"";position:absolute;inset:0;border-radius:50%;}
  .sw-pt--dot::before{background:radial-gradient(circle at 34% 30%,color-mix(in srgb,var(--sw-accent) 60%,#000),#000 82%);}
  .sw-pt--ring::before{background:transparent;border:2px solid color-mix(in srgb,var(--sw-accent) 55%,transparent);}
  @keyframes sw-drift{0%{opacity:0;transform:scale(var(--sw-sc)) translate(0,12vh) rotate(0)}12%{opacity:.5}88%{opacity:.45}100%{opacity:0;transform:scale(var(--sw-sc)) translate(4vw,-22vh) rotate(210deg)}}
  .sw-scrollbar{position:fixed;top:0;left:0;right:0;height:3px;z-index:60;background:color-mix(in srgb,var(--sw-accent) 14%,transparent);}
  .sw-scrollbar span{display:block;height:100%;width:100%;transform-origin:0 50%;transform:scaleX(0);background:var(--sw-accent);}
  .sw-topbar{position:fixed;top:0;left:0;right:0;z-index:50;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:clamp(14px,2.4vw,26px) clamp(18px,5vw,64px);}
  .sw-brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:var(--sw-ink);}
  .sw-brand__mark{width:24px;height:28px;border-radius:7px 7px 10px 10px;background:linear-gradient(160deg,var(--sw-accent),color-mix(in srgb,var(--sw-accent) 60%,#000));box-shadow:0 6px 14px color-mix(in srgb,var(--sw-accent) 40%,transparent);}
  .sw-brand__name{font-family:var(--sw-font-display);font-weight:700;font-size:1.1rem;}
  .sw-brand__logo{display:block;height:clamp(19px,2.5vw,27px);width:auto;position:relative;top:5px;}
  .sw-nav{display:flex;gap:4px;padding:5px;background:color-mix(in srgb,#fff 55%,transparent);backdrop-filter:blur(10px);border:1px solid color-mix(in srgb,var(--sw-accent) 16%,transparent);border-radius:999px;}
  .sw-nav__item{font:inherit;font-size:.82rem;color:var(--sw-ink-soft);border:0;background:transparent;cursor:pointer;padding:7px 14px;border-radius:999px;transition:color .25s,background .25s;}
  .sw-nav__item:hover{color:var(--sw-ink);} .sw-nav__item.is-active{color:#fff;background:var(--sw-accent);}
  .sw-topcta{text-decoration:none;font-weight:600;font-size:.9rem;color:#fff;background:var(--sw-ink);padding:10px 20px;border-radius:999px;white-space:nowrap;}
  .sw-stage{position:fixed;inset:0;z-index:10;pointer-events:none;}
  .sw-scene{position:absolute;inset:0;opacity:0;overflow:hidden;will-change:opacity;}
  .sw-scene__video,.sw-scene__still{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 42%;}
  .sw-scene__still{will-change:transform;} .sw-scene.has-clip .sw-scene__still{opacity:0;} .sw-scene__video{z-index:1;}
  .sw-copylayer{position:fixed;inset:0;z-index:20;pointer-events:none;}
  .sw-copylayer::before{content:"";position:absolute;inset:0;width:min(58vw,780px);background:linear-gradient(90deg,var(--sw-bg) 0%,color-mix(in srgb,var(--sw-bg) 82%,transparent) 34%,color-mix(in srgb,var(--sw-bg) 40%,transparent) 62%,transparent 100%);}
  .sw-copy{position:absolute;left:clamp(18px,5vw,64px);top:50%;transform:translateY(-50%);width:min(42vw,460px);opacity:0;will-change:opacity,transform;}
  .sw-copy__eyebrow{display:block;font-family:var(--sw-font-display);font-weight:700;font-size:.8rem;letter-spacing:.16em;text-transform:uppercase;color:var(--sw-accent);}
  .sw-copy__title{font-family:var(--sw-font-display);font-weight:700;color:var(--sw-ink);font-size:clamp(2rem,4.4vw,3.5rem);line-height:1.03;margin:12px 0 0;letter-spacing:-.01em;text-shadow:0 2px 20px color-mix(in srgb,var(--sw-bg) 70%,transparent);}
  .sw-copy__body{margin-top:18px;font-size:clamp(1rem,1.25vw,1.14rem);line-height:1.55;color:color-mix(in srgb,var(--sw-ink) 78%,var(--sw-ink-soft));max-width:40ch;text-shadow:0 1px 12px color-mix(in srgb,var(--sw-bg) 90%,transparent);}
  .sw-copy__tags{list-style:none;display:flex;flex-wrap:wrap;gap:8px;margin:24px 0 0;padding:0;}
  .sw-copy__tags li{font-size:.82rem;font-weight:600;color:color-mix(in srgb,var(--sw-accent) 70%,#000);padding:7px 14px;border-radius:999px;background:color-mix(in srgb,var(--sw-accent) 14%,#fff);border:1px solid color-mix(in srgb,var(--sw-accent) 30%,transparent);}
  .sw-copy__cta{display:flex;flex-wrap:wrap;gap:12px;margin-top:28px;pointer-events:auto;}
  .sw-btn{text-decoration:none;font-weight:600;font-size:.95rem;padding:13px 24px;border-radius:999px;transition:transform .2s;}
  .sw-btn--primary{color:#fff;background:var(--sw-ink);} .sw-btn--primary:hover{transform:translateY(-2px);}
  .sw-btn--ghost{color:var(--sw-ink);border:1.5px solid color-mix(in srgb,var(--sw-ink) 25%,transparent);} .sw-btn--ghost:hover{transform:translateY(-2px);}
  .sw-route{position:fixed;right:clamp(14px,2.4vw,30px);top:50%;z-index:40;transform:translateY(-50%);display:flex;flex-direction:column;gap:22px;padding:18px 10px;}
  /* Riel neutro fijo (ni el color ni la línea dependen del accent de la
     sección activa — eso hacía que todo el riel "parpadeara" de tono al
     scrollear). .sw-route__fill es el tramo ya recorrido, medido en JS. */
  .sw-route::before{content:"";position:absolute;left:50%;top:22px;bottom:22px;width:2px;transform:translateX(-50%);background:color-mix(in srgb,var(--sw-ink) 20%,transparent);border-radius:2px;}
  .sw-route__fill{position:absolute;left:50%;top:22px;width:2px;height:0;transform:translateX(-50%);background:var(--sw-ink);opacity:.55;border-radius:2px;transition:height .5s cubic-bezier(.22,1,.36,1);pointer-events:none;}
  .sw-route__dot{position:relative;border:0;background:transparent;cursor:pointer;width:16px;height:16px;display:grid;place-items:center;}
  /* Relleno crema fijo (== fondo de página, no el accent variable) + anillo
     de contorno: se mantiene legible sin importar qué haya detrás (selva,
     río, mármol) en vez de mezclarse con la escena. */
  .sw-route__dot i{width:9px;height:9px;border-radius:50%;background:var(--sw-bg);box-shadow:0 0 0 1.5px color-mix(in srgb,var(--sw-ink) 45%,transparent),0 1px 3px color-mix(in srgb,#000 20%,transparent);transition:transform .3s,background .3s,box-shadow .3s;}
  .sw-route__dot:hover i{transform:scale(1.2);box-shadow:0 0 0 1.5px var(--sw-accent),0 1px 4px color-mix(in srgb,#000 22%,transparent);}
  .sw-route__dot.is-active i{background:var(--sw-accent);transform:scale(1.3);box-shadow:0 0 0 1.5px var(--sw-accent),0 0 0 4px color-mix(in srgb,var(--sw-bg) 85%,#fff),0 2px 6px color-mix(in srgb,#000 25%,transparent);}
  .sw-route__label{position:absolute;right:26px;top:50%;transform:translateY(-50%) translateX(6px);white-space:nowrap;font-family:var(--sw-font-display);font-weight:700;letter-spacing:.01em;font-size:.82rem;color:var(--sw-ink);background:color-mix(in srgb,var(--sw-bg) 90%,#fff);backdrop-filter:blur(6px);padding:6px 13px;border-radius:999px;opacity:0;pointer-events:none;transition:opacity .25s,transform .25s;border:1px solid color-mix(in srgb,var(--sw-accent) 30%,transparent);box-shadow:0 2px 10px color-mix(in srgb,#000 10%,transparent);}
  .sw-route__dot:hover .sw-route__label,.sw-route__dot.is-active .sw-route__label{opacity:1;transform:translateY(-50%) translateX(0);}
  .sw-nav--controls{padding:5px;gap:6px;}
  .sw-nav__play{position:relative;width:32px;height:32px;border-radius:50%;border:0;cursor:pointer;display:grid;place-items:center;background:transparent;transition:transform .2s,background .25s;}
  .sw-nav__play:hover{transform:scale(1.06);background:var(--sw-accent);}
  .sw-nav__play:hover .sw-nav__play-icon{border-color:transparent transparent transparent #fff;}
  .sw-nav__play:hover .sw-nav__pause-icon::before,.sw-nav__play:hover .sw-nav__pause-icon::after{background:#fff;}
  .sw-nav__play-icon{width:0;height:0;border-style:solid;border-width:6px 0 6px 10px;border-color:transparent transparent transparent var(--sw-ink);margin-left:2px;transition:border-color .2s;}
  .sw-nav__pause-icon{display:none;position:relative;width:10px;height:12px;}
  .sw-nav__pause-icon::before,.sw-nav__pause-icon::after{content:"";position:absolute;top:0;width:3px;height:12px;border-radius:1px;background:var(--sw-ink);transition:background .2s;}
  .sw-nav__pause-icon::before{left:0;} .sw-nav__pause-icon::after{right:0;}
  .sw-nav__play.is-playing .sw-nav__play-icon{display:none;}
  .sw-nav__play.is-playing .sw-nav__pause-icon{display:block;}
  .sw-hint{position:fixed;left:50%;bottom:26px;z-index:30;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:10px;font-size:.76rem;letter-spacing:.14em;text-transform:uppercase;color:var(--sw-ink-soft);transition:opacity .3s;}
  .sw-hint i{width:22px;height:34px;border-radius:12px;border:2px solid color-mix(in srgb,var(--sw-ink) 28%,transparent);position:relative;}
  .sw-hint i::after{content:"";position:absolute;left:50%;top:7px;width:4px;height:7px;border-radius:2px;background:var(--sw-accent);transform:translateX(-50%);animation:sw-wheel 1.7s ease-in-out infinite;}
  @keyframes sw-wheel{0%{opacity:0;top:6px}40%{opacity:1}100%{opacity:0;top:17px}}
  .sw-track{position:relative;z-index:1;width:100%;pointer-events:none;}
  @media (max-width:860px){
    .sw-nav{display:none;}
    .sw-nav--controls{display:flex;}
    .sw-copylayer::before{width:100%;height:60%;top:auto;bottom:0;background:linear-gradient(0deg,var(--sw-bg) 8%,color-mix(in srgb,var(--sw-bg) 70%,transparent) 46%,transparent 100%);}
    /* Anchor copy to the bottom, clear of the home indicator / collapsing URL bar.
       dvh + env() are progressive: browsers that lack them keep the vh fallback line. */
    .sw-copy{left:clamp(18px,5vw,64px);right:clamp(18px,5vw,64px);top:auto;bottom:clamp(64px,14vh,120px);transform:none;width:auto;max-width:560px;}
    .sw-copy{bottom:calc(clamp(56px,12dvh,110px) + env(safe-area-inset-bottom));}
    .sw-copy__title{font-size:clamp(1.9rem,7.5vw,2.7rem);}
    .sw-copy__body{max-width:none;font-size:clamp(.98rem,3.6vw,1.1rem);} .sw-scene__video,.sw-scene__still{object-position:center 46%;}
    .sw-hint{bottom:calc(20px + env(safe-area-inset-bottom));}
    .sw-route{gap:16px;right:6px;} .sw-route__label{display:none;}
  }
  /* Portrait phones crop a 16:9 clip hard; keep the framing centred so the focal
     subject (which the camera dives toward) stays in view. */
  @media (max-width:860px) and (orientation:portrait){
    .sw-scene__video,.sw-scene__still{object-position:center 44%;}
  }
  /* Touch: give the route dots a finger-sized hit area without growing the visible dot. */
  @media (hover:none) and (pointer:coarse){
    .sw-route{padding:14px 6px;}
    .sw-route__dot{width:28px;height:28px;}
    .sw-btn{padding:15px 26px;}
  }
  @media (prefers-reduced-motion:reduce){ .sw-hint i::after{animation:none;} .sw-pt{display:none;} }
  `;
  // Wrap in a cascade layer so the page's own theme tokens (unlayered
  // :root / .sw-root { --sw-bg / --sw-ink / --sw-accent … }) always win over
  // these defaults, regardless of injection order. Enables clean dark themes.
  const style = document.createElement('style'); style.id = 'sw-css';
  style.textContent = '@layer sw {\n' + css + '\n}';
  document.head.appendChild(style);
}

// Expose for module + global use.
if (typeof module !== 'undefined' && module.exports) module.exports = { mountScrollWorld };
if (typeof window !== 'undefined') window.mountScrollWorld = mountScrollWorld;
