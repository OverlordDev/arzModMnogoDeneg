/* ARZ Terminal — Items DB: полный каталог предметов Arizona RP.
 *
 * Грузит data/items_catalog.json (скрапинг arz-wiki, имена + категории +
 * редкость + ссылки). Поиск по названию, фильтр по категории.
 */
(function () {
  "use strict";

  var URL = "data/items_catalog.json";
  var S = { doc: null, loaded: false, q: "", cat: "all", shown: 200 };
  var STEP = 200;

  function U() { return window.ARZ && window.ARZ.ui; }

  function items() { return (S.doc && S.doc.items) || []; }

  function cats() {
    var seen = {};
    items().forEach(function (it) { if (it.cat) seen[it.cat] = true; });
    return Object.keys(seen).sort();
  }

  function ensureData(done) {
    if (S.loaded) { if (done) done(); return; }
    fetch(URL, { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (doc) {
        if (doc && doc.items && doc.items.length) { S.doc = doc; S.loaded = true; }
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
    if (active && active.getAttribute("data-nav") === "items") active.click();
  }

  function filtered() {
    var q = (S.q || "").trim().toLowerCase();
    return items().filter(function (it) {
      if (S.cat !== "all" && it.cat !== S.cat) return false;
      if (q && (it.name || "").toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }

  function render() {
    var ui = U();
    if (!ui) return "";
    var all = filtered();
    var rows = all.slice(0, S.shown).map(function (it) {
      return "<tr>" +
        '<td><div class="item-cell"><div class="item-avatar">' + ui.esc((it.name || "?").slice(0, 2).toUpperCase()) + '</div><div><div class="item-name">' + ui.esc(it.name) + "</div>" + (it.rarity ? '<div class="item-sub">' + ui.esc(it.rarity) + "</div>" : "") + "</div></div></td>" +
        '<td><span class="badge">' + ui.esc(it.cat || "—") + "</span></td>" +
        '<td class="text-right"><a class="card-link" href="' + it.url + '" target="_blank" rel="noopener">вики ' + ui.icon("arrow", 12) + "</a></td>" +
        "</tr>";
    }).join("");

    var catOpts = '<option value="all">Все категории</option>' + cats().map(function (c) {
      return '<option value="' + ui.esc(c) + '"' + (S.cat === c ? " selected" : "") + ">" + ui.esc(c) + "</option>";
    }).join("");

    var head = '<div class="page-head"><div class="page-head-left">' +
      '<div class="eyebrow">ARZ Terminal / Items</div><h1>База предметов</h1>' +
      '<div class="desc">Полный каталог вики: ищи любой предмет, открывай карточку вики. Цены — в Market (там только то, что торгуется).</div>' +
      '</div><div class="page-actions"><span class="badge">' + items().length + ' поз.</span>' +
      (S.doc && S.doc.updated ? '<span class="badge badge-low">обновлено ' + ui.esc(S.doc.updated) + "</span>" : '<span class="badge">демо</span>') +
      "</div></div>";

    return head +
      '<div class="market-toolbar"><label class="search" style="width:320px">' + ui.icon("search", 13) + '<input id="items-search" placeholder="Название предмета..." value="' + ui.esc(S.q) + '" autocomplete="off"></label>' +
      '<div class="toolbar-spacer"></div><select class="select" id="items-cat" aria-label="Категория">' + catOpts + "</select></div>" +
      '<div class="card table-card"><div class="table-scroll"><table><thead><tr><th>Предмет</th><th>Категория</th><th></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="3"><div class="empty">' + (items().length ? "Ничего не найдено." : "База не загружена — проверь data/items_catalog.json.") + "</div></td></tr>") +
      "</tbody></table></div>" +
      '<div class="table-foot"><span>Показано ' + Math.min(S.shown, all.length) + " из " + all.length + "</span>" +
      (all.length > S.shown ? '<button class="btn btn-ghost btn-sm" data-items-more="1">Показать ещё</button>' : "") +
      "</div></div>";
  }

  window.ARZ.renderItems = function () {
    var html = render();
    setTimeout(ensureData, 0);
    return html;
  };

  document.addEventListener("input", function (e) {
    if (!e.target || e.target.id !== "items-search") return;
    S.q = e.target.value;
    S.shown = STEP;
    var root = document.querySelector("#view-root");
    if (root) {
      var pos = window.scrollY;
      root.innerHTML = render();
      window.scrollTo(0, pos);
      var el = document.querySelector("#items-search");
      if (el && el.focus) {
        el.focus();
        try { var len = String(el.value || "").length; el.setSelectionRange(len, len); } catch (err) {}
      }
    }
  });

  document.addEventListener("change", function (e) {
    if (!e.target || e.target.id !== "items-cat") return;
    S.cat = e.target.value;
    S.shown = STEP;
    rerender();
  });

  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest ? e.target.closest("[data-items-more]") : null;
    if (!t) return;
    S.shown = Math.min(S.shown + 500, 2000);
    rerender();
  });
})();
