/* ARZ Terminal — Node-сервер для VPS (2 пользователя).
 *
 * Ноль зависимостей: только встроенные модули Node.
 * - Раздаёт статику из своей папки (index.html, styles.css, js/*, data/*).
 * - API для живости:
 *     GET /api/health            -> { ok, time, uptime }
 *     GET /api/servers           -> { servers: ["yuma","vc"] }
 *     GET /api/market?server=... -> содержимое data/market_<server>.json
 *     GET /api/history-manifest  -> содержимое data/history/index.json
 * - Дампы цен делает НЕ сервер и НЕ cron (автоматика удалена).
 *   Обновление данных — только вручную:
 *       python3 scripts/snapshot.py  (разово, yuma + vc).
 *   Файлы пишутся прямо на диск VPS, сервер их тут же отдаёт.
 *   Пушить в GitHub не нужно.
 *
 * Запуск:  node server.js   (PORT/HOST через env, по умолчанию 3000/0.0.0.0)
 */
"use strict";

const http = require("http");
const os = require("os");
const fs = require("fs");
const path = require("path");
const url = require("url");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

const SERVERS = ["yuma", "vc"];

// --- Игрок (локально): файл, который пишет game/arz_export.lua ---
// Данные аккаунта отдаются ТОЛЬКО с loopback-адреса (и с Host localhost),
// без CORS-заголовка: иначе любая открытая вкладка могла бы прочитать
// инвентарь через fetch("http://localhost:3000/api/player").
const PLAYER_FILE = process.env.ARZ_EVENTS_FILE ||
  (process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "Programs", "Arizona Games Launcher", "bin", "arizona", "moonloader", "arz_player_events.log")
    : "");
// Игровые средние цены Центрального рынка (окно «Средняя цена товаров»): рядом с файлом игрока.
const GAMEPRICES_FILE = process.env.ARZ_MARKET_DIALOGS_FILE ||
  (PLAYER_FILE ? path.join(path.dirname(PLAYER_FILE), "arz_market_dialogs.log") : "");
// «Банковский чек» PayDay из чата (его пишет arz_export.lua): реальный доход за выплату и свежие остатки банка.
const PAYDAY_FILE = process.env.ARZ_PAYDAY_FILE ||
  (PLAYER_FILE ? path.join(path.dirname(PLAYER_FILE), "arz_payday.log") : "");
const PLAYER_ALLOW_REMOTE = process.env.ARZ_PLAYER_ALLOW_REMOTE === "1";
// История капитала — ЛИЧНЫЕ данные: только в local/ (в .gitignore), НЕ в data/ (её пушит планировщик).
const HISTORY_FILE = process.env.ARZ_HISTORY_FILE || path.join(ROOT, "local", "player_history.jsonl");
const statsMod = require("./game/arz_stats");
const bankMod = require("./game/arz_bank");
const cloudmap = require("./game/arz_cloudmap");
const paydayMod = require("./game/arz_payday");
const access = require("./game/arz_access");
// Ключ доступа для телефона: данные игрока вне ПК отдаются только с ним (cookie после захода по ссылке с ключом).
const ACCESS_FILE = process.env.ARZ_ACCESS_FILE || path.join(ROOT, "local", "access.json");
const FORCE_REMOTE = process.env.ARZ_FORCE_REMOTE === "1"; // только для тестов: loopback-запросы считать «чужими»
let accessKey = null;
try { accessKey = access.loadOrCreateKey(ACCESS_FILE); } catch (e) { process.stderr.write("[access] ключ не создан: " + e.message + "\n"); }
// История банка (депозит/лимит/доход) — личные данные: только local/, в облако — документами bank/<день>.
const BANK_HISTORY_FILE = process.env.ARZ_BANK_HISTORY_FILE || path.join(ROOT, "local", "bank_history.jsonl");
let bankPoints = [];
let lastCatalogStamp = "";
let lastCatalogAt = 0;
const CATALOG_MIN_MS = 10 * 60 * 1000; // каталог цен — десятки документов, чаще раза в 10 минут не шлём
const { createHistory } = require("./game/arz_history");
let history = null; // создаётся при старте, только если настроен файл игрока
// Облако (Firebase/Firestore) — по желанию: включается, только если есть local/firebase.json
// (apiKey + projectId). Реквизиты лежат в local/ (в .gitignore), в репозиторий не попадают.
const FIREBASE_CONFIG_FILE = process.env.ARZ_FIREBASE_CONFIG || path.join(ROOT, "local", "firebase.json");
const FIREBASE_AUTH_FILE = path.join(ROOT, "local", "firebase_auth.json");
let cloud = null;
// Как часто сервер сам перечитывает и разбирает файл игрока (по умолчанию 30 с).
const PLAYER_PARSE_MS = Math.max(5000, Number(process.env.ARZ_PLAYER_PARSE_MS) || 30000);
const jsonCache = new Map(); // file -> { mtimeMs, doc }
let playerCache = null;
let playerCheckedAt = 0; // когда был последний цикл разбора (даже если файл не менялся)

