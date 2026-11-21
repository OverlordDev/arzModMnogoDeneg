/* ARZ Terminal — Player: инвентарь, деньги и состояние из игры + оценка стоимости.
 *
 * Данные: server.js следит за файлом, который пишет game/arz_export.lua, и
 * толкает новое состояние в браузер по SSE (GET /api/player/stream) почти
 * сразу после события игры (~0,15 с). GET /api/player — первичная загрузка и
 * запасной вариант (опрос раз в 10 с), если поток недоступен.
 * Локально (localhost) работает по SSE/опросу, как описано выше. На телефоне (любой другой адрес) сервера
 * нет: ПК кладёт копию ответа в облако (Firestore), js/cloudclient.js читает её после входа по e-mail,
 * и вся отрисовка остаётся той же («режим приложения»). Без подключения раздел Player показывает инструкцию.
 */
(function () {
  "use strict";

  var URL = "/api/player";
  var STREAM = "/api/player/stream";
  var POLL_MS = 10000;
  var S = { data: null, err: null, loaded: false, sig: "", es: null, live: false, refreshTimer: null, range: "24h", phone: null, phoneAsked: false };

  // Откуда берём данные:
  //   "server"  — страницу отдаёт сам сервер ARZ Terminal (на ПК, либо телефон открыл адрес ПК): /api/player;
  //   "cloud"   — страница лежит на статическом хостинге без сервера: читаем копию из облака (js/cloudclient.js);
  //   "probing" — пока не знаем: спрашиваем /api/health.
  var CC = window.ARZ && window.ARZ.cloudclient;
  var HOST = window.location.hostname;
  // ?forcecloud=1 — проверить облачный режим на localhost (только переключает режим)
  var FORCE_CLOUD = window.location.search.indexOf("forcecloud=1") >= 0;
  var LOCAL = !FORCE_CLOUD && (HOST === "localhost" || HOST === "127.0.0.1" || HOST === "[::1]" || HOST === "" || window.location.protocol === "file:");
  var MODE = FORCE_CLOUD ? "cloud" : LOCAL ? "server" : "probing";
  var CLOUD_POLL_MS = 20000;
  function safeStorage() { try { var s = window.localStorage; s.getItem("arz.probe"); return s; } catch (_) { return null; } }
  var cloud = null;
  function initCloud() {
    if (cloud || !CC) return;
    cloud = CC.createCloudClient({ fetch: function (u, i) { return window.fetch(u, i); }, storage: safeStorage(), location: window.location, history: window.history });
    cloud.consumeHash();
  }
  if (MODE === "cloud") initCloud();

  /** Страницу отдаёт сервер ARZ Terminal? (на статическом хостинге /api/health нет) */
  function probeMode(done) {
    window.fetch("/api/health", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (j) { return !!(j && j.ok === true); })
      .catch(function () { return false; })
      .then(function (isServer) {
        MODE = isServer ? "server" : "cloud";
        if (MODE === "cloud") initCloud();
        done();
      });
  }

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

  // Узкий экран (телефон): суммы в таблицах сокращаем до «31,7 млн», иначе они не влезают в колонки
  function isNarrow() { return !!(window.matchMedia && window.matchMedia("(max-width: 640px)").matches); }
  function compact(v) {
    if (v === null || v === undefined || Number.isNaN(v)) return "—";
    var a = Math.abs(v), sign = v < 0 ? "−" : "";
    var s;
    if (a >= 1e9) s = (a / 1e9).toFixed(1).replace(".", ",") + " млрд";
    else if (a >= 1e6) s = (a / 1e6).toFixed(a >= 1e8 ? 0 : 1).replace(".", ",") + " млн";
    else if (a >= 1e4) s = Math.round(a / 1e3) + " тыс";
    else s = Math.round(a).toLocaleString("ru-RU");
    return sign + s;
  }
  function money(v) { return isNarrow() ? compact(v) + " $" : full(v); }
  function perHour(x) { return x == null ? "—" : money(x) + "/ч"; }
  function signed(x) { return (x > 0 ? "+" : "") + money(x); }
  function dur(sec) {
    var m = Math.floor(Math.max(0, Math.round(sec)) / 60);
    return m < 60 ? m + " мин" : Math.floor(m / 60) + " ч " + String(m % 60).padStart(2, "0") + " мин";
  }
  function clock(iso) {
    var d = new Date(iso);
    return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  /* ---------- получение данных ---------- */

  function apply(body) {
    // age/parsed* меняются на каждый запрос — в подпись не включаем
    var sig = body ? JSON.stringify([body.fileUpdated, body.summary, body.valuation, body.tips, body.earnings, (body.history || []).slice(-1), body.cloud, body.gamePrices, body.bank, body.netWorth, body.payday && body.payday.last]) : "none";
    var changed = sig !== S.sig || S.err !== null;
    S.data = body;
    S.err = null;
    S.loaded = true;
    S.sig = sig;
    if (changed) scheduleRefresh();
  }

  function setError(status, message, mode) {
    var sig = "err:" + status + ":" + message + ":" + (mode || "");
    var changed = sig !== S.sig;
    S.data = null;
    S.err = { status: status, error: message, mode: mode || null };
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

  /** Облачный режим: читаем зеркало из облака. Ошибка сети при уже загруженных данных не стирает экран. */
  function cloudPoll(force) {
    if (!cloud.configured()) { setError(0, "", "setup"); return; }
    if (!cloud.signedIn()) { if (!(S.err && S.err.mode === "login")) setError(401, "", "login"); return; }
    if (!force && S.cloudAt && Date.now() - S.cloudAt < CLOUD_POLL_MS - 500) return;
    S.cloudAt = Date.now();
    cloud.fetchBody().then(apply).catch(function (e) {
      if (e && e.code === "NOT_SIGNED_IN") setError(401, "", "login");
      else if (!S.data) setError((e && e.status) || 0, CC.explain(e), "error");
    });
  }

  /** ПК: адреса и ключ для телефона (только с loopback). */
  function loadPhoneLink(force) {
    if (S.phoneAsked && !force) return;
    S.phoneAsked = true;
    fetch("/api/phone-link", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (j) { S.phone = j; scheduleRefresh(); })
      .catch(function () { S.phone = { ok: false, error: "эндпоинт недоступен" }; });
  }

  function poll(force) {
    if (MODE === "probing") {
      if (!S.probing) { S.probing = true; probeMode(function () { S.probing = false; poll(true); }); }
      return;
    }
    if (cloud) { cloudPoll(force === true); return; }
    if (LOCAL) loadPhoneLink();
    if (S.live) return; // поток жив — опрос не нужен
    fetch(URL, { cache: "no-store" })
      .then(function (r) {
        return r.json().then(function (j) { return { status: r.status, body: j }; }, function () { return { status: r.status, body: null }; });
      })
      .then(function (res) {
        var b = res.body;
        if (res.status === 200 && b && b.ok) apply(b);
        else if (res.status === 401) setError(401, (b && b.error) || "нужен ключ доступа", "needkey");
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
      ? '<div class="stat-value">≈ ' + full(d.capital) + '</div><div class="stat-sub">деньги + инвентарь' +
        (d.netWorth != null ? " · с банком и депозитом ≈ " + full(d.netWorth) : "") + "</div>"
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

  /** Три плитки на главном экране: приход/чистыми в час за последний час и длина сессии. */
  function earnMini(e) {
    if (!e) return "";
    var w = e.windows.h1;
    var warn = w.oneOff ? '<div class="tiny dim mt-8">⚠ В окне доминирует одно крупное поступление (' + full(w.maxIncome) + ") — «$/ч» здесь не ставка заработка.</div>" : "";
    return '<div class="kpi-mini">' +
      "<div><small>Приход за час, $/ч</small><strong>" + perHour(w.incomePerHour) + "</strong></div>" +
      "<div><small>Чистыми, $/ч</small><strong>" + perHour(w.netPerHour) + "</strong></div>" +
      "<div><small>Сессия " + (e.active ? "идёт" : "закончилась") + "</small><strong>" + dur(e.windows.session.elapsedSec) + "</strong></div>" +
      "</div>" + warn;
  }

  function liveBadge() {
    if (cloud) return "из облака";
    return S.live
      ? '<span class="live-dot"></span>live'
      : "обновление раз в " + (POLL_MS / 1000) + " с";
  }

  /* ---------- карточка на Dashboard ---------- */

  window.ARZ = window.ARZ || {};
  window.ARZ.renderPlayerCard = function () {
    if (!S.data) {
      // телефон не подключён / не вошли: короткая подсказка вместо пустого места
      if (S.err && (S.err.mode === "needkey" || (cloud && (S.err.mode === "setup" || S.err.mode === "login")))) {
        return '<div class="card player-card"><div class="card-head"><div><div class="card-title">Игрок</div>' +
          '<div class="card-sub">' + (S.err.mode === "needkey" ? "Нужен ключ доступа" : S.err.mode === "setup" ? "Телефон ещё не подключён к облаку" : "Нужно войти") + '</div></div>' +
          '<a class="card-link" href="#" data-nav="player">Подключить ' + U().icon("arrow", 12) + "</a></div></div>";
      }
      return ""; // нет данных (статика/VPS/игра не запущена) — не засоряем главный экран
    }
    var d = S.data;
    var stale = ageOf(d.fileUpdated) > 900; // событий не было >15 мин — вероятно, игра закрыта
    return '<div class="card player-card">' +
      '<div class="card-head"><div><div class="card-title">Игрок · ' + esc(d.summary.server || "—") + "</div>" +
      '<div class="card-sub">' + (cloud ? "Из облака" : "Из игры") + " · " + liveBadge() + " · последнее изменение " + ageSpan(d.fileUpdated) + " назад" + (stale ? " · игра не активна" : "") + "</div></div>" +
      '<a class="card-link" href="#" data-nav="player">Инвентарь ' + U().icon("arrow", 12) + "</a></div>" +
      stats(d) +
      earnMini(d.earnings) +
      '<div class="mt-12">' + tipsHtml(d.tips, 3) + "</div>" +
      "</div>";
  };

  /* ---------- раздел Player ---------- */

  function howTo() {
    if (S.err && S.err.mode === "needkey") {
      return '<div class="card"><div class="card-head"><div><div class="card-title">Нужен ключ доступа</div>' +
        '<div class="card-sub">Данные игрока открыты только самому ПК и телефонам с ключом</div></div></div>' +
        '<ol class="howto">' +
        "<li>На ПК открой терминал → раздел <b>Player</b> → блок «Телефон».</li>" +
        "<li>Скопируй ссылку для своей сети (дома — «Домашняя сеть», вне дома — Tailscale) и открой её на этом телефоне.</li>" +
        "<li>Ключ запомнится в браузере — ссылка больше не понадобится.</li></ol></div>";
    }
    return '<div class="card"><div class="card-head"><div><div class="card-title">Игра не подключена</div>' +
      '<div class="card-sub">' + esc(S.err ? S.err.error : "") + "</div></div></div>" +
      '<ol class="howto">' +
      "<li>Скрипт <code>game/arz_export.lua</code> должен лежать в <code>moonloader</code> Arizona (он только читает данные, ничего не отправляет).</li>" +
      "<li>Зайди на сервер — полный инвентарь приходит один раз при входе. После этого скрипт сам дописывает изменения, а здесь они появляются сразу.</li>" +
      "<li>Терминал должен быть запущен <b>локально</b>: <code>node server.js</code> на этом же ПК и адрес <code>http://localhost:3000</code>. На VPS и статике данные игрока намеренно недоступны.</li>" +
      "</ol></div>";
  }

  /** Игровая средняя цена за 30 дн.; жёлтый бейдж — сильно расходится с ArzMarket (в ~3+ раза). */
  function gameCell(r) {
    if (r.gameNoSales) return '<td class="num hide-sm" title="В игре за 30 дней не было ни одной сделки с этим предметом: цену по ArzMarket реально получить может не получиться"><span class="badge badge-mid">0 сделок</span></td>';
    if (!r.game) return '<td class="num dim hide-sm">—</td>';
    var warn = r.gameDiverge
      ? ' <span class="badge badge-mid" title="Игра и ArzMarket расходятся в ' + (r.gameRatio >= 1 ? r.gameRatio + " раза выше" : Math.round(100 / r.gameRatio) / 100 + " раза ниже") + ' — проверь цену вручную">×' + (r.gameRatio >= 1 ? r.gameRatio : Math.round(100 / r.gameRatio) / 100) + "</span>"
      : "";
    var h = r.gameHist;
    var tip = h
      ? "Из истории предмета (медиана дневных цен): за 7 дн. " + full(h.med7 != null ? h.med7 : h.avg7) + ", за 30 дн. " + full(h.med30 != null ? h.med30 : h.avg30) + ", продаж за 7 дн. " + h.vol7.toLocaleString("ru-RU") +
        (h.trendPct != null ? ", тренд " + (h.trendPct > 0 ? "+" : "") + h.trendPct + "%" : "")
      : "Средняя цена за 30 дн. из списка рынка (истории предмета ещё нет)";
    var trend = h && h.trendPct != null && Math.abs(h.trendPct) >= 3
      ? ' <span class="tiny ' + (h.trendPct > 0 ? "pos" : "neg") + '">' + (h.trendPct > 0 ? "▲" : "▼") + Math.abs(Math.round(h.trendPct)) + "%</span>"
      : "";
    return '<td class="num hide-sm" title="' + esc(tip) + '">' + full(r.game) + trend + warn + "</td>";
  }

  function inventoryTable(d) {
    var v = d.valuation;
    var rows;
    if (v && v.ok) {
      var total = v.estimate || 0;
      rows = v.rows.map(function (r) {
        if (!r.priced) {
          return '<tr class="dim"><td><div class="item-name">' + esc(r.name) + '</div></td><td class="num">×' + r.amount + '</td><td class="num hide-sm">—</td><td class="num hide-sm">—</td><td class="num hide-sm">—</td><td class="num">—</td><td class="tiny hide-sm">' + (r.noSales ? "не продаётся: 0 сделок за 30 дн." : "нет цены на рынке") + "</td></tr>";
        }
        var share = total > 0 ? Math.round((r.total / total) * 100) : 0;
        // на телефоне скупка/продажа/доля скрыты (узкий экран), игровая цена и «0 сделок» переезжают под название
        var gameSub = r.gameNoSales ? '<div class="item-sub show-sm"><span class="badge badge-mid">0 сделок за 30 дн.</span></div>'
          : r.game ? '<div class="item-sub show-sm">игра: ' + full(r.game) + (r.gameDiverge ? " ⚠" : "") + "</div>" : "";
        
        return "<tr><td><div class=\"item-name\">" + esc(r.name) + "</div>" + (r.liq ? '<div class="item-sub hide-sm">ликвидность: ' + esc(r.liq) + "</div>" : "") + gameSub + "</td>" +
          '<td class="num">×' + r.amount.toLocaleString("ru-RU") + "</td>" +
          '<td class="num hide-sm">' + (r.buy ? full(r.buy) : "—") + "</td>" +
          '<td class="num hide-sm">' + (r.sell ? full(r.sell) : "—") + "</td>" +
          gameCell(r) +
          '<td class="num">≈ ' + full(r.total) + (r.src === "game" ? ' <span class="badge badge-mid" title="Цены ArzMarket нет — оценено по игровой средней за 30 дней">игра</span>' : "") + "</td>" +
          '<td class="hide-sm"><div class="conf"><div class="conf-track"><div class="conf-fill" style="width:' + share + '%"></div></div><span class="tiny dim">' + share + "%</span></div></td></tr>";
      }).join("");
    } else {
      rows = d.summary.totals.map(function (t) {
        return '<tr><td><div class="item-name">' + esc(t.name) + '</div></td><td class="num">×' + t.amount + '</td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td></td></tr>';
      }).join("");
    }
    return '<div class="card table-card"><div class="table-head"><div><div class="card-title">Инвентарь</div>' +
      '<div class="card-sub">Предметы сгруппированы · цена = ArzMarket (скупка / продажа лавок), оценка — середина · «Игра 30д» — средняя цена из окна Центрального рынка</div></div>' +
      '<span class="badge">' + d.summary.totals.length + " поз.</span></div>" +
      '<div class="table-scroll"><table class="inv-table"><thead><tr><th>Предмет</th><th>Кол-во</th><th class="hide-sm">Скупка</th><th class="hide-sm">Продажа</th><th class="hide-sm" title="Средняя цена за 30 дней из окна Центрального рынка в игре">Игра 30д</th><th>Оценка</th><th class="hide-sm">Доля</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="7"><div class="empty">Инвентарь пуст</div></td></tr>') + "</tbody></table></div></div>";
  }

  /** Банк и депозит: данные приходят только когда игрок открывает окно банка («на момент последнего открытия»). */
  function bankCard(d) {
    var b = d.bank;
    if (!b || !b.deposit && !(b.accounts && b.accounts.length)) {
      return '<div class="card"><div class="card-title">Банк и депозит</div>' +
        '<div class="empty">Данных пока нет: открой в игре окно банка один раз — депозит, лимит и доход за PayDay появятся здесь.</div></div>';
    }
    var dep = b.deposit, an = dep && dep.analysis, rows = "";
    var staleWarn = dep && dep.stale
      ? '<div class="tip warn" style="margin:0 16px 12px"><span class="tip-dot"></span><span>Лимит и доход из окна банка устарели: в чеке PayDay доход депозита ' + full(dep.stale.checkIncome) + " вместо " + full(dep.stale.windowIncome) + ' (изменился лимит или бонусы). Открой в игре окно банка — данные обновятся.</span></div>'
      : "";
    function row(k, v) { return '<tr><td class="dim">' + k + '</td><td class="num">' + v + "</td></tr>"; }
    if (dep) {
      var age = dep.at ? ageOf(dep.at) : null;
      var fill = an ? Math.min(100, Math.round(dep.money / dep.limit * 100)) : null;
      rows += row("Депозит", full(dep.money) + (dep.moneyFrom === "payday" && dep.moneyAt ? ' <span class="tiny dim" title="Остаток обновлён чеком PayDay, лимит и доход — из окна банка">чек ' + ageSpan(dep.moneyAt) + " назад</span>" : ""));
      rows += row("Лимит дохода", full(dep.limit) + (an ? ' <span class="badge ' + (an.idle > 0 ? "badge-mid" : "") + '">' + (an.idle > 0 ? "заполнен, лишние " + Math.round(an.idle / 1e6).toLocaleString("ru-RU") + " млн" : "заполнено " + an.fillPct + "%") + "</span>" : ""));
      rows += row("Доход за PayDay", dep.incomePerPayday != null ? full(dep.incomePerPayday) : "—");
      if (an && an.ratePerMillion != null) rows += row("С каждого млн под лимитом", full(an.ratePerMillion) + " / PayDay");
      if (an && an.lostPerPayday > 0) rows += row("Упускается из-за лимита", '<span class="neg">' + full(an.lostPerPayday) + " / PayDay</span>");
      rows += row("Уровень депозита", dep.level + " / " + dep.maxLevel);
      if (dep.upgradeCooldownSec != null && age != null) {
        var left = Math.max(0, dep.upgradeCooldownSec - age);
        rows += row("Следующее улучшение", left > 0 ? "через ~" + ago(left) : "можно сейчас");
      }
      rows += row("Комиссия снятия с депозита", dep.withdrawPct != null ? dep.withdrawPct + "%" : "—");
    }
    var acc = (b.accounts || []).reduce(function (a, x) { return a + x.money; }, 0);
    if (b.accounts && b.accounts.length) rows += row("Банковский счёт", full(acc));
    var hint = "";
    if (dep && an && an.idle > 0) {
      hint = '<div class="tiny dim mt-12">Деньги сверх лимита дохода не приносят. Лимит растёт от уровня депозита, домов с улучшением (+6 млн за дом) и семейного улучшения «Банковские махинации» (+100 млн).' +
        (dep.next && dep.next.gainPerPayday > 0
          ? " Уровень " + dep.next.level + ": +" + Math.round(dep.next.limitAdd / 1e6) + " млн лимита ≈ +" + full(dep.next.gainPerPayday) + " за PayDay (без прибавки процента уровня; по вики, если надбавка накопительная)."
          : "") + "</div>";
    }
    var when = (dep && dep.at) || b.accountsAt;
    return '<div class="card table-card"><div class="table-head"><div><div class="card-title">Банк и депозит</div>' +
      '<div class="card-sub">Данные на момент последнего открытия окна банка' + (when ? " — " + ageSpan(when) + " назад" : "") + "</div></div>" +
      '<span class="badge">всего ' + full(b.total) + "</span></div>" +
      staleWarn + '<div class="table-scroll"><table><tbody>' + rows + "</tbody></table></div>" + hint + "</div>";
  }

  /** PayDay из «банковского чека» в чате: деньги выплаты идут на счёт и депозит, а не в наличные (их нет в «Заработке»). */
  function paydayCard(d) {
    var p = d.payday;
    if (!p) {
      return '<div class="card"><div class="card-title">PayDay</div><div class="empty">Чеков пока нет: перезагрузи скрипты в игре (Ctrl+R) и дождись выплаты — чек из чата появится здесь.</div></div>';
    }
    function row(k, v) { return '<tr><td class="dim">' + k + '</td><td class="num">' + v + "</td></tr>"; }
    var l = p.last, rows = "";
    rows += row("Последняя выплата", ageSpan(new Date(l.at).toISOString()) + " назад");
    rows += row("Интервал", "каждые " + p.nominalMin + " мин" + (p.intervalMin != null && Math.abs(p.intervalMin - p.nominalMin) > 3
      ? ' <span class="badge badge-mid" title="Между чеками проходит больше интервала, а банк растёт на одну выплату: часть выплат не засчитывается (игра закрыта или мало онлайна)">по журналу ' + p.intervalMin + " мин · пропущено " + p.missed + "</span>" : ""));
    rows += row("Зарплата → на счёт", l.salary != null ? full(l.salary) : "—");
    rows += row("Депозит → на депозит", l.depositIncome != null ? full(l.depositIncome) : "—");
    rows += row("Доход за выплату", p.incomePerPayday != null ? "<b>" + full(p.incomePerPayday) + "</b>" : "—");
    rows += row("Доход в час (если засчитываются все выплаты)", p.incomePerHour != null ? "<b>" + full(p.incomePerHour) + "/ч</b>" : "—");
    if (p.incomePerHourActual != null && p.missed > 0) rows += row("Доход в час по журналу (с пропусками)", '<span class="neg">' + full(p.incomePerHourActual) + "/ч</span>");
    if (l.az) rows += row("AZ за выплату", "+" + l.az.delta + " (баланс " + l.az.balance.toLocaleString("ru-RU") + ")");
    if (l.level) rows += row("Уровень", l.level.level + " · респекты " + l.level.respect + "/" + l.level.respectMax + (l.level.exp ? " · +" + l.level.exp + " EXP" : ""));
    rows += row("Сегодня выплат", p.today.paydays + " · всего " + full(p.today.total));
    return '<div class="card table-card"><div class="table-head"><div><div class="card-title">PayDay</div>' +
      '<div class="card-sub">Из чека в чате · ' + p.count + " выплат в журнале · деньги идут на счёт и депозит, а не в наличные</div></div></div>" +
      '<div class="table-scroll"><table><tbody>' + rows + "</tbody></table></div>" +
      '<div class="tiny dim" style="padding:10px 16px">Интервал и доход считаются по медиане последних 10 выплат; паузы длиннее 3 часов (игра закрыта) в интервал не входят. «В час» верно только пока ты играешь без перерывов.</div></div>';
  }

  function earningsCard(d) {
    var e = d.earnings;
    if (!e) return '<div class="card"><div class="card-title">Заработок</div><div class="empty">Пока нет событий денег с датой.</div></div>';
    var rows = [["15 минут", e.windows.m15], ["1 час", e.windows.h1], ["Сессия · " + dur(e.windows.session.elapsedSec), e.windows.session]].map(function (r) {
      var w = r[1];
      var warn = w.oneOff ? ' <span class="badge badge-mid" title="Больше 60% прихода — одно поступление">разово</span>' : "";
      return "<tr><td>" + esc(r[0]) + "</td>" +
        '<td class="num pos">' + (w.income ? "+" + money(w.income) : "—") + warn + "</td>" +
        '<td class="num neg hide-sm">' + (w.spend ? money(w.spend) : "—") + "</td>" +
        '<td class="num ' + (w.net < 0 ? "neg" : "") + '">' + signed(w.net) + "</td>" +
        '<td class="num hide-sm">' + perHour(w.incomePerHour) + "</td>" +
        '<td class="num">' + perHour(w.netPerHour) + "</td></tr>";
    }).join("");
    var recent = e.recent.length
      ? e.recent.map(function (x) {
          return '<div class="flex between tiny" style="padding:3px 0"><span class="dim">' + clock(x.at) + '</span><span class="num ' + (x.delta > 0 ? "pos" : "neg") + '">' + signed(x.delta) + "</span></div>";
        }).join("")
      : '<div class="tiny dim">Изменений денег в этой сессии ещё не было.</div>';
    return '<div class="card table-card"><div class="table-head"><div><div class="card-title">Заработок</div>' +
      '<div class="card-sub">По изменениям денег · сессия ' + (e.active ? "идёт" : "закончилась") + " · " + e.samples + " изм.</div></div></div>" +
      '<div class="table-scroll"><table><thead><tr><th>Окно</th><th>Приход</th><th class="hide-sm">Расход</th><th>Чистыми</th><th class="hide-sm">Приход, $/ч</th><th title="Чистыми за час, $/ч">Чист. $/ч</th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
      '<div style="padding:12px 16px"><div class="tiny dim" style="margin-bottom:6px">Последние изменения денег</div>' + recent +
      '<div class="tiny dim mt-12">Приход — любые поступления (зарплата, продажа, перевод), расход — покупки, налоги, аренда. Работу от продажи предмета по одним событиям денег не отделить. «$/ч» не считается, пока набралось меньше 3 минут.</div></div></div>';
  }

  var RANGES = { "1h": ["1Ч", 3600000], "24h": ["24Ч", 86400000], "7d": ["7Д", 7 * 86400000] };

  function capitalCard(d) {
    var tabs = Object.keys(RANGES).map(function (k) {
      return '<button class="chart-tab ' + (S.range === k ? "active" : "") + '" data-prange="' + k + '">' + RANGES[k][0] + "</button>";
    }).join("");
    var since = Date.now() - RANGES[S.range][1];
    var pts = (d.history || []).filter(function (p) { return p[0] >= since; });
    var body;
    if (pts.length < 2) {
      body = '<div class="empty">' + (d.summary.baseline === false
        ? "История не пишется, пока нет полной загрузки инвентаря — перезайди на сервер."
        : "История копится: точка пишется раз в минуту при изменениях (и минимум раз в 5 мин). График появится через пару минут.") + "</div>";
    } else {
      var vals = pts.map(function (p) { return p[1]; });
      var first = vals[0], last = vals[vals.length - 1];
      var diff = last - first;
      body = window.ARZ.chart({
        x: pts.map(function (p) { return p[0]; }),
        series: [{ label: "Капитал", color: "#f5f5f4", values: vals }],
        yFormat: function (v) { return full(v); },
        extra: function (i) { return '<span class="dim">деньги ' + full(pts[i][2]) + " · инвентарь ≈ " + full(pts[i][3]) + "</span>"; },
        deltaLabel: "с начала периода",
        height: 200
      }) +
        '<div class="chart-legend mt-8"><span class="legend-dot"></span><span>Капитал (деньги + инвентарь) · с ' + clock(pts[0][0]) + '</span>' +
        '<span style="margin-left:auto" class="mono ' + (diff >= 0 ? "pos" : "neg") + '">' + signed(diff) + "</span></div>" +
        '<div class="tiny dim mt-8">Мин. ' + full(Math.min.apply(null, vals)) + " · макс. " + full(Math.max.apply(null, vals)) + " · точек: " + pts.length + "</div>";
    }
    return '<div class="card"><div class="card-head"><div><div class="card-title">Капитал</div><div class="card-sub">Только полные данные · ' + (cloud ? "копия с ПК за 7 дней" : "хранится локально") + '</div></div><div class="chart-tabs">' + tabs + "</div></div>" + body + "</div>";
  }

  /* ---------- режим «приложение» (телефон) ---------- */

  /** Экран подключения/входа вместо данных: телефон не подключён, нужен пароль или облако недоступно. */
  function cloudCard() {
    var mode = S.err && S.err.mode;
    var msg = S.err && S.err.error ? '<div class="tip danger mt-12"><span class="tip-dot"></span><span>' + esc(S.err.error) + "</span></div>" : "";
    if (mode === "login") {
      return '<div class="card"><div class="card-head"><div><div class="card-title">Вход</div>' +
        '<div class="card-sub">' + esc(cloud.email() || "аккаунт Firebase") + " · пароль вводится один раз, на телефоне он не хранится</div></div></div>" +
        '<form data-cloud-form class="cloud-form" autocomplete="on">' +
        '<input class="input" type="password" name="password" autocomplete="current-password" autocapitalize="off" placeholder="Пароль" required>' +
        '<button class="btn btn-white" type="submit">Войти</button></form>' + msg + "</div>";
    }
    if (mode === "error") {
      return '<div class="card"><div class="card-head"><div><div class="card-title">Не удалось получить данные</div></div></div>' + msg +
        '<div class="mt-12"><button class="btn" data-cloud-logout>Сменить аккаунт</button></div></div>';
    }
    return '<div class="card"><div class="card-head"><div><div class="card-title">Подключи телефон</div>' +
      '<div class="card-sub">Этот сайт в режиме приложения: данные игрока берутся из облака, куда их кладёт ПК</div></div></div>' +
      '<ol class="howto">' +
      "<li>Этот режим — для сайта на статическом хостинге без сервера. Подключение через облако описано в <code>deploy/FIREBASE.md</code> (раздел «Телефон»).</li>" +
      "<li>Проще: открой сайт по адресу ПК (ссылка с ключом из раздела Player на ПК) — тогда облако не нужно.</li>" +
      "</ol>" + msg + "</div>";
  }

  /** ПК: блок «Телефон» — ссылки с ключом (домашняя сеть, Tailscale) для открытия сайта на телефоне. */
  function phoneCard() {
    var P = S.phone;
    if (!P) return "";
    var title = '<div class="card-head"><div><div class="card-title">Телефон</div>' +
      '<div class="card-sub">Тот же сайт открывается на телефоне по адресу ПК — без хостинга и облака</div></div></div>';
    if (!P.ok) return '<div class="card">' + title + '<div class="tiny dim">' + esc(P.error || "недоступно") + "</div></div>";
    var urls = P.urls || [];
    var hasTs = urls.some(function (u) { return u.kind === "tailscale"; });
    var body = "";
    if (!P.lanOpen) {
      body += '<div class="tip warn"><span class="tip-dot"></span><span>Сервер слушает только этот ПК (<code>HOST=127.0.0.1</code>) — телефон ссылку не откроет. Запусти без <code>HOST</code> (по умолчанию все интерфейсы).</span></div>';
    }
    body += urls.length
      ? urls.map(function (u, i) {
          return '<div class="tiny dim mt-12">' + esc(u.label) + '</div><div class="flex mt-8" style="gap:8px">' +
            '<input class="input" id="phone-url-' + i + '" readonly value="' + esc(u.url) + '">' +
            '<button class="btn" data-copy-phone="' + i + '">Копировать</button></div>';
        }).join("")
      : '<div class="tiny dim mt-12">Сетевых адресов не найдено: подключи ПК к Wi-Fi или Ethernet.</div>';
    body += '<div class="tiny dim mt-12">1. Отправь себе ссылку (Telegram, «Избранное») и открой на телефоне. Ключ запомнится, ссылка больше не нужна.</div>' +
      '<div class="tiny dim mt-8">2. Телефон и ПК в одной Wi-Fi сети. Не открывается — разреши порт в брандмауэре Windows: <code>powershell -ExecutionPolicy Bypass -File scripts/allow_firewall.ps1</code> (спросит права администратора).</div>' +
      (hasTs ? "" : '<div class="tiny dim mt-8">3. Вне дома: поставь бесплатный Tailscale на ПК и на телефон — здесь появится ссылка с адресом 100.x.x.x, она работает откуда угодно (и канал шифруется).</div>') +
      '<div class="tiny dim mt-8">Ссылка содержит ключ доступа к данным игрока — не отправляй её посторонним. <button class="btn btn-sm" data-rotate-key>Сменить ключ</button></div>';
    return '<div class="card">' + title + body + "</div>";
  }

  window.ARZ.renderPlayer = function () {
    var ui = U();
    var head = ui.pageHead("Игрок и инвентарь",
      cloud ? "Состояние персонажа и примерная стоимость инвентаря. Данные из облака: ПК кладёт копию состояния игрока в твою базу Firebase."
            : "Состояние персонажа и примерная стоимость инвентаря. Читается из игры на ПК и открывается с телефона по адресу ПК.", "");
    if (!S.loaded) return head + '<div class="card"><div class="empty">Загрузка…</div></div>';
    if (!S.data) return head + (cloud ? cloudCard() : howTo() + '<div class="mt-16">' + phoneCard() + "</div>");
    var d = S.data, v = d.valuation;
    var meta = [];
    if (cloud) {
      var cp = d.cloud && (d.cloud.generatedAt || d.cloud.updatedAt);
      meta.push("Обновление: из облака — ПК передаёт копию раз в ~30 с, телефон читает раз в " + (CLOUD_POLL_MS / 1000) + " с" + (cp ? " (копия сделана " + ageSpan(cp) + " назад)" : ""));
    } else {
      meta.push("Обновление: " + (S.live
        ? "в реальном времени — каждое событие игры попадает сюда сразу"
        : "опрос раз в " + (POLL_MS / 1000) + " с (live-поток недоступен)"));
    }
    meta.push("Последнее изменение в игре " + ageSpan(d.fileUpdated) + " назад");
    if (v && v.ok) meta.push("Цены ArzMarket за " + esc(v.pricesDate || "—") + (v.pricesAgeDays != null ? " (" + v.pricesAgeDays + " дн. назад)" : ""));
    if (d.gamePrices) {
      meta.push("Игровые цены (Центральный рынок, 30 дн.): " + d.gamePrices.saItems + " предметов в списке, историй по дням: " + (d.gamePrices.historyItems || 0) + ", обновлено " + ageSpan(d.gamePrices.updatedAt) + " назад");
    } else {
      meta.push("Игровых цен нет: открой на ЦР окно «Средняя цена товаров» и пролистай страницы — они появятся здесь");
    }
    if (d.summary.worn && d.summary.worn.length) meta.push("Надет скин: " + esc(d.summary.worn[0].name));
    if (d.cloud && d.cloud.enabled) {
      if (d.cloud.lastError) {
        meta.push('<span class="neg">Firebase: не сохраняется — ' + esc(d.cloud.hint || d.cloud.lastError) + "</span>");
      } else if (d.cloud.lastOkAt) {
        meta.push("Firebase: сохранено " + ageSpan(d.cloud.lastOkAt) + " назад (" + esc(d.cloud.projectId) + ")");
      } else {
        meta.push("Firebase: включено, первое сохранение ещё не прошло");
      }
    }
    return head + stats(d) +
      '<div class="player-grid mt-16">' + inventoryTable(d) +
      '<div class="card"><div class="card-head"><div><div class="card-title">Советы</div><div class="card-sub">Простые правила по твоим данным</div></div></div>' +
        tipsHtml(d.tips) +
        '<div class="divider mt-16"></div><div class="tiny dim mt-12">' + meta.join("<br>") + "</div>" +
        '<div class="tiny dim mt-12">Оценка приблизительная: цены дневные, большие стопки на деле продаются дешевле, а предметы без рыночной цены в сумму не входят.</div>' +
      "</div></div>" +
      '<div class="mt-16">' + paydayCard(d) + "</div>" +
      '<div class="mt-16">' + bankCard(d) + "</div>" +
      '<div class="mt-16">' + earningsCard(d) + "</div>" +
      '<div class="mt-16">' + capitalCard(d) + "</div>" +
      (cloud
        ? '<div class="mt-16"><button class="btn" data-cloud-logout>Выйти из облака</button></div>'
        : '<div class="mt-16">' + phoneCard() + "</div>");
  };

  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest("[data-prange]") : null;
    if (!b) return;
    S.range = b.getAttribute("data-prange");
    refresh();
  });

  // Вход по паролю (телефон)
  document.addEventListener("submit", function (e) {
    var f = e.target && e.target.closest ? e.target.closest("[data-cloud-form]") : null;
    if (!f || !cloud) return;
    e.preventDefault();
    var input = f.querySelector("input[type=password]");
    var btn = f.querySelector("button");
    if (btn) btn.disabled = true;
    cloud.signIn(input ? input.value : "")
      .then(function () { S.err = null; S.sig = ""; poll(); })
      .catch(function (err) { setError((err && err.status) || 0, CC.explain(err), "login"); });
  });

  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest ? e.target.closest("[data-cloud-logout],[data-copy-phone],[data-rotate-key]") : null;
    if (!t) return;
    if (t.hasAttribute("data-cloud-logout") && cloud) {
      cloud.signOut();
      S.data = null; S.sig = "";
      setError(401, "", "login");
    } else if (t.hasAttribute("data-copy-phone")) {
      var el = document.getElementById("phone-url-" + t.getAttribute("data-copy-phone"));
      if (!el || !el.value) return;
      el.select();
      var done = function () { t.textContent = "Скопировано"; setTimeout(function () { t.textContent = "Копировать"; }, 1500); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(el.value).then(done, function () { document.execCommand("copy"); done(); });
      else { document.execCommand("copy"); done(); }
    } else if (t.hasAttribute("data-rotate-key")) {
      if (!window.confirm("Сменить ключ? Все подключённые телефоны придётся подключить заново новой ссылкой.")) return;
      fetch("/api/phone-link", { method: "POST", headers: { "X-Requested-With": "arz" } })
        .then(function (r) { return r.json(); })
        .then(function (j) { S.phone = j; scheduleRefresh(); });
    }
  });

  // Облачный режим: вернулся в приложение — сразу обновить, не ждать таймера
  document.addEventListener("visibilitychange", function () { if (!document.hidden && MODE !== "server") poll(true); });

  poll();
  setInterval(poll, POLL_MS);
})();
