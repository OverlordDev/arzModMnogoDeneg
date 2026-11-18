/* =========================================================
   ARZ Terminal — visual skeleton (vanilla JS, no build step)
   ========================================================= */

(function () {
  "use strict";

  const D = window.ARZ.data;
  const icon = window.icon;

  const state = {
    view: "dashboard",
    server: "yuma",
    search: "",
    marketCat: "all",
    marketSort: "spread",
    portfolioRange: "30D",
    drawer: null,
    modal: null,
    paletteOpen: false,
    paletteQuery: "",
    paletteIndex: 0,
    sidebarOpen: false,
    selectedBusiness: 0,
    selectedRecipe: 0,
    tasks: D.tasks.map((t) => ({ ...t })),
    alerts: D.alerts.map((a) => ({ ...a }))
  };

  const VIEWS = {
    dashboard: { title: "Обзор рынка", sub: "ARZ Terminal · Arizona RP", icon: "dashboard" },
    market: { title: "Market", sub: "База цен и история", icon: "market" },
    items: { title: "Items", sub: "База всех предметов", icon: "layers" },
    arbitrage: { title: "Arbitrage", sub: "Связки и перекуп", icon: "arbitrage" },
    farming: { title: "Farming", sub: "План фарма на сегодня", icon: "farming" },
    jobs: { title: "Jobs", sub: "Калькулятор работ: $/час", icon: "trend" },
    deposit: { title: "Deposit", sub: "Депозит: уровни, % и калькулятор", icon: "wallet" },
    player: { title: "Player", sub: "Инвентарь и состояние из игры", icon: "users" },
    business: { title: "Business Lab", sub: "Бизнесы и окупаемость", icon: "business" },
    craft: { title: "Craft Lab", sub: "Крафт и expected value", icon: "craft" },
    auctions: { title: "Auctions", sub: "Аукционы и снайпинг", icon: "auctions" },
    portfolio: { title: "Portfolio", sub: "Капитал и активы", icon: "portfolio" },
    deals: { title: "Deals", sub: "CRM перекупа", icon: "deals" },
    alerts: { title: "Alerts", sub: "Алерты и Telegram", icon: "alerts" },
    meta: { title: "Meta", sub: "Гайды и патчноуты", icon: "meta" },
    history: { title: "History", sub: "Дампы цен каждые 30 минут", icon: "clock" },
    settings: { title: "Settings", sub: "Настройки терминала", icon: "settings" }
  };

  const NAV = [
    { label: "Обзор", items: ["dashboard", "player", "market", "arbitrage", "history"] },
    { label: "Фарм", items: ["farming", "business", "craft", "jobs", "deposit"] },
    { label: "Рынок", items: ["auctions", "portfolio", "deals", "items"] },
    { label: "Система", items: ["alerts", "meta", "settings"] }
  ];

  const PORTFOLIO_RANGES = {
    "7D": [300, 306, 302, 309, 312, 310, 318],
    "30D": [240, 248, 255, 252, 268, 275, 290, 286, 300, 312, 318],
    "90D": [180, 190, 205, 198, 220, 230, 245, 240, 255, 270, 285, 278, 300, 312, 318],
    ALL: [60, 80, 75, 100, 95, 120, 140, 135, 160, 180, 170, 200, 230, 220, 250, 270, 260, 290, 310, 318]
  };

  /* ============================= helpers ============================= */

  function esc(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function fmt(value, digits) {
    if (value === null || value === undefined || Number.isNaN(value)) return "—";
    const d = digits === undefined ? 2 : digits;
    if (Math.abs(value) >= 1e9) return (value / 1e9).toLocaleString("ru-RU", { maximumFractionDigits: d }) + " млрд";
    if (Math.abs(value) >= 1e6) return (value / 1e6).toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + " млн";
    if (Math.abs(value) >= 1e3) return (value / 1e3).toLocaleString("ru-RU", { maximumFractionDigits: 0 }) + " тыс.";
    return value.toLocaleString("ru-RU");
  }

  function money(value) {
    return fmt(value) + " $";
  }

  function pct(value) {
    if (value === null || value === undefined) return "—";
    return (value > 0 ? "+" : "") + value.toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + "%";
  }

  function spreadPct(buy, sell) {
    if (!buy || buy <= 0 || !sell || sell <= 0) return 0;
    return ((sell - buy) / buy) * 100;
  }

  function serverName(id) {
    const s = D.servers.find((x) => x.id === id);
    return s ? s.name : id;
  }

  function currentServer() {
    return D.servers.find((s) => s.id === state.server) || D.servers[0];
  }

  function riskBadge(risk) {
    const map = { "Низкий": "badge-low", "Средний": "badge-mid", "Высокий": "badge-high" };
    return '<span class="badge ' + (map[risk] || "") + '">' + esc(risk) + "</span>";
  }

  function liqBadge(liq) {
    const map = { "Высокая": "badge-low", "Средняя": "badge-mid", "Низкая": "badge-high", "Очень низкая": "badge-high" };
    return '<span class="badge ' + (map[liq] || "") + '">' + esc(liq) + "</span>";
  }

  function timeAgo(seconds) {
    const s = Math.max(0, Number(seconds) || 0);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h > 0 ? h + ":" + String(m).padStart(2, "0") + ":" + String(sec).padStart(2, "0") : String(m).padStart(2, "0") + ":" + String(sec).padStart(2, "0");
  }

  function itemById(id) {
    return D.items.find((i) => i.id === id) || D.items[0];
  }

  function sparkline(values, color) {
    const w = 96, h = 36, pad = 3;
    const min = Math.min.apply(null, values);
    const max = Math.max.apply(null, values);
    const range = max - min || 1;
    const pts = values.map((v, i) => {
      const x = pad + (i / Math.max(1, values.length - 1)) * (w - pad * 2);
      const y = h - pad - ((v - min) / range) * (h - pad * 2);
      return x.toFixed(1) + "," + y.toFixed(1);
    });
    const line = pts.join(" ");
    const area = pad + "," + (h - pad) + " " + line + " " + (w - pad) + "," + (h - pad);
    return '<svg class="spark" viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<polygon points="' + area + '" fill="rgba(245,245,244,.06)"/>' +
      '<polyline points="' + line + '" fill="none" stroke="' + (color || "#f5f5f4") + '" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>' +
      "</svg>";
  }

  function lineChart(values, opacity) {
    const w = 640, h = 180, padX = 8, padY = 14;
    const min = Math.min.apply(null, values);
    const max = Math.max.apply(null, values);
    const range = max - min || 1;
    const pts = values.map((v, i) => {
      const x = padX + (i / Math.max(1, values.length - 1)) * (w - padX * 2);
      const y = h - padY - ((v - min) / range) * (h - padY * 2);
      return [x, y];
    });
    const line = pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
    const area = padX + "," + (h - padY) + " " + line + " " + (w - padX) + "," + (h - padY);
    const grid = [0, 0.25, 0.5, 0.75, 1].map((t) => {
      const y = padY + t * (h - padY * 2);
      return '<line x1="' + padX + '" x2="' + (w - padX) + '" y1="' + y + '" y2="' + y + '" stroke="#26292e" stroke-width="1"/>';
    }).join("");
    const last = pts[pts.length - 1];
    return '<svg class="chart" viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none" role="img" aria-label="График">' +
      grid +
      '<polygon points="' + area + '" fill="rgba(245,245,244,' + (opacity || 0.045) + ')"/>' +
      '<polyline points="' + line + '" fill="none" stroke="#f5f5f4" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<circle cx="' + last[0] + '" cy="' + last[1] + '" r="3" fill="#f5f5f4"/>' +
      "</svg>";
  }

  function donut(segments, totalLabel, totalCaption) {
    const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;
    let acc = 0;
    const stops = segments.map((s) => {
      const from = (acc / total) * 100;
      acc += s.value;
      const to = (acc / total) * 100;
      return s.color + " " + from.toFixed(2) + "% " + to.toFixed(2) + "%";
    }).join(", ");
    return '<div class="donut" style="background:conic-gradient(' + stops + ')">' +
      '<div class="donut-center"><strong>' + totalLabel + "</strong><small>" + (totalCaption || "капитал") + "</small></div>" +
      "</div>";
  }

  function pageHead(title, desc, actions) {
    return '<div class="page-head"><div class="page-head-left">' +
      '<div class="eyebrow">ARZ Terminal / ' + esc(VIEWS[state.view].title) + "</div>" +
      "<h1>" + title + "</h1>" +
      '<div class="desc">' + desc + "</div>" +
      '</div><div class="page-actions">' + (actions || "") + "</div></div>";
  }

  function pageActions() {
    return '<button class="btn btn-ghost" data-action="toast" data-msg="Экспорт появится после подключения API">' + icon("external", 13) + "<span>Экспорт</span></button>" +
      '<button class="btn btn-white" data-action="add-price">' + icon("plus", 13) + "<span>Добавить цену</span></button>";
  }

  /* ============================= shell ============================= */

  function renderSidebar() {
    const s = currentServer();
    const groups = NAV.map((group) => {
      const items = group.items.map((key) => {
        const v = VIEWS[key];
        let count = "";
        if (key === "market") count = '<span class="nav-count">' + D.items.length + "</span>";
        if (key === "alerts") count = '<span class="nav-count">' + state.alerts.filter((a) => a.active).length + "</span>";
        if (key === "deals") count = '<span class="nav-count">' + D.deals.length + "</span>";
        return '<button class="nav-item ' + (state.view === key ? "active" : "") + '" data-nav="' + key + '">' +
          '<span class="nav-icon">' + icon(v.icon, 15) + "</span><span>" + v.title + "</span>" + count +
          "</button>";
      }).join("");
      return '<div class="nav-group"><div class="nav-label">' + group.label + "</div>" + items + "</div>";
    }).join("");

    document.getElementById("sidebar").innerHTML =
      '<div class="brand"><div class="brand-mark">AZ</div><div><div class="brand-name">ARZ TERMINAL</div><div class="brand-sub">market operating system</div></div></div>' +
      '<button class="workspace" data-action="server">' +
        '<span class="workspace-dot" style="background:' + s.color + '"></span>' +
        '<span><span class="workspace-name">' + esc(s.name) + '</span><span class="workspace-meta">' + esc(s.platform) + "</span></span>" +
        '<span class="chev" style="margin-left:auto;color:var(--text-3)">' + icon("chevron", 12) + "</span>" +
      "</button>" +
      groups +
      '<div class="sidebar-footer">' +
        '<div class="data-card"><div class="data-row"><span class="data-dot"></span><span>98% цен свежие</span><span class="badge" style="margin-left:auto;height:16px;font-size:8px">demo</span></div><div class="data-meta">Обновлено 2 мин назад · 12 480 наблюдений</div></div>' +
        '<div class="user"><div class="avatar">N</div><div><div class="user-name">negrozoido</div><div class="user-role">Pro · Yuma</div></div><div style="margin-left:auto;color:var(--text-3)">' + icon("settings", 14) + "</div></div>" +
      "</div>";
  }

  function topbarAction() {
    const map = {
      dashboard: { label: "Быстрая сделка", action: "new-deal", icon: "plus" },
      market: { label: "Добавить цену", action: "add-price", icon: "plus" },
      arbitrage: { label: "Новая сделка", action: "new-deal", icon: "plus" },
      farming: { label: "Пересобрать", action: "toast", icon: "sparkles", msg: "План пересобран по текущим ценам" },
      business: { label: "Сравнить", action: "toast", icon: "layers", msg: "Сравнение с депозитом — следующий шаг" },
      craft: { label: "Пересчитать", action: "toast", icon: "sparkles", msg: "EV пересчитан по текущим ценам" },
      auctions: { label: "Алерт на лот", action: "new-alert", icon: "alerts" },
      portfolio: { label: "Добавить актив", action: "add-price", icon: "plus" },
      deals: { label: "Новая сделка", action: "new-deal", icon: "plus" },
      alerts: { label: "Новый алерт", action: "new-alert", icon: "plus" },
      player: { label: "Обновляется само", action: "toast", icon: "sparkles", msg: "Инвентарь обновляется в реальном времени, по событиям игры" },
      meta: { label: "Гайды", action: "toast", icon: "meta", msg: "Библиотека гайдов — следующий шаг" },
      settings: { label: "Сохранить", action: "toast", icon: "check", msg: "Настройки сохранены локально" }
    };
    const a = map[state.view] || map.dashboard;
    const msg = a.msg ? ' data-msg="' + esc(a.msg) + '"' : "";
    return '<button class="btn btn-white" data-action="' + a.action + '"' + msg + ">" + icon(a.icon, 13) + "<span>" + a.label + "</span></button>";
  }

  function renderTopbar() {
    const v = VIEWS[state.view];
    const s = currentServer();
    document.getElementById("topbar").innerHTML =
      '<button class="icon-btn menu-btn" data-action="toggle-sidebar" aria-label="Меню">' + icon("menu", 16) + "</button>" +
      '<div><div class="page-title">' + esc(v.title) + '</div><div class="page-sub">' + esc(v.sub) + "</div></div>" +
      '<div class="topbar-actions">' +
        '<button class="server-select" data-action="server"><span class="server-dot" style="background:' + s.color + '"></span><span>' + esc(s.name) + '</span><span class="chev">' + icon("chevron", 12) + "</span></button>" +
        '<label class="search">' + icon("search", 13) + '<input id="global-search" placeholder="Поиск по рынку..." value="' + esc(state.search) + '" autocomplete="off"><span class="kbd">⌘K</span></label>' +
        '<button class="icon-btn" data-action="palette" aria-label="Поиск" id="mobile-search">' + icon("search", 15) + "</button>" +
        topbarAction() +
        '<button class="icon-btn" data-action="alerts" aria-label="Алерты">' + icon("alerts", 15) + "</button>" +
        '<div class="avatar" title="negrozoido">N</div>' +
      "</div>";
  }

  function render() {
    const sidebar = document.getElementById("sidebar");
    if (sidebar) sidebar.classList.toggle("open", state.sidebarOpen);
    renderSidebar();
    renderTopbar();
    renderView();
    syncOverlays();
  }

  function renderViewOnly() {
    renderView();
  }

  function renderView() {
    const root = document.getElementById("view-root");
    if (state.view === "dashboard") root.innerHTML = renderDashboard();
    else if (state.view === "market") root.innerHTML = renderMarket();
    else if (state.view === "arbitrage") root.innerHTML = renderArbitrage();
    else if (state.view === "farming") root.innerHTML = renderFarming();
    else if (state.view === "jobs") root.innerHTML = window.ARZ.renderJobs ? window.ARZ.renderJobs() : "";
    else if (state.view === "deposit") root.innerHTML = window.ARZ.renderDeposit ? window.ARZ.renderDeposit() : "";
    else if (state.view === "player") root.innerHTML = window.ARZ.renderPlayer ? window.ARZ.renderPlayer() : "";
    else if (state.view === "business") root.innerHTML = renderBusiness();
    else if (state.view === "craft") root.innerHTML = renderCraft();
    else if (state.view === "auctions") root.innerHTML = renderAuctions();
    else if (state.view === "portfolio") root.innerHTML = renderPortfolio();
    else if (state.view === "deals") root.innerHTML = renderDeals();
    else if (state.view === "alerts") root.innerHTML = renderAlerts();
    else if (state.view === "meta") root.innerHTML = renderMeta();
    else if (state.view === "history") root.innerHTML = window.ARZ.renderHistory ? window.ARZ.renderHistory() : "";
    else if (state.view === "items") root.innerHTML = window.ARZ.renderItems ? window.ARZ.renderItems() : "";
    else if (state.view === "settings") root.innerHTML = renderSettings();
    if (state.view === "business") updateBizCalc();
  }

  function navigate(view) {
    if (!VIEWS[view]) return;
    state.view = view;
    state.search = "";
    state.sidebarOpen = false;
    closeDrawer();
    closeModal();
    closePalette();
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ============================= dashboard ============================= */

  function renderDashboard() {
    const kpis = D.kpis.map((k) => {
      const color = k.delta >= 0 ? "#8fe3b0" : "#ff9a9a";
      return '<div class="card kpi">' +
        '<div class="kpi-top"><span class="kpi-label">' + esc(k.label) + '</span><span class="kpi-icon">' + icon(k.icon, 13) + "</span></div>" +
        '<div class="kpi-value">' + money(k.value) + "</div>" +
        '<div class="kpi-meta"><span class="kpi-delta ' + (k.delta >= 0 ? "pos" : "neg") + '">' + pct(k.delta) + "</span><span>" + esc(k.sub) + "</span></div>" +
        sparkline(k.spark, color) +
        "</div>";
    }).join("");

    const opportunities = D.opportunities.map((o) => {
      const roi = spreadPct(o.buy, o.sell);
      return '<div class="opp-row" data-item="' + o.id + '">' +
        '<div class="item-cell"><div class="item-avatar">' + esc(o.short) + '</div><div><div class="item-name">' + esc(o.name) + '</div><div class="item-sub">' + esc(o.sub) + "</div></div></div>" +
        '<div class="opp-buy"><div class="sub-cell">Скупка</div><div class="num">' + money(o.buy) + '</div><div class="sub-cell">' + esc(o.buyServer) + "</div></div>" +
        '<div class="opp-sell"><div class="sub-cell">Продажа</div><div class="num">' + money(o.sell) + '</div><div class="sub-cell">' + esc(o.sellServer) + "</div></div>" +
        '<div class="opp-roi"><div class="sub-cell">ROI</div><div class="num pos">+' + roi.toFixed(1) + "%</div></div>" +
        '<div class="opp-risk">' + riskBadge(o.risk) + "</div>" +
        '<div class="opp-arrow">' + icon("arrow", 13) + "</div>" +
        "</div>";
    }).join("");

    const events = D.events.map((e) => {
      return '<div class="timeline-item ' + (e.days <= 3 ? "hot" : "") + '">' +
        '<div class="timeline-date">' + esc(e.end) + "</div>" +
        '<div class="timeline-main"><div class="timeline-title"><span class="alloc-dot" style="background:' + e.color + '"></span>' + esc(e.name) + "</div>" +
        '<div class="timeline-note">' + esc(e.note) + "</div>" +
        '<div class="progress"><span style="width:' + e.progress + "%;background:" + e.color + '"></span></div></div>' +
        '<div class="timeline-days">' + e.days + " дн.</div>" +
        "</div>";
    }).join("");

    const movers = D.movers.map((m) => {
      return '<div class="mover">' +
        '<div class="mover-left"><div class="item-avatar">' + esc(m.short) + '</div><div><div class="mover-name">' + esc(m.name) + '</div><div class="mover-cat">' + esc(m.cat) + "</div></div></div>" +
        '<div class="mover-val">' + money(m.price) + "</div>" +
        '<div class="num ' + (m.change >= 0 ? "pos" : "neg") + '">' + pct(m.change) + "</div>" +
        "</div>";
    }).join("");

    const tasks = state.tasks.map((t, i) => {
      return '<div class="task ' + (t.done ? "done" : "") + '" data-task="' + i + '">' +
        '<span class="task-box">' + icon("check", 10) + "</span>" +
        '<div><div class="task-text">' + esc(t.text) + '</div><div class="task-meta">' + esc(t.meta) + "</div></div>" +
        "</div>";
    }).join("");

    const plan = D.farming.map((p) => {
      return '<div class="plan-item">' +
        '<div class="plan-time">' + esc(p.time) + "</div>" +
        '<div><div class="plan-title">' + esc(p.title) + '</div><div class="plan-desc">' + esc(p.desc) + "</div>" +
        '<span class="badge plan-tag">' + esc(p.tag) + "</span></div>" +
        '<div class="plan-profit ' + (p.profit ? "" : "zero") + '">' + (p.profit ? "+" + money(p.profit) : "—") + "</div>" +
        "</div>";
    }).join("");

    return pageHead("Рынок под контролем", "Сводка капитала, лучшие связки, события и план фарма на сегодня.", pageActions()) +
      (window.ARZ.renderPlayerCard ? window.ARZ.renderPlayerCard() : "") +
      '<div class="grid-4">' + kpis + "</div>" +
      '<div class="dash-grid mt-16">' +
        '<div class="card table-card">' +
          '<div class="table-head"><div><div class="card-title">Лучшие возможности</div><div class="card-sub">С учётом комиссий, налогов и ликвидности</div></div><a class="card-link" href="#" data-nav="arbitrage">Все возможности ' + icon("arrow", 12) + "</a></div>" +
          '<div class="opp-list">' + opportunities + "</div>" +
        "</div>" +
        '<div class="card"><div class="card-head"><div><div class="card-title">События</div><div class="card-sub">Ближайшие две недели</div></div><span class="badge">' + D.events.length + "</span></div>" +
          '<div class="timeline">' + events + "</div>" +
          '<div class="divider mt-16"></div><div class="flex between center mt-12"><span class="tiny dim">Ближайший дедлайн</span><span class="badge badge-white">3 дня</span></div>' +
        "</div>" +
      "</div>" +
      '<div class="dash-bottom mt-16">' +
        '<div class="card"><div class="card-head"><div><div class="card-title">Портфель</div><div class="card-sub">Чистый капитал · ' + money(D.kpis[0].value) + '</div></div><div class="chart-tabs">' +
          ["7D", "30D", "90D", "ALL"].map((r) => '<button class="chart-tab ' + (state.portfolioRange === r ? "active" : "") + '" data-range="' + r + '">' + r + "</button>").join("") +
          "</div></div>" + lineChart(PORTFOLIO_RANGES[state.portfolioRange]) +
          '<div class="chart-legend mt-8"><span class="legend-dot"></span><span>Капитал, млрд $</span><span style="margin-left:auto" class="mono">+4,7% за 30 дней</span></div>' +
          '<div class="divider mt-16"></div><div class="kpi-mini"><div><small>В лимитках</small><strong>171 млрд</strong></div><div><small>Свободно</small><strong>46,4 млрд</strong></div><div><small>Ликвидность</small><strong>14,6%</strong></div></div>' +
        "</div>" +
        '<div class="card"><div class="card-head"><div><div class="card-title">Движение рынка</div><div class="card-sub">За 24 часа</div></div><a class="card-link" href="#" data-nav="market">Market ' + icon("arrow", 12) + "</a></div>" +
          '<div class="movers">' + movers + "</div>" +
        "</div>" +
        '<div class="card"><div class="card-head"><div><div class="card-title">Задачи на сегодня</div><div class="card-sub">' + state.tasks.filter((t) => t.done).length + " из " + state.tasks.length + ' выполнено</div></div><span class="badge badge-white">live</span></div>' +
          '<div class="tasks">' + tasks + "</div>" +
        "</div>" +
      "</div>" +
      '<div class="card mt-16"><div class="card-head"><div><div class="card-title">План фарма</div><div class="card-sub">Сегодня · 3 ч 30 мин · прогноз +785 млн</div></div><a class="card-link" href="#" data-nav="farming">Открыть planner ' + icon("arrow", 12) + "</a></div>" +
        '<div class="plan">' + plan + "</div>" +
      "</div>";
  }

  /* ============================= market ============================= */

  function renderMarket() {
    const cats = ["Все", "Аксессуары", "Лимитки", "Транспорт", "Сеты", "Ресурсы", "Скины", "Кейсы", "Прочее"];
    const catKey = (c) => c === "Все" ? "all" : c;
    const tabs = cats.map((c) => '<button class="tab ' + (state.marketCat === catKey(c) ? "active" : "") + '" data-cat="' + catKey(c) + '">' + c + "</button>").join("");

    let rows = D.items.slice();
    if (state.marketCat !== "all") rows = rows.filter((i) => i.cat === state.marketCat);
    if (state.search.trim()) {
      const q = state.search.toLowerCase();
      rows = rows.filter((i) => (i.name + " " + i.sub + " " + i.cat).toLowerCase().includes(q));
    }
    if (state.marketSort === "spread") rows.sort((a, b) => spreadPct(b.buy, b.sell) - spreadPct(a.buy, a.sell));
    if (state.marketSort === "buy") rows.sort((a, b) => b.buy - a.buy);
    if (state.marketSort === "change") rows.sort((a, b) => b.change - a.change);

    const body = rows.map((i) => {
      return '<tr class="row-click" data-item="' + i.id + '">' +
        '<td><div class="item-cell"><div class="item-avatar">' + esc(i.short) + '</div><div><div class="item-name">' + esc(i.name) + '</div><div class="item-sub">' + esc(i.sub) + "</div></div></div></td>" +
        '<td><span class="badge">' + esc(i.cat) + "</span></td>" +
        (i.buy > 0 ? '<td class="num">' + money(i.buy) + "</td>" : '<td class="num dim">—</td>') +
        (i.sell > 0 ? '<td class="num">' + money(i.sell) + "</td>" : '<td class="num dim">—</td>') +
        ((i.buy > 0 && i.sell > 0) ? '<td class="num pos">+' + spreadPct(i.buy, i.sell).toFixed(1) + "%</td>" : '<td class="num dim">—</td>') +
        '<td class="num ' + (i.change >= 0 ? "pos" : "neg") + '">' + pct(i.change) + "</td>" +
        '<td>' + liqBadge(i.liq) + "</td>" +
        '<td><div class="conf"><div class="conf-track"><div class="conf-fill" style="width:' + i.conf + '%"></div></div><span class="tiny dim">' + i.conf + "%</span></div></td>" +
        '<td class="dim tiny">' + esc(i.upd) + "</td>" +
        '<td class="text-right dim">' + icon("arrow", 12) + "</td>" +
        "</tr>";
    }).join("");

    return pageHead("База цен", "Все предметы, серверы и качество. Нажми на строку, чтобы открыть карточку и связку." + (D.meta && D.meta.note ? " " + D.meta.note : ""), '<button class="btn btn-ghost" data-action="toast" data-msg="Экспорт появится после подключения API">' + icon("external", 13) + "<span>Экспорт</span></button>") +
      '<div class="market-stats">' +
        '<div class="stat-card"><div class="stat-label">Предметов в базе</div><div class="stat-value">' + D.items.length + '</div></div>' +
        '<div class="stat-card"><div class="stat-label">Свежие цены</div><div class="stat-value">' + (D.meta ? D.meta.freshPct + "%" : "98%") + '</div></div>' +
        '<div class="stat-card"><div class="stat-label">Сервер данных</div><div class="stat-value" style="font-size:15px">' + (D.meta ? esc(D.meta.dataServer) : "демо") + '</div></div>' +
        '<div class="stat-card"><div class="stat-label">Наблюдений</div><div class="stat-value">' + (D.meta ? D.meta.obs.toLocaleString("ru-RU") : "12 480") + '</div></div>' +
      "</div>" +
      '<div class="market-toolbar"><div class="tabs">' + tabs + '</div><div class="toolbar-spacer"></div>' +
        '<select class="select" id="market-sort" aria-label="Сортировка">' +
          '<option value="spread" ' + (state.marketSort === "spread" ? "selected" : "") + '>По спреду</option>' +
          '<option value="buy" ' + (state.marketSort === "buy" ? "selected" : "") + '>По цене</option>' +
          '<option value="change" ' + (state.marketSort === "change" ? "selected" : "") + '>По изменению</option>' +
        "</select>" +
        '<button class="btn btn-ghost btn-sm" data-action="toast" data-msg="Фильтры по качеству и серверу появятся после подключения БД">' + icon("filter", 12) + " Фильтры</button>" +
      "</div>" +
      '<div class="card table-card"><div class="table-scroll"><table><thead><tr>' +
        "<th>Предмет</th><th>Категория</th><th>Покупка</th><th>Продажа</th><th>Спред</th><th>24ч</th><th>Ликвидность</th><th>Уверенность</th><th>Обновлено</th><th></th>" +
      "</tr></thead><tbody>" + (body || '<tr><td colspan="10"><div class="empty">Ничего не найдено. Измени фильтр или поиск.</div></td></tr>') + "</tbody></table></div>" +
      '<div class="table-foot"><span>Показано ' + rows.length + " из " + D.items.length + ' предметов</span><div class="flex gap-4"><button class="btn btn-ghost btn-sm" data-action="toast" data-msg="Пагинация в MVP">←</button><button class="btn btn-white btn-sm">1</button><button class="btn btn-ghost btn-sm" data-action="toast" data-msg="Пагинация в MVP">2</button><button class="btn btn-ghost btn-sm" data-action="toast" data-msg="Пагинация в MVP">→</button></div></div>' +
      "</div>";
  }

  /* ============================= arbitrage ============================= */

  function renderArbitrage() {
    const extra = {
      id: "bugatti", name: "Bugatti La Voiture Noire", sub: "Кейс Каптура · Лимитка", short: "BV",
      buy: 210e9, sell: 245e9, buyServer: "Tucson", sellServer: "Phoenix", risk: "Средний", liq: "Очень низкая"
    };
    const opps = D.opportunities.concat([extra]);

    const cards = opps.map((o) => {
      const net = o.sell * 0.95 - o.buy;
      const roi = (net / o.buy) * 100;
      return '<div class="card opp-card" data-item="' + o.id + '">' +
        '<div class="opp-card-head"><div><div class="opp-card-title">' + esc(o.name) + '</div><div class="opp-card-sub">' + esc(o.sub) + "</div></div>" + riskBadge(o.risk) + "</div>" +
        '<div class="opp-route-box">' +
          '<div class="opp-route-side"><small>Скупка</small><strong>' + money(o.buy) + '</strong><em>' + esc(o.buyServer) + "</em></div>" +
          '<div class="opp-route-mid">' + icon("arrow", 14) + "</div>" +
          '<div class="opp-route-side"><small>Продажа</small><strong>' + money(o.sell) + '</strong><em>' + esc(o.sellServer) + "</em></div>" +
        "</div>" +
        '<div class="opp-stats">' +
          '<div class="opp-stat"><small>Маржа</small><strong class="' + (net >= 0 ? "pos" : "neg") + '">' + (net >= 0 ? "+" : "") + money(net) + "</strong></div>" +
          '<div class="opp-stat"><small>ROI</small><strong class="' + (roi >= 0 ? "pos" : "neg") + '">' + (roi >= 0 ? "+" : "") + roi.toFixed(1) + "%</strong></div>" +
          '<div class="opp-stat"><small>Ликвидность</small><strong>' + esc(o.liq) + "</strong></div>" +
        "</div>" +
        '<div class="flex between center mt-12"><span class="tiny dim">Комиссия 5% уже учтена</span><span class="tiny" style="color:var(--text-2)">' + icon("zap", 11) + "</span></div>" +
        "</div>";
    }).join("");

    const rows = opps.map((o) => {
      const net = o.sell * 0.95 - o.buy;
      const roi = (net / o.buy) * 100;
      return '<tr class="row-click" data-item="' + o.id + '">' +
        '<td><div class="item-cell"><div class="item-avatar">' + esc(o.short) + '</div><div><div class="item-name">' + esc(o.name) + '</div><div class="item-sub">' + esc(o.sub) + "</div></div></div></td>" +
        '<td class="num">' + money(o.buy) + '<div class="sub-cell">' + esc(o.buyServer) + "</div></td>" +
        '<td class="num">' + money(o.sell) + '<div class="sub-cell">' + esc(o.sellServer) + "</div></td>" +
        '<td class="num ' + (net >= 0 ? "pos" : "neg") + '">' + (net >= 0 ? "+" : "") + money(net) + "</td>" +
        '<td class="num ' + (roi >= 0 ? "pos" : "neg") + '">' + (roi >= 0 ? "+" : "") + roi.toFixed(1) + "%</td>" +
        '<td>' + riskBadge(o.risk) + "</td>" +
        '<td class="text-right dim">' + icon("arrow", 12) + "</td>" +
        "</tr>";
    }).join("");

    return pageHead("Связки и перекуп", "Маржа лавок: скупка против продажи. Жирная маржа и большие объёмы — то, что выгодно фармить и сдавать.", '<button class="btn btn-ghost" data-action="toast" data-msg="Фильтры по ROI и риску — следующий шаг">' + icon("filter", 13) + "<span>Фильтры</span></button>") +
      '<div class="opp-grid">' + cards + "</div>" +
      '<div class="card table-card mt-16"><div class="table-head"><div><div class="card-title">Все связки</div><div class="card-sub">' + opps.length + " активных возможностей</div></div><span class=\"badge badge-white\">live</span></div>" +
        '<div class="table-scroll"><table><thead><tr><th>Предмет</th><th>Скупка</th><th>Продажа</th><th>Маржа</th><th>Маржа %</th><th>Риск</th><th></th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
      "</div>";
  }

  /* ============================= farming ============================= */

  function renderFarming() {
    const plan = D.farming.map((p) => {
      return '<div class="plan-item">' +
        '<div class="plan-time">' + esc(p.time) + "</div>" +
        '<div><div class="plan-title">' + esc(p.title) + '</div><div class="plan-desc">' + esc(p.desc) + '</div><span class="badge plan-tag">' + esc(p.tag) + "</span></div>" +
        '<div class="plan-profit ' + (p.profit ? "" : "zero") + '">' + (p.profit ? "+" + money(p.profit) : "—") + "</div>" +
        "</div>";
    }).join("");

    const alloc = [
      { label: "Депозит", value: 127.1e9, color: "#f5f5f4" },
      { label: "Бизнесы", value: 79.5e9, color: "#8fe3b0" },
      { label: "Перекуп", value: 63.6e9, color: "#9ab7ff" },
      { label: "Лимитки", value: 31.8e9, color: "#e7c27d" },
      { label: "Кэш", value: 15.9e9, color: "#70757e" }
    ];
    const legend = alloc.map((a) => '<div class="alloc-row"><span class="alloc-dot" style="background:' + a.color + '"></span><span>' + a.label + '</span><span class="mono">' + money(a.value) + "</span></div>").join("");

    const activities = D.activities.map((a) => {
      return '<tr><td><div class="item-name">' + esc(a.name) + '</div><div class="item-sub">' + esc(a.type) + "</div></td>" +
        '<td class="num">' + (a.perHour ? "+" + money(a.perHour) : "—") + "</td>" +
        '<td class="num dim">' + esc(a.time) + "</td>" +
        '<td class="dim">' + esc(a.req) + "</td>" +
        '<td>' + riskBadge(a.risk) + "</td>" +
        '<td><div class="conf"><div class="conf-track"><div class="conf-fill" style="width:' + a.score + '%"></div></div><span class="tiny dim">' + a.score + "</span></div></td>" +
        "</tr>";
    }).join("");

    return pageHead("План фарма", "Что делать сегодня: работы, ивенты, аукционы и перепродажа с оценкой прибыли в час.", '<button class="btn btn-ghost" data-action="toast" data-msg="Настройка целей и онлайна — следующий шаг">' + icon("settings", 13) + "<span>Настроить план</span></button>") +
      '<div class="grid-4">' +
        '<div class="card kpi"><div class="kpi-top"><span class="kpi-label">Капитал</span><span class="kpi-icon">' + icon("wallet", 13) + '</span></div><div class="kpi-value">' + money(D.kpis[0].value) + '</div><div class="kpi-meta"><span class="pos">+4,7%</span><span>за 30 дней</span></div></div>' +
        '<div class="card kpi"><div class="kpi-top"><span class="kpi-label">Онлайн сегодня</span><span class="kpi-icon">' + icon("clock", 13) + '</span></div><div class="kpi-value">3 ч 30 м</div><div class="kpi-meta"><span>цель — 4 часа</span></div></div>' +
        '<div class="card kpi"><div class="kpi-top"><span class="kpi-label">Прогноз прибыли</span><span class="kpi-icon">' + icon("trend", 13) + '</span></div><div class="kpi-value pos">+785 млн</div><div class="kpi-meta"><span>за план</span></div></div>' +
        '<div class="card kpi"><div class="kpi-top"><span class="kpi-label">Эффективность</span><span class="kpi-icon">' + icon("target", 13) + '</span></div><div class="kpi-value">91 / 100</div><div class="kpi-meta"><span>по текущему рынку</span></div></div>' +
      "</div>" +
      '<div class="farm-grid mt-16">' +
        '<div class="card"><div class="card-head"><div><div class="card-title">План на сегодня</div><div class="card-sub">Оптимизирован по прибыли в час</div></div><span class="badge badge-white">6 блоков</span></div><div class="plan plan-lg">' + plan + "</div></div>" +
        '<div class="card"><div class="card-head"><div><div class="card-title">Распределение капитала</div><div class="card-sub">Куда вложены вирты</div></div></div>' +
          '<div class="alloc">' + donut(alloc, "318 млрд", "капитал") + '<div class="alloc-legend">' + legend + "</div></div>" +
          '<div class="divider mt-16"></div>' +
          '<div class="mt-12"><div class="flex between small"><span class="dim">Цель: 500 млрд</span><span class="mono">63,6%</span></div><div class="progress mt-8"><span style="width:63.6%"></span></div></div>' +
          '<div class="mt-12"><div class="flex between small"><span class="dim">Доходность портфеля</span><span class="mono pos">+18,4%</span></div><div class="progress mt-8"><span style="width:72%;background:var(--green)"></span></div></div>' +
        "</div>" +
      "</div>" +
      '<div class="card table-card mt-16"><div class="table-head"><div><div class="card-title">Активности</div><div class="card-sub">Отсортировано по прибыли в час</div></div><span class="badge">6</span></div>' +
        '<div class="table-scroll"><table><thead><tr><th>Активность</th><th>Прибыль / час</th><th>Время</th><th>Требования</th><th>Риск</th><th>Скор</th></tr></thead><tbody>' + activities + "</tbody></table></div>" +
      "</div>";
  }

  /* ============================= business ============================= */

  function renderBusiness() {
    const b = D.businesses[state.selectedBusiness] || D.businesses[0];
    const net = b.income * (b.occupancy / 100) * (1 - 0.13 - 0.2);
    const payback = b.price / net;
    const roi = (net * 365 / b.price) * 100;

    const list = D.businesses.map((x, i) => {
      return '<div class="biz-row ' + (i === state.selectedBusiness ? "active" : "") + '" data-biz="' + i + '">' +
        '<div><div class="biz-name">' + esc(x.name) + '</div><div class="biz-meta">занятость ' + x.occupancy + "% · риск " + esc(x.risk.toLowerCase()) + "</div></div>" +
        '<div class="biz-price">' + money(x.price) + "</div>" +
        '<div class="biz-payback">' + x.payback + " дн.</div>" +
        "</div>";
    }).join("");

    const comparison = D.businesses.map((x) => '<tr><td><div class="item-name">' + esc(x.name) + '</div><div class="item-sub">' + money(x.income) + ' / сутки</div></td><td class="num">' + money(x.price) + '</td><td class="num">' + x.occupancy + '%</td><td class="num">' + x.payback + ' дн.</td><td>' + riskBadge(x.risk) + "</td><td class=\"text-right dim\">" + icon("arrow", 12) + "</td></tr>").join("");

    return pageHead("Business Lab", "Считай окупаемость бизнеса до покупки: доход, занятость, налоги и крыша.", '<button class="btn btn-ghost" data-action="toast" data-msg="Данные бизнеса обновлены">' + icon("check", 13) + "<span>Обновить</span></button>") +
      '<div class="biz-grid">' +
        '<div class="card"><div class="card-head"><div><div class="card-title">Бизнесы</div><div class="card-sub">Выбери актив для расчёта</div></div><span class="badge">' + D.businesses.length + "</span></div><div class=\"biz-list\">" + list + "</div></div>" +
        '<div class="card"><div class="card-head"><div><div class="card-title">' + esc(b.name) + '</div><div class="card-sub">Калькулятор окупаемости</div></div>' + riskBadge(b.risk) + "</div>" +
          '<div class="calc" id="biz-calc">' +
            '<div class="field"><label>Цена покупки, $</label><input id="biz-price" type="number" value="' + b.price + '"></div>' +
            '<div class="field"><label>Доход / сутки, $</label><input id="biz-income" type="number" value="' + b.income + '"></div>' +
            '<div class="field"><label>Занятость, %</label><input id="biz-occupancy" type="number" value="' + b.occupancy + '"></div>' +
            '<div class="field"><label>Налог штата, %</label><input id="biz-tax" type="number" value="13"></div>' +
            '<div class="field"><label>Крыша, %</label><input id="biz-roof" type="number" value="20"></div>' +
            '<div class="field"><label>Апгрейды, $</label><input id="biz-upgrade" type="number" value="0"></div>' +
          "</div>" +
          '<div class="calc-out">' +
            '<div class="calc-box"><small>Чистый доход / сутки</small><strong id="biz-net">' + money(net) + "</strong></div>" +
            '<div class="calc-box"><small>Окупаемость</small><strong id="biz-payback">' + Math.round(payback) + " дн.</strong></div>" +
            '<div class="calc-box"><small>ROI / год</small><strong id="biz-roi" class="pos">+' + roi.toFixed(1) + "%</strong></div>" +
            '<div class="calc-box"><small>Цена входа</small><strong id="biz-entry">' + money(b.price) + "</strong></div>" +
          "</div>" +
          '<div class="verdict" id="biz-verdict">' + icon("check", 14) + "<span>Сильный актив: окупаемость меньше 30 дней.</span></div>" +
          '<div class="flex gap-8 mt-12"><button class="btn btn-white" data-action="toast" data-msg="Расчёт сохранён в портфель">' + icon("plus", 13) + "В портфель</button><button class=\"btn btn-ghost\" data-action=\"toast\" data-msg=\"Алерт по цене бизнеса создан\">" + icon("alerts", 13) + "Алерт</button></div>" +
        "</div>" +
      "</div>" +
      '<div class="card table-card mt-16"><div class="table-head"><div><div class="card-title">Сравнение</div><div class="card-sub">Все бизнесы по окупаемости</div></div></div><div class="table-scroll"><table><thead><tr><th>Бизнес</th><th>Цена</th><th>Занятость</th><th>Окупаемость</th><th>Риск</th><th></th></tr></thead><tbody>' + comparison + "</tbody></table></div></div>";
  }

  function updateBizCalc() {
    const priceEl = document.getElementById("biz-price");
    if (!priceEl) return;
    const price = Number(document.getElementById("biz-price").value) || 0;
    const income = Number(document.getElementById("biz-income").value) || 0;
    const occupancy = Number(document.getElementById("biz-occupancy").value) || 0;
    const tax = Number(document.getElementById("biz-tax").value) || 0;
    const roof = Number(document.getElementById("biz-roof").value) || 0;
    const upgrade = Number(document.getElementById("biz-upgrade").value) || 0;
    const net = income * (occupancy / 100) * (1 - tax / 100 - roof / 100);
    const payback = net > 0 ? (price + upgrade) / net : 0;
    const roi = price > 0 ? (net * 365 / (price + upgrade)) * 100 : 0;
    const set = (id, text, cls) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = text;
      if (cls !== undefined) el.className = cls;
    };
    set("biz-net", money(net));
    set("biz-payback", payback ? Math.round(payback) + " дн." : "—");
    set("biz-roi", (roi >= 0 ? "+" : "") + roi.toFixed(1) + "%", roi >= 0 ? "pos" : "neg");
    set("biz-entry", money(price + upgrade));
    const verdict = document.getElementById("biz-verdict");
    if (verdict) {
      if (payback > 0 && payback <= 30) {
        verdict.className = "verdict";
        verdict.innerHTML = icon("check", 14) + "<span>Сильный актив: окупаемость меньше 30 дней.</span>";
      } else if (payback > 0 && payback <= 55) {
        verdict.className = "verdict warn";
        verdict.innerHTML = icon("clock", 14) + "<span>Средний актив: окупаемость " + Math.round(payback) + " дней. Смотри на занятость.</span>";
      } else {
        verdict.className = "verdict bad";
        verdict.innerHTML = icon("alerts", 14) + "<span>Долгая окупаемость. Торг или другой актив.</span>";
      }
    }
  }

  /* ============================= craft ============================= */

  function renderCraft() {
    const r = D.recipes[state.selectedRecipe] || D.recipes[0];
    const cost = r.inputs.reduce((sum, x) => sum + x.qty * x.price, 0);
    const revenue = r.output * (r.success / 100);
    const ev = revenue - cost - r.fee;
    const roi = ((ev / (cost + r.fee)) * 100);

    const recipes = D.recipes.map((x, i) => '<button class="recipe-item ' + (i === state.selectedRecipe ? "active" : "") + '" data-recipe="' + i + '">' + icon("craft", 13) + "<span>" + esc(x.name) + "</span></button>").join("");

    const inputs = r.inputs.map((x) => '<tr><td>' + esc(x.name) + '</td><td class="num text-right">' + x.qty.toLocaleString("ru-RU") + '</td><td class="num text-right">' + money(x.price) + '</td><td class="num text-right">' + money(x.qty * x.price) + "</td></tr>").join("");

    return pageHead("Craft Lab", "Считай expected value крафта: ресурсы, шанс успеха, комиссия и цена выхода.", '<button class="btn btn-ghost" data-action="toast" data-msg="Дерево рецептов — следующий шаг">' + icon("layers", 13) + "<span>Дерево рецептов</span></button>") +
      '<div class="craft-grid">' +
        '<div class="card"><div class="card-head"><div><div class="card-title">Рецепты</div><div class="card-sub">Лимитированный крафт</div></div></div><div class="recipe-list">' + recipes + "</div></div>" +
        '<div class="card"><div class="card-head"><div><div class="card-title">' + esc(r.name) + '</div><div class="card-sub">Лимит: 3 крафта на сервер · шанс успеха ' + r.success + "%</div></div><span class=\"badge badge-white\">GGLIMIT</span></div>" +
          '<div class="table-scroll"><table class="cost-table"><thead><tr><th>Ресурс</th><th class="text-right">Кол-во</th><th class="text-right">Цена</th><th class="text-right">Сумма</th></tr></thead><tbody>' + inputs + "</tbody></table></div>" +
          '<div class="mt-16">' +
            '<div class="ev-row"><span class="dim">Себестоимость ресурсов</span><span class="mono">' + money(cost) + "</span></div>" +
            '<div class="ev-row"><span class="dim">Ожидаемая выручка</span><span class="mono">' + money(revenue) + "</span></div>" +
            '<div class="ev-row"><span class="dim">Комиссия крафта</span><span class="mono">' + money(r.fee) + "</span></div>" +
            '<div class="ev-row"><span>Expected value</span><span class="mono ' + (ev >= 0 ? "pos" : "neg") + '">' + (ev >= 0 ? "+" : "") + money(ev) + "</span></div>" +
            '<div class="ev-row"><span class="dim">ROI крафта</span><span class="mono ' + (roi >= 0 ? "pos" : "neg") + '">' + (roi >= 0 ? "+" : "") + roi.toFixed(1) + "%</span></div>" +
          "</div>" +
          '<div class="verdict ' + (ev >= 0 ? "" : "bad") + '">' + icon(ev >= 0 ? "check" : "alerts", 14) + "<span>" + (ev >= 0 ? "Крафт выгоднее покупки готового предмета." : "Крафт убыточен: покупай готовый предмет или жди падения ресурсов.") + "</span></div>" +
          '<div class="flex gap-8 mt-12"><button class="btn btn-white" data-action="toast" data-msg="Рецепт добавлен в план фарма">' + icon("plus", 13) + "В план</button><button class=\"btn btn-ghost\" data-action=\"toast\" data-msg=\"Алерт на ресурсы создан\">" + icon("alerts", 13) + "Алерт на ресурсы</button></div>" +
        "</div>" +
      "</div>";
  }

  /* ============================= auctions ============================= */

  function renderAuctions() {
    const cards = D.auctions.map((a) => {
      const progress = Math.min(100, (a.bid / a.buyout) * 100);
      return '<div class="card auction-card">' +
        '<div class="auction-top"><div><div class="auction-name">' + esc(a.name) + '</div><div class="auction-kind">' + esc(a.kind) + " · " + esc(a.server) + "</div></div>" + (a.hot ? '<span class="badge badge-white">hot</span>' : '<span class="badge">lot</span>') + "</div>" +
        '<div class="auction-time ' + (a.ends < 600 ? "hot" : "") + '" data-countdown="' + a.ends + '">' + timeAgo(a.ends) + "</div>" +
        '<div class="auction-row"><span>Текущая ставка</span><span class="mono">' + money(a.bid) + "</span></div>" +
        '<div class="auction-row"><span>Выкуп</span><span class="mono">' + money(a.buyout) + "</span></div>" +
        '<div class="auction-row"><span>Твоя max-ставка</span><span class="mono">' + money(a.max) + "</span></div>" +
        '<div class="progress mt-8"><span style="width:' + progress + '%"></span></div>' +
        '<div class="auction-foot"><span class="auction-max">target ROI <strong>+' + a.target + "%</strong></span><button class=\"btn btn-white btn-sm\" data-action=\"toast\" data-msg=\"Ставка по лоту " + esc(a.name) + " поставлена в очередь\">Сделать ставку</button></div>" +
        "</div>";
    }).join("");

    const history = [
      { name: "HSR-II #1/3", server: "Phoenix", hammer: 168e9, market: 171e9, over: -1.8, date: "12 ноя" },
      { name: "Bugatti La Voiture Noire", server: "Tucson", hammer: 252e9, market: 245e9, over: 2.9, date: "10 ноя" },
      { name: "Дом Arizona Springs", server: "Ford Carson", hammer: 11.2e9, market: 9.6e9, over: 16.7, date: "08 ноя" },
      { name: "SIM 777", server: "Mesa", hammer: 940e6, market: 1.1e9, over: -14.5, date: "06 ноя" },
      { name: "Контейнер 20×", server: "Yuma", hammer: 1.6e9, market: 1.5e9, over: 6.7, date: "04 ноя" }
    ].map((h) => '<tr><td><div class="item-name">' + esc(h.name) + '</div><div class="item-sub">' + esc(h.server) + "</div></td><td class=\"num\">" + money(h.hammer) + "</td><td class=\"num\">" + money(h.market) + "</td><td class=\"num " + (h.over > 0 ? "neg" : "pos") + "\">" + pct(h.over) + "</td><td class=\"dim tiny\">" + esc(h.date) + "</td></tr>").join("");

    return pageHead("Аукционы", "Лоты, таймеры и максимальная ставка под твой target ROI.", '<button class="btn btn-ghost" data-action="toast" data-msg="Календарь аукционов — следующий шаг">' + icon("clock", 13) + "<span>Календарь</span></button>") +
      '<div class="auction-grid">' + cards + "</div>" +
      '<div class="card table-card mt-16"><div class="table-head"><div><div class="card-title">История аукционов</div><div class="card-sub">Hammer price vs рынок</div></div></div><div class="table-scroll"><table><thead><tr><th>Лот</th><th>Hammer</th><th>Рынок</th><th>Переплата</th><th>Дата</th></tr></thead><tbody>' + history + "</tbody></table></div></div>";
  }

  /* ============================= portfolio ============================= */

  function renderPortfolio() {
    const value = D.portfolio.reduce((sum, p) => sum + p.qty * p.current, 0);
    const cost = D.portfolio.reduce((sum, p) => sum + p.qty * p.buy, 0);
    const pnl = value - cost;

    const alloc = [
      { label: "Лимитки", value: 171e9, color: "#f5f5f4" },
      { label: "Аксессуары", value: 83.6e9, color: "#8fe3b0" },
      { label: "Недвижимость", value: 9.6e9, color: "#9ab7ff" },
      { label: "Транспорт", value: 4.1e9, color: "#e7c27d" },
      { label: "Ресурсы", value: 3.12e9, color: "#c9a7ff" },
      { label: "Кэш", value: 46.4e9, color: "#70757e" }
    ];
    const legend = alloc.map((a) => '<div class="alloc-row"><span class="alloc-dot" style="background:' + a.color + '"></span><span>' + a.label + '</span><span class="mono">' + money(a.value) + "</span></div>").join("");

    const rows = D.portfolio.map((p) => {
      const val = p.qty * p.current;
      const cst = p.qty * p.buy;
      const rowPnl = val - cst;
      const rowPct = (rowPnl / cst) * 100;
      return '<tr><td><div class="item-cell"><div class="item-avatar">' + esc(p.short) + '</div><div><div class="item-name">' + esc(p.name) + '</div><div class="item-sub">' + esc(p.type) + "</div></div></div></td>" +
        '<td class="num">' + p.qty + "</td>" +
        '<td class="num">' + money(p.buy) + "</td>" +
        '<td class="num">' + money(p.current) + "</td>" +
        '<td class="num">' + money(val) + "</td>" +
        '<td class="num ' + (rowPnl >= 0 ? "pos" : "neg") + '">' + (rowPnl >= 0 ? "+" : "") + money(rowPnl) + "</td>" +
        '<td><div class="pl-bar"><div class="pl-track"><div class="pl-fill ' + (rowPct < 0 ? "neg" : "") + '" style="width:' + Math.min(100, Math.abs(rowPct)) + '%"></div></div><span class="tiny ' + (rowPct >= 0 ? "pos" : "neg") + '">' + pct(rowPct) + "</span></div></td>" +
        "</tr>";
    }).join("");

    return pageHead("Портфель", "Капитал, активы и P&L. Всё, что куплено, продано и ждёт своего часа.", '<button class="btn btn-ghost" data-action="toast" data-msg="Ребаланс портфеля — следующий шаг">' + icon("layers", 13) + "<span>Ребаланс</span></button>") +
      '<div class="grid-4">' +
        '<div class="card kpi"><div class="kpi-top"><span class="kpi-label">Стоимость активов</span><span class="kpi-icon">' + icon("wallet", 13) + '</span></div><div class="kpi-value">' + money(value) + '</div><div class="kpi-meta"><span class="pos">+4,7%</span><span>за 30 дней</span></div></div>' +
        '<div class="card kpi"><div class="kpi-top"><span class="kpi-label">Вложено</span><span class="kpi-icon">' + icon("database", 13) + '</span></div><div class="kpi-value">' + money(cost) + '</div><div class="kpi-meta"><span>' + D.portfolio.length + ' позиций</span></div></div>' +
        '<div class="card kpi"><div class="kpi-top"><span class="kpi-label">P&L</span><span class="kpi-icon">' + icon("trend", 13) + '</span></div><div class="kpi-value pos">' + (pnl >= 0 ? "+" : "") + money(pnl) + '</div><div class="kpi-meta"><span class="pos">' + pct((pnl / cost) * 100) + '</span><span>от вложений</span></div></div>' +
        '<div class="card kpi"><div class="kpi-top"><span class="kpi-label">Свободный кэш</span><span class="kpi-icon">' + icon("package", 13) + '</span></div><div class="kpi-value">' + money(46.4e9) + '</div><div class="kpi-meta"><span>14,6% ликвидность</span></div></div>' +
      "</div>" +
      '<div class="portfolio-grid mt-16">' +
        '<div class="card"><div class="card-head"><div><div class="card-title">Динамика капитала</div><div class="card-sub">Портфель · ' + money(D.kpis[0].value) + '</div></div><div class="chart-tabs">' + ["7D", "30D", "90D", "ALL"].map((r) => '<button class="chart-tab ' + (state.portfolioRange === r ? "active" : "") + '" data-range="' + r + '">' + r + "</button>").join("") + "</div></div>" + lineChart(PORTFOLIO_RANGES[state.portfolioRange]) + '<div class="chart-legend mt-8"><span class="legend-dot"></span><span>Капитал, млрд $</span><span style="margin-left:auto" class="mono pos">+18,4% за всё время</span></div></div>' +
        '<div class="card"><div class="card-head"><div><div class="card-title">Аллокация</div><div class="card-sub">По типам активов</div></div></div><div class="alloc">' + donut(alloc, "318 млрд", "капитал") + '<div class="alloc-legend">' + legend + "</div></div></div>" +
      "</div>" +
      '<div class="card table-card mt-16"><div class="table-head"><div><div class="card-title">Активы</div><div class="card-sub">' + D.portfolio.length + ' позиций · P&L по каждой</div></div></div><div class="table-scroll"><table class="holdings"><thead><tr><th>Актив</th><th>Кол-во</th><th>Вход</th><th>Сейчас</th><th>Стоимость</th><th>P&L</th><th>%</th></tr></thead><tbody>' + rows + "</tbody></table></div></div>";
  }

  /* ============================= deals ============================= */

  function renderDeals() {
    const stages = [
      { id: "lead", label: "Лиды" },
      { id: "nego", label: "Переговоры" },
      { id: "bought", label: "Куплено" },
      { id: "listed", label: "Выставлено" },
      { id: "sold", label: "Продано" }
    ];

    const board = stages.map((s) => {
      const cards = D.deals.filter((d) => d.stage === s.id).map((d) => {
        return '<div class="deal-card" data-deal="' + d.id + '">' +
          '<div class="deal-title">' + esc(d.title) + '</div>' +
          '<div class="deal-meta">' + esc(d.tag) + " · " + esc(d.server) + "</div>" +
          '<div class="deal-money"><span class="dim">' + money(d.buy) + '</span><span class="deal-profit">+' + money(d.profit) + "</span></div>" +
          '<div class="deal-contact">' + icon("users", 10) + "<span>" + esc(d.contact) + "</span></div>" +
          "</div>";
      }).join("");
      return '<div class="kanban-col"><div class="kanban-head"><span class="kanban-title">' + s.label + '</span><span class="kanban-count">' + D.deals.filter((d) => d.stage === s.id).length + "</span></div>" + (cards || '<div class="empty" style="padding:18px 6px">Пусто</div>') + "</div>";
    }).join("");

    return pageHead("Deals", "Воронка перекупа: лид → переговоры → куплено → выставлено → продано.", '<button class="btn btn-ghost" data-action="toast" data-msg="Импорт сделок из CSV — следующий шаг">' + icon("external", 13) + "<span>Импорт</span></button>") +
      '<div class="kanban">' + board + "</div>";
  }

  /* ============================= alerts ============================= */

  function renderAlerts() {
    const rows = state.alerts.map((a) => {
      return '<div class="alert-row">' +
        '<div><div class="alert-name">' + esc(a.name) + '</div><div class="alert-meta">' + esc(a.condition) + " · " + esc(a.channel) + " · последний раз: " + esc(a.last) + "</div></div>" +
        '<span class="badge ' + (a.active ? "badge-low" : "") + '">' + (a.active ? "активен" : "пауза") + "</span>" +
        '<button class="toggle ' + (a.active ? "on" : "") + '" data-alert="' + a.id + '" aria-label="Переключить алерт"></button>' +
        "</div>";
    }).join("");

    return pageHead("Alerts", "Правила, которые следят за рынком вместо тебя. Telegram, Discord и push.", '<button class="btn btn-ghost" data-action="toast" data-msg="Discord webhook — следующий шаг">' + icon("send", 13) + "<span>Discord</span></button>") +
      '<div class="alerts-grid">' +
        '<div class="card"><div class="card-head"><div><div class="card-title">Правила</div><div class="card-sub">' + state.alerts.filter((a) => a.active).length + " активных из " + state.alerts.length + "</div></div><span class=\"badge badge-white\">live</span></div><div class=\"alert-list\">" + rows + "</div></div>" +
        '<div class="card"><div class="card-head"><div><div class="card-title">ARZ Alerts bot</div><div class="card-sub">Telegram · превью</div></div><span class="badge badge-low">online</span></div>' +
          '<div class="bot-preview">' +
            '<div class="bubble bot">Iegovy на Phoenix упал до <span class="mono">12,4 млрд</span>. Спред к Tucson — <span class="mono pos">+27%</span>.</div>' +
            '<div class="bubble user">Купить 2 шт?</div>' +
            '<div class="bubble bot">Да, ликвидность средняя. Максимальная цена входа — <span class="mono">12,8 млрд</span>. Комиссия 5% уже учтена.</div>' +
            '<div class="bubble bot">Аукцион HSR-II #3/3 закончится через <span class="mono">14:32</span>. Твоя max-ставка — <span class="mono">165 млрд</span>.</div>' +
          "</div>" +
          '<div class="flex gap-8 mt-16"><button class="btn btn-white" data-action="toast" data-msg="Бот открыт в Telegram (демо)">' + icon("send", 13) + "Открыть бота</button><button class=\"btn btn-ghost\" data-action=\"toast\" data-msg=\"Тестовый алерт отправлен\">" + icon("zap", 13) + "Тест</button></div>" +
        "</div>" +
      "</div>";
  }

  /* ============================= meta ============================= */

  function renderMeta() {
    const guides = D.guides.map((g) => '<div class="card guide-card" data-action="toast" data-msg="Гайд «' + esc(g.title) + '» — следующий шаг">' +
      '<div class="guide-top"><span class="badge">' + esc(g.tag) + '</span><span class="tiny dim">' + esc(g.time) + "</span></div>" +
      '<div class="guide-title">' + esc(g.title) + '</div><div class="guide-desc">' + esc(g.desc) + "</div>" +
      '<div class="guide-meta"><span>' + icon("meta", 11) + "</span><span>ARZ Meta</span><span style=\"margin-left:auto\">" + icon("arrow", 12) + "</span></div>" +
      "</div>").join("");

    const patches = [
      { date: "01.11.2026", title: "Эпицентр зла", tag: "Хэллоуин" },
      { date: "28.08.2026", title: "Сезон Крафта", tag: "Крафт" },
      { date: "11.08.2026", title: "Double Gang", tag: "Battle Pass" },
      { date: "29.05.2026", title: "Arizona Re-Start", tag: "Экономика" },
      { date: "12.04.2026", title: "Новая Arizona", tag: "Технологии" }
    ].map((p) => '<div class="flex between center" style="padding:9px 0;border-bottom:1px solid var(--border-soft)"><div><div class="item-name">' + esc(p.title) + '</div><div class="item-sub">' + esc(p.date) + '</div></div><span class="badge">' + esc(p.tag) + "</span></div>").join("");

    return pageHead("Meta", "Гайды, тир-листы и патчноуты. Чтобы не изобретать велосипед там, где рынок уже всё придумал.", "") +
      '<div class="guide-grid">' + guides + "</div>" +
      '<div class="grid-2 mt-16">' +
        '<div class="card"><div class="card-head"><div><div class="card-title">Патчноуты</div><div class="card-sub">Что меняет рынок</div></div><a class="card-link" href="#" data-action="toast" data-msg="Архив патчноутов — следующий шаг">Все ' + icon("arrow", 12) + "</a></div>" + patches + "</div>" +
        '<div class="card"><div class="card-head"><div><div class="card-title">Тир-лист фарма</div><div class="card-sub">2026 · по прибыли в час</div></div></div>' +
          '<div class="flex between center" style="padding:8px 0"><span class="dim">S</span><span class="small">Эпицентр зла · Перекуп лимиток · Крафт HSR-II</span></div>' +
          '<div class="flex between center" style="padding:8px 0"><span class="dim">A</span><span class="small">Лесопилка · Нефтевышки · Дальнобойщик</span></div>' +
          '<div class="flex between center" style="padding:8px 0"><span class="dim">B</span><span class="small">Казино · Бизнес-центр · Депозит</span></div>' +
          '<div class="flex between center" style="padding:8px 0"><span class="dim">C</span><span class="small">Такси · Хот-доги · Мусорщик</span></div>' +
        "</div>" +
      "</div>";
  }

  /* ============================= settings ============================= */

  function renderSettings() {
    const s = currentServer();
    return pageHead("Settings", "Подключение, интерфейс и данные. Пока это демо-каркас без бэкенда.", "") +
      '<div class="settings-grid">' +
        '<div class="card"><div class="card-head"><div><div class="card-title">Подключение</div><div class="card-sub">Сервер и валюта</div></div></div>' +
          '<div class="field"><label>Сервер</label><select>' + D.servers.map((x) => '<option ' + (x.id === state.server ? "selected" : "") + '>' + esc(x.name) + "</option>").join("") + "</select></div>" +
          '<div class="field mt-12"><label>Валюта</label><select><option>$ · вирты</option><option>AZ · донат</option><option>VC$ · Vice City</option></select></div>' +
          '<div class="field mt-12"><label>Источник цен</label><select><option>Ручной ввод + OCR</option><option>Краудсорсинг</option><option>Импорт CSV</option></select></div>' +
          '<div class="settings-row mt-12"><div><div class="settings-label">Текущий сервер</div><div class="settings-desc">' + esc(s.name) + " · " + esc(s.platform) + '</div></div><span class="badge badge-low">online</span></div>' +
        "</div>" +
        '<div class="card"><div class="card-head"><div><div class="card-title">Интерфейс</div><div class="card-sub">Плотность и поведение</div></div></div>' +
          '<div class="settings-row"><div><div class="settings-label">Компактные таблицы</div><div class="settings-desc">Меньше отступов, больше строк</div></div><button class="toggle on" data-action="toast" data-msg="Компактные таблицы включены"></button></div>' +
          '<div class="settings-row"><div><div class="settings-label">Анимации</div><div class="settings-desc">Плавные переходы и drawer</div></div><button class="toggle on" data-action="toast" data-msg="Анимации включены"></button></div>' +
          '<div class="settings-row"><div><div class="settings-label">Звук алертов</div><div class="settings-desc">Короткий сигнал в Telegram</div></div><button class="toggle" data-action="toast" data-msg="Звук алертов выключен"></button></div>' +
          '<div class="settings-row"><div><div class="settings-label">Показывать комиссии</div><div class="settings-desc">В карточках и таблицах</div></div><button class="toggle on" data-action="toast" data-msg="Комиссии включены"></button></div>' +
        "</div>" +
        '<div class="card"><div class="card-head"><div><div class="card-title">Данные</div><div class="card-sub">Импорт и экспорт</div></div></div>' +
          '<div class="settings-row"><div><div class="settings-label">Экспорт CSV</div><div class="settings-desc">Цены, предметы, сделки</div></div><button class="btn btn-ghost btn-sm" data-action="toast" data-msg="CSV будет доступен после подключения БД">Скачать</button></div>' +
          '<div class="settings-row"><div><div class="settings-label">Импорт CSV</div><div class="settings-desc">Загрузить историю цен</div></div><button class="btn btn-ghost btn-sm" data-action="toast" data-msg="Импорт CSV — следующий шаг">Загрузить</button></div>' +
          '<div class="settings-row"><div><div class="settings-label">Резервная копия</div><div class="settings-desc">Локальный JSON</div></div><button class="btn btn-ghost btn-sm" data-action="toast" data-msg="Резервная копия создана (демо)">Создать</button></div>' +
        "</div>" +
        '<div class="card"><div class="card-head"><div><div class="card-title">Опасная зона</div><div class="card-sub">Только для демо</div></div></div>' +
          '<div class="settings-row"><div><div class="settings-label">Сбросить демо-данные</div><div class="settings-desc">Вернуть исходные цены и сделки</div></div><button class="btn btn-ghost btn-sm danger" data-action="toast" data-msg="Демо-данные сброшены (визуально)">Сбросить</button></div>' +
          '<div class="settings-row"><div><div class="settings-label">Удалить аккаунт</div><div class="settings-desc">Это демо, аккаунта пока нет</div></div><button class="btn btn-ghost btn-sm danger" data-action="toast" data-msg="В демо нельзя удалить аккаунт">Удалить</button></div>' +
        "</div>" +
      "</div>";
  }

  /* ============================= drawer ============================= */

  function openDrawer(id) {
    state.drawer = id;
    renderDrawer();
    document.getElementById("drawer").classList.add("open");
    document.getElementById("scrim").classList.add("show");
  }

  function closeDrawer() {
    state.drawer = null;
    document.getElementById("drawer").classList.remove("open");
    if (!state.modal && !state.paletteOpen && !state.sidebarOpen) {
      document.getElementById("scrim").classList.remove("show");
    }
  }

  function renderDrawer() {
    const item = itemById(state.drawer);
    const hasBoth = item.buy > 0 && item.sell > 0;
    const net = hasBoth ? item.sell * 0.95 - item.buy : 0;
    const roi = hasBoth ? (net / item.buy) * 100 : 0;
    const series = (item.history && item.history.length > 3) ? item.history : priceSeries(item.id, item.buy || item.sell || 1, 26);
    const seriesNote = (item.history && item.history.length > 3)
      ? series.length + " точек · средние цены продажи, ArzMarket"
      : "26 точек · демо-генерация";
    const listings = [
      { side: "продажа (средняя)", server: serverName(state.server), price: item.sell, qty: 1 },
      { side: "скупка (средняя)", server: serverName(state.server), price: item.buy, qty: 2 },
      { side: "продажа (средняя)", server: serverName(state.server), price: item.sell, qty: 1 }
    ];
    const listingRows = listings.map((l) => '<div class="listing"><span class="listing-side">' + l.side + '</span><span class="listing-server">' + l.server + '</span><span class="dim tiny">×' + l.qty + '</span><span class="listing-price">' + money(l.price) + "</span></div>").join("");

    document.getElementById("drawer").innerHTML =
      '<div class="drawer-head"><span class="eyebrow">Карточка предмета</span><button class="icon-btn" data-close="drawer" aria-label="Закрыть">' + icon("close", 15) + "</button></div>" +
      '<div class="drawer-body">' +
        '<div class="drawer-item"><div class="item-avatar">' + esc(item.short) + '</div><div><div class="drawer-title">' + esc(item.name) + '</div><div class="drawer-sub">' + esc(item.cat) + " · " + esc(item.sub) + " · " + esc(item.limited) + "</div></div></div>" +
        '<div class="drawer-stats">' +
          '<div class="drawer-stat"><small>Покупка</small><strong>' + (item.buy > 0 ? money(item.buy) : "—") + "</strong></div>" +
          '<div class="drawer-stat"><small>Продажа</small><strong>' + (item.sell > 0 ? money(item.sell) : "—") + "</strong></div>" +
          '<div class="drawer-stat"><small>Спред</small><strong class="pos">' + (hasBoth ? "+" + spreadPct(item.buy, item.sell).toFixed(1) + "%" : "—") + "</strong></div>" +
          '<div class="drawer-stat"><small>24 часа</small><strong class="' + (item.change >= 0 ? "pos" : "neg") + '">' + pct(item.change) + "</strong></div>" +
          '<div class="drawer-stat"><small>Ликвидность</small><strong>' + esc(item.liq) + "</strong></div>" +
          '<div class="drawer-stat"><small>Уверенность</small><strong>' + item.conf + "%</strong></div>" +
        "</div>" +
        '<div class="drawer-section"><h4>История цены</h4>' + lineChart(series, 0.05) + '<div class="flex between tiny dim mt-4"><span>' + seriesNote + "</span><span>обновлено " + esc(item.upd) + " назад</span></div></div>" +
        '<div class="drawer-section"><h4>Активные объявления</h4>' + listingRows + "</div>" +
        '<div class="drawer-section"><h4>Маржа лавки</h4><div class="opp-route-box"><div class="opp-route-side"><small>Скупка</small><strong>' + (item.buy > 0 ? money(item.buy) : "—") + '</strong><em>' + esc(serverName(state.server)) + '</em></div><div class="opp-route-mid">' + icon("arrow", 14) + '</div><div class="opp-route-side"><small>Продажа</small><strong>' + (item.sell > 0 ? money(item.sell) : "—") + '</strong><em>' + esc(serverName(state.server)) + "</em></div></div>" +
          '<div class="calc-out" style="grid-template-columns:1fr 1fr;margin-top:10px"><div class="calc-box"><small>Маржа</small><strong class="' + (hasBoth && net >= 0 ? "pos" : hasBoth ? "neg" : "") + '">' + (hasBoth ? (net >= 0 ? "+" : "") + money(net) : "—") + '</strong></div><div class="calc-box"><small>ROI</small><strong class="' + (hasBoth && roi >= 0 ? "pos" : hasBoth ? "neg" : "") + '">' + (hasBoth ? (roi >= 0 ? "+" : "") + roi.toFixed(1) + "%" : "—") + "</strong></div></div>" +
        "</div>" +
        '<div class="drawer-actions"><button class="btn btn-white" data-action="toast" data-msg="Предмет добавлен в портфель">' + icon("plus", 13) + "В портфель</button><button class=\"btn btn-ghost\" data-action=\"new-alert\">" + icon("alerts", 13) + "Алерт</button><button class=\"btn btn-ghost\" data-action=\"new-deal\">" + icon("deals", 13) + "Сделка</button></div>" +
        '<div class="tiny dim mt-12">' + ((item.history && item.history.length > 3) ? "Цены: средние по лавкам (ArzMarket avg_price), скупка/продажа. История — дневные средние продажи." : "Данные демонстрационные. В реальной системе здесь будет история сделок, источники и confidence.") + "</div>" +
      "</div>";
  }

  function priceSeries(id, base, n) {
    let seed = 0;
    for (let i = 0; i < id.length; i++) seed += id.charCodeAt(i);
    const out = [];
    for (let i = 0; i < n; i++) {
      seed = (seed * 9301 + 49297) % 233280;
      const r = seed / 233280;
      out.push(base * (0.82 + r * 0.36));
    }
    return out;
  }

  /* ============================= modal ============================= */

  function openModal(type, payload) {
    closeDrawer();
    state.modal = { type: type, payload: payload || null };
    renderModal();
    document.getElementById("modal-wrap").classList.add("show");
    document.getElementById("modal-wrap").setAttribute("aria-hidden", "false");
  }

  function closeModal() {
    if (document.activeElement && document.getElementById("modal")?.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    state.modal = null;
    document.getElementById("modal-wrap").classList.remove("show");
    document.getElementById("modal-wrap").setAttribute("aria-hidden", "true");
    if (!state.drawer && !state.paletteOpen && !state.sidebarOpen) {
      document.getElementById("scrim").classList.remove("show");
    }
  }

  function renderModal() {
    if (!state.modal) {
      document.getElementById("modal").innerHTML = "";
      return;
    }
    const type = state.modal.type;
    let html = "";

    if (type === "server") {
      html = '<h3>Выбор сервера</h3><div class="desc">У каждого сервера своя экономика и цены.</div><div class="mt-16">' +
        D.servers.map((s) => '<button class="workspace w-full" data-server="' + s.id + '" style="margin-bottom:6px"><span class="workspace-dot" style="background:' + s.color + '"></span><span><span class="workspace-name">' + esc(s.name) + '</span><span class="workspace-meta">' + esc(s.platform) + " · онлайн " + esc(s.online) + "</span></span>" + (state.server === s.id ? '<span style="margin-left:auto">' + icon("check", 14) + "</span>" : "") + "</button>").join("") +
        '</div><div class="modal-actions"><button class="btn btn-ghost" data-close="modal">Закрыть</button></div>';
    } else if (type === "price") {
      html = '<h3>Добавить цену</h3><div class="desc">Быстрый ввод: сервер, сторона, цена. Источник повышает confidence.</div>' +
        '<form data-form="price"><div class="form-grid">' +
          '<div class="field full"><label>Предмет</label><select name="item">' + D.items.map((i) => '<option value="' + i.id + '">' + esc(i.name) + " · " + esc(i.cat) + "</option>").join("") + "</select></div>" +
          '<div class="field"><label>Сервер</label><select name="server">' + D.servers.map((s) => '<option ' + (s.id === state.server ? "selected" : "") + '>' + esc(s.name) + "</option>").join("") + "</select></div>" +
          '<div class="field"><label>Сторона</label><select name="side"><option>Продажа</option><option>Покупка</option></select></div>' +
          '<div class="field"><label>Цена, $</label><input name="price" type="number" placeholder="12500000000" required></div>' +
          '<div class="field"><label>Источник</label><select name="source"><option>Скриншот</option><option>Объявление</option><option>Аукцион</option><option>Ручной ввод</option></select></div>' +
        '</div><div class="modal-actions"><button type="button" class="btn btn-ghost" data-close="modal">Отмена</button><button class="btn btn-white" type="submit">Сохранить</button></div></form>';
    } else if (type === "alert") {
      html = '<h3>Новый алерт</h3><div class="desc">Следи за ценой, спредом или аукционом.</div>' +
        '<form data-form="alert"><div class="form-grid">' +
          '<div class="field full"><label>Название</label><input name="name" placeholder="Iegovy < 13 млрд" required></div>' +
          '<div class="field"><label>Условие</label><select name="condition"><option>Цена покупки</option><option>Цена продажи</option><option>Спред</option><option>Аукцион</option></select></div>' +
          '<div class="field"><label>Канал</label><select name="channel"><option>Telegram</option><option>Discord</option><option>Push</option></select></div>' +
          '<div class="field full"><label>Порог, $</label><input name="threshold" type="number" placeholder="13000000000"></div>' +
        '</div><div class="modal-actions"><button type="button" class="btn btn-ghost" data-close="modal">Отмена</button><button class="btn btn-white" type="submit">Создать</button></div></form>';
    } else if (type === "deal") {
      const d = state.modal.payload ? D.deals.find((x) => x.id === state.modal.payload) : null;
      if (d) {
        html = '<h3>' + esc(d.title) + '</h3><div class="desc">' + esc(d.tag) + " · " + esc(d.server) + "</div><div class=\"drawer-stats\"><div class=\"drawer-stat\"><small>Вход</small><strong>" + money(d.buy) + '</strong></div><div class="drawer-stat"><small>Цель</small><strong>' + money(d.target) + '</strong></div><div class="drawer-stat"><small>Профит</small><strong class="pos">+' + money(d.profit) + '</strong></div><div class="drawer-stat"><small>Контакт</small><strong>' + esc(d.contact) + '</strong></div></div><div class="modal-actions"><button class="btn btn-ghost" data-close="modal">Закрыть</button><button class="btn btn-white" data-action="toast" data-msg="Сделка открыта в CRM">Открыть</button></div>';
      } else {
        html = '<h3>Новая сделка</h3><div class="desc">Зафиксируй вход, цель и контакт.</div>' +
          '<form data-form="deal"><div class="form-grid">' +
            '<div class="field full"><label>Предмет</label><select name="item">' + D.items.map((i) => '<option>' + esc(i.name) + "</option>").join("") + "</select></div>" +
            '<div class="field"><label>Цена входа, $</label><input name="buy" type="number" placeholder="12500000000" required></div>' +
            '<div class="field"><label>Цель, $</label><input name="target" type="number" placeholder="15800000000" required></div>' +
            '<div class="field"><label>Контакт</label><input name="contact" placeholder="Sk1nny"></div>' +
            '<div class="field"><label>Сервер</label><select name="server">' + D.servers.map((s) => '<option>' + esc(s.name) + "</option>").join("") + "</select></div>" +
          '</div><div class="modal-actions"><button type="button" class="btn btn-ghost" data-close="modal">Отмена</button><button class="btn btn-white" type="submit">Создать</button></div></form>';
      }
    }

    document.getElementById("modal").innerHTML = html;
  }

  /* ============================= command palette ============================= */

  const PALETTE = [
    { label: "Дашборд", hint: "G D", view: "dashboard", icon: "dashboard" },
    { label: "Market · база цен", hint: "G M", view: "market", icon: "market" },
    { label: "Arbitrage · связки", hint: "G A", view: "arbitrage", icon: "arbitrage" },
    { label: "Farming · план", hint: "G F", view: "farming", icon: "farming" },
    { label: "Jobs · калькулятор", hint: "G J", view: "jobs", icon: "trend" },
    { label: "Deposit · депозит", hint: "G D", view: "deposit", icon: "wallet" },
    { label: "Business Lab", hint: "G B", view: "business", icon: "business" },
    { label: "Craft Lab", hint: "G C", view: "craft", icon: "craft" },
    { label: "Auctions", hint: "G U", view: "auctions", icon: "auctions" },
    { label: "Portfolio", hint: "G P", view: "portfolio", icon: "portfolio" },
    { label: "Deals · CRM", hint: "G L", view: "deals", icon: "deals" },
    { label: "Items · база", hint: "G I", view: "items", icon: "layers" },
    { label: "Alerts", hint: "G R", view: "alerts", icon: "alerts" },
    { label: "Meta · гайды", hint: "G K", view: "meta", icon: "meta" },
    { label: "History · дампы", hint: "G H", view: "history", icon: "clock" },
    { label: "Добавить цену", hint: "N", action: "add-price", icon: "plus" },
    { label: "Новая сделка", hint: "D", action: "new-deal", icon: "deals" },
    { label: "Выбрать сервер", hint: "S", action: "server", icon: "server" }
  ];

  function openPalette() {
    state.paletteOpen = true;
    state.paletteQuery = "";
    state.paletteIndex = 0;
    document.getElementById("palette-wrap").classList.add("show");
    document.getElementById("palette-wrap").setAttribute("aria-hidden", "false");
    renderPalette();
    setTimeout(() => {
      const input = document.getElementById("palette-input");
      if (input) input.focus();
    }, 20);
  }

  function closePalette() {
    if (document.activeElement && document.getElementById("palette")?.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    state.paletteOpen = false;
    document.getElementById("palette-wrap").classList.remove("show");
    document.getElementById("palette-wrap").setAttribute("aria-hidden", "true");
    if (!state.drawer && !state.modal && !state.sidebarOpen) {
      document.getElementById("scrim").classList.remove("show");
    }
  }

  function paletteResults() {
    const q = state.paletteQuery.trim().toLowerCase();
    if (!q) return PALETTE;
    return PALETTE.filter((p) => (p.label + " " + (p.hint || "")).toLowerCase().includes(q));
  }

  function renderPalette() {
    const results = paletteResults();
    state.paletteIndex = Math.min(state.paletteIndex, Math.max(0, results.length - 1));
    const list = results.map((p, i) => '<button class="palette-item ' + (i === state.paletteIndex ? "active" : "") + '" data-palette="' + i + '"><span class="palette-icon">' + icon(p.icon, 15) + "</span><span>" + esc(p.label) + '</span><span class="palette-hint">' + esc(p.hint || "") + "</span></button>").join("");
    document.getElementById("palette").innerHTML =
      '<div class="palette-search">' + icon("search", 15) + '<input id="palette-input" placeholder="Команда или страница..." value="' + esc(state.paletteQuery) + '" autocomplete="off"><span class="kbd">ESC</span></div>' +
      '<div class="palette-list" id="palette-list">' + (list || '<div class="palette-empty">Ничего не найдено</div>') + "</div>" +
      '<div class="palette-foot"><span>↑↓ выбрать</span><span>↵ открыть</span><span style="margin-left:auto">ARZ Terminal</span></div>';
  }

  function executePalette(index) {
    const results = paletteResults();
    const cmd = results[index];
    if (!cmd) return;
    closePalette();
    if (cmd.view) navigate(cmd.view);
    else if (cmd.action === "add-price") openModal("price");
    else if (cmd.action === "new-deal") openModal("deal");
    else if (cmd.action === "server") openModal("server");
  }

  /* ============================= toast ============================= */

  let toastTimer = null;
  function showToast(message) {
    const el = document.getElementById("toast");
    el.innerHTML = '<span class="toast-dot"></span><span>' + esc(message) + "</span>";
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
  }

  /* ============================= overlays ============================= */

  function syncOverlays() {
    const scrim = document.getElementById("scrim");
    if (state.drawer || state.modal || state.paletteOpen || state.sidebarOpen) scrim.classList.add("show");
    else scrim.classList.remove("show");
  }

  function closeAll() {
    closeDrawer();
    closeModal();
    closePalette();
    state.sidebarOpen = false;
    document.getElementById("sidebar").classList.remove("open");
    syncOverlays();
  }

  /* ============================= actions ============================= */

  function handleAction(action, el) {
    if (action === "add-price") openModal("price");
    else if (action === "new-deal") openModal("deal");
    else if (action === "new-alert") openModal("alert");
    else if (action === "server") openModal("server");
    else if (action === "palette") openPalette();
    else if (action === "alerts") navigate("alerts");
    else if (action === "toggle-sidebar") {
      state.sidebarOpen = !state.sidebarOpen;
      document.getElementById("sidebar").classList.toggle("open", state.sidebarOpen);
      syncOverlays();
    } else if (action === "toast") {
      showToast(el.getAttribute("data-msg") || "Готово");
    }
  }

  /* ============================= events ============================= */

  document.addEventListener("click", function (event) {
    const nav = event.target.closest("[data-nav]");
    if (nav) {
      event.preventDefault();
      navigate(nav.getAttribute("data-nav"));
      return;
    }

    const close = event.target.closest("[data-close]");
    if (close) {
      event.preventDefault();
      const target = close.getAttribute("data-close");
      if (target === "drawer") closeDrawer();
      else if (target === "modal") closeModal();
      else if (target === "all") closeAll();
      return;
    }

    const actionEl = event.target.closest("[data-action]");
    if (actionEl) {
      event.preventDefault();
      handleAction(actionEl.getAttribute("data-action"), actionEl);
      return;
    }

    const serverEl = event.target.closest("[data-server]");
    if (serverEl) {
      state.server = serverEl.getAttribute("data-server");
      closeModal();
      render();
      showToast("Сервер: " + serverName(state.server));
      return;
    }

    const catEl = event.target.closest("[data-cat]");
    if (catEl) {
      state.marketCat = catEl.getAttribute("data-cat");
      renderViewOnly();
      return;
    }

    const rangeEl = event.target.closest("[data-range]");
    if (rangeEl) {
      state.portfolioRange = rangeEl.getAttribute("data-range");
      renderViewOnly();
      return;
    }

    const taskEl = event.target.closest("[data-task]");
    if (taskEl) {
      const i = Number(taskEl.getAttribute("data-task"));
      state.tasks[i].done = !state.tasks[i].done;
      renderViewOnly();
      return;
    }

    const bizEl = event.target.closest("[data-biz]");
    if (bizEl) {
      state.selectedBusiness = Number(bizEl.getAttribute("data-biz"));
      renderViewOnly();
      return;
    }

    const recipeEl = event.target.closest("[data-recipe]");
    if (recipeEl) {
      state.selectedRecipe = Number(recipeEl.getAttribute("data-recipe"));
      renderViewOnly();
      return;
    }

    const alertEl = event.target.closest("[data-alert]");
    if (alertEl) {
      const id = alertEl.getAttribute("data-alert");
      const a = state.alerts.find((x) => x.id === id);
      if (a) a.active = !a.active;
      renderViewOnly();
      return;
    }

    const dealEl = event.target.closest("[data-deal]");
    if (dealEl) {
      openModal("deal", dealEl.getAttribute("data-deal"));
      return;
    }

    const itemEl = event.target.closest("[data-item]");
    if (itemEl) {
      openDrawer(itemEl.getAttribute("data-item"));
      return;
    }

    if (event.target.id === "scrim") closeAll();
  });

  document.addEventListener("input", function (event) {
    if (event.target.id === "global-search") {
      state.search = event.target.value;
      if (state.view === "market") renderViewOnly();
    }
    if (event.target.closest("#biz-calc")) updateBizCalc();
    if (event.target.id === "palette-input") {
      state.paletteQuery = event.target.value;
      state.paletteIndex = 0;
      const list = document.getElementById("palette-list");
      if (list) {
        const results = paletteResults();
        list.innerHTML = results.length ? results.map((p, i) => '<button class="palette-item ' + (i === state.paletteIndex ? "active" : "") + '" data-palette="' + i + '"><span class="palette-icon">' + icon(p.icon, 15) + "</span><span>" + esc(p.label) + '</span><span class="palette-hint">' + esc(p.hint || "") + "</span></button>").join("") : '<div class="palette-empty">Ничего не найдено</div>';
      }
    }
  });

  document.addEventListener("change", function (event) {
    if (event.target.id === "market-sort") {
      state.marketSort = event.target.value;
      renderViewOnly();
    }
  });

  document.addEventListener("keydown", function (event) {
    const meta = event.metaKey || event.ctrlKey;
    if (meta && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (state.paletteOpen) closePalette();
      else openPalette();
      return;
    }
    if (event.key === "Escape") {
      if (state.paletteOpen) closePalette();
      else if (state.modal) closeModal();
      else if (state.drawer) closeDrawer();
      else if (state.sidebarOpen) closeAll();
      return;
    }
    if (state.paletteOpen) {
      const results = paletteResults();
      if (event.key === "ArrowDown") {
        event.preventDefault();
        state.paletteIndex = Math.min(results.length - 1, state.paletteIndex + 1);
        renderPalette();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        state.paletteIndex = Math.max(0, state.paletteIndex - 1);
        renderPalette();
      } else if (event.key === "Enter") {
        event.preventDefault();
        executePalette(state.paletteIndex);
      }
    }
    if (event.key === "Enter" && event.target.id === "global-search" && state.view !== "market") {
      navigate("market");
    }
  });

  document.addEventListener("click", function (event) {
    const p = event.target.closest("[data-palette]");
    if (p) {
      executePalette(Number(p.getAttribute("data-palette")));
    }
  });

  document.addEventListener("submit", function (event) {
    const form = event.target.closest("form[data-form]");
    if (!form) return;
    event.preventDefault();
    const kind = form.getAttribute("data-form");
    if (kind === "price") showToast("Цена добавлена · confidence +4%");
    if (kind === "alert") showToast("Алерт создан · Telegram подключён");
    if (kind === "deal") showToast("Сделка создана · лид в воронке");
    closeModal();
  });

  /* ============================= countdown / boot ============================= */

  setInterval(function () {
    document.querySelectorAll("[data-countdown]").forEach(function (el) {
      let s = parseInt(el.getAttribute("data-countdown"), 10);
      if (Number.isNaN(s)) return;
      s = Math.max(0, s - 1);
      el.setAttribute("data-countdown", String(s));
      el.textContent = timeAgo(s);
      if (s < 600) el.classList.add("hot");
    });
  }, 1000);

  // Внешние модули (history.js): helpers для рендера.
  window.ARZ.ui = { esc, money, pct, lineChart, serverName, icon, pageHead, refreshView: renderView, view: () => state.view };

  render();
})();
