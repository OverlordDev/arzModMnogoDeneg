/* ARZ Terminal — интерактивные графики.
 *
 * ARZ.chart(opts) возвращает HTML. Наведи курсор (или проведи пальцем / стрелками
 * после фокуса): появляется перекрестие, точки на линиях и подсказка с датой/временем
 * и значением каждой серии.
 *
 * opts:
 *   x        массив подписей точек: числа (epoch, мс) или строки. Числа раскладываются
 *            по оси пропорционально времени (дыры в данных видны как дыры).
 *   xKind    "time" (по умолчанию для чисел: «вс, 18 ноя, 10:03») или "day" («вс, 16 ноя 2026»)
 *   series   [{label, color, values: [число|null], fill?: true}] — values той же длины, что x;
 *            null/NaN = нет данных (линия рвётся)
 *   yFormat  (v, series) => строка для подсказки (по умолчанию число с пробелами)
 *   extra    (i) => HTML, дополнительная строка в подсказке (необязательно)
 *   deltaLabel  подпись к изменению «с начала периода» (по умолчанию показывается для 1-й серии)
 *   height   высота графика в px (по умолчанию 200)
 *   empty    текст, если точек меньше двух
 */
(function () {
  "use strict";
  window.ARZ = window.ARZ || {};

  var MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  var DOW = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
  var REG = {};
  var REG_KEYS = [];
  var seq = 0;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ok(v) { return typeof v === "number" && isFinite(v); }
  function fullNum(v) { return Math.round(v).toLocaleString("ru-RU"); }

  function compact(v) {
    var a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toLocaleString("ru-RU", { maximumFractionDigits: 2 }) + " млрд";
    if (a >= 1e6) return (v / 1e6).toLocaleString("ru-RU", { maximumFractionDigits: 2 }) + " млн";
    if (a >= 1e4) return (v / 1e3).toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + " тыс.";
    return Math.round(v).toLocaleString("ru-RU");
  }

  /** "2026-11-16" -> epoch мс (локальная полночь). */
  function parseDay(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || "");
    return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : NaN;
  }

  function titleFor(o, x, i) {
    if (o.xTitle) return o.xTitle(x, i);
    if (typeof x !== "number") return String(x);
    var d = new Date(x);
    var date = d.getDate() + " " + MONTHS[d.getMonth()];
    if (o.xKind === "day") return DOW[d.getDay()] + ", " + date + " " + d.getFullYear();
    return DOW[d.getDay()] + ", " + date + ", " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function axisFor(o, x, spanMs) {
    if (typeof x !== "number") return String(x);
    var d = new Date(x);
    if (o.xKind === "day" || spanMs >= 36 * 3600 * 1000) return d.getDate() + " " + MONTHS[d.getMonth()];
    return pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function register(c) {
    REG[c.id] = c;
    REG_KEYS.push(c.id);
    while (REG_KEYS.length > 40) delete REG[REG_KEYS.shift()]; // старые перерисованные графики не копим
  }

  function chart(o) {
    var x = o.x || [];
    var n = x.length;
    var series = (o.series || []).filter(function (s) { return s && s.values; });
    if (n < 2 || !series.length) return '<div class="empty">' + esc(o.empty || "Недостаточно точек для графика") + "</div>";

    // положение точек по оси X
    var numeric = x.every(ok);
    var px = new Array(n);
    var t0 = numeric ? x[0] : 0;
    var spanX = numeric ? x[n - 1] - x[0] : 0;
    for (var i = 0; i < n; i++) px[i] = numeric && spanX > 0 ? (x[i] - t0) / spanX : i / (n - 1);

    // диапазон по Y
    var vmin = Infinity, vmax = -Infinity;
    series.forEach(function (s) { s.values.forEach(function (v) { if (ok(v)) { if (v < vmin) vmin = v; if (v > vmax) vmax = v; } }); });
    if (vmin === Infinity) return '<div class="empty">' + esc(o.empty || "Нет данных") + "</div>";
    var span = vmax - vmin;
    var pad8 = span ? span * 0.12 : Math.max(Math.abs(vmax) * 0.05, 1);
    var lo = vmin - pad8, hi = vmax + pad8;
    if (vmin >= 0 && lo < 0) lo = 0;
    function Y(v) { return (1 - (v - lo) / (hi - lo)) * 100; }

    var id = "ic" + (++seq);
    var grid = [0, 25, 50, 75, 100].map(function (y) {
      return '<line x1="0" x2="1000" y1="' + y + '" y2="' + y + '" stroke="#2a2d33" stroke-width="1" vector-effect="non-scaling-stroke" stroke-dasharray="' + (y === 100 ? "" : "2 4") + '"/>';
    }).join("");

    var defs = "", paths = "", ends = "", dots = "";
    series.forEach(function (s, si) {
      var color = s.color || "#f5f5f4";
      var segs = [], cur = [];
      s.values.forEach(function (v, i) {
        if (ok(v)) cur.push([px[i] * 1000, Y(v)]);
        else if (cur.length) { segs.push(cur); cur = []; }
      });
      if (cur.length) segs.push(cur);
      var fill = s.fill === undefined ? si === 0 : s.fill;
      if (fill) {
        defs += '<linearGradient id="g-' + id + "-" + si + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + color + '" stop-opacity="0.20"/><stop offset="1" stop-color="' + color + '" stop-opacity="0"/></linearGradient>';
      }
      segs.forEach(function (seg) {
        var line = seg.map(function (p, k) { return (k ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(2); }).join(" ");
        if (fill && seg.length > 1) {
          paths += '<path d="' + line + " L" + seg[seg.length - 1][0].toFixed(1) + " 100 L" + seg[0][0].toFixed(1) + ' 100 Z" fill="url(#g-' + id + "-" + si + ')" stroke="none"/>';
        }
        paths += '<path d="' + line + '" fill="none" stroke="' + color + '" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>';
      });
      // последняя известная точка — всегда видна
      for (var k = s.values.length - 1; k >= 0; k--) {
        if (ok(s.values[k])) {
          ends += '<i class="ichart-last" style="left:' + (px[k] * 100).toFixed(2) + "%;top:" + Y(s.values[k]).toFixed(2) + "%;--c:" + color + '"></i>';
          break;
        }
      }
      dots += '<i class="ichart-dot" data-s="' + si + '" style="--c:' + color + '"></i>';
    });

    // подписи осей
    var midT = numeric ? t0 + spanX / 2 : x[Math.floor(n / 2)];
    var xl = [axisFor(o, x[0], spanX), axisFor(o, midT, spanX), axisFor(o, x[n - 1], spanX)];
    var fmtAxis = o.axisFormat || compact;
    var h = o.height || 200;

    register({ id: id, o: o, series: series, px: px, n: n, lo: lo, hi: hi, Y: Y });

    return '<div class="ichart" data-cid="' + id + '" style="--ic-h:' + h + 'px">' +
      '<div class="ichart-body">' +
        '<div class="ichart-y"><span>' + esc(fmtAxis(hi)) + "</span><span>" + esc(fmtAxis((hi + lo) / 2)) + "</span><span>" + esc(fmtAxis(lo)) + "</span></div>" +
        '<div class="ichart-plot" tabindex="0" role="img" aria-label="' + esc(o.label || "График: наведи курсор или используй стрелки, чтобы увидеть значения") + '">' +
          '<svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true"><defs>' + defs + "</defs>" + grid + paths + "</svg>" +
          ends + '<div class="ichart-cross"></div>' + dots + '<div class="ichart-tip" role="status"></div>' +
        "</div>" +
      "</div>" +
      '<div class="ichart-x"><span>' + esc(xl[0]) + "</span><span>" + esc(xl[1]) + "</span><span>" + esc(xl[2]) + "</span></div>" +
      "</div>";
  }

  /* ---------- взаимодействие ---------- */

  function nearest(px, f) {
    var best = 0, bd = Infinity;
    for (var i = 0; i < px.length; i++) {
      var d = Math.abs(px[i] - f);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  function show(plot, idx) {
    var root = plot.closest(".ichart");
    var c = root && REG[root.getAttribute("data-cid")];
    if (!c) return;
    var o = c.o;
    plot._idx = idx;
    var f = c.px[idx];

    var cross = plot.querySelector(".ichart-cross");
    cross.style.left = (f * 100) + "%";
    var rows = "";
    c.series.forEach(function (s, si) {
      var v = s.values[idx];
      var dot = plot.querySelector('.ichart-dot[data-s="' + si + '"]');
      if (ok(v)) {
        dot.style.left = (f * 100) + "%";
        dot.style.top = c.Y(v) + "%";
        dot.classList.add("v");
      } else {
        dot.classList.remove("v");
      }
      var fmt = o.yFormat || function (val) { return fullNum(val); };
      rows += '<div class="ichart-row"><i style="background:' + (s.color || "#f5f5f4") + '"></i><span>' + esc(s.label || "") + "</span><b>" + (ok(v) ? esc(fmt(v, s)) : "—") + "</b></div>";
    });

    // изменение с начала периода — по первой серии
    var delta = "";
    var s0 = c.series[0];
    var first = null;
    for (var k = 0; k < s0.values.length; k++) { if (ok(s0.values[k])) { first = s0.values[k]; break; } }
    var cur = s0.values[idx];
    if (ok(cur) && first && first > 0 && idx > 0) {
      var p = (cur - first) / first * 100;
      delta = '<div class="ichart-delta ' + (p >= 0 ? "pos" : "neg") + '">' + (p >= 0 ? "+" : "") + p.toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + "% " + esc(o.deltaLabel || "с начала периода") + "</div>";
    }

    var tip = plot.querySelector(".ichart-tip");
    tip.innerHTML = '<div class="ichart-tip-title">' + esc(titleFor(o, o.x[idx], idx)) + "</div>" + rows + (o.extra ? '<div class="ichart-extra">' + o.extra(idx) + "</div>" : "") + delta;
    root.classList.add("on");

    // подсказка не вылезает за график: справа от курсора, а у правого края — слева
    var W = plot.clientWidth;
    var tw = tip.offsetWidth;
    var left = f * W + 14;
    if (left + tw > W) left = f * W - 14 - tw;
    tip.style.left = Math.max(0, Math.min(left, W - tw)) + "px";
  }

  function hide(plot) {
    var root = plot.closest(".ichart");
    plot._idx = undefined; // чтобы фокус с клавиатуры снова показал последнюю точку
    if (root) root.classList.remove("on");
    plot.querySelectorAll(".ichart-dot.v").forEach(function (d) { d.classList.remove("v"); });
  }

  function fromPointer(plot, clientX) {
    var root = plot.closest(".ichart");
    var c = root && REG[root.getAttribute("data-cid")];
    if (!c) return;
    var r = plot.getBoundingClientRect();
    var f = r.width ? (clientX - r.left) / r.width : 0;
    show(plot, nearest(c.px, Math.max(0, Math.min(1, f))));
  }

  function plotOf(t) { return t && t.closest ? t.closest(".ichart-plot") : null; }

  document.addEventListener("pointermove", function (e) {
    var p = plotOf(e.target);
    if (p) fromPointer(p, e.clientX);
  });
  document.addEventListener("pointerdown", function (e) {
    var p = plotOf(e.target);
    if (p) fromPointer(p, e.clientX); // касание: показать точку сразу
  });
  // pointerleave не всплывает — слушаем в фазе перехвата; на тач-экранах подсказку оставляем до следующего касания
  document.addEventListener("pointerleave", function (e) {
    var p = e.target && e.target.classList && e.target.classList.contains("ichart-plot") ? e.target : null;
    if (p && e.pointerType === "mouse") hide(p);
  }, true);
  document.addEventListener("focusin", function (e) {
    var p = plotOf(e.target);
    if (!p) return;
    var root = p.closest(".ichart");
    var c = root && REG[root.getAttribute("data-cid")];
    if (c && p._idx === undefined) show(p, c.n - 1);
  });
  document.addEventListener("focusout", function (e) {
    var p = plotOf(e.target);
    if (p) { p._idx = undefined; hide(p); }
  });
  document.addEventListener("keydown", function (e) {
    var p = plotOf(e.target);
    if (!p) return;
    var root = p.closest(".ichart");
    var c = root && REG[root.getAttribute("data-cid")];
    if (!c) return;
    var i = p._idx === undefined ? c.n - 1 : p._idx;
    if (e.key === "ArrowLeft") i = Math.max(0, i - 1);
    else if (e.key === "ArrowRight") i = Math.min(c.n - 1, i + 1);
    else if (e.key === "Home") i = 0;
    else if (e.key === "End") i = c.n - 1;
    else if (e.key === "Escape") { hide(p); return; }
    else return;
    e.preventDefault();
    show(p, i);
  });

  chart.parseDay = parseDay;
  chart.compact = compact;
  chart.full = fullNum;
  window.ARZ.chart = chart;
})();
