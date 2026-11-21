/* ARZ Terminal — History: дампы цен (автоматика удалена, только ручные).
 *
 * Читает data/history/<server>/index.json (манифест снапшотов),
 * грузит снапшоты пачками и строит график скупка/продажа по предмету.
 * Экономики серверов изолированы: у каждого сервера своя история.
 */
(function () {
  "use strict";

  var SERVER_FILE = { vice: "vc" };
  var BATCH = 8;       // параллельных загрузок
  var STEP = 24;        // сколько снапшотов подгружать за раз
  var HARD_CAP = 240;  // жёсткий предел точек на график

  var S = {}; // server -> {manifest, snaps:{file->doc}, selected, query, shown, loading, names}

  function server() { return (window.ARZ && window.ARZ.historyServer) || "yuma"; }
  function D() { return window.ARZ && window.ARZ.data; }
  function UI() { return window.ARZ && window.ARZ.ui; }

  function st() {
    var s = server();
    if (!S[s]) S[s] = { manifest: null, snaps: {}, failed: {}, selected: null, query: "", shown: STEP, loading: false, names: [] };
    return S[s];
  }

  function fileFor(srv, file) {
    return "data/history/" + (SERVER_FILE[srv] || srv) + "/" + file;
  }

  function esc(s) { return UI().esc(s); }

  function shortName(name) {
    var parts = String(name).replace(/[()]/g, " ").split(/\s+/).filter(function (p) { return p && /[A-Za-zА-Яа-яЁё0-9]/.test(p[0]); });
    if (!parts.length) return "•";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  function rerender() {
    if (document.querySelector(".drawer.open")) return;
    if (document.querySelector(".modal-wrap.show")) return;
    if (document.querySelector(".palette-wrap.show")) return;
    var active = document.querySelector(".nav-item.active");
    if (!(active && active.getAttribute("data-nav") === "history")) return;
    // Перерисовываем только раздел и сохраняем прокрутку (раньше имитировался клик по меню,
    // который каждый раз возвращал страницу наверх).
    var ui = UI();
    if (ui && ui.refreshView) {
      var pos = window.scrollY;
      ui.refreshView();
      window.scrollTo(0, pos);
    } else {
      active.click();
    }
  }

  function loadManifest(done) {
    var s = st();
    if (s.manifest) { if (done) done(s.manifest); return; }
    fetch("data/history/index.json", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (m) {
        s.manifest = (m && m.servers && m.servers[server()]) || { snapshots: [] };
        if (done) done(s.manifest);
      })
      .catch(function () { s.manifest = { snapshots: [] }; if (done) done(s.manifest); });
  }

  function needFiles() {
    var s = st();
    var all = (s.manifest && s.manifest.snapshots) || [];
    // Новейшие первыми: slice с конца.
    return all.slice(-s.shown).map(function (x) { return x.file; }).filter(function (f) { return !s.snaps[f] && !s.failed[f]; });
  }

  function loadMore(done) {
    var s = st();
    var files = needFiles();
    if (!files.length || s.loading) { if (done) done(); return; }
    s.loading = true;
    var batch = files.slice(0, BATCH);
    var pending = batch.length;
    batch.forEach(function (f) {
      fetch(fileFor(server(), f), { cache: "no-store" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (doc) { if (doc) s.snaps[f] = doc; else s.failed[f] = true; })
        .catch(function () { s.failed[f] = true; })
        .then(function () {
          if (--pending === 0) {
            s.loading = false;
            refreshNames();
            if (needFiles().length && Object.keys(s.snaps).length < s.shown && Object.keys(s.snaps).length < HARD_CAP) {
              loadMore(done);
            } else { if (done) done(); rerender(); }
          }
        });
    });
    rerender(); // показать прогресс сразу
  }

  function refreshNames() {
    var s = st();
    var files = Object.keys(s.snaps).sort();
    if (!files.length) return;
    var latest = s.snaps[files[files.length - 1]];
    var arr = (latest && latest.items) || [];
    var scored = arr.map(function (r) { return { n: r[0], v: (r[3] || 0) + (r[4] || 0) }; });
    scored.sort(function (a, b) { return b.v - a.v; });
    s.names = scored.map(function (x) { return x.n; });
    if (!s.selected && s.names.length) s.selected = s.names[0];
  }

  function series(name) {
    var s = st();
    var files = Object.keys(s.snaps).sort().slice(-HARD_CAP);
    var out = [];
    files.forEach(function (f) {
      var doc = s.snaps[f];
      if (!doc || !doc.items) return;
      for (var i = 0; i < doc.items.length; i++) {
        var r = doc.items[i];
        if (r[0] === name) {
          var ts = (doc.meta && doc.meta.ts) || f.replace(".json", "");
          out.push({ t: ts, buy: r[1], sell: r[2], qb: r[3], qs: r[4] });
          break;
        }
      }
    });
    return out;
  }

  function dualChart(pts) {
    var w = 640, h = 200, padX = 8, padY = 14;
    var vals = [];
    pts.forEach(function (p) { if (p.buy > 0) vals.push(p.buy); if (p.sell > 0) vals.push(p.sell); });
    if (!vals.length) return '<div class="empty">Нет данных</div>';
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    if (max === min) max = min + 1;
    function X(i) { return padX + (i / Math.max(1, pts.length - 1)) * (w - padX * 2); }
    function Y(v) { return h - padY - ((v - min) / (max - min)) * (h - padY * 2); }
    function line(key, color) {
      var d = "";
      var started = false;
      pts.forEach(function (p, i) {
        if (!(p[key] > 0)) { started = false; return; }
        d += (started ? "L" : "M") + X(i).toFixed(1) + "," + Y(p[key]).toFixed(1) + " ";
        started = true;
      });
      return '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>';
    }
    var grid = [0, 0.25, 0.5, 0.75, 1].map(function (t) {
      var y = padY + t * (h - padY * 2);
      return '<line x1="' + padX + '" x2="' + (w - padX) + '" y1="' + y + '" y2="' + y + '" stroke="#26292e" stroke-width="1"/>';
    }).join("");
    return '<svg class="chart" viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none" role="img" aria-label="История цены">' +
      grid + line("sell", "#f5f5f4") + line("buy", "#8fe3b0") + "</svg>";
  }

  /** "2026-11-18T05:12" или "20261118-0512" -> epoch мс (локальное время). */
  function tsToMs(ts) {
    var m = /(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(ts || "") || /(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/.exec(ts || "");
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() : NaN;
  }

  /** Интерактивный график скупка/продажа: наведи — увидишь цену и время дампа. */
  function priceChart(pts) {
    var cur = server() === "vc" ? "VC$" : "$";
    var C = window.ARZ.chart;
    return C({
      x: pts.map(function (p) { return tsToMs(p.t); }),
      series: [
        { label: "Продажа", color: "#f5f5f4", values: pts.map(function (p) { return p.sell > 0 ? p.sell : null; }) },
        { label: "Скупка", color: "#8fe3b0", fill: false, values: pts.map(function (p) { return p.buy > 0 ? p.buy : null; }) }
      ],
      yFormat: function (v) { return C.full(v) + " " + cur; },
      extra: function (i) {
        var p = pts[i];
        return '<span class="dim">объём за день: скупка ' + C.full(p.qb || 0) + " · продажа " + C.full(p.qs || 0) + "</span>";
      },
      deltaLabel: "продажа с начала периода",
      height: 220
    });
  }

  function fmtTs(ts) {
    // "2026-11-18T05:12" или "20261118-0512" -> "18.11 05:12"
    var m = /(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(ts || "");
    if (m) return m[3] + "." + m[2] + " " + m[4] + ":" + m[5];
    m = /(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/.exec(ts || "");
    if (m) return m[3] + "." + m[2] + " " + m[4] + ":" + m[5];
    return ts || "—";
  }

  function statsCards() {
    var s = st();
    var all = ((s.manifest && s.manifest.snapshots) || []).slice().sort(function (a, b) { return a.ts < b.ts ? -1 : 1; });
    var loaded = Object.keys(s.snaps).length;
    var first = all.length ? fmtTs(all[0].ts) : "—";
    var last = all.length ? fmtTs(all[all.length - 1].ts) : "—";
    function card(label, value) {
      return '<div class="stat-card"><div class="stat-label">' + label + '</div><div class="stat-value">' + value + "</div></div>";
    }
    return '<div class="market-stats">' +
      card("Снапшотов", String(all.length)) +
      card("Загружено", String(loaded)) +
      card("Период", esc(first + " — " + last)) +
      card("Частота", "30 мин") +
      "</div>";
  }

  function suggestHtml() {
    var s = st();
    var q = (s.query || "").trim().toLowerCase();
    if (!q) return "";
    var hits = s.names.filter(function (n) { return n.toLowerCase().indexOf(q) !== -1; }).slice(0, 8);
    if (!hits.length) return '<div class="palette-empty">Ничего не найдено</div>';
    return hits.map(function (n) {
      return '<button class="palette-item' + (n === s.selected ? " active" : "") + '" data-hname="' + esc(n) + '"><span class="palette-icon">' + UI().icon("search", 14) + "</span><span>" + esc(n) + "</span></button>";
    }).join("");
  }

  function chartBlock() {
    var s = st();
    if (!s.selected) return '<div class="card"><div class="empty">Выбери предмет поиском выше — построю историю скупки и продажи.</div></div>';
    var pts = series(s.selected).slice(-HARD_CAP);
    var buys = pts.filter(function (p) { return p.buy > 0; }).map(function (p) { return p.buy; });
    var sells = pts.filter(function (p) { return p.sell > 0; }).map(function (p) { return p.sell; });
    function stat(arr) {
      if (!arr.length) return "—";
      return UI().money(arr[arr.length - 1]);
    }
    var ch = pts.length > 1 && sells.length ? ((sells[sells.length - 1] - sells[0]) / sells[0] * 100) : 0;
    var loaded = Object.keys(s.snaps).length;
    var total = ((s.manifest && s.manifest.snapshots) || []).length;
    return '<div class="card"><div class="card-head"><div><div class="card-title">' + esc(s.selected) + '</div><div class="card-sub">Точек: ' + pts.length + " · загружено снапшотов " + loaded + " из " + total + "</div></div>" +
      '<span class="badge ' + (ch >= 0 ? "badge-low" : "badge-high") + '">' + (ch >= 0 ? "+" : "") + ch.toFixed(1) + '%</span></div>' +
      (window.ARZ.chart ? priceChart(pts) : dualChart(pts)) +
      '<div class="chart-legend mt-8"><span class="legend-dot"></span><span>Продажа</span><span class="legend-dot" style="background:#8fe3b0"></span><span>Скупка</span>' +
      '<span style="margin-left:auto" class="mono">скупка ' + stat(buys) + " · продажа " + stat(sells) + "</span></div>" +
      '<div class="flex gap-8 mt-12">' +
        (loaded < total && loaded < HARD_CAP ? '<button class="btn btn-ghost btn-sm" data-hmore="1">Загрузить ещё (' + Math.min(STEP, total - loaded) + ")</button>" : "") +
        '<span class="tiny dim" style="align-self:center">Каждая точка — дамп раз в 30 минут</span></div>' +
      "</div>";
  }

  function snapshotsTable() {
    var s = st();
    var all = ((s.manifest && s.manifest.snapshots) || []).slice().sort(function (a, b) { return a.ts < b.ts ? -1 : 1; }).slice(-12).reverse();
    if (!all.length) return "";
    var rows = all.map(function (x) {
      var loaded = s.snaps[x.file] ? '<span class="badge badge-low">в памяти</span>' : '<span class="badge">на диске</span>';
      return "<tr><td class=\"num\">" + esc(fmtTs(x.ts)) + "</td><td class=\"num\">" + x.items + "</td><td class=\"dim tiny\">" + esc(x.data_max || "—") + "</td><td>" + loaded + "</td></tr>";
    }).join("");
    return '<div class="card table-card mt-16"><div class="table-head"><div><div class="card-title">Последние дампы</div><div class="card-sub">Хранятся каждые 30 мин · 48 часов, дальше — посуточно</div></div></div>' +
      '<div class="table-scroll"><table><thead><tr><th>Время</th><th>Позиций</th><th>Данные по</th><th>Статус</th></tr></thead><tbody>' + rows + "</tbody></table></div></div>";
  }

  function render() {
    var ui = UI();
    if (!ui) return "";
    var U = ui;
    var s = st();
    var srvName = "Yuma";
    try { srvName = U.serverName ? U.serverName(server()) : server(); } catch (e) { srvName = server(); }
    if (server() === "vc") srvName += " · VC$";
    var head = '<div class="page-head"><div class="page-head-left">' +
      '<div class="eyebrow">ARZ Terminal / History</div>' +
      "<h1>История цен · " + esc(srvName) + "</h1>" +
      '<div class="desc">История по сохранённым дампам. Выбери предмет — увидишь, как двигались скупка и продажа.</div>' +
      '</div><div class="page-actions"><button class="btn btn-ghost" data-action="toast" data-msg="Автодампы отключены и удалены">' + U.icon("clock", 13) + "<span>Расписание</span></button></div></div>";
    var search = '<div class="card"><div class="card-head"><div><div class="card-title">Предмет</div><div class="card-sub">' + (s.selected ? "Сейчас: " + esc(s.selected) : "Начни вводить название") + "</div></div></div>" +
      '<label class="search w-full">' + U.icon("search", 13) + '<input id="history-search" placeholder="Например: Дрова, Материалы, Хлопок..." value="' + esc(s.query) + '" autocomplete="off"></label>' +
      '<div class="mt-8" id="hist-suggest">' + suggestHtml() + "</div></div>";
    return head + statsCards() + '<div class="mt-16">' + search + '</div><div class="mt-16">' + chartBlock() + "</div>" + snapshotsTable();
  }

  function ensureData() {
    var firstLoad = !st().manifest; // манифест ещё не приходил — после загрузки надо перерисоваться
    loadManifest(function () {
      var s = st();
      refreshNames();
      if (!s.selected) {
        // Без выбора — грузим только последний снапшот для списка имён.
        var all = (s.manifest.snapshots || []).slice().sort(function (a, b) { return a.ts < b.ts ? -1 : 1; });
        var last = all[all.length - 1];
        if (last && !s.snaps[last.file] && !s.failed[last.file]) {
          fetch(fileFor(server(), last.file), { cache: "no-store" })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (doc) { if (doc) { s.snaps[last.file] = doc; refreshNames(); } else { s.failed[last.file] = true; } rerender(); })
            .catch(function () { s.failed[last.file] = true; rerender(); });
          return;
        }
      }
      if (needFiles().length) loadMore();
      // Иначе всё уже загружено и перерисовывать нечего. Раньше тут стоял безусловный rerender():
      // он запускал ensureData() снова — бесконечный цикл (~130 перерисовок в секунду).
      else if (firstLoad) rerender();
    });
  }

  // Публичный рендер для app.js
  window.ARZ.renderHistory = function () {
    var html = render();
    setTimeout(ensureData, 0);
    return html;
  };

  // Поиск без потери фокуса.
  document.addEventListener("input", function (e) {
    if (e.target && e.target.id === "history-search") {
      var s = st();
      s.query = e.target.value;
      var box = document.getElementById("hist-suggest");
      if (box) box.innerHTML = suggestHtml();
    }
  });

  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest ? e.target.closest("[data-hname]") : null;
    if (t) {
      var s = st();
      s.selected = t.getAttribute("data-hname");
      s.shown = Math.max(s.shown, STEP);
      rerender();
      loadMore();
      return;
    }
    var more = e.target && e.target.closest ? e.target.closest("[data-hmore]") : null;
    if (more) {
      var s2 = st();
      s2.shown = Math.min(s2.shown + STEP, HARD_CAP);
      loadMore();
      return;
    }
    var srv = e.target && e.target.closest ? e.target.closest("[data-server]") : null;
    if (srv) {
      var id = srv.getAttribute("data-server");
      window.ARZ.historyServer = (id === "vice") ? "vc" : id;
    }
  });

  window.ARZ.historyServer = window.ARZ.historyServer || "yuma";
})();
