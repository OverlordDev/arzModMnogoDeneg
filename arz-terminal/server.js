/* ARZ Terminal — Node-сервер для VPS (2 пользователя).
 *
 * Ноль зависимостей: только встроенные модули Node.
 * - Раздаёт статику из своей папки (index.html, styles.css, js/*, data/*).
 * - API для живости:
 *     GET /api/health            -> { ok, time, uptime }
 *     GET /api/servers           -> { servers: ["yuma","vc"] }
 *     GET /api/market?server=... -> содержимое data/market_<server>.json
 *     GET /api/history-manifest  -> содержимое data/history/index.json
 * - Дампы цен делает НЕ сервер, а cron на VPS:
 *       python3 scripts/snapshot.py  (каждые 30 минут)
 *   Файлы пишутся прямо на диск VPS, сервер их тут же отдаёт.
 *   Пушить в GitHub не нужно.
 *
 * Запуск:  node server.js   (PORT/HOST через env, по умолчанию 3000/0.0.0.0)
 */
"use strict";

const http = require("http");
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
const PLAYER_ALLOW_REMOTE = process.env.ARZ_PLAYER_ALLOW_REMOTE === "1";
// История капитала — ЛИЧНЫЕ данные: только в local/ (в .gitignore), НЕ в data/ (её пушит планировщик).
const HISTORY_FILE = process.env.ARZ_HISTORY_FILE || path.join(ROOT, "local", "player_history.jsonl");
const statsMod = require("./game/arz_stats");
const { createHistory } = require("./game/arz_history");
let history = null; // создаётся при старте, только если настроен файл игрока
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

function isLocalRequest(req) {
  if (PLAYER_ALLOW_REMOTE) return true;
  const ra = (req.socket && req.socket.remoteAddress) || "";
  const okAddr = ra === "127.0.0.1" || ra === "::1" || ra === "::ffff:127.0.0.1";
  const host = String(req.headers.host || "").replace(/:\d+$/, "").toLowerCase();
  const okHost = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  return okAddr && okHost;
}

function marketStamp() {
  // Ключ кэша включает рыночные файлы: их обновляет snapshot.py каждые 30 минут,
  // оценка должна пересчитаться и без новых событий из игры.
  let k = "";
  for (const s of SERVERS) {
    try { k += ":" + fs.statSync(path.join(ROOT, "data", "market_" + s + ".json")).mtimeMs; } catch (_) { k += ":-"; }
  }
  return k;
}

function buildPlayer() {
  const st = fs.statSync(PLAYER_FILE);
  const key = st.mtimeMs + ":" + st.size + marketStamp();
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
  const valuation = valuer.valueInventory(summary, market);
  const body = {
    ok: true,
    fileUpdated: st.mtime.toISOString(),
    summary,
    valuation,
    capital: valuation.ok ? (summary.money || 0) + valuation.estimate : null,
    tips: valuer.advise(summary, valuation),
  };
  playerCache = { key, body, timeline };
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
    // зависят от «сейчас», поэтому считаются при каждой отдаче, а не кэшируются
    earnings: statsMod.earnings(playerCache.timeline, now),
    history: history ? history.series(300, 7 * 86400000) : [],
  });
}

/** Точка истории капитала — только при полной загрузке инвентаря (иначе капитал занижен). */
function recordHistory() {
  if (!history || !playerCache) return;
  const b = playerCache.body;
  if (!b.summary.baseline || b.capital == null) return;
  history.record(Date.now(), Math.round(b.capital), b.summary.money || 0, Math.round(b.valuation.estimate));
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
  // force: плановый тик — ставки заработка «в час» зависят от времени, шлём свежие и без новых событий
  if (force === true || playerCache !== before) broadcastPlayer();
}

/** Событие из игры дописало файл -> разбираем почти сразу (не ждём таймера). */
let playerWatchTimer = null;
function watchPlayerFile() {
  const dir = path.dirname(PLAYER_FILE);
  const base = path.basename(PLAYER_FILE);
  if (!fs.existsSync(dir)) return false;
  try {
    fs.watch(dir, { persistent: false }, (_event, name) => {
      if (name && name !== base) return;
      if (playerWatchTimer) return; // всплеск записей (вход на сервер = ~25 событий) -> один разбор на 120 мс
      playerWatchTimer = setTimeout(() => { playerWatchTimer = null; parsePlayerCycle(); }, 120);
    });
    return true;
  } catch (e) {
    process.stderr.write("[player] fs.watch недоступен, остаётся разбор по таймеру: " + e.message + "\n");
    return false;
  }
}

function handlePlayerStream(req, res) {
  const plain = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" };
  if (!isLocalRequest(req)) return send(res, 403, "player data is local-only", plain);
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
  if (!isLocalRequest(req)) return reply(403, { ok: false, error: "player data is local-only" });
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

function log(req, status, ms) {
  const t = new Date().toISOString().slice(11, 19);
  process.stdout.write(`[${t}] ${req.method} ${req.url} -> ${status} (${ms}ms)\n`);
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

function serveStatic(req, res, pathname) {
  let file = safeJoin(ROOT, pathname);
  if (!file) {
    send(res, 400, "Bad Request", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) file = path.join(file, "index.html");
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
      if (file.endsWith("index.html")) cache = "no-cache";
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
  if (pathname === "/api/player/stream") {
    handlePlayerStream(req, res);
    return;
  }
  if (pathname === "/api/player") {
    handlePlayer(req, res);
    finish(res.statusCode);
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

server.listen(PORT, HOST, () => {
  process.stdout.write(`ARZ Terminal on http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}/\n`);
  if (PLAYER_FILE) {
    history = createHistory(HISTORY_FILE);
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