function readJsonCachedSync(file) {
  const st = fs.statSync(file);
  const hit = jsonCache.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs) return hit.doc;
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  jsonCache.set(file, { mtimeMs: st.mtimeMs, doc });
  return doc;
}

/** С ключом (cookie) данные игрока доступны и не с самого ПК. */
function isPlayerAuthorized(req) {
  return PLAYER_ALLOW_REMOTE || isLocalRequest(req) || access.hasValidKey(req, accessKey);
}

function isLocalRequest(req) {
  if (PLAYER_ALLOW_REMOTE) return true;
  if (FORCE_REMOTE) return false;
  const ra = (req.socket && req.socket.remoteAddress) || "";
  const okAddr = ra === "127.0.0.1" || ra === "::1" || ra === "::ffff:127.0.0.1";
  const host = String(req.headers.host || "").replace(/:\d+$/, "").toLowerCase();
  const okHost = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  return okAddr && okHost;
}

function marketStamp() {
  // Ключ кэша включает рыночные файлы: их обновляет snapshot.py вручную,
  // оценка должна пересчитаться и без новых событий из игры.
  let k = "";
  for (const s of SERVERS) {
    try { k += ":" + fs.statSync(path.join(ROOT, "data", "market_" + s + ".json")).mtimeMs; } catch (_) { k += ":-"; }
  }
  return k;
}

/** Игровые цены: файл может отсутствовать (игрок ещё не открывал окно) — это не ошибка. */
function gamePricesStamp() {
  let k = "";
  for (const f of [GAMEPRICES_FILE, GAMEPRICES_FILE + ".old"]) {
    try { const g = fs.statSync(f); k += ":" + g.mtimeMs + ":" + g.size; } catch (_) { k += ":-"; }
  }
  return k;
}

function paydayStamp() {
  let k = "";
  for (const f of [PAYDAY_FILE, PAYDAY_FILE + ".old"]) {
    try { const g = fs.statSync(f); k += ":" + g.mtimeMs + ":" + g.size; } catch (_) { k += ":-"; }
  }
  return k;
}

function loadPayday() {
  if (!PAYDAY_FILE) return null;
  let text = "";
  for (const f of [PAYDAY_FILE + ".old", PAYDAY_FILE]) {
    try { text += fs.readFileSync(f, "utf8") + "\n"; } catch (_) {}
  }
  const stats = paydayMod.paydayStats(paydayMod.parsePaydayLog(text), null, { nominalMin: Number(process.env.ARZ_PAYDAY_MIN) || 30 });
  return stats;
}

const freshenBank = bankMod.freshenBank; // остатки из свежего чека PayDay поверх данных окна банка (arz_bank.js)

function loadGamePrices() {
  if (!GAMEPRICES_FILE) return null;
  try {
    // сначала .old (ротация при 4 МБ), потом основной файл: поздние окна перекрывают ранние
    let text = "";
    for (const f of [GAMEPRICES_FILE + ".old", GAMEPRICES_FILE]) {
      try { text += fs.readFileSync(f, "utf8") + "\n"; } catch (_) {}
    }
    const gp = require("./game/arz_gameprices").parseGamePrices(text);
    return gp.rows || gp.historyItems ? gp : null;
  } catch (_) { return null; }
}

/** Банк для API: разобранные счета и депозит + анализ лимита; null, если игрок ещё не открывал окно банка. */
function buildBank(sb, times, pd) {
  if (!sb || (!sb.deposit && !sb.accounts)) return null;
  const at = (idx) => (idx != null && times && times[idx] != null ? new Date(times[idx]).toISOString() : null);
  let levels = null;
  try { levels = readJsonCachedSync(path.join(ROOT, "data", "deposit.json")).levels; } catch (_) {}
  const dep = sb.deposit;
  const accountsSum = (sb.accounts || []).reduce((a, x) => a + x.money, 0);
  return {
    deposit: dep && Object.assign({}, dep, {
      at: at(sb.depositIdx),
      moneyAt: dep.moneyAt ? new Date(dep.moneyAt).toISOString() : null,   // остаток обновлён чеком PayDay (moneyFrom)
      analysis: dep.stale ? null : bankMod.analyzeDeposit(dep),
      next: dep.stale ? null : bankMod.nextLevelGain(dep, levels),
    }),
    accounts: sb.accounts || null,
    accountsAt: sb.accountsPaydayAt ? new Date(sb.accountsPaydayAt).toISOString() : at(sb.accountsIdx),
    // депозит из окна банка; если окно не открывали, но чек PayDay был — остаток депозита берём из чека
    total: accountsSum + (dep && dep.money ? dep.money : pd && pd.last && pd.last.depositTotal ? pd.last.depositTotal : 0),
  };
}

