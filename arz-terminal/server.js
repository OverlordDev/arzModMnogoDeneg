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
  let p = decodeURIComponent(reqPath.split("?")[0]);
  // Убираем query-хвосты вида ?v=10 — они уже отрезаны выше.
  p = p.split("?")[0];
  if (p.endsWith("/")) p += "index.html";
  const full = path.normalize(path.join(root, p));
  if (!full.startsWith(root)) return null;
  return full;
}

function serveStatic(req, res, pathname) {
  let file = safeJoin(ROOT, pathname);
  if (!file) {
    send(res, 403, "Forbidden", { "Content-Type": "text/plain; charset=utf-8" });
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
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
