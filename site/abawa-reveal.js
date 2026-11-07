/* Reveal final de Abawa: splash de chocolate líquido que fragua en la tableta real.

   Todo se dibuja en vivo (sin video), así que queda nítido a cualquier resolución:
   - el chocolate es SVG con un filtro "goo" (blur + umbral de alfa) que funde los
     blobs como líquido, más una luz especular que le da brillo;
   - la tableta es la foto real recortada (assets/tableta_abawa.webp), que aparece
     sobre el líquido como si se asentara en él.

   Uso:  const r = AbawaReveal.mount(el, { src, onEnd });  r.play();  r.reset();  r.renderAt(t);
   `renderAt(t)` pinta el instante t (segundos) sin animar; sirve para QA. */
(function () {
  const DUR = 1.35;           // duración del splash (s); el brillo final corre aparte
  const BAR_RATIO = 1300 / 2714;
  const NS = 'http://www.w3.org/2000/svg';

  // PRNG con semilla: el splash es idéntico cada vez que se repite.
  function rng(seed) {
    return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  }
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const seg = (t, a, b) => clamp((t - a) / (b - a));
  const easeOut = (x) => 1 - Math.pow(1 - x, 3);
  const easeInOut = (x) => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  const backOut = (x) => { const c = 1.6; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };

  function mount(root, opts) {
    root.innerHTML = `
      <div class="abawa-veil"></div>
      <svg class="abawa-goo" aria-hidden="true">
        <defs>
          <filter id="abawa-goo-f" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">
            <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="b"/>
            <feColorMatrix in="b" mode="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 24 -10" result="goo"/>
            <feGaussianBlur in="goo" stdDeviation="5" result="gb"/>
            <feSpecularLighting in="gb" surfaceScale="9" specularConstant="1.3" specularExponent="30"
                                lighting-color="#fff1e2" result="spec">
              <feDistantLight azimuth="235" elevation="34"/>
            </feSpecularLighting>
            <feComposite in="spec" in2="goo" operator="in" result="specIn"/>
            <feComposite in="specIn" in2="goo" operator="arithmetic" k1="0" k2="0.9" k3="1" k4="0"/>
          </filter>
          <radialGradient id="abawa-choc" cx="45%" cy="35%" r="75%">
            <stop offset="0" stop-color="#7d4535"/><stop offset="1" stop-color="#4b2419"/>
          </radialGradient>
        </defs>
        <g filter="url(#abawa-goo-f)" fill="url(#abawa-choc)"></g>
      </svg>
      <div class="abawa-bar">
        <img alt="" decoding="async">
        <i class="abawa-bar__shine"></i>
      </div>`;
    const veil = root.querySelector('.abawa-veil');
    const svg = root.querySelector('svg');
    const blur1 = svg.querySelector('feGaussianBlur');
    const g = svg.querySelector('g');
    const bar = root.querySelector('.abawa-bar');
    const img = bar.querySelector('img');
    img.src = opts.src;

    // Geometría (px de viewport): la tableta centrada, más chica en vertical.
    let W, H, bw, bh, cx, cy, u;
    function layout() {
      W = innerWidth; H = innerHeight;
      const portrait = H > W;
      bh = portrait ? Math.min(H * 0.6, W * 0.78 / BAR_RATIO) : H * 0.74;
      bw = bh * BAR_RATIO;
      cx = W / 2; cy = H * (portrait ? 0.5 : 0.52);
      u = Math.min(W, H) / 1000;                    // unidad relativa al viewport
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      blur1.setAttribute('stdDeviation', (10 * u * 1.4).toFixed(1));
      Object.assign(bar.style, {
        width: bw + 'px', height: bh + 'px',
        left: (cx - bw / 2) + 'px', top: (cy - bh / 2) + 'px',
        borderRadius: (bw * 0.0127) + 'px',
      });
    }

    // Elementos del líquido.
    const el = (tag) => g.appendChild(document.createElementNS(NS, tag));
    const fall = el('ellipse');       // la gota que cae y provoca el splash
    const core = el('rect');          // la masa que crece hasta tener forma de tableta
    const arms = [];                  // brazos de líquido: cadenas de blobs que el filtro funde
    const drops = [];                 // la corona: gotas que salen disparadas
    const back = [];                  // gotas que vuelven y se funden en la tableta
    const R = rng(7);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + (R() - .5) * 0.3;
      const reach = 0.55 + R() * 0.6, beads = [];
      for (let j = 0; j < 5; j++) beads.push(el('circle'));
      arms.push({ a, reach, beads, w: 0.8 + R() * 0.5, t0: 0.08 + R() * 0.05 });
    }
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + (R() - .5) * 0.35;
      drops.push({ n: el('ellipse'), a, v: 0.75 + R() * 0.9, r: 9 + R() * 16,
                   t0: 0.1 + R() * 0.12, life: 0.55 + R() * 0.4, up: R() * 0.6 });
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + R() * 0.5;
      back.push({ n: el('circle'), a, d: 1.25 + R() * 0.35, r: 10 + R() * 9, t0: 0.42 + R() * 0.18 });
    }

    // Pinta el instante t (s).
    function renderAt(t) {
      const k = u * 1.4;

      // Velo crema: la escena del mármol pasa a segundo plano.
      veil.style.opacity = (0.72 * easeOut(seg(t, 0, 0.5))).toFixed(3);

      // Gota que cae desde arriba e impacta en el centro (0–0.1 s).
      const fp = seg(t, 0, 0.1);
      if (fp < 1) {
        const fy = -60 * k + (cy + 60 * k) * fp * fp, fr = 26 * k;
        fall.setAttribute('cx', cx); fall.setAttribute('cy', fy);
        fall.setAttribute('rx', fr); fall.setAttribute('ry', fr * (1 + 1.6 * fp));
      } else { fall.setAttribute('rx', 0); fall.setAttribute('ry', 0); }

      // Núcleo: de gota a rectángulo de tableta (con rebote), y luego se recoge
      // justo por dentro del borde para que no asome bajo la foto.
      const grow = backOut(seg(t, 0.08, 0.5));
      const settle = easeInOut(seg(t, 0.75, 1.2));
      const cw = Math.max(0, bw * 1.0 * grow * (1 - 0.06 * settle));
      const ch = Math.max(0, bh * 1.02 * backOut(seg(t, 0.1, 0.56)) * (1 - 0.06 * settle));
      const rr = Math.min(cw, ch) / 2 * (1 - 0.85 * seg(t, 0.15, 0.5));
      core.setAttribute('x', cx - cw / 2); core.setAttribute('y', cy - ch / 2);
      core.setAttribute('width', cw); core.setAttribute('height', ch);
      core.setAttribute('rx', rr); core.setAttribute('ry', rr);
      const coreFade = 1 - seg(t, 1.1, DUR);
      core.style.opacity = coreFade;

      // Brazos: salen disparados del impacto, se adelgazan hacia la punta y se
      // recogen hacia la tableta; el filtro los funde como un solo líquido.
      const span = Math.hypot(bw, bh) * 0.5;
      for (const a of arms) {
        const out = easeOut(seg(t, a.t0, a.t0 + 0.26));
        const ret = easeInOut(seg(t, a.t0 + 0.3, a.t0 + 0.75));
        const ext = span * a.reach * out * (1 - ret);
        const ca = Math.cos(a.a), sa = Math.sin(a.a);
        a.beads.forEach((b, j) => {
          const f = (j + 1) / a.beads.length;
          const d = span * 0.25 * out + ext * f;
          b.setAttribute('cx', cx + ca * d * (bw / span) * 1.1);
          b.setAttribute('cy', cy + sa * d * (bh / span) * 0.75);
          b.setAttribute('r', Math.max(0, 30 * k * a.w * (1 - 0.72 * f) * out * (1 - ret * 0.9)));
        });
      }

      // Corona: balística simple con gravedad; las gotas se estiran según su
      // velocidad y se encogen hasta desaparecer (el filtro las "corta" del cuerpo).
      const grav = 2400 * k;
      for (const d of drops) {
        const lt = t - d.t0;
        if (lt <= 0 || lt > d.life) { d.n.setAttribute('rx', 0); d.n.setAttribute('ry', 0); continue; }
        const sp = d.v * 1250 * k;
        const ox = cx + Math.cos(d.a) * bw * 0.42, oy = cy + Math.sin(d.a) * bh * 0.42;
        const vx = Math.cos(d.a) * sp, vy = Math.sin(d.a) * sp * 0.8 - d.up * 700 * k;
        const x = ox + vx * lt, y = oy + vy * lt + 0.5 * grav * lt * lt;
        const vyNow = vy + grav * lt;
        const speed = Math.hypot(vx, vyNow);
        const life = lt / d.life;
        const r = d.r * k * (1 - life * life) * (life < 0.12 ? life / 0.12 : 1);
        const stretch = 1 + speed / (1600 * k);
        d.n.setAttribute('cx', x); d.n.setAttribute('cy', y);
        d.n.setAttribute('rx', Math.max(0, r * stretch)); d.n.setAttribute('ry', Math.max(0, r / Math.sqrt(stretch)));
        d.n.setAttribute('transform', `rotate(${(Math.atan2(vyNow, vx) * 180 / Math.PI).toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})`);
      }

      // Gotas de regreso: caen hacia la tableta y se funden con ella.
      for (const b of back) {
        const p = seg(t, b.t0, b.t0 + 0.38);
        if (p <= 0 || p >= 1) { b.n.setAttribute('r', 0); continue; }
        const e = easeInOut(p);
        const d = b.d + (0.45 - b.d) * e;
        b.n.setAttribute('cx', cx + Math.cos(b.a) * bw * 0.5 * d);
        b.n.setAttribute('cy', cy + Math.sin(b.a) * bh * 0.5 * d);
        b.n.setAttribute('r', b.r * k * Math.sin(Math.PI * Math.min(1, p * 1.15)));
      }

      // La tableta real emerge del líquido: entra con un poco de escala y foco.
      const bi = easeOut(seg(t, 0.3, 0.68));
      bar.style.opacity = bi.toFixed(3);
      bar.style.transform = `scale(${(1.05 - 0.05 * bi).toFixed(4)})`;
      img.style.filter = bi < 1 ? `blur(${(6 * (1 - bi)).toFixed(2)}px)` : '';
    }

    let raf = 0, t0 = 0;
    function frame(now) {
      const t = (now - t0) / 1000;
      renderAt(Math.min(t, DUR));
      if (t < DUR) { raf = requestAnimationFrame(frame); return; }
      raf = 0;
      bar.classList.add('is-shining');
      if (opts.onEnd) opts.onEnd();
    }
    function play() {
      cancelAnimationFrame(raf);
      bar.classList.remove('is-shining');
      void bar.offsetWidth;            // reinicia la animación CSS del brillo
      layout();
      t0 = performance.now();
      raf = requestAnimationFrame(frame);
    }
    function reset() {                 // vuelve al estado previo al splash (invisible)
      cancelAnimationFrame(raf); raf = 0; t0 = 0;
      bar.classList.remove('is-shining');
      layout(); renderAt(0);
    }
    function finish() {                // estado final sin animar (reduced motion)
      cancelAnimationFrame(raf); raf = 0;
      layout(); renderAt(DUR);
    }

    layout(); renderAt(0);
    addEventListener('resize', () => { layout(); if (!raf) renderAt(t0 ? DUR : 0); });
    return { play, reset, finish, renderAt: (t) => { layout(); renderAt(t); }, duration: DUR };
  }

  window.AbawaReveal = { mount };
})();