function buildPlayer() {
  const st = fs.statSync(PLAYER_FILE);
  const key = st.mtimeMs + ":" + st.size + marketStamp() + gamePricesStamp() + paydayStamp();
  if (playerCache && playerCache.key === key) return playerCache.body;
  const parser = require("./game/arz_parser");
  const valuer = require("./game/arz_value");
  let names = {};
  try { names = readJsonCachedSync(path.join(ROOT, "data", "items_names.json")); } catch (_) {}
  const events = parser.parseLog(fs.readFileSync(PLAYER_FILE, "utf8"));
  const summary = parser.summarize(parser.replayEvents(events), names);
  const timeline = statsMod.timeline(events, st.mtimeMs);
  let market = null;
  const sk = valuer.serverKey(summary.server);
  if (sk) { try { market = readJsonCachedSync(path.join(ROOT, "data", "market_" + sk + ".json")); } catch (_) {} }
  const gamePrices = loadGamePrices();
  const valuation = valuer.valueInventory(summary, market, undefined, gamePrices);
  // Банк: приходит только когда игрок открывает окно банка — время берём по номеру события.
  const pd = loadPayday();
  freshenBank(summary.bank, timeline.times, pd);
  const bank = buildBank(summary.bank, timeline.times, pd);
  const capital0 = valuation.ok ? (summary.money || 0) + valuation.estimate : null;
  const body = {
    ok: true,
    fileUpdated: st.mtime.toISOString(),
    summary,
    valuation,
    gamePrices: gamePrices && {
      dialogs: gamePrices.dialogs, rows: gamePrices.rows, historyItems: gamePrices.historyItems,
      updatedAt: gamePrices.updatedAt ? new Date(gamePrices.updatedAt).toISOString() : null,
      saItems: Object.keys(gamePrices.sale.sa).length, vcItems: Object.keys(gamePrices.sale.vc).length,
    },
    capital: capital0,
    bank,
    payday: pd,
    // с банком и депозитом: деньги + инвентарь + счета + депозит (данные банка могут быть старше остальных — см. bank.*At)
    netWorth: capital0 != null && bank ? capital0 + bank.total : null,
    tips: valuer.advise(summary, valuation),
  };
  playerCache = { key, body, timeline, gp: gamePrices };
  process.stdout.write("[player] разобрано: " + summary.inventory.length + " слотов с предметами, " +
    (valuation.ok ? "оценка ≈ " + Math.round(valuation.estimate) : "без оценки") + "\n");
  return body;
}

/** Что отдаём клиенту: кэш разбора + «возраст», посчитанный на момент отправки. */
function playerPayload() {
  if (!playerCache) return null;
  const body = playerCache.body;
  const now = Date.now();
  return Object.assign({}, body, {
    ageSec: Math.round((now - Date.parse(body.fileUpdated)) / 1000),
    parsedAgoSec: Math.round((now - playerCheckedAt) / 1000),
    parseEverySec: Math.round(PLAYER_PARSE_MS / 1000),
    payday: body.payday ? Object.assign({}, body.payday, { sinceLastSec: Math.max(0, Math.round((now - body.payday.last.at) / 1000)) }) : null,
    // зависят от «сейчас», поэтому считаются при каждой отдаче, а не кэшируются
    earnings: statsMod.earnings(playerCache.timeline, now),
    history: history ? history.series(300, 7 * 86400000) : [],
    cloud: cloud ? cloud.status() : { enabled: false },
  });
}

