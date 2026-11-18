/* ARZ Terminal — загрузчик реальных цен ArzMarket.
 *
 * Подменяет мок-данные Market / Arbitrage / Dashboard реальными
 * средними ценами лавок (скупка/продажа) с серверов Arizona RP.
 * Файлы готовит scripts/import_arzmarket.py -> data/market_<server>.json
 * Если файла нет или он не загрузился — остаются демо-данные.
 */
(function () {
  "use strict";

  var D = window.ARZ && window.ARZ.data;
  if (!D) return;

  var SERVER_FILE = { vice: "vc" };
  function fileFor(server) {
    return "data/market_" + (SERVER_FILE[server] || server) + ".json";
  }

  var cache = {};   // server -> doc

  function spreadPct(buy, sell) {
    if (!buy || !sell) return 0;
    return ((sell - buy) / buy) * 100;
  }

  function vol(it) { return (it.dealsBuy || 0) + (it.dealsSell || 0); }
  function mean(a) { return a.reduce(function (s, x) { return s + x; }, 0) / a.length; }
  function cv(a) {
    if (!a || a.length < 5) return 99;
    var m = mean(a);
    if (!m) return 99;
    var v = mean(a.map(function (x) { return (x - m) * (x - m); }));
    return Math.sqrt(v) / m;
  }
  function stable(it) { return cv(it.history) <= 0.8; }

  function riskOf(it) {
    if (it.conf >= 85 && (it.liq === "Высокая" || it.liq === "Средняя")) return "Низкий";
    if (it.conf >= 65) return "Средний";
    return "Высокий";
  }

  function applyServer(server, doc) {
    D.items = doc.items;
    var totalQty = 0;
    doc.items.forEach(function (it) {
      totalQty += (it.dealsBuy || 0) + (it.dealsSell || 0);
    });
    // Доля позиций, обновлённых за последние 7 дней от свежайшей даты (по UTC, без TZ).
    var dp = doc.data_date_max.split("-");
    var cut7 = new Date(Date.UTC(+dp[0], +dp[1] - 1, +dp[2] - 7)).toISOString().slice(0, 10);
    var f = doc.items.filter(function (it) { return it.lastDate >= cut7; }).length;
    D.meta = {
      source: doc.source,
      dataServer: serverName(server),
      dataDate: doc.data_date_max,
      generated: doc.generated_at,
      note: server === "vc" ? "Цены Vice City — в VC$." : "",
      freshPct: doc.items.length ? Math.round((f / doc.items.length) * 100) : 0,
      obs: totalQty
    };
    buildIntra(server, doc);
    buildMovers(server, doc);
    buildCross();
  }

  function buildIntra(server, doc) {
    var sname = serverName(server);
    var cands = doc.items.filter(function (it) {
      if (!(it.buy > 0 && it.sell > 0)) return false;
      if (it.conf < 60 || vol(it) < 20) return false;
      if ((it.dealsBuy || 0) < 30 || (it.dealsSell || 0) < 30) return false;
      // Скупка «по 10» при продаже за тысячи — пыльная заглушка лавок,
      // а не реальная ставка. Реальная маржа — в пределах ~20x.
      if (it.buy / it.sell < 0.05) return false;
      if (!it.history || it.history.length < 5 || !stable(it)) return false;
      return true;
    });
    cands.sort(function (a, b) { return spreadPct(b.buy, b.sell) - spreadPct(a.buy, a.sell); });
    D.opportunities = cands.slice(0, 12).map(function (it) {
      return {
        id: it.id, name: it.name,
        sub: "скупка → продажа · " + sname,
        short: it.short, buy: it.buy, sell: it.sell,
        buyServer: sname, sellServer: sname,
        roi: spreadPct(it.buy, it.sell),
        risk: riskOf(it), liq: it.liq
      };
    });
  }

  function buildMovers(server, doc) {
    var cands = doc.items.filter(function (it) {
      return it.sell > 0 && ((it.dealsBuy || 0) + (it.dealsSell || 0)) >= 50;
    });
    cands.sort(function (a, b) { return Math.abs(b.change) - Math.abs(a.change); });
    D.movers = cands.slice(0, 6).map(function (it) {
      return { name: it.name, short: it.short, price: it.sell, change: it.change, cat: it.cat };
    });
  }

  function serverName(id) {
    var s = (D.servers || []).filter(function (x) { return x.id === id; })[0];
    if (s) return s.name;
    return id === "vc" ? "Vice City" : id;
  }

  // Межсерверный арбитраж ОТКЛЮЧЁН: экономики серверов изолированы
  // (у Yuma — вирты $, у Vice City — VC$), связки только внутри сервера.
  function buildCross() {
    return;
  }

  function rerender() {
    if (document.querySelector(".drawer.open")) return;
    if (document.querySelector(".modal-wrap.show")) return;
    if (document.querySelector(".palette-wrap.show")) return;
    var active = document.querySelector(".nav-item.active");
    if (active) active.click();
  }

  function load(server, done) {
    if (cache[server]) {
      if (done) done(cache[server]);
      return;
    }
    fetch(fileFor(server), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.json(); })
      .then(function (doc) {
        cache[server] = doc;
        if (done) done(doc);
      })
      .catch(function () { if (done) done(null); });
  }

  function loadFor(server) {
    load(server, function (doc) {
      if (!doc) return; // нет файла — остаются демо-данные
      applyServer(server, doc);
      rerender();
    });
  }

  // Первичная загрузка: Yuma (совпадает со стартовым в app.js).
  loadFor("yuma");

  // Переключение сервера в UI: подхватываем файл нового сервера.
  // Маппинг id интерфейса -> слаг файлов (vice -> vc).
  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest ? e.target.closest("[data-server]") : null;
    if (!t) return;
    var srv = SERVER_FILE[t.getAttribute("data-server")] || t.getAttribute("data-server");
    setTimeout(function () { loadFor(srv); }, 0);
  });
})();
