// Draws the hero ¹H spectrum from the task's reported peak list, plus the chart
// tooltip and the BibTeX copy button. No dependencies.
(function () {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function el(name, attrs, parent) {
    const n = document.createElementNS(NS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  // ---- line list from a reported peak --------------------------------------
  // Splits a peak into first-order lines using its multiplicity letters and J
  // values. Ranges reported as "m" have no stated pattern, so they are drawn
  // as a smooth cluster across the range.
  const SPLIT = { d: [1, 1], t: [1, 2, 1], q: [1, 3, 3, 1], p: [1, 4, 6, 4, 1] };

  function lines(peak, mhz) {
    const centre = peak.shift != null ? peak.shift : (peak.range[0] + peak.range[1]) / 2;
    const mult = (peak.mult || "s").replace(/\s+/g, " ").trim();
    const broad = /^br/.test(mult);
    const letters = mult.replace(/^br\s*/, "");
    let out = [{ ppm: centre, w: 1 }];
    let width = broad ? 5 : 0.9; // half width at half height, Hz

    if (peak.range || letters === "m") {
      const lo = peak.range ? peak.range[0] : centre - 0.012;
      const hi = peak.range ? peak.range[1] : centre + 0.012;
      const n = Math.max(5, Math.round(((hi - lo) * mhz) / 3));
      out = [];
      for (let i = 0; i < n; i++) {
        const f = i / (n - 1);
        out.push({ ppm: lo + f * (hi - lo), w: 0.35 + Math.sin(Math.PI * f) });
      }
      width = 1.6;
    } else if (/^[dtqp]+$/.test(letters)) {
      const Js = peak.J && peak.J.length ? peak.J : [7];
      [...letters].forEach((ch, i) => {
        const J = (Js[i] != null ? Js[i] : Js[Js.length - 1]) / mhz;
        const pattern = SPLIT[ch];
        const next = [];
        out.forEach((l) => {
          pattern.forEach((c, k) => {
            next.push({ ppm: l.ppm + (k - (pattern.length - 1) / 2) * J, w: l.w * c });
          });
        });
        out = next;
      });
    }
    const total = out.reduce((s, l) => s + l.w, 0);
    return out.map((l) => ({ ppm: l.ppm, area: (l.w / total) * peak.nH, hw: width / mhz }));
  }

  function lorentz(ppm, all) {
    let y = 0;
    for (const l of all) {
      const d = ppm - l.ppm;
      y += (l.area * l.hw) / (Math.PI * (d * d + l.hw * l.hw));
    }
    return y;
  }

  // ---- the spectrum ----------------------------------------------------------
  function drawSpectrum(host) {
    const data = JSON.parse(host.dataset.spectrum);
    const mhz = data.freq || 400;
    const peaks = data.h1.map((p) => ({ peak: p, lines: lines(p, mhz) }));
    const all = peaks.flatMap((p) => p.lines);

    const W = 1000, H = 330, L = 20, R = 980, BASE = 280, TOP = 30;
    const MAX = 12, MIN = 0;
    const x = (ppm) => L + ((MAX - ppm) / (MAX - MIN)) * (R - L);

    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "nmr", role: "img",
      "aria-label": `Proton NMR spectrum drawn from the reported peak list: ${data.h1.length} signals between ${Math.min(...data.h1.map(p => p.shift ?? p.range[0])).toFixed(2)} and ${Math.max(...data.h1.map(p => p.shift ?? p.range[1])).toFixed(2)} ppm.` });

    // chart-paper grid: a line every 0.5 ppm, heavier every 1 ppm
    const grid = el("g", { class: "paper" }, svg);
    for (let v = MIN; v <= MAX + 1e-9; v += 0.5) {
      const major = Math.abs(v - Math.round(v)) < 1e-9;
      el("line", { x1: x(v), x2: x(v), y1: TOP - 14, y2: BASE, class: major ? "major" : "minor" }, grid);
      if (major) {
        const t = el("text", { x: x(v), y: BASE + 24, "text-anchor": "middle", class: "tick" }, grid);
        t.textContent = v;
      }
    }
    for (let y = BASE; y >= TOP - 14; y -= 25) el("line", { x1: L, x2: R, y1: y, y2: y, class: "minor" }, grid);
    el("line", { x1: L, x2: R, y1: BASE, y2: BASE, class: "axis" }, svg);
    const unit = el("text", { x: R, y: BASE + 46, "text-anchor": "end", class: "tick" }, svg);
    unit.textContent = "δ (ppm)";

    // trace: sample densely, and always at each line centre so narrow lines keep their height
    const xs = [];
    for (let v = MAX; v >= MIN; v -= 0.0025) xs.push(v);
    all.forEach((l) => xs.push(l.ppm));
    xs.sort((a, b) => b - a);
    const ys = xs.map((v) => lorentz(v, all));
    const peakMax = Math.max(...ys);
    const scale = (BASE - TOP) / peakMax;
    const d = xs.map((v, i) => `${i ? "L" : "M"}${x(v).toFixed(2)},${(BASE - ys[i] * scale).toFixed(2)}`).join("");
    const trace = el("path", { d, class: "trace" }, svg);

    // integral: cumulative area, drawn as the pen-blue step curve above the peaks
    const totalH = data.h1.reduce((s, p) => s + p.nH, 0);
    const iTop = TOP - 8, iBase = TOP + 62;
    let acc = 0, prev = MAX;
    const sorted = all.slice().sort((a, b) => b.ppm - a.ppm);
    let id = `M${x(MAX)},${iBase}`;
    sorted.forEach((l) => {
      id += `L${x(l.ppm).toFixed(2)},${(iBase - (acc / totalH) * (iBase - iTop)).toFixed(2)}`;
      acc += l.area;
      id += `L${x(l.ppm).toFixed(2)},${(iBase - (acc / totalH) * (iBase - iTop)).toFixed(2)}`;
      prev = l.ppm;
    });
    id += `L${x(MIN)},${iTop}`;
    el("path", { d: id, class: "integral" }, svg);

    // zoom inset in the widest empty stretch of the axis
    const centres = data.h1.map((p) => (p.shift != null ? p.shift : (p.range[0] + p.range[1]) / 2)).sort((a, b) => b - a);
    let gap = { from: MAX, to: centres[0] };
    for (let i = 0; i < centres.length - 1; i++) {
      if (centres[i] - centres[i + 1] > gap.from - gap.to) gap = { from: centres[i], to: centres[i + 1] };
    }
    const insetW = Math.min(220, x(gap.to) - x(gap.from) - 40);
    const ix = (x(gap.from) + x(gap.to)) / 2 - insetW / 2, iy = TOP + 84, ih = 140;
    const inset = el("g", { class: "inset", transform: `translate(${ix},${iy})` }, svg);
    el("rect", { x: 0, y: 0, width: insetW, height: ih, class: "inset-box" }, inset);
    const insetPath = el("path", { class: "trace inset-trace" }, inset);
    const insetLabel = el("text", { x: 8, y: 16, class: "inset-label" }, inset);
    const insetScale = el("text", { x: insetW - 8, y: ih - 8, "text-anchor": "end", class: "inset-label muted" }, inset);
    const leader = el("line", { class: "leader" }, svg);

    function showInset(i) {
      const p = peaks[i];
      const ls = p.lines;
      const lo = Math.min(...ls.map((l) => l.ppm)), hi = Math.max(...ls.map((l) => l.ppm));
      const half = Math.max(0.03, (hi - lo) / 2 + 0.015);
      const c = (lo + hi) / 2;
      const pts = [];
      for (let k = 0; k <= 240; k++) {
        const v = c + half - (k / 240) * 2 * half;
        pts.push([v, lorentz(v, ls)]);
      }
      const m = Math.max(...pts.map((q) => q[1]));
      const px = (v) => 8 + ((c + half - v) / (2 * half)) * (insetW - 16);
      insetPath.setAttribute("d", pts.map((q, k) => `${k ? "L" : "M"}${px(q[0]).toFixed(1)},${(ih - 26 - (q[1] / m) * (ih - 52)).toFixed(1)}`).join(""));
      insetLabel.textContent = describe(p.peak, true);
      const hz = Math.round(2 * half * mhz);
      insetScale.textContent = `${hz} Hz wide`;
      leader.setAttribute("x1", x(c)); leader.setAttribute("x2", ix + insetW / 2);
      leader.setAttribute("y1", BASE - lorentz(c, all) * scale - 6); leader.setAttribute("y2", iy + ih);
      leader.setAttribute("y1", Math.max(iy + ih + 4, BASE - Math.max(...ls.map(l => lorentz(l.ppm, all))) * scale - 6));
    }

    function describe(p, short) {
      const where = p.shift != null ? p.shift.toFixed(2) : `${p.range[0].toFixed(2)}–${p.range[1].toFixed(2)}`;
      const J = p.J && p.J.length ? `, J = ${p.J.join(", ")} Hz` : "";
      return short ? `δ ${where}, ${p.mult}${J}, ${p.nH}H` : `δ ${where} ppm, ${p.mult}${J}, ${p.nH}H`;
    }

    // hit targets: one focusable band per reported signal
    const hits = el("g", { class: "hits" }, svg);
    const readout = document.getElementById("h1-readout");
    peaks.forEach((p, i) => {
      const ls = p.lines;
      const lo = Math.min(...ls.map((l) => l.ppm)), hi = Math.max(...ls.map((l) => l.ppm));
      const g = el("g", { class: "hit", tabindex: 0, role: "button", "aria-label": describe(p.peak) }, hits);
      const left = x(hi + 0.06), right = x(lo - 0.06);
      el("rect", { x: left, y: TOP - 14, width: Math.max(8, right - left), height: BASE - TOP + 14 }, g);
      const activate = () => {
        hits.querySelectorAll(".hit").forEach((h) => h.classList.remove("on"));
        g.classList.add("on");
        showInset(i);
        readout.textContent = describe(p.peak);
      };
      g.addEventListener("mouseenter", activate);
      g.addEventListener("focus", activate);
      g.addEventListener("click", activate);
    });

    host.appendChild(svg);

    // default inset: the first resolved multiplet, so the inset is never empty
    const first = peaks.findIndex((p) => /^[dtq]+$/.test(p.peak.mult) && p.peak.J.length);
    showInset(first >= 0 ? first : 0);

    // the one load moment: the trace is swept from high field to low, like a chart recorder
    if (!reduceMotion && trace.getTotalLength) {
      const len = trace.getTotalLength();
      trace.style.strokeDasharray = `${len}`;
      trace.style.strokeDashoffset = `${len}`;
      requestAnimationFrame(() => {
        trace.style.transition = "stroke-dashoffset 1.6s cubic-bezier(.45,0,.2,1)";
        trace.style.strokeDashoffset = "0";
      });
    }
  }

  // ---- graded steps resolve in order when the table comes into view ---------
  function revealSteps() {
    const table = document.querySelector(".steps");
    if (!table) return;
    if (reduceMotion || !("IntersectionObserver" in window)) return;
    table.classList.add("pending");
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        table.classList.remove("pending");
        table.classList.add("resolve");
        io.disconnect();
      }
    }, { threshold: 0.4 });
    io.observe(table);
  }

  // ---- dot plot tooltip -------------------------------------------------------
  function tooltips() {
    const tip = document.getElementById("tip");
    if (!tip) return;
    const chart = tip.parentElement;
    function show(e) {
      const g = e.currentTarget;
      tip.textContent = g.dataset.tip;
      tip.hidden = false;
      const dot = g.querySelector("circle").getBoundingClientRect();
      const box = chart.getBoundingClientRect();
      const left = Math.min(Math.max(dot.left - box.left + dot.width / 2, 120), box.width - 120);
      tip.style.left = `${left}px`;
      tip.style.top = `${dot.top - box.top - 10}px`;
    }
    const hide = () => { tip.hidden = true; };
    document.querySelectorAll(".dotplot .dot").forEach((g) => {
      g.addEventListener("mouseenter", show);
      g.addEventListener("focus", show);
      g.addEventListener("mouseleave", hide);
      g.addEventListener("blur", hide);
    });
  }

  // ---- copy BibTeX --------------------------------------------------------------
  function copyButtons() {
    document.querySelectorAll("button.copy").forEach((b) => {
      b.addEventListener("click", async () => {
        const text = document.querySelector(b.dataset.copy).textContent;
        try {
          await navigator.clipboard.writeText(text);
          b.textContent = "Copied";
        } catch (_) {
          b.textContent = "Select the text above to copy it";
        }
        setTimeout(() => { b.textContent = "Copy BibTeX"; }, 2000);
      });
    });
  }

  const host = document.getElementById("h1");
  if (host) drawSpectrum(host);
  revealSteps();
  tooltips();
  copyButtons();
})();