/** Снимок игрока -> Firestore (не чаще раза в 30 с и только при изменениях). */
function offerCloud() {
  if (!cloud || !playerCache) return;
  const b = playerCache.body;
  if (!b.summary.baseline) return; // неполный инвентарь в облако не заливаем — перезапишет хорошие данные плохими
  const s = b.summary;
  const v = b.valuation;
  const e = statsMod.earnings(playerCache.timeline, Date.now());
  const win = (w) => w && {
    income: w.income, spend: w.spend, net: w.net, elapsedSec: w.elapsedSec,
    incomePerHour: w.incomePerHour, netPerHour: w.netPerHour, maxIncome: w.maxIncome, oneOff: w.oneOff,
  };
  // Предметы (сгруппированные) — с ценами, если есть рыночные данные сервера.
  const items = (v.ok ? v.rows : s.totals.map((t) => Object.assign({ priced: false }, t))).map((r) => ({
    item: r.item, name: r.name, amount: r.amount, priced: !!r.priced,
    buy: r.buy || 0, sell: r.sell || 0, mid: r.mid || 0, total: r.total || 0,
    liq: r.liq || null, spreadPct: r.spreadPct == null ? null : r.spreadPct,
    // игровые цены Центрального рынка (медиана дневных цен за 7 дн.), сверка с ArzMarket и «нет сделок за 30 дн.»
    game: r.game || 0, gameRatio: r.gameRatio == null ? null : r.gameRatio, gameDiverge: !!r.gameDiverge,
    gameNoSales: !!(r.gameNoSales || r.noSales), src: r.src || null,
    gameHist: r.gameHist ? { med7: r.gameHist.med7, med30: r.gameHist.med30, vol7: r.gameHist.vol7, trendPct: r.gameHist.trendPct } : null,
  }));
  // Схема — deploy/FIREBASE.md («Схема для приложения»). Меняешь поля — подними schema.
  cloud.offerSnapshot({
    schema: 1,
    server: s.server || null,
    money: s.money, satiety: s.satiety, wanted: s.wanted, skinModel: s.skinModel,
    capital: b.capital,
    netWorth: b.netWorth == null ? null : Math.round(b.netWorth),
    // банк и депозит: данные на момент последнего открытия окна банка (поля *At — когда это было)
    bank: cloudmap.bankForCloud(b.bank),
    gamePrices: b.gamePrices ? {
      historyItems: b.gamePrices.historyItems || 0, listItems: b.gamePrices.saItems || 0,
      updatedAt: b.gamePrices.updatedAt ? new Date(b.gamePrices.updatedAt) : null,
    } : null,
    valuation: v.ok
      ? { ok: true, quick: Math.round(v.quick), ask: Math.round(v.ask), estimate: Math.round(v.estimate),
          pricedCount: v.pricedCount, unpricedCount: v.unpriced.length, pricesDate: v.pricesDate, pricesAgeDays: v.pricesAgeDays }
      : { ok: false, reason: v.reason },
    slotsUsed: s.slots.used, slotsTotal: s.slots.total,
    slots: s.inventory.map((r) => ({ slot: r.slot, item: r.item, name: r.name, amount: r.amount })),
    items,
    worn: (s.worn || []).map((w) => ({ slot: w.slot, item: w.item, name: w.name })),
    tips: b.tips.map((t) => ({ level: t.level, text: t.text })),
    gameUpdatedAt: new Date(b.fileUpdated),
    // зависит от времени, в «подпись изменений» не входит (см. arz_firebase.offerSnapshot)
    earnings: e && {
      active: e.active, sessionStart: new Date(e.sessionStart), lastEventAt: new Date(e.lastEventAt),
      windows: { m15: win(e.windows.m15), h1: win(e.windows.h1), session: win(e.windows.session) },
      recent: e.recent.map((x) => ({ at: new Date(x.at), delta: x.delta })),
    },
  });
  // лента изменений денег по суткам (для графиков «заработок по дням» в приложении)
  cloud.offerMoney(playerCache.timeline.money);

  // Зеркало ответа /api/player: сайт на телефоне читает его тем же кодом отрисовки (web/latest).
  const body = playerPayload();
  if (body) {
    const m = cloudmap.mirrorOf(body, Date.now());
    cloud.offerDoc("web/latest", m.data, { sig: m.sig, minIntervalMs: 30 * 1000, refreshMs: 5 * 60 * 1000 });
  }
  // Каталог игровых цен (все предметы списка + история по дням) — только если данные поменялись.
  const gpStamp = gamePricesStamp();
  if (playerCache.gp && gpStamp !== lastCatalogStamp && Date.now() - lastCatalogAt >= CATALOG_MIN_MS) {
    for (const d of cloudmap.catalogDocs(playerCache.gp).docs) cloud.offerDoc(d.rel, d.data);
    lastCatalogStamp = gpStamp;
    lastCatalogAt = Date.now();
  }
  // История банка по суткам
  const days = cloudmap.bankDays(bankPoints, 2);
  for (const day of Object.keys(days)) cloud.offerDoc("bank/" + day, { day, points: days[day] });
}

/** Банк: новая точка, только если депозит/лимит/доход/уровень/счёт изменились (локальный файл + для облака). */
function recordBank() {
  if (!playerCache) return;
  const p = cloudmap.bankPoint(playerCache.body.bank);
  if (!p || cloudmap.samePoint(bankPoints[bankPoints.length - 1], p)) return;
  bankPoints.push(p);
  if (bankPoints.length > 5000) bankPoints = bankPoints.slice(-5000);
  try {
    fs.mkdirSync(path.dirname(BANK_HISTORY_FILE), { recursive: true });
    fs.appendFileSync(BANK_HISTORY_FILE, JSON.stringify(p) + "\n");
  } catch (_) { /* не критично */ }
}

