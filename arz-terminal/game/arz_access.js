"use strict";
/* ARZ Terminal — доступ к данным игрока с телефона (без хостинга и без облака).
 *
 * Сервер на ПК раздаёт сайт; данные игрока по умолчанию видны только самому ПК (loopback). Чтобы открыть их
 * на телефоне, ПК показывает ссылку с КЛЮЧОМ: http://адрес-пк:3000/?key=<ключ>. Первый заход по ссылке ставит
 * cookie (HttpOnly, SameSite=Strict, на год) и перенаправляет на чистый адрес — дальше телефон ходит без ключа
 * в адресе, а EventSource/fetch сайта получают cookie сами.
 * Ключ — 24 случайных байта (hex), лежит в local/access.json (в .gitignore, статикой не отдаётся). Сменить ключ =
 * все телефоны «разлогиниваются».
 *
 * Честно про угрозы: по HTTP внутри домашней Wi-Fi cookie можно подсмотреть сниффером в той же сети;
 * через Tailscale канал шифруется (WireGuard). Публичный интернет напрямую не открывай.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const COOKIE = "arz_key";
const KEY_RE = /^[0-9a-f]{32,}$/;

function newKey() { return crypto.randomBytes(24).toString("hex"); }

/** Ключ из файла; нет файла или он битый — создаём новый. */
function loadOrCreateKey(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    if (j && typeof j.key === "string" && KEY_RE.test(j.key)) return j.key;
  } catch (_) { /* нет файла / битый JSON */ }
  return rotateKey(file);
}

function rotateKey(file) {
  const key = newKey();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ key, createdAt: new Date().toISOString() }));
  return key;
}

/** Сравнение без утечки по времени. */
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function hasValidKey(req, key) {
  if (!key) return false;
  const c = parseCookies(req.headers && req.headers.cookie)[COOKIE];
  return !!c && safeEqual(c, key);
}

function cookieHeader(key, secure) {
  return COOKIE + "=" + key + "; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000" + (secure ? "; Secure" : "");
}

/** 100.64.0.0/10 — адреса Tailscale (CGNAT-диапазон). */
function isTailscale(ip) {
  const p = ip.split(".").map(Number);
  return p[0] === 100 && p[1] >= 64 && p[1] <= 127;
}

/**
 * Адреса ПК, по которым телефон может достучаться: домашняя сеть и Tailscale.
 * interfaces — результат os.networkInterfaces() (параметром, чтобы тестировать).
 */
function phoneUrls(interfaces, port, key) {
  const out = [];
  for (const name of Object.keys(interfaces || {})) {
    for (const a of interfaces[name] || []) {
      const fam = a.family === "IPv4" || a.family === 4;
      if (!fam || a.internal || !a.address || a.address.startsWith("169.254.")) continue;
      const kind = isTailscale(a.address) ? "tailscale" : "lan";
      out.push({
        kind, iface: name, ip: a.address,
        label: kind === "tailscale" ? "Tailscale (откуда угодно)" : "Домашняя сеть (" + name + ")",
        url: "http://" + a.address + ":" + port + "/?key=" + key,
      });
    }
  }
  // Tailscale первым: он работает и вне дома
  out.sort((x, y) => (x.kind === y.kind ? 0 : x.kind === "tailscale" ? -1 : 1));
  return out;
}

/** Убрать key= из адреса для логов (ключ не должен попадать в server.log). */
function redactKey(u) { return String(u).replace(/([?&])key=[^&#]*/, "$1key=***"); }

module.exports = { loadOrCreateKey, rotateKey, safeEqual, parseCookies, hasValidKey, cookieHeader, isTailscale, phoneUrls, redactKey, COOKIE };
