/*
 * Minimal SVG charts: a multi-series line chart with a crosshair tooltip,
 * and a stacked-bar chart. Colors come from CSS custom properties so light
 * and dark themes stay in one place.
 */
(function () {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  };
  const fmt = (v) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : Number.isInteger(v) ? String(v) : v.toFixed(1));

  function niceMax(v) {
    if (v <= 0) return 10;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }

  function tooltip(host) {
    let tip = host.querySelector(".chart-tip");
    if (!tip) { tip = document.createElement("div"); tip.className = "chart-tip"; host.appendChild(tip); }
    return tip;
  }

  // series: [{ name, values, color: "var(--series-1)", dashed }]
  function line(host, { labels, series, height = 220, format = fmt }) {
    host.classList.add("chart");
    host.querySelectorAll("svg").forEach((s) => s.remove());
    const width = Math.max(280, host.clientWidth || 600);
    const pad = { t: 12, r: 56, b: 26, l: 36 };
    const w = width - pad.l - pad.r, h = height - pad.t - pad.b;
    const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
    const n = labels.length;
    const x = (i) => pad.l + (n === 1 ? w / 2 : (i * w) / (n - 1));
    const y = (v) => pad.t + h - (v / max) * h;

    const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, width, height, role: "img", "aria-label": series.map((s) => s.name).join(" and ") + " over time" });
    host.prepend(svg);

    for (let i = 0; i <= 4; i++) {
      const v = (max / 4) * i;
      el("line", { x1: pad.l, x2: pad.l + w, y1: y(v), y2: y(v), class: i === 0 ? "axis" : "gridline" }, svg);
      el("text", { x: pad.l - 8, y: y(v) + 4, class: "tick", "text-anchor": "end" }, svg).textContent = fmt(v);
    }
    const every = Math.ceil(n / 8);
    labels.forEach((l, i) => {
      if (i % every !== 0 && i !== n - 1) return;
      el("text", { x: x(i), y: height - 6, class: "tick", "text-anchor": "middle" }, svg).textContent = l;
    });

    const endLabels = [];
    series.forEach((s) => {
      const d = s.values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
      el("path", { d, fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round", "stroke-dasharray": s.dashed ? "5 4" : "none" }, svg);
      const last = s.values.length - 1;
      el("circle", { cx: x(last), cy: y(s.values[last]), r: 4, fill: s.color, class: "ring" }, svg);
      endLabels.push({ y: y(s.values[last]), text: s.name, color: s.color });
    });
    // Direct labels at line ends, nudged apart so they never overlap.
    endLabels.sort((a, b) => a.y - b.y);
    for (let i = 1; i < endLabels.length; i++) if (endLabels[i].y - endLabels[i - 1].y < 14) endLabels[i].y = endLabels[i - 1].y + 14;
    endLabels.forEach((l) => {
      el("text", { x: pad.l + w + 8, y: l.y + 4, class: "direct" }, svg).textContent = l.text;
    });

    // Hover layer.
    const cross = el("line", { y1: pad.t, y2: pad.t + h, class: "cross", visibility: "hidden" }, svg);
    const dots = series.map((s) => el("circle", { r: 4.5, fill: s.color, class: "ring", visibility: "hidden" }, svg));
    const hit = el("rect", { x: pad.l, y: pad.t, width: w, height: h, fill: "transparent" }, svg);
    const tip = tooltip(host);
    hit.addEventListener("mousemove", (e) => {
      const r = svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * width;
      const i = Math.max(0, Math.min(n - 1, Math.round(((px - pad.l) / w) * (n - 1))));
      cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("visibility", "visible");
      dots.forEach((dt, k) => { dt.setAttribute("cx", x(i)); dt.setAttribute("cy", y(series[k].values[i])); dt.setAttribute("visibility", "visible"); });
      tip.innerHTML = `<div class="tip-title">${labels[i]}</div>` + series.map((s) =>
        `<div class="tip-row"><span class="swatch${s.dashed ? " dashed" : ""}" style="--c:${s.color}"></span>${s.name}<b>${format(s.values[i])}</b></div>`).join("");
      tip.style.opacity = 1;
      const left = (x(i) / width) * r.width;
      tip.style.left = `${Math.min(r.width - 150, Math.max(0, left + 12))}px`;
      tip.style.top = `${pad.t}px`;
    });
    hit.addEventListener("mouseleave", () => {
      cross.setAttribute("visibility", "hidden"); dots.forEach((d) => d.setAttribute("visibility", "hidden")); tip.style.opacity = 0;
    });
  }

  // Stacked bars. series: [{ name, values, color }]
  function stacked(host, { labels, series, height = 200 }) {
    host.classList.add("chart");
    host.querySelectorAll("svg").forEach((s) => s.remove());
    const width = Math.max(280, host.clientWidth || 600);
    const pad = { t: 10, r: 8, b: 26, l: 40 };
    const w = width - pad.l - pad.r, h = height - pad.t - pad.b;
    const totals = labels.map((_, i) => series.reduce((s, se) => s + se.values[i], 0));
    const max = niceMax(Math.max(1, ...totals));
    const y = (v) => pad.t + h - (v / max) * h;
    const band = w / labels.length;
    const bw = Math.min(34, band * 0.6);

    const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, width, height, role: "img", "aria-label": "Stacked bars: " + series.map((s) => s.name).join(", ") });
    host.prepend(svg);
    for (let i = 0; i <= 4; i++) {
      const v = (max / 4) * i;
      el("line", { x1: pad.l, x2: pad.l + w, y1: y(v), y2: y(v), class: i === 0 ? "axis" : "gridline" }, svg);
      el("text", { x: pad.l - 8, y: y(v) + 4, class: "tick", "text-anchor": "end" }, svg).textContent = fmt(v);
    }
    const tip = tooltip(host);
    labels.forEach((label, i) => {
      const cx = pad.l + band * i + band / 2;
      el("text", { x: cx, y: height - 6, class: "tick", "text-anchor": "middle" }, svg).textContent = label;
      let acc = 0;
      series.forEach((s, k) => {
        const v = s.values[i];
        if (!v) return;
        const top = y(acc + v), bottom = y(acc);
        const segH = Math.max(0, bottom - top - (k > 0 ? 2 : 0)); // 2px surface gap between segments
        const isTop = series.slice(k + 1).every((ss) => !ss.values[i]);
        el("path", { d: roundedTop(cx - bw / 2, top, bw, segH, isTop ? 4 : 0), fill: s.color }, svg);
        acc += v;
      });
      const hit = el("rect", { x: pad.l + band * i, y: pad.t, width: band, height: h, fill: "transparent" }, svg);
      hit.addEventListener("mousemove", () => {
        tip.innerHTML = `<div class="tip-title">${label}</div>` + series.map((s) =>
          `<div class="tip-row"><span class="swatch" style="--c:${s.color}"></span>${s.name}<b>${fmt(s.values[i])}</b></div>`).join("") +
          `<div class="tip-row total">Total<b>${fmt(totals[i])}</b></div>`;
        tip.style.opacity = 1;
        const r = svg.getBoundingClientRect();
        tip.style.left = `${Math.min(r.width - 150, ((cx + band / 2) / width) * r.width)}px`;
        tip.style.top = `${pad.t}px`;
      });
      hit.addEventListener("mouseleave", () => (tip.style.opacity = 0));
    });
  }

  function roundedTop(x, y, w, h, r) {
    r = Math.min(r, h, w / 2);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }

  window.HVAC_CHARTS = { line, stacked };
})();