function loadBankPoints() {
  try {
    bankPoints = fs.readFileSync(BANK_HISTORY_FILE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).slice(-5000);
  } catch (_) { bankPoints = []; }
}

/** Точка истории капитала — только при полной загрузке инвентаря (иначе капитал занижен). */
function recordHistory() {
  if (!history || !playerCache) return;
  const b = playerCache.body;
  if (!b.summary.baseline || b.capital == null) return;
  const t = Date.now();
  const cap = Math.round(b.capital);
  const money = b.summary.money || 0;
  const est = Math.round(b.valuation.estimate);
  if (history.record(t, cap, money, est) && cloud) cloud.queuePoint([t, cap, money, est]);
}

// --- live-поток (Server-Sent Events): сайт получает новое состояние сразу ---
const sseClients = new Set();

function broadcastPlayer() {
  const p = playerPayload();
  const chunk = p ? "data: " + JSON.stringify(p) + "\n\n" : "event: nofile\ndata: {}\n\n";
  for (const res of sseClients) {
    try { res.write(chunk); } catch (_) { sseClients.delete(res); }
  }
}

/** Перечитать файл игрока. Если разбор изменился — сразу пушим клиентам. */
function parsePlayerCycle(force) {
  const before = playerCache;
  try {
    if (PLAYER_FILE && fs.existsSync(PLAYER_FILE)) buildPlayer();
    else playerCache = null; // файла нет (или удалён) — отдаём 404, а не старые данные
  } catch (e) {
    process.stderr.write("[player] ошибка разбора: " + e.message + "\n");
  }
  playerCheckedAt = Date.now();
  recordHistory();
  recordBank();
  offerCloud();
  // force: плановый тик — ставки заработка «в час» зависят от времени, шлём свежие и без новых событий
  if (force === true || playerCache !== before) broadcastPlayer();
}

/** Событие из игры дописало файл -> разбираем почти сразу (не ждём таймера). */
let playerWatchTimer = null;
function watchPlayerFile() {
  const dir = path.dirname(PLAYER_FILE);
  const base = path.basename(PLAYER_FILE);
  const gpBase = GAMEPRICES_FILE ? path.basename(GAMEPRICES_FILE) : null;
  const pdBase = PAYDAY_FILE ? path.basename(PAYDAY_FILE) : null;
  if (!fs.existsSync(dir)) return false;
  try {
    fs.watch(dir, { persistent: false }, (_event, name) => {
      if (name && name !== base && name !== gpBase && name !== pdBase) return;
      if (playerWatchTimer) return; // всплеск записей (вход на сервер = ~25 событий) -> один разбор на 120 мс
      playerWatchTimer = setTimeout(() => { playerWatchTimer = null; parsePlayerCycle(); }, 120);
    });
    return true;
  } catch (e) {
    process.stderr.write("[player] fs.watch недоступен, остаётся разбор по таймеру: " + e.message + "\n");
    return false;
  }
}

/** Игровые цены ЦР для расчётов: разбор лога тяжёлый (МБ), поэтому кэшируем по отметке файлов. */
let gpCache = null;
function gamePricesCached() {
  const stamp = gamePricesStamp();
  if (gpCache && gpCache.stamp === stamp) return gpCache.gp;
  const gp = loadGamePrices();
  gpCache = { stamp, gp };
  return gp;
}

/**
 * GET /api/flip?budget=26000000&comm=2&roi=8&q=ларец&cat=Кейсы&server=yuma — что ставить на скупку (game/arz_flip.js).
 * Данные цен — публичные (ArzMarket) + игровые цены ЦР с ПК игрока, поэтому доступ как к /api/player (ключ вне ПК).
 */
