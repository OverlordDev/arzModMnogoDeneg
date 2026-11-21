/* ARZ Terminal — Скуп: что ставить на скупку в лавке (расчёт на сервере: GET /api/flip, game/arz_flip.js).
 * Поля ввода живут отдельно от результатов: при вводе перерисовывается только таблица, фокус не теряется. */
(function () {
  "use strict";

  var KEY = "arz.flip.v2";
  var S = { budget: 26, comm: 2, roi: 8, q: "", cat: "", data: null, err: null, loading: false, seq: 0 };
  try {
    var saved = JSON.parse(window.localStorage.getItem(KEY) || "null");
    if (saved) {
      S.budget = saved.budget || S.budget;
      S.comm = saved.comm != null ? saved.comm : S.comm;
      S.roi = saved.roi != null ? saved.roi : S.roi;
      S.cat = saved.cat || "";
    }
  } catch (_) {}
  function save() {
    try { window.localStorage.setItem(KEY, JSON.stringify({ budget: S.budget, comm: S.comm, roi: S.roi, cat: S.cat })); } catch (_) {}
  }

  var FLAGS = {
    noSales: ["нет сделок", "high"], stale: ["цены ArzMarket старые", "mid"], askInflated: ["лавки просят завышено", "mid"],
    volatile: ["цена скачет", "mid"], falling: ["падает", "mid"], gameFalling: ["в игре падает", "mid"],
    noGameData: ["нет данных игры", "mid"], lowGameVol: ["мало сделок", "high"], tooGood: ["подозрительно", "high"]
  };

  function U() { return window.ARZ && window.ARZ.ui; }
  function esc(s) { return U().esc(s); }
  function full(v) { return v == null ? "—" : Math.round(v).toLocaleString("ru-RU"); }
  function compact(v) {
    if (v == null) return "—";
    var a = Math.abs(v), sign = v < 0 ? "−" : "";
    if (a >= 1e9) return sign + (a / 1e9).toFixed(1).replace(".", ",") + " млрд";
    if (a >= 1e6) return sign + (a / 1e6).toFixed(a >= 1e8 ? 0 : 1).replace(".", ",") + " млн";
    if (a >= 1e4) return sign + Math.round(a / 1e3) + " тыс";
    return sign + Math.round(a).toLocaleString("ru-RU");
  }
  function narrow() { return !!(window.matchMedia && window.matchMedia("(max-width: 760px)").matches); }
  function m(v) { return narrow() ? compact(v) : full(v); }

  function query() {
    var p = ["budget=" + Math.round((Number(S.budget) || 26) * 1e6), "comm=" + (Number(S.comm) || 0), "roi=" + (Number(S.roi) || 0)];
    if (S.q) p.push("q=" + encodeURIComponent(S.q));
    if (S.cat) p.push("cat=" + encodeURIComponent(S.cat));
    return "/api/flip?" + p.join("&");
  }

  var timer = null;
  function load(delay) {
    clearTimeout(timer);
    timer = setTimeout(function () {
      var mine = ++S.seq;
      S.loading = true;
      fetch(query(), { credentials: "same-origin" })
        .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
        .then(function (res) {
          if (mine !== S.seq) return; // ответ на устаревший запрос
          S.loading = false;
          if (res.body && res.body.ok) { S.data = res.body; S.err = null; }
          else { S.data = null; S.err = (res.body && res.body.error) || "ошибка " + res.status; }
          paint();
        })
        .catch(function () {
          if (mine !== S.seq) return;
          S.loading = false;
          S.err = "сервер недоступен (на телефоне нужна ссылка с ПК)";
          paint();
        });
    }, delay || 0);
  }

  function badges(flags) {
    return (flags || []).filter(function (f) { return FLAGS[f]; }).map(function (f) {
      return '<span class="badge badge-' + FLAGS[f][1] + '">' + FLAGS[f][0] + "</span>";
    }).join(" ");
  }

  function results() {
    if (S.err) return '<div class="card"><div class="empty">' + esc(S.err) + "</div></div>";
    var d = S.data;
    if (!d) return '<div class="card"><div class="empty">Считаю…</div></div>';
    var p = d.portfolio || { items: [] }, a = d.assumptions;
    var plan = p.items.map(function (i) {
      return "<tr><td>" + esc(i.name) + '</td><td class="num">×' + full(i.units) + '</td><td class="num">' + m(i.bid) +
        '</td><td class="num hide-sm">' + m(i.ask) + '</td><td class="num">' + m(i.cost) + '</td><td class="num pos">+' + m(i.profit) + "</td></tr>";
    }).join("");
    var summary = '<div class="card table-card"><div class="table-head"><div><div class="card-title">Раскладка на ' + compact(a.budget) + ' $</div>' +
      '<div class="card-sub">Лоты сверху рейтинга, пока хватает денег. Лот ограничен долей бюджета (25%) и тем, что реально разойдётся за ' + a.holdDays + " дня при " + Math.round(a.capture * 100) + "% оборота</div></div>" +
      '<span class="badge badge-white">≈ ' + compact(p.profitPerDay) + " $/сутки</span></div>" +
      (plan
        ? '<div class="table-scroll"><table><thead><tr><th>Предмет</th><th>Шт.</th><th>Скуп по</th><th class="hide-sm">Продать по</th><th>Вложить</th><th>Прибыль</th></tr></thead><tbody>' + plan +
          '<tr><td><b>Итого</b></td><td></td><td></td><td class="hide-sm"></td><td class="num"><b>' + m(p.spent) + '</b></td><td class="num pos"><b>+' + m(p.profitPerCycle) + "</b></td></tr></tbody></table></div>" +
          '<div class="tiny dim" style="padding:10px 16px">Свободно: ' + m(p.left) + " $. «Прибыль» — за один оборот лота (≈1–3 суток), если заявки заполнятся по этим ценам.</div>"
        : '<div class="empty">С такими настройками ничего не подходит: снизь минимальную прибыль или смени категорию.</div>') + "</div>";

    var rows = d.items.map(function (i) {
      return '<tr><td><div class="item-name">' + esc(i.name) + '</div><div class="item-sub">' + esc(i.cat) + "</div></td>" +
        '<td class="num">' + m(i.bid) + '<div class="sub-cell">скупка ' + m(i.buy) + "</div></td>" +
        '<td class="num">' + m(i.ask) + '<div class="sub-cell">' + (i.askSource === "game" ? "по сделкам в игре" : "лавки") + "</div></td>" +
        '<td class="num pos">+' + i.roi.toFixed(1) + '%<div class="sub-cell">+' + m(i.profitPerUnit) + "</div></td>" +
        '<td class="num hide-sm">' + full(i.flowPerDay) + "/сут</td>" +
        '<td class="num">' + full(i.units) + '<div class="sub-cell">≈' + (i.cycleDays == null ? "—" : i.cycleDays) + " сут</div></td>" +
        '<td class="hide-sm">' + badges(i.flags) + "</td></tr>";
    }).join("");
    var table = '<div class="card table-card mt-16"><div class="table-head"><div><div class="card-title">Подходящие предметы</div>' +
      '<div class="card-sub">' + d.eligible + " из " + d.total + " прошли фильтры" +
      (d.suspicious ? " · отброшено " + d.suspicious + " с нереальной маржой (скорее всего, мусорные заявки в данных)" : "") + "</div></div>" +
      '<span class="badge">' + esc(d.server) + "</span></div>" +
      '<div class="table-scroll"><table><thead><tr><th>Предмет</th><th>Скуп по</th><th>Продать по</th><th>Прибыль</th><th class="hide-sm">Оборот</th><th>Лот</th><th class="hide-sm">Риски</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="7"><div class="empty">Ничего не найдено.</div></td></tr>') + "</tbody></table></div></div>";

    var age = [];
    if (d.dataDate) age.push("цены ArzMarket за " + esc(d.dataDate) + (d.staleDays != null ? " (" + d.staleDays + " дн. назад)" : ""));
    age.push(d.gameUpdatedAt ? "игровые цены ЦР обновлены " + esc(new Date(d.gameUpdatedAt).toLocaleString("ru-RU")) : "игровых цен нет — все расчёты по ArzMarket с запасом 10%");
    var notes = '<div class="card mt-16"><div class="card-title">Как это считается и чему не верить</div><div class="tiny dim mt-12">' +
      "Скуп по = цена скупки лавок + 1% (перебить, чтобы встать первым). Продать по = меньшая из цен «лавки просят» и «реально проходит в игре» (медиана за 7 дней). Прибыль = продажа × (1 − комиссия) − скуп.<br><br>" +
      "<b>Заявки конкурентов в реальном времени я не вижу</b> — только сделки за прошлые дни. Поэтому цифры «в сутки» — верхняя оценка: проверь первую партию (одна-две штуки) и смотри, как быстро она купится и продастся. Комиссия по умолчанию 2% (с ADD VIP, проверено продажей); без ADD VIP впиши свою.<br><br>" +
      "Данные: " + age.join("; ") + ".</div></div>";
    return summary + table + notes;
  }

  function catOptions() {
    var cats = S.data && S.data.categories ? Object.keys(S.data.categories).sort() : [];
    if (S.cat && cats.indexOf(S.cat) < 0) cats.push(S.cat);
    return '<option value="">Все категории</option>' + cats.map(function (c) {
      return '<option value="' + esc(c) + '"' + (S.cat === c ? " selected" : "") + ">" + esc(c) + "</option>";
    }).join("");
  }

  function controls() {
    function field(id, label, val, step) {
      return '<label class="field"><span>' + label + '</span><input class="input" id="' + id + '" type="number" inputmode="decimal" min="0" step="' + step + '" value="' + esc(String(val)) + '"></label>';
    }
    return '<div class="card"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px">' +
      field("flip-budget", "Бюджет, млн $", S.budget, "1") + field("flip-comm", "Комиссия продажи, %", S.comm, "0.5") + field("flip-roi", "Мин. прибыль, %", S.roi, "1") +
      '<label class="field"><span>Категория</span><select class="select" id="flip-cat" style="height:36px">' + catOptions() + "</select></label>" +
      '<label class="field"><span>Поиск</span><input class="input" id="flip-q" type="search" placeholder="ларец…" value="' + esc(S.q) + '" autocomplete="off"></label>' +
      "</div></div>";
  }

  function paint() {
    var box = document.getElementById("flip-results");
    if (box) box.innerHTML = results();
    var cat = document.getElementById("flip-cat"); // список категорий приходит вместе с данными
    if (cat && cat.options.length <= 1 && S.data) cat.innerHTML = catOptions();
  }

  window.ARZ.renderFlip = function () {
    var ui = U();
    if (!S.data && !S.err && !S.loading) load(0);
    return ui.pageHead("Скуп: что ставить на лавку",
      "Заявки на скупку, которые можно перепродать с прибылью: цена скупки против цены продажи, оборот и риски. Деньги — свободные, не с депозита (депозит приносит больше, а снятие стоит 7%).", "") +
      controls() + '<div id="flip-results" class="mt-16">' + results() + "</div>";
  };

  function num(id) {
    var el = document.getElementById(id);
    var v = el ? parseFloat(String(el.value).replace(",", ".")) : NaN;
    return isFinite(v) && v >= 0 ? v : null;
  }
  document.addEventListener("input", function (e) {
    var id = e.target && e.target.id;
    if (id === "flip-q") { S.q = e.target.value.trim(); load(350); }
    else if (id === "flip-budget" || id === "flip-comm" || id === "flip-roi") {
      var v = num(id);
      if (v == null) return;
      if (id === "flip-budget") S.budget = v; else if (id === "flip-comm") S.comm = v; else S.roi = v;
      save();
      load(450);
    }
  });
  document.addEventListener("change", function (e) {
    if (e.target && e.target.id === "flip-cat") { S.cat = e.target.value; save(); load(0); }
  });
})();
