/* ARZ Terminal — Deposit: всё про банковский депозит + калькулятор.
 *
 * Грузит data/deposit.json (ставки, уровни, бонусы, штрафы).
 * Формула: min(вклад, лимит) / делитель_VIP x (1 + сумма %) x штрафы.
 * Сложение процентов — допущение (вики даёт по одному бонусу за раз).
 */
(function () {
  "use strict";

  var URL = "data/deposit.json";
  var S = {
    doc: null, loaded: false,
    vip: "none", level: 0, amount: 40000000,
    faction: "none", houses: 0, family: false,
    gramota: false, pension: false, backpack: false,
    povestka: false, nohouse: false,
    paydayMin: 30, target: 1000000
  };

  function U() { return window.ARZ && window.ARZ.ui; }
  function D() { return S.doc; }

  function vip() {
    var vs = (D() && D().vip) || [];
    for (var i = 0; i < vs.length; i++) if (vs[i].id === S.vip) return vs[i];
    return vs[0];
  }

  function levelObj() {
    var ls = (D() && D().levels) || [];
    for (var i = 0; i < ls.length; i++) if (ls[i].level === S.level) return ls[i];
    return { level: 0, pct: 0, limit_add: 0 };
  }

  function factionPct() {
    var ts = (D() && D().faction_tiers) || [];
    for (var i = 0; i < ts.length; i++) if (ts[i].id === S.faction) return ts[i].pct || 0;
    return 0;
  }

  function calc() {
    var v = vip() || { divisor: 1500, cap: 40000000, vip_bonus: 0 };
    var lv = levelObj();
    var limitAdds = 0;
    ((D() && D().levels) || []).forEach(function (l) { if (l.level >= 1 && l.level <= S.level) limitAdds += (l.limit_add || 0); });
    var houses = (D() && D().houses && D().houses.per_house || 0) * (S.houses || 0);
    var fam = 0;
    ((D() && D().bonuses) || []).forEach(function (b) { if (b.id === "family_bank" && S.family) fam = b.limit_add || 0; });
    var cap = v.cap + limitAdds + houses + fam;

    var bonusSum = (lv.pct || 0) + (v.vip_bonus || 0) + factionPct();
    var activeBonus = [];
    if (lv.pct) activeBonus.push("ур." + S.level + " +" + Math.round(lv.pct * 100) + "%");
    if (v.vip_bonus) activeBonus.push("VIP +" + Math.round(v.vip_bonus * 100) + "%");
    function tb(id, label) {
      var on = S[id];
      var pct = 0;
      ((D() && D().bonuses) || []).forEach(function (b) { if (b.id === id) pct = b.pct || 0; });
      if (on && pct) { bonusSum += pct; activeBonus.push(label + " +" + Math.round(pct * 100) + "%"); }
    }
    tb("gramota", "Грамота"); tb("pension", "Пенсия"); tb("backpack", "Рюкзак");
    var fpct = factionPct();
    if (fpct) activeBonus.push("Фракция +" + Math.round(fpct * 100) + "%");

    var penMult = 1, penList = [];
    ((D() && D().penalties) || []).forEach(function (p) {
      var on = (p.id === "povestka" && S.povestka) || (p.id === "nohouse" && S.nohouse);
      if (on) { penMult *= p.mult; penList.push(p.name + " x" + p.mult); }
    });

    var counted = Math.min(S.amount || 0, cap);
    var base = counted / (v.divisor || 1500);
    var net = base * (1 + bonusSum) * penMult;
    var perHour = net * (60 / (S.paydayMin || 30));
    var perDay = perHour * 24;
    var effPct = counted > 0 ? (net / counted) * 100 : 0;
    var need = net > 0 ? Math.ceil(S.target / net * counted) : 0;
    return { cap: cap, counted: counted, base: base, mult: 1 + bonusSum, penMult: penMult, net: net, perHour: perHour, perDay: perDay, effPct: effPct, need: need, activeBonus: activeBonus, penList: penList, limitAdds: limitAdds, housesAdd: houses, famAdd: fam, divisor: v.divisor || 1500 };
  }

  function ensureData(done) {
    if (S.loaded) { if (done) done(); return; }
    fetch(URL, { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (doc) {
        if (doc && doc.vip) { S.doc = doc; S.loaded = true; }
        if (done) done();
        rerender();
      })
      .catch(function () { if (done) done(); rerender(); });
  }

  function rerender() {
    if (document.querySelector(".drawer.open")) return;
    if (document.querySelector(".modal-wrap.show")) return;
    if (document.querySelector(".palette-wrap.show")) return;
    var active = document.querySelector(".nav-item.active");
    if (active && active.getAttribute("data-nav") === "deposit") active.click();
  }

  function numField(id, label, val, min, max, step) {
    return '<div class="field"><label>' + label + '</label><input id="' + id + '" type="number" value="' + val + '" min="' + min + '" max="' + max + '" step="' + step + '"></div>';
  }

  function optList(items, val, getV, getL) {
    return items.map(function (x) { return '<option value="' + getV(x) + '"' + (String(val) === String(getV(x)) ? " selected" : "") + ">" + getL(x) + "</option>"; }).join("");
  }

  function toggleRow(id, label, desc, on) {
    return '<div class="settings-row"><div><div class="settings-label">' + label + '</div><div class="settings-desc">' + desc + '</div></div>' +
      '<button class="toggle' + (on ? " on" : "") + '" data-dep="' + id + '" aria-label="' + label + '"></button></div>';
  }

  function render() {
    var ui = U();
    if (!ui) return "";
    var doc = D() || {};
    var c = calc();
    var v = vip() || { name: "—" };
    var lv = levelObj();

    var vipOpts = optList(doc.vip || [], S.vip, function (x) { return x.id; }, function (x) { return x.name + " (1/" + x.divisor + ", до " + ui.money(x.cap) + ")"; });
    var lvlOpts = optList(doc.levels || [], S.level, function (x) { return x.level; }, function (x) { return "Уровень " + x.level + (x.pct ? " (+" + Math.round(x.pct * 100) + "%)" : ""); });
    var facOpts = optList(doc.faction_tiers || [], S.faction, function (x) { return x.id; }, function (x) { return x.name; });

    function bonusTog(id) {
      var b = null;
      (doc.bonuses || []).forEach(function (x) { if (x.id === id) b = x; });
      if (!b) return "";
      return toggleRow(id, b.name + " (+" + Math.round((b.pct || 0) * 100) + "%)", b.hint || "", !!S[id]);
    }

    var lvlRows = (doc.levels || []).map(function (l) {
      var cum = 0;
      doc.levels.forEach(function (x) { if (x.level >= 1 && x.level <= l.level) cum += (x.limit_add || 0); });
      return "<tr" + (l.level === S.level ? ' style="background:rgba(255,255,255,.03)"' : "") + "><td class=\"num\">" + l.level + "</td>" +
        '<td class="num">+' + Math.round((l.pct || 0) * 100) + '%</td><td class="num">+' + ui.money(l.limit_add || 0) + '</td><td class="num dim">+' + ui.money(cum) + '</td><td class="dim tiny">' + ui.esc(l.note || "") + "</td></tr>";
    }).join("");

    var exRows = ((doc && doc.examples) || []).map(function (e) {
      return "<tr><td class=\"num\">" + ui.money(e.amount) + "</td><td>" + ui.esc(e.vip) + "</td><td class=\"num\">" + (e.bonus ? "+" + Math.round(e.bonus * 100) + "%" : "—") + '</td><td class="num pos">' + ui.money(e.payout) + '</td><td class="dim tiny">' + ui.esc(e.note || "") + "</td></tr>";
    }).join("");

    var head = '<div class="page-head"><div class="page-head-left">' +
      '<div class="eyebrow">ARZ Terminal / Deposit</div><h1>Депозит</h1>' +
      '<div class="desc">Пассивный доход каждый PayDay. Формула: min(вклад, лимит) / делитель VIP x (1 + сумма %) x штрафы. Сложение процентов — допущение: вики подтверждает по одному бонусу за раз.</div>' +
      '</div><div class="page-actions"><span class="badge">' + (doc ? "данные " + ui.esc(doc.updated) : "демо") + "</span></div></div>";

    var calcHtml = '<div class="card"><div class="card-head"><div><div class="card-title">Калькулятор</div><div class="card-sub">Множитель x' + c.mult.toFixed(2) + (c.activeBonus.length ? " · " + ui.esc(c.activeBonus.join(", ")) : "") + (c.penList.length ? " · штрафы: " + ui.esc(c.penList.join(", ")) : "") + "</div></div></div>" +
      '<div class="field"><label>VIP-статус</label><select id="dep-vip">' + vipOpts + "</select></div>" +
      '<div class="calc mt-12">' +
        '<div class="field"><label>Уровень депозита</label><select id="dep-level">' + lvlOpts + "</select></div>" +
        '<div class="field"><label>Фракция (ранг)</label><select id="dep-faction">' + facOpts + "</select></div>" +
        numField("dep-amount", "Вклад, $", S.amount, 0, 999000000000, 1000000) +
        numField("dep-houses", "Домов с улучшением (+6 млн к лимиту каждый)", S.houses, 0, 100, 1) +
        '<div class="field"><label>PayDay каждые, мин</label><select id="dep-payday"><option value="30"' + (S.paydayMin === 30 ? " selected" : "") + '>30 мин</option><option value="60"' + (S.paydayMin === 60 ? " selected" : "") + ">60 мин</option></select></div>" +
        numField("dep-target", "Хочу $ за PayDay", S.target, 0, 100000000, 50000) +
      "</div>" +
      '<div class="mt-12">' + bonusTog("gramota") + bonusTog("pension") + bonusTog("backpack") +
      toggleRow("family", "Банковские махинации (семья)", "+100 млн $ к лимиту", S.family) +
      toggleRow("povestka", "Повестка висит", "x0.5 к доходу", S.povestka) +
      toggleRow("nohouse", "Нет жилья", "x0.5 к доходу", S.nohouse) + "</div>" +
      '<div class="calc-out">' +
        '<div class="calc-box"><small>Лимит вклада</small><strong>' + fmtMoney(c.cap, ui) + "</strong></div>" +
        '<div class="calc-box"><small>Засчитано</small><strong>' + fmtMoney(c.counted, ui) + "</strong></div>" +
        '<div class="calc-box"><small>Чистыми / PayDay</small><strong class="pos">' + fmtMoney(c.net, ui) + "</strong></div>" +
        '<div class="calc-box"><small>Эффективный % / PayDay</small><strong>' + c.effPct.toFixed(3) + "%</strong></div>" +
        '<div class="calc-box"><small>В час</small><strong class="pos">' + fmtMoney(c.perHour, ui) + "</strong></div>" +
        '<div class="calc-box"><small>В сутки</small><strong class="pos">' + fmtMoney(c.perDay, ui) + "</strong></div>" +
        '<div class="calc-box"><small>Для целевого дохода вложить</small><strong>' + fmtMoney(c.need, ui) + "</strong></div>" +
        '<div class="calc-box"><small>Окупаемость цели</small><strong>' + (c.cap >= c.need ? "влезает в лимит" : "НЕ влезает в лимит") + "</strong></div>" +
      "</div>" +
      '<div class="tiny dim mt-12">Лимит = база VIP + надбавки уровней накопительно (' + fmtMoney(c.limitAdds, ui) + ') + дома (' + fmtMoney(c.housesAdd, ui) + ') + семья (' + fmtMoney(c.famAdd, ui) + '). По вики абсолютный максимум — 372 млн: если расчёт выше, игра, вероятно, срежет. Точную цену улучшения показывает кнопка «Улучшить» в банке.</div>' +
      "</div>";

    var tables = '<div class="card table-card mt-16"><div class="card-head"><div><div class="card-title">Уровни депозита</div><div class="card-sub">Надбавки лимита — накопительно (допущение, в вики не уточнено)</div></div></div>' +
      '<div class="table-scroll"><table><thead><tr><th>Уровень</th><th>Доход</th><th>+ к лимиту</th><th>Суммарно</th><th></th></tr></thead><tbody>' + lvlRows + "</tbody></table></div></div>" +
      '<div class="card table-card mt-16"><div class="card-head"><div><div class="card-title">Проверочные примеры из вики</div><div class="card-sub">Сходится с формулой (округление вики ±500)</div></div></div>' +
      '<div class="table-scroll"><table><thead><tr><th>Вклад</th><th>VIP</th><th>Бонус</th><th>PayDay</th><th>Комментарий</th></tr></thead><tbody>' + exRows + "</tbody></table></div></div>";

    var info = '<div class="grid-2 mt-16">' +
      '<div class="card"><div class="card-head"><div><div class="card-title">Как качать</div><div class="card-sub">Опыт депозита</div></div></div>' +
      '<div class="small muted">Опыт депозита дают за повышение игрового уровня (до 100-го), его можно покупать/продавать на Центральном рынке. Улучшение: деньги с банковского счёта + опыт; пример 0→1: 10 ед. опыта + 7 млн $, каждое вложение +10% прогресса, на 10-м — уровень. В донате можно понизить уровень до 12-го и фармить опыт заново.</div></div>' +
      '<div class="card"><div class="card-head"><div><div class="card-title">Снятие и пополнение</div><div class="card-sub">Старое vs новое</div></div></div>' +
      '<div class="small muted">До 2026: не снимать 5 PayDay; операции — касса банка 22:00–12:00, сотрудник банка 4+ ранга или галочка семьи; комиссия вывода была 3% (выходные) / 7% (будни). С 2026 (Double Gang): кулдаун на снятие убран — снимать без лимитов по времени, пополнение с ограничениями.</div></div>' +
      "</div>";

    return head + '<div class="biz-grid">' + calcHtml + tables + "</div>" + info;
  }

  function fmtMoney(v, ui) {
    if (v === null || v === undefined) return "—";
    return ui.money(Math.round(v));
  }

  window.ARZ.renderDeposit = function () {
    var html = render();
    setTimeout(ensureData, 0);
    return html;
  };

  document.addEventListener("change", function (e) {
    if (!e.target || !e.target.id) return;
    var id = e.target.id;
    if (id === "dep-vip") { S.vip = e.target.value; rerender(); }
    if (id === "dep-level") { S.level = parseInt(e.target.value, 10) || 0; rerender(); }
    if (id === "dep-faction") { S.faction = e.target.value; rerender(); }
    if (id === "dep-payday") { S.paydayMin = parseInt(e.target.value, 10) || 30; rerender(); }
  });

  function rerender() {
    if (document.querySelector(".drawer.open")) return;
    if (document.querySelector(".modal-wrap.show")) return;
    if (document.querySelector(".palette-wrap.show")) return;
    var active = document.querySelector(".nav-item.active");
    if (active && active.getAttribute("data-nav") === "deposit") active.click();
  }

  document.addEventListener("input", function (e) {
    if (!e.target || !e.target.id) return;
    var id = e.target.id;
    if (id.indexOf("dep-") !== 0 || id === "history-search") return;
    // Селекты (dep-vip/level/faction/payday) обрабатываются в change;
    // input на них только сбросил бы выбор — выходим.
    if (id !== "dep-amount" && id !== "dep-houses" && id !== "dep-target") return;
    var v = parseFloat(e.target.value);
    if (id === "dep-amount" && v >= 0) S.amount = v;
    if (id === "dep-houses" && v >= 0) S.houses = Math.floor(v);
    if (id === "dep-target" && v >= 0) S.target = v;
    var root = document.querySelector("#view-root");
    if (root) {
      var pos = window.scrollY, sel = "#" + id;
      root.innerHTML = render();
      window.scrollTo(0, pos);
      var el = document.querySelector(sel);
      if (el && el.focus) {
        el.focus();
        try { var len = String(el.value || "").length; el.setSelectionRange(len, len); } catch (err) {}
      }
    }
  });

  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest ? e.target.closest("[data-dep]") : null;
    if (!t) return;
    var id = t.getAttribute("data-dep");
    S[id] = !S[id];
    rerender();
  });
})();