function handleFlip(req, res, query) {
  const reply = (status, obj) => send(res, status, JSON.stringify(obj), { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  if (!isPlayerAuthorized(req)) return reply(401, { ok: false, needKey: true, error: "нужен ключ доступа" });
  const num = (v, lo, hi, def) => {
    const t = String(v == null ? "" : v).replace(/[\s_]/g, "");
    const x = t === "" ? NaN : Number(t);                    // пустое/отсутствующее — значение по умолчанию, а не 0
    return Number.isFinite(x) && x >= lo && x <= hi ? x : def;
  };
  let server = String(query.server || "").toLowerCase();
  if (!SERVERS.includes(server)) {
    const sk = playerCache && playerCache.body && playerCache.body.summary ? require("./game/arz_value").serverKey(playerCache.body.summary.server) : null;
    server = sk && SERVERS.includes(sk) ? sk : "yuma";
  }
  let market;
  try { market = readJsonCachedSync(path.join(ROOT, "data", "market_" + server + ".json")); } catch (_) { return reply(404, { ok: false, error: "нет data/market_" + server + ".json — запусти snapshot" }); }
  const opts = {
    budget: num(query.budget, 100000, 1e12, 26e6),
    comm: num(query.comm, 0, 30, 2) / 100,
    minRoi: num(query.roi, 0, 100, 8) / 100,
    q: String(query.q || "").slice(0, 60),
    cat: String(query.cat || "").slice(0, 30),
  };
  try {
    const r = require("./game/arz_flip").scanFlips(market, gamePricesCached(), opts);
    reply(r.ok ? 200 : 404, Object.assign({ server }, r));
  } catch (e) { reply(500, { ok: false, error: "flip failed: " + e.message }); }
}

function handlePlayerStream(req, res) {
  const plain = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" };
  if (!isPlayerAuthorized(req)) return send(res, 401, "access key required", plain);
  if (!PLAYER_FILE) return send(res, 404, "no player file configured", plain);
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    "Connection": "keep-alive",
  });
  res.write("retry: 3000\n\n");
  sseClients.add(res);
  req.on("close", () => sseClients.delete(res));
  const p = playerPayload();
  res.write(p ? "data: " + JSON.stringify(p) + "\n\n" : "event: nofile\ndata: {}\n\n");
}

function handlePlayer(req, res) {
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  const reply = (status, obj) => send(res, status, JSON.stringify(obj), headers);
  if (!isPlayerAuthorized(req)) return reply(401, { ok: false, needKey: true, error: "нужен ключ доступа: открой на телефоне ссылку с ПК (раздел Player → «Телефон»)" });
  if (!PLAYER_FILE || !fs.existsSync(PLAYER_FILE)) {
    return reply(404, { ok: false, local: !!PLAYER_FILE, error: "no player file yet: install game/arz_export.lua and log in", file: PLAYER_FILE || null });
  }
  try {
    // Отдаём результат последнего разбора; если он ещё не готов — разбираем сразу.
    if (!playerCache) buildPlayer();
    if (!playerCheckedAt) playerCheckedAt = Date.now();
    reply(200, playerPayload());
  } catch (e) {
    reply(500, { ok: false, error: "player parse failed: " + e.message });
  }
}

/**
 * Ссылки для телефона: адрес ПК в домашней сети / Tailscale + ключ доступа. Только с ПК (loopback).
 * POST с заголовком X-Requested-With: arz — выпустить новый ключ (все телефоны разлогинятся).
 */
function handlePhoneLink(req, res) {
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  const reply = (status, obj) => send(res, status, JSON.stringify(obj), headers);
  if (!isLocalRequest(req)) return reply(403, { ok: false, error: "local-only" });
  if (!accessKey) return reply(200, { ok: false, error: "ключ доступа не создан (нет прав на запись в local/)" });
  if (req.method === "POST") {
    if (req.headers["x-requested-with"] !== "arz") return reply(400, { ok: false, error: "bad request" });
    try { accessKey = access.rotateKey(ACCESS_FILE); } catch (e) { return reply(500, { ok: false, error: e.message }); }
  } else if (req.method !== "GET") {
    return reply(405, { ok: false, error: "method not allowed" });
  }
  reply(200, {
    ok: true, key: accessKey, host: HOST, port: PORT,
    lanOpen: HOST !== "127.0.0.1" && HOST !== "localhost",
    urls: access.phoneUrls(os.networkInterfaces(), PORT, accessKey),
  });
}

/**
 * Настройки облака для ссылки подключения телефона: apiKey/projectId веб-приложения Firebase и e-mail.
 * ПАРОЛЬ не отдаётся никогда. Только с loopback (как и данные игрока).
 */
function handlePhoneConfig(req, res) {
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  const reply = (status, obj) => send(res, status, JSON.stringify(obj), headers);
  if (!isLocalRequest(req)) return reply(403, { ok: false, error: "local-only" });
  try {
    if (!fs.existsSync(FIREBASE_CONFIG_FILE)) return reply(200, { ok: false, error: "облако не настроено (нет local/firebase.json)" });
    const cfg = JSON.parse(fs.readFileSync(FIREBASE_CONFIG_FILE, "utf8"));
    const st = cloud ? cloud.status() : null;
    reply(200, {
      ok: true,
      apiKey: cfg.apiKey, projectId: cfg.projectId,
      email: cfg.email || "",
      mode: st ? st.mode : null,                 // anonymous | email
      authWarning: st ? st.authWarning : null,   // например «не включён Email/Password»
    });
  } catch (e) {
    reply(200, { ok: false, error: "конфиг облака не прочитан: " + e.message });
  }
}

