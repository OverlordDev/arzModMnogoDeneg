/* ARZ Terminal — Player: инвентарь, деньги и состояние из игры + оценка стоимости.
 *
 * Данные: server.js следит за файлом, который пишет game/arz_export.lua, и
 * толкает новое состояние в браузер по SSE (GET /api/player/stream) почти
 * сразу после события игры (~0,15 с). GET /api/player — первичная загрузка и
 * запасной вариант (опрос раз в 10 с), если поток недоступен.
 * Работает ТОЛЬКО при локальном запуске терминала (node server.js на ПК с
 * игрой). На статике/VPS эндпоинта нет — карточка на Dashboard тихо скрывается,
 * а раздел Player показывает инструкцию.
 */
(function () {
  "use strict";

  var URL = "/api/player";
  var STREAM = "/api/player/stream";
  var POLL_MS = 10000;
  var S = { data: null, err: null, loaded: false, sig: "", es: null, live: false, refreshTimer: null };

  function U() { return window.ARZ && window.ARZ.ui; }
  function esc(v) { return U().esc(v); }

  function cur() {
    return S.data && S.data.valuation && S.data.valuation.server === "vc" ? "VC$" : "$";
  }
  function full(v) {
    if (v === null || v === undefined || Number.isNaN(v)) return "—";
    return Math.round(v).toLocaleString("ru-RU") + " " + cur();
  }
  function ago(sec) {
    sec = Math.max(0, Math.round(sec));
    if (sec < 60) return sec + " с";
    if (sec < 3600) return Math.floor(sec / 60) + " мин";
    if (sec < 86400) return Math.floor(sec / 3600) + " ч";
    return Math.floor(sec / 86400) + " дн.";
  }
  function ageOf(iso) { return (Date.now() - Date.parse(iso)) / 1000; }
  // «N назад», которое тикает само, без перерисовки страницы
  function ageSpan(iso) {
    return '<span class="js-age" data-ts="' + esc(iso) + '">' + ago(ageOf(iso)) + "</span>";
  }
  setInterval(function () {
    document.querySelectorAll(".js-age").forEach(function (el) {
      var ts = el.getAttribute("data-ts");
      if (ts) el.textContent = ago(ageOf(ts));
    });
  }, 5000);

  /* ---------- получение данных ---------- */

  function apply(body) {
    // age/parsed* меняются на каждый запрос — в подпись не включаем
    var sig = body ? JSON.stringify([body.fileUpdated, body.summary, body.valuation, body.tips]) : "none";
    var changed = sig !== S.sig || S.err !== null;
    S.data = body;
    S.err = null;
    S.loaded = true;
    S.sig = sig;
    if (changed) scheduleRefresh();
  }

  function setError(status, message) {
    var sig = "err:" + status + ":" + message;
    var changed = sig !== S.sig;
    S.data = null;
    S.err = { status: status, error: message };
    S.loaded = true;
    S.sig = sig;
    if (changed) scheduleRefresh();
  }

  function openStream() {
    if (S.es || !window.EventSource) return;
    var es = new EventSource(STREAM);
    S.es = es;
    es.onopen = function () { S.live = true; scheduleRefresh(); };
    es.onmessage = function (e) {
      try { apply(JSON.parse(e.data)); } catch (_) {}
    };
    es.addEventListener("nofile", function () {
      setError(404, "файла игрока пока нет — зайди на сервер с включённым arz_export.lua");
    });
    es.onerror = function () {
      // EventSource сам переподключается; пока связи нет — работаем по опросу
      if (S.live) { S.live = false; scheduleRefresh(); }
    };
  }

  function poll() {
    if (S.live) return; // поток жив — опрос не нужен
    fetch(URL, { cache: "no-store" })
      .then(function (r) {
        return r.json().then(function (j) { return { status: r.status, body: j }; }, function () { return { status: r.status, body: null }; });
      })
      .then(function (res) {
        var b = res.body;
        if (res.status === 200 && b && b.ok) apply(b);
        else setError(res.status, (b && b.error) || "нет ответа");
        // локальный сервер (есть файл или он ожидается) -> открываем live-поток
        if (res.status === 200 || (res.status === 404 && b && b.local)) openStream();
      })
      .catch(function () { setError(0, "эндпоинт недоступен"); });
  }

  function scheduleRefresh() {
    // серия событий (вход на сервер = десятки) схлопывается в одну перерисовку
    if (S.refreshTimer) return;
    S.refreshTimer = setTimeout(function () { S.refreshTimer = null; refresh(); }, 150);
  }

  function refresh() {
    var ui = U();
    if (!ui || !ui.view || !ui.refreshView) return;
    var v = ui.view();
    if (v !== "dashboard" && v !== "player") return;
    // не перерисовываем под открытыми дровером/модалками/палитрой
    if (document.querySelector(".drawer.open, .modal-wrap.show, .palette-wrap.show")) return;
    var pos = window.scrollY;
    ui.refreshView();
    window.scrollTo(0, pos);
  }

  /* ---------- общие куски ---------- */

  function tipsHtml(tips, max) {
    var list = (tips || []).slice(0, max || 99);
    if (!list.length) return '<div class="tiny dim">Замечаний нет.</div>';
    return list.map(function (t) {
      return '<div class="tip ' + esc(t.level) + '"><span class="tip-dot"></span><span>' + esc(t.text) + "</span></div>";
    }).join("");
  }

  function stats(d) {
    var s = d.summary, v = d.valuation;
    var inv = v && v.ok
      ? '<div class="stat-value">≈ ' + full(v.estimate) + '</div><div class="stat-sub">скупка ' + full(v.quick) + " · продажа " + full(v.ask) + "</div>"
      : '<div class="stat-value dim">—</div><div class="stat-sub">' + esc(v && v.reason || "нет оценки") + "</div>";
    var cap = d.capital != null
      ? '<div class="stat-value">≈ ' + full(d.capital) + '</div><div class="stat-sub">деньги + инвентарь</div>'
      : '<div class="stat-value dim">—</div><div class="stat-sub">нужны рыночные цены сервера</div>';
    var sat = s.satiety != null ? s.satiety + "%" : "—";
    var partial = s.baseline === false;
    return '<div class="market-stats">' +
      '<div class="stat-card"><div class="stat-label">Деньги</div><div class="stat-value">' + (s.money != null ? full(s.money) : "—") + '</div><div class="stat-sub">' + esc(s.server || "сервер неизвестен") + "</div></div>" +
      '<div class="stat-card"><div class="stat-label">Инвентарь, примерно' + (partial ? ' <span class="badge badge-mid">неполно</span>' : "") + "</div>" + inv + "</div>" +
      '<div class="stat-card"><div class="stat-label">Капитал</div>' + cap + "</div>" +
      '<div class="stat-card"><div class="stat-label">Состояние</div><div class="stat-value">' + sat + '</div><div class="stat-sub">сытость · розыск ' + (s.wanted != null ? s.wanted : "—") + (s.slots && s.slots.total ? " · слоты " + s.slots.used + "/" + s.slots.total : "") + "</div></div>" +
      "</div>";
  }

  function liveBadge() {
    return S.live
      ? '<span class="live-dot"></span>live'
      : "обновление раз в " + (POLL_MS / 1000) + " с";
  }

  /* ---------- карточка на Dashboard ---------- */

  window.ARZ = window.ARZ || {};
  window.ARZ.renderPlayerCard = function () {
    if (!S.data) return ""; // нет данных (статика/VPS/игра не запущена) — не засоряем главный экран
    var d = S.data;
    var stale = ageOf(d.fileUpdated) > 900; // событий не было >15 мин — вероятно, игра закрыта
    return '<div class="card player-card">' +
      '<div class="card-head"><div><div class="card-title">Игрок · ' + esc(d.summary.server || "—") + "</div>" +
      '<div class="card-sub">Из игры · ' + liveBadge() + " · последнее изменение " + ageSpan(d.fileUpdated) + " назад" + (stale ? " · игра не активна" : "") + "</div></div>" +
      '<a class="card-link" href="#" data-nav="player">Инвентарь ' + U().icon("arrow", 12) + "</a></div>" +
      stats(d) +
      '<div class="mt-12">' + tipsHtml(d.tips, 3) + "</div>" +
      "</div>";
  };

  /* ---------- раздел Player ---------- */

  function howTo() {
    return '<div class="card"><div class="card-head"><div><div class="card-title">Игра не подключена</div>' +
      '<div class="card-sub">' + esc(S.err ? S.err.error : "") + "</div></div></div>" +
      '<ol class="howto">' +
      "<li>Скрипт <code>game/arz_export.lua</code> должен лежать в <code>moonloader</code> Arizona (он только читает данные, ничего не отправляет).</li>" +
      "<li>Зайди на сервер — полный инвентарь приходит один раз при входе. После этого скрипт сам дописывает изменения, а здесь они появляются сразу.</li>" +
      "<li>Терминал должен быть запущен <b>локально</b>: <code>node server.js</code> на этом же ПК и адрес <code>http://localhost:3000</code>. На VPS и статике данные игрока намеренно недоступны.</li>" +
      "</ol></div>";
  }

  function inventoryTable(d) {
    var v = d.valuation;
    var rows;
    if (v && v.ok) {
      var total = v.estimate || 0;
      rows = v.rows.map(function (r) {
        if (!r.priced) {
          return '<tr class="dim"><td><div class="item-name">' + esc(r.name) + '</div></td><td class="num">×' + r.amount + '</td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="tiny">нет цены на рынке</td></tr>';
        }
        var share = total > 0 ? Math.round((r.total / total) * 100) : 0;
        return "<tr><td><div class=\"item-name\">" + esc(r.name) + "</div>" + (r.liq ? '<div class="item-sub">ликвидность: ' + esc(r.liq) + "</div>" : "") + "</td>" +
          '<td class="num">×' + r.amount.toLocaleString("ru-RU") + "</td>" +
          '<td class="num">' + (r.buy ? full(r.buy) : "—") + "</td>" +
          '<td class="num">' + (r.sell ? full(r.sell) : "—") + "</td>" +
          '<td class="num">≈ ' + full(r.total) + "</td>" +
          '<td><div class="conf"><div class="conf-track"><div class="conf-fill" style="width:' + share + '%"></div></div><span class="tiny dim">' + share + "%</span></div></td></tr>";
      }).join("");
    } else {
      rows = d.summary.totals.map(function (t) {
        return '<tr><td><div class="item-name">' + esc(t.name) + '</div></td><td class="num">×' + t.amount + '</td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td></td></tr>';
      }).join("");
    }
    return '<div class="card table-card"><div class="table-head"><div><div class="card-title">Инвентарь</div>' +
      '<div class="card-sub">Предметы сгруппированы · цена = ArzMarket (скупка / продажа лавок), оценка — середина</div></div>' +
      '<span class="badge">' + d.summary.totals.length + " поз.</span></div>" +
      '<div class="table-scroll"><table><thead><tr><th>Предмет</th><th>Кол-во</th><th>Скупка</th><th>Продажа</th><th>Оценка</th><th>Доля</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="6"><div class="empty">Инвентарь пуст</div></td></tr>') + "</tbody></table></div></div>";
  }

  window.ARZ.renderPlayer = function () {
    var ui = U();
    var head = ui.pageHead("Игрок и инвентарь",
      "Состояние персонажа и примерная стоимость инвентаря. Читается из игры локально, ничего не уходит в сеть.", "");
    if (!S.loaded) return head + '<div class="card"><div class="empty">Загрузка…</div></div>';
    if (!S.data) return head + howTo();
    var d = S.data, v = d.valuation;
    var meta = [];
    meta.push("Обновление: " + (S.live
      ? "в реальном времени — каждое событие игры попадает сюда сразу"
      : "опрос раз в " + (POLL_MS / 1000) + " с (live-поток недоступен)"));
    meta.push("Последнее изменение в игре " + ageSpan(d.fileUpdated) + " назад");
    if (v && v.ok) meta.push("Цены ArzMarket за " + esc(v.pricesDate || "—") + (v.pricesAgeDays != null ? " (" + v.pricesAgeDays + " дн. назад)" : ""));
    if (d.summary.worn && d.summary.worn.length) meta.push("Надет скин: " + esc(d.summary.worn[0].name));
    return head + stats(d) +
      '<div class="player-grid mt-16">' + inventoryTable(d) +
      '<div class="card"><div class="card-head"><div><div class="card-title">Советы</div><div class="card-sub">Простые правила по твоим данным</div></div></div>' +
        tipsHtml(d.tips) +
        '<div class="divider mt-16"></div><div class="tiny dim mt-12">' + meta.join("<br>") + "</div>" +
        '<div class="tiny dim mt-12">Оценка приблизительная: цены дневные, большие стопки на деле продаются дешевле, а предметы без рыночной цены в сумму не входят.</div>' +
      "</div></div>";
  };

  poll();
  setInterval(poll, POLL_MS);
})();
