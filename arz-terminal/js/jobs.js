/* ARZ Terminal — Jobs: калькулятор работ.
 *
 * Грузит data/jobs.json (замеры) + data/job_items.json (аренда, сиропы,
 * аксессуары с подсказками). Считает чистыми в час с учётом навыка,
 * бонусов, аренды и расходников; разовые покупки — с окупаемостью.
 */
(function () {
  "use strict";

  var FALLBACK = [
    { id: "lesopilka", name: "Лесопилка", net_min: 14500000, net_median: 20000000, net_max: 28280000, reliability: "medium", requirements: "1 уровень", costs: [{ name: "бензопила", per_hour: 400 }], n: 0 },
    { id: "shahta", name: "Шахта", net_min: 16000000, net_median: 16000000, net_max: 16000000, reliability: "medium", requirements: "3 уровень", costs: [], n: 0 },
    { id: "taxi", name: "Таксист", net_min: 6500000, net_median: 20000000, net_max: 40000000, reliability: "medium", requirements: "1 уровень", costs: [{ name: "аренда такси", per_hour: 0 }], n: 0 },
  ];

  var S = { doc: null, items: null, job: null, hours: 1, skill: 70, group: 0, x2: false, extraPct: 0, rent: 0, sel: {}, loadedJobs: false, loadedItems: false };
  var JOBS_URL = "data/jobs.json";
  var ITEMS_URL = "data/job_items.json";

  function U() { return window.ARZ && window.ARZ.ui; }

  function jobs() {
    if (S.doc && S.doc.jobs && S.doc.jobs.length) return S.doc.jobs;
    return FALLBACK;
  }

  function byId(id) {
    var js = jobs();
    for (var i = 0; i < js.length; i++) if (js[i].id === id) return js[i];
    return js[0];
  }

  function itemsFor(jobId) {
    if (!S.items || !S.items.items) return [];
    return S.items.items.filter(function (it) { return (it.jobs || []).indexOf(jobId) !== -1; });
  }

  function fmtMoney(v, ui) {
    if (v === null || v === undefined) return "—";
    return ui.money(Math.round(v));
  }

  function relBadge(r, ui) {
    var map = { high: ["Высокая", "badge-low"], medium: ["Средняя", "badge-mid"], low: ["Низкая", "badge-high"] };
    var m = map[r] || map.medium;
    return '<span class="badge ' + m[1] + '">' + m[0] + "</span>";
  }

  function itemState(it) {
    if (!S.sel[it.id]) S.sel[it.id] = { on: false, price: it.price || 0 };
    return S.sel[it.id];
  }

  function calc(j) {
    var ui = U();
    var lo = j.net_min || 0, med = j.net_median || lo, hi = j.net_max || med;
    var base = med + (hi - med) * (S.skill / 100);
    if (S.skill < 50) base = lo + (med - lo) * (S.skill / 50);
    var g = [0, 10, 15, 20, 30][S.group] || 0;
    var mult = (1 + g / 100) * (S.x2 ? 2 : 1) * (1 + (S.extraPct || 0) / 100);
    var flat = 0, costsH = 0, oneTime = 0, activeBuffs = [];
    itemsFor(j.id).forEach(function (it) {
      var st = itemState(it);
      if (!st.on) return;
      var price = st.price || 0;
      if (it.kind === "rent" || it.kind === "consumable") {
        costsH += price;
      } else {
        if (price > 0) oneTime += price;
      }
      if (it.effect && it.effect.mode === "mult" && it.effect.value > 1) {
        mult *= it.effect.value;
        activeBuffs.push(it.name + " x" + it.effect.value);
      }
      if (it.effect && it.effect.mode === "flat" && it.effect.value) {
        flat += it.effect.value;
        activeBuffs.push(it.name + " +" + ui.money(it.effect.value) + "/ч");
      }
    });
    var rent = 0;
    (j.costs || []).forEach(function (c) { rent += (c.per_hour || 0); });
    rent += (S.rent || 0);
    var gross = (base + flat) * mult;
    var net = gross - costsH - rent;
    var session = net * (S.hours || 0) - oneTime;
    return { gross: gross, costsH: costsH + rent, net: net, session: session, oneTime: oneTime, mult: mult, buffs: activeBuffs };
  }

  function ensureData(done) {
    var need = (!S.loadedJobs || !S.loadedItems);
    if (!need) { if (done) done(); return; }
    var p1 = fetch(JOBS_URL, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    var p2 = fetch(ITEMS_URL, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    Promise.all([p1, p2]).then(function (res) {
      if (res[0] && res[0].jobs && res[0].jobs.length) { S.doc = res[0]; S.loadedJobs = true; }
      if (res[1] && res[1].items) { S.items = res[1]; S.loadedItems = true; }
      if (!S.job) {
        var js = jobs();
        var taxi = null;
        for (var i = 0; i < js.length; i++) if (js[i].id === "taxi") taxi = js[i];
        S.job = taxi ? taxi.id : (js.length ? js[0].id : null);
      }
      if (done) done();
      rerender();
    });
  }

  function rerender() {
    if (document.querySelector(".drawer.open")) return;
    if (document.querySelector(".modal-wrap.show")) return;
    if (document.querySelector(".palette-wrap.show")) return;
    var active = document.querySelector(".nav-item.active");
    if (active && active.getAttribute("data-nav") === "jobs") active.click();
  }

  function kindLabel(kind) {
    return { rent: "Аренда", consumable: "Сиропы и расходники", buff: "Бафы и аксессуары", service: "Разовое" }[kind] || kind;
  }

  function kindOrder(kind) {
    return { rent: 0, consumable: 1, buff: 2, service: 3 }[kind] || 9;
  }

  function itemRow(it, ui) {
    var st = itemState(it);
    var priceLabel = (it.kind === "rent" || it.kind === "consumable") ? "$/час" : "$ разово";
    var eff = "";
    if (it.effect && it.effect.mode === "mult" && it.effect.value > 1) eff = '<span class="badge badge-low">x' + it.effect.value + "</span>";
    else if (it.effect && it.effect.mode === "flat" && it.effect.value) eff = '<span class="badge badge-low">+' + ui.money(it.effect.value) + "/ч</span>";
    var out = '<div class="biz-row' + (st.on ? " active" : "") + '" data-jitem="' + it.id + '">' +
      '<div style="display:flex;gap:8px;align-items:flex-start"><button class="toggle' + (st.on ? " on" : "") + '" data-jtoggle="' + it.id + '" aria-label="Вкл/выкл"></button>' +
      '<div><div class="biz-name">' + ui.esc(it.name) + " " + eff + '</div><div class="biz-meta">' + ui.esc(it.price_note || "") + " · " + ui.esc(({ high: "надёжность высокая", medium: "средняя", low: "низкая — проверь" })[it.reliability] || "") + '</div>' +
      '<div class="biz-meta hist-hint hide" id="hint-' + it.id + '">' + ui.esc(it.hint || "") + (it.source ? " [" + ui.esc(it.source) + "]" : "") + "</div></div></div>" +
      '<div class="biz-price"><input class="mini-price" data-jprice="' + it.id + '" type="number" value="' + (st.price || 0) + '" title="' + priceLabel + '"></div>' +
      '<div class="biz-payback"><button class="btn btn-ghost btn-sm" data-jhint="' + it.id + '">?</button></div>' +
      "</div>";
    return out;
  }

  function itemsBlock(j, ui, c) {
    var list = itemsFor(j.id).slice().sort(function (a, b) { return kindOrder(a.kind) - kindOrder(b.kind); });
    if (!list.length) return '<div class="card mt-16"><div class="empty">По этой работе детальных позиций нет — цифры из вики/патчноутов. Включай свои расходы вручную выше.</div></div>';
    var buffs = list.filter(function (it) { return it.kind === "buff"; });
    var rest = list.filter(function (it) { return it.kind !== "buff"; });
    var html = '<div class="card mt-16"><div class="card-head"><div><div class="card-title">Предметы и аренда</div><div class="card-sub">Аренда и расходники — в $/час · аксы — из списка ниже · «?» — подсказка</div></div></div>';
    html += accDropdown(j, buffs, ui);
    var groups = {};
    rest.forEach(function (it) { (groups[it.kind] = groups[it.kind] || []).push(it); });
    Object.keys(groups).sort(function (a, b) { return kindOrder(a) - kindOrder(b); }).forEach(function (k) {
      html += '<div class="card-head mt-12"><div><div class="card-title">' + kindLabel(k) + '</div><div class="card-sub">клик по строке — вкл/выкл · цену можно править</div></div></div>' +
        '<div class="biz-list">' + groups[k].map(function (it) { return itemRow(it, ui); }).join("") + "</div>";
    });
    return html + "</div>";
  }

  function accDropdown(j, buffs, ui) {
    var added = buffs.filter(function (it) { return itemState(it).on; });
    var avail = buffs.filter(function (it) { return !itemState(it).on; });
    var html = '<div class="card-head"><div><div class="card-title">Аксессуары и бафы — только для: ' + ui.esc(j.name) + '</div><div class="card-sub">выбери из списка — добавится ниже · цена = разовая покупка (для окупаемости)</div></div></div>';
    html += '<div class="field"><label>Добавить акс (' + buffs.length + ' шт. для этой работы)</label><select id="job-acc">' +
      '<option value="">— выбрать —</option>' +
      avail.map(function (it) {
        var eff = it.effect && it.effect.mode === "mult" && it.effect.value > 1 ? " · x" + it.effect.value : "";
        return '<option value="' + it.id + '">' + ui.esc(it.name) + eff + "</option>";
      }).join("") + "</select></div>";
    if (!added.length) {
      html += '<div class="empty" style="padding:12px">Ничего не выбрано — считается голый фарм с групповыми бафами выше.</div>';
      return html;
    }
    html += '<div class="chips-row mt-8">' + added.map(function (it) {
      var st = itemState(it);
      var eff = it.effect && it.effect.mode === "mult" && it.effect.value > 1 ? '<span class="badge badge-low">x' + it.effect.value + "</span>" : "";
      return '<div class="chip"><button class="chip-x" data-accrm="' + it.id + '" aria-label="Убрать">×</button>' +
        '<div><div class="chip-name">' + ui.esc(it.name) + " " + eff + '</div><div class="chip-sub">' + ui.esc(it.price_note || "") + '</div>' +
        '<div class="chip-row"><input class="mini-price" data-jprice="' + it.id + '" type="number" value="' + (st.price || 0) + '" title="Разовая цена, $">' +
        '<button class="btn btn-ghost btn-sm" data-jhint="' + it.id + '">?</button></div>' +
        '<div class="biz-meta hist-hint hide" id="hint-' + it.id + '">' + ui.esc(it.hint || "") + "</div></div></div>";
    }).join("") + "</div>";
    return html;
  }

  function render() {
    var ui = U();
    if (!ui) return "";
    var js = jobs().slice().sort(function (a, b) { return (b.net_median || 0) - (a.net_median || 0); });
    if (!S.job) {
      S.job = "taxi";
    }
    var j = byId(S.job) || js[0];
    var c = j ? calc(j) : { gross: 0, costsH: 0, net: 0, session: 0, oneTime: 0, mult: 1, buffs: [] };

    var rows = js.map(function (x) {
      return '<tr class="row-click" data-jobrow="' + x.id + '">' +
        '<td><div class="item-cell"><div class="item-avatar">' + ui.esc((x.name || "?").slice(0, 2).toUpperCase()) + '</div><div><div class="item-name">' + ui.esc(x.name) + '</div><div class="item-sub">' + ui.esc(x.requirements || "") + "</div></div></div></td>" +
        '<td class="num">' + fmtMoney(x.net_min, ui) + "</td>" +
        '<td class="num"><strong>' + fmtMoney(x.net_median, ui) + "</strong></td>" +
        '<td class="num">' + fmtMoney(x.net_max, ui) + "</td>" +
        '<td class="num dim">' + (x.costs || []).map(function (cc) { return ui.esc(cc.name); }).join(", ") + "</td>" +
        '<td>' + relBadge(x.reliability, ui) + "</td>" +
        '<td class="num dim">' + (x.n || "—") + "</td>" +
        "</tr>";
    }).join("");

    function numField(id, label, val, min, max, step) {
      return '<div class="field"><label>' + label + '</label><input id="' + id + '" type="number" value="' + val + '" min="' + min + '" max="' + max + '" step="' + step + '"></div>';
    }

    var head = '<div class="page-head"><div class="page-head-left">' +
      '<div class="eyebrow">ARZ Terminal / Jobs</div><h1>Калькулятор работ</h1>' +
      '<div class="desc">Чистыми в час по замерам. База — медиана→макс по навыку; множители перемножаются; аренда и расходники вычитаются каждый час, разовые покупки — один раз за смену.</div>' +
      '</div><div class="page-actions"><span class="badge">' + js.length + ' работ</span>' +
      (S.doc ? '<span class="badge badge-low">данные ' + ui.esc(S.doc.updated || "") + "</span>" : '<span class="badge">демо</span>') +
      "</div></div>";

    var opts = js.map(function (x) { return '<option value="' + x.id + '"' + (j && x.id === j.id ? " selected" : "") + ">" + ui.esc(x.name) + "</option>"; }).join("");

    var once = "";
    if (c.oneTime > 0) {
      var pb = c.net > 0 ? Math.ceil(c.oneTime / c.net) : null;
      once = '<div class="calc-box"><small>Разовые покупки</small><strong>' + fmtMoney(c.oneTime, ui) + '</strong></div>' +
        '<div class="calc-box"><small>Окупятся за</small><strong>' + (pb === null ? "—" : "~" + pb + " ч") + "</strong></div>";
    }

    var calcHtml = '<div class="card"><div class="card-head"><div><div class="card-title">' + ui.esc(j ? j.name : "—") + '</div><div class="card-sub">Множитель x' + c.mult.toFixed(2) + (c.buffs.length ? " · " + ui.esc(c.buffs.join(", ")) : "") + '</div></div>' + (j ? relBadge(j.reliability, ui) : "") + "</div>" +
      '<div class="field"><label>Работа</label><select id="job-select">' + opts + "</select></div>" +
      '<div class="calc mt-12">' +
        numField("job-hours", "Часов в смене", S.hours, 0.25, 24, 0.25) +
        numField("job-skill", "Навык/прокачка, % (0=голый, 100=фулл)", S.skill, 0, 100, 5) +
        '<div class="field"><label>Группа на работе</label><select id="job-group">' +
          [["0", "Соло"], ["1", "2 чел +10%"], ["2", "3 чел +15%"], ["3", "4 чел +20%"], ["4", "5 чел +30%"]].map(function (o) { return '<option value="' + o[0] + '"' + (String(S.group) === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></div>" +
        numField("job-extra", "Свои бафы (семья/аксы), %", S.extraPct, 0, 200, 5) +
        '<div class="field"><label>x2 акция на сервере</label><select id="job-x2"><option value="0">Нет</option><option value="1"' + (S.x2 ? " selected" : "") + ">Да, x2</option></select></div>" +
        numField("job-rent", "Своя аренда/топливо, $/час", S.rent, 0, 100000000, 1000) +
      "</div>" +
      '<div class="calc-out">' +
        '<div class="calc-box"><small>Грязными / час</small><strong>' + fmtMoney(c.gross, ui) + "</strong></div>" +
        '<div class="calc-box"><small>Расходы / час</small><strong>' + fmtMoney(c.costsH, ui) + "</strong></div>" +
        '<div class="calc-box"><small>Чистыми / час</small><strong class="' + (c.net >= 0 ? "pos" : "neg") + '">' + fmtMoney(c.net, ui) + "</strong></div>" +
        '<div class="calc-box"><small>За смену (' + S.hours + " ч)</small><strong class=\"" + (c.session >= 0 ? "pos" : "neg") + "\">" + fmtMoney(c.session, ui) + "</strong></div>" +
        once +
      "</div>" +
      '<div class="tiny dim mt-12">Медиана — типовой фарм, макс — фулл-навык и бафы. Разброс между видосами — это разные сеты и условия: смотри подсказки «?» у предметов.</div>' +
      "</div>";

    var table = '<div class="card table-card mt-16"><div class="table-head"><div><div class="card-title">Все работы — чистыми в час</div><div class="card-sub">Клик по строке — в калькулятор</div></div></div><div class="table-scroll"><table><thead><tr><th>Работа</th><th>Мин</th><th>Медиана</th><th>Макс</th><th>Расходы</th><th>Надёжность</th><th>Замеры</th></tr></thead><tbody>' + rows + "</tbody></table></div></div>";

    return head + '<div class="biz-grid">' + calcHtml + table + "</div>" + itemsBlock(j, ui, c);
  }

  function fmtMoney(v, ui) {
    if (v === null || v === undefined) return "—";
    return ui.money(Math.round(v));
  }

  window.ARZ.renderJobs = function () {
    var html = render();
    setTimeout(ensureData, 0);
    return html;
  };

  document.addEventListener("input", function (e) {
    if (!e.target || !e.target.id) return;
    var id = e.target.id;
    if (id === "history-search") return;
    if (id.indexOf("job-") !== 0 && e.target.getAttribute("data-jprice") === null) return;
    if (id.indexOf("job-") === 0) {
      // Селекты (job-select/group/x2/acc) обрабатываются в change;
      // input на них только сбросил бы выбор — выходим.
      if (id === "job-select" || id === "job-group" || id === "job-x2" || id === "job-acc") return;
      var v = parseFloat(e.target.value);
      if (id === "job-hours" && v > 0) S.hours = v;
      if (id === "job-skill" && v >= 0) S.skill = Math.min(100, v);
      if (id === "job-extra" && v >= 0) S.extraPct = v;
      if (id === "job-rent" && v >= 0) S.rent = v;
      refreshRoot("#" + id);
      return;
    }
    var pid = e.target.getAttribute("data-jprice");
    if (pid) {
      var it = null;
      (itemsFor(S.job) || []).forEach(function (x) { if (x.id === pid) it = x; });
      if (it) { itemState(it).price = parseFloat(e.target.value) || 0; refreshRoot('[data-jprice="' + pid + '"]'); }
    }
  });

  function refreshRoot(focusSel) {
    var root = document.querySelector("#view-root");
    if (root) {
      var pos = window.scrollY;
      root.innerHTML = render();
      window.scrollTo(0, pos);
      if (focusSel) {
        var el = document.querySelector(focusSel);
        if (el && el.focus) {
          el.focus();
          try {
            var len = String(el.value || "").length;
            el.setSelectionRange(len, len);
          } catch (e) { /* не текстовое поле */ }
        }
      }
    }
  }

  document.addEventListener("change", function (e) {
    var id = e.target && e.target.id;
    if (id === "job-select") { S.job = e.target.value; S.sel = {}; rerender(); return; }
    if (id === "job-acc" && e.target.value) { var it = null; (itemsFor(S.job) || []).forEach(function (x) { if (x.id === e.target.value) it = x; }); if (it) { itemState(it).on = true; } rerender(); return; }
    if (id === "job-group") { S.group = parseInt(e.target.value, 10) || 0; rerender(); return; }
    if (id === "job-x2") { S.x2 = e.target.value === "1"; rerender(); return; }
  });

  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest ? e.target.closest("[data-jobrow]") : null;
    if (t && !e.target.closest("[data-jprice]")) { S.job = t.getAttribute("data-jobrow"); S.sel = {}; rerender(); return; }
    var rm = e.target && e.target.closest ? e.target.closest("[data-accrm]") : null;
    if (rm) {
      var cur = S.sel[rm.getAttribute("data-accrm")];
      if (cur) cur.on = false;
      rerender();
      return;
    }
    var jh = e.target && e.target.closest ? e.target.closest("[data-jhint]") : null;
    if (jh) {
      var box = document.querySelector("#hint-" + jh.getAttribute("data-jhint"));
      if (box) box.classList.toggle("hide");
      return;
    }
    var tog = e.target && e.target.closest ? e.target.closest("[data-jtoggle]") : null;
    if (tog) {
      var id2 = tog.getAttribute("data-jtoggle");
      var cur = S.sel[id2] || { on: false, price: 0 };
      cur.on = !cur.on;
      S.sel[id2] = cur;
      rerender();
      return;
    }
    var row = e.target && e.target.closest ? e.target.closest("[data-jitem]") : null;
    if (row && !e.target.closest("input") && !e.target.closest("button")) {
      var id3 = row.getAttribute("data-jitem");
      var cur3 = S.sel[id3] || { on: false, price: 0 };
      cur3.on = !cur3.on;
      S.sel[id3] = cur3;
      rerender();
    }
  });
})();