function log(req, status, ms) {
  const t = new Date().toISOString().slice(11, 19);
  process.stdout.write(`[${t}] ${req.method} ${access.redactKey(req.url)} -> ${status} (${ms}ms)\n`);
}

function send(res, status, body, headers) {
  const h = Object.assign({ "Content-Length": Buffer.byteLength(body) }, headers || {});
  res.writeHead(status, h);
  res.end(body);
}

function sendJson(res, status, obj, cache) {
  const body = JSON.stringify(obj);
  send(res, status, body, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": cache || "no-store",
    "Access-Control-Allow-Origin": "*",
  });
}

function safeJoin(root, reqPath) {
  let p;
  try {
    // Кривой %-код (например /%E0) кидает URIError — без try это валило весь процесс.
    p = decodeURIComponent(reqPath.split("?")[0]);
  } catch (_) {
    return null;
  }
  if (p.includes("\0")) return null;
  if (p.endsWith("/")) p += "index.html";
  const full = path.normalize(path.join(root, p));
  // root + sep: иначе соседняя папка вида arz-terminal2 проходила бы проверку.
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

/**
 * Что вообще можно отдавать как статику. Раньше отдавалось ВСЁ из папки проекта — в том числе
 * local/firebase_auth.json (refresh-токен облака), local/player_history.jsonl и конфиг с паролем: сервер
 * слушает 0.0.0.0, значит их мог прочитать любой в той же сети. Теперь — только то, что нужно сайту.
 */
const STATIC_FILES = new Set(["index.html", "styles.css", "preview-mobile.html", "manifest.webmanifest", "sw.js"]);
const STATIC_DIRS = ["js/", "data/", "icons/"];
function isPublicPath(file) {
  const rel = path.relative(ROOT, file).split(path.sep).join("/");
  if (!rel || rel.startsWith("..")) return false;
  if (rel.split("/").some((seg) => seg.startsWith("."))) return false; // .git, .env и т.п.
  return STATIC_FILES.has(rel) || STATIC_DIRS.some((d) => rel.startsWith(d));
}

function serveStatic(req, res, pathname) {
  let file = safeJoin(ROOT, pathname);
  if (!file) {
    send(res, 400, "Bad Request", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) file = path.join(file, "index.html");
    if (!isPublicPath(file)) {
      send(res, 404, "Not found", { "Content-Type": "text/plain; charset=utf-8" });
      return;
    }
    fs.readFile(file, (err2, data) => {
      if (err2) {
        // SPA-фолбэк не нужен (многостраничности нет), отдаём 404 как index
        // только для корня; остальное — честный 404.
        send(res, 404, "Not found", { "Content-Type": "text/plain; charset=utf-8" });
        return;
      }
      const ext = path.extname(file).toLowerCase();
      const type = MIME[ext] || "application/octet-stream";
      let cache = "public, max-age=3600";
      if (file.endsWith("index.html") || file.endsWith("sw.js") || file.endsWith("manifest.webmanifest")) cache = "no-cache";
      else if (file.includes(`${path.sep}data${path.sep}`)) cache = "no-cache";
      else if (/\.(css|js|png|jpg|jpeg|webp|svg|ico|woff2?)$/.test(file)) cache = "public, max-age=86400";
      res.writeHead(200, { "Content-Type": type, "Cache-Control": cache, "Content-Length": data.length });
      res.end(data);
    });
  });
}

function readJsonFile(rel, cb) {
  fs.readFile(path.join(ROOT, rel), "utf8", (err, text) => {
    if (err) return cb(err);
    try {
      cb(null, JSON.parse(text));
    } catch (e) {
      cb(e);
    }
  });
}

const server = http.createServer((req, res) => {
  const t0 = Date.now();
  const finish = (status) => log(req, status, Date.now() - t0);
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname || "/";

  // Заход по ссылке с ключом: верный — ставим cookie и убираем ключ из адреса, неверный — отказ.
  if (parsed.query && typeof parsed.query.key === "string") {
    if (accessKey && access.safeEqual(parsed.query.key, accessKey)) {
      const rest = Object.assign({}, parsed.query); delete rest.key;
      const qs = Object.keys(rest).length ? "?" + new URLSearchParams(rest).toString() : "";
      res.writeHead(302, {
        "Set-Cookie": access.cookieHeader(accessKey, req.headers["x-forwarded-proto"] === "https"),
        "Location": pathname + qs, "Cache-Control": "no-store",
      });
      res.end();
      finish(302);
    } else {
      send(res, 403, "Неверный ключ доступа. Открой свежую ссылку из раздела Player → «Телефон» на ПК.", { "Content-Type": "text/plain; charset=utf-8" });
      finish(403);
    }
    return;
  }

  if (pathname === "/api/phone-link") {
    handlePhoneLink(req, res);
    finish(res.statusCode);
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, "Method Not Allowed", { "Content-Type": "text/plain; charset=utf-8" });
    finish(405);
    return;
  }

  // --- API ---
  if (pathname === "/api/health") {
    sendJson(res, 200, { ok: true, time: new Date().toISOString(), uptime: Math.round(process.uptime()) });
    finish(200);
    return;
  }
  if (pathname === "/api/servers") {
    sendJson(res, 200, { servers: SERVERS });
    finish(200);
    return;
  }
  if (pathname === "/api/market") {
    const s = String(parsed.query.server || "yuma").toLowerCase();
    if (!SERVERS.includes(s)) {
      sendJson(res, 400, { ok: false, error: "unknown server, use yuma|vc" });
      finish(400);
      return;
    }
    readJsonFile(`data/market_${s}.json`, (err, doc) => {
      if (err) {
        sendJson(res, 404, { ok: false, error: "no data file yet, run snapshot" });
        finish(404);
        return;
      }
      sendJson(res, 200, doc);
      finish(200);
    });
    return;
  }
  if (pathname === "/api/flip") {
    handleFlip(req, res, parsed.query);
    return;
  }
  if (pathname === "/api/player/stream") {
    handlePlayerStream(req, res);
    return;
  }
  if (pathname === "/api/phone-config") {
    handlePhoneConfig(req, res);
    finish(res.statusCode);
    return;
  }
  if (pathname === "/api/player") {
    handlePlayer(req, res);
    // успешные опросы раз в 10 с не пишем в лог (иначе он растёт на сотни КБ в сутки)
    if (res.statusCode !== 200) finish(res.statusCode);
    return;
  }
  if (pathname === "/api/history-manifest") {
    readJsonFile("data/history/index.json", (err, doc) => {
      if (err) {
        sendJson(res, 404, { ok: false, error: "no history yet" });
        finish(404);
        return;
      }
      sendJson(res, 200, doc);
      finish(200);
    });
    return;
  }

  // --- статика ---
  const origEnd = res.end.bind(res);
  res.end = function (...args) {
    if (!res.statusCode) res.statusCode = 200;
    try { finish(res.statusCode); } catch (_) {}
    return origEnd(...args);
  };
  if (req.method === "HEAD") {
    // Для HEAD отдаём только заголовки через тот же путь.
    serveStatic({ ...req, method: "GET" }, res, pathname);
    return;
  }
  serveStatic(req, res, pathname);
});

// Порт занят — вероятно, уже запущен другой экземпляр. Код 98 понимает scripts/run_server.bat
// и не пытается перезапускаться в бесконечном цикле.
server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    process.stderr.write(`Порт ${PORT} уже занят (другой экземпляр ARZ Terminal?). Выход.\n`);
    process.exit(98);
  }
  throw e;
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`ARZ Terminal on http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}/\n`);
  if (PLAYER_FILE) {
    history = createHistory(HISTORY_FILE);
    loadBankPoints();
    if (process.env.ARZ_FIREBASE !== "0" && fs.existsSync(FIREBASE_CONFIG_FILE)) {
      try {
        const cfg = JSON.parse(fs.readFileSync(FIREBASE_CONFIG_FILE, "utf8"));
        cloud = require("./game/arz_firebase").createFirebase({
          config: cfg,
          authFile: FIREBASE_AUTH_FILE,
          log: (m) => process.stderr.write("[firebase] " + m + "\n"),
        });
        cloud.seedPoints(history.series(1e9, 3 * 3600 * 1000)); // не затереть начало часа после перезапуска
        cloud.start();
        process.stdout.write(`[firebase] сохранение включено: проект ${cfg.projectId}\n`);
      } catch (e) {
        cloud = null;
        process.stderr.write("[firebase] выключено, конфиг не принят: " + e.message + "\n");
      }
    }
    parsePlayerCycle();
    const watching = watchPlayerFile();
    // Страховочный разбор по таймеру: подхватит рыночные цены, случай, когда fs.watch промолчал,
    // и обновит ставки заработка «в час» (они меняются со временем).
    setInterval(() => parsePlayerCycle(true), PLAYER_PARSE_MS).unref();
    // Пульс для SSE: без него браузер/прокси могут закрыть «молчащее» соединение.
    setInterval(() => { for (const r of sseClients) { try { r.write(": ping\n\n"); } catch (_) { sseClients.delete(r); } } }, 15000).unref();
    process.stdout.write(`[player] live: ${watching ? "слежение за файлом + " : ""}страховочный разбор каждые ${Math.round(PLAYER_PARSE_MS / 1000)} с: ${PLAYER_FILE}\n`);
  }
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
