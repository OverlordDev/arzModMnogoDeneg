"use strict";
/* Интеграционный тест server.js: поднимает настоящий сервер на свободном порту и проверяет
 *  1) статику: отдаётся только публичное, секреты (токены, local/, исходники) — нет;
 *  2) доступ с телефона: данные игрока вне ПК только по ключу (ссылка с ?key= ставит cookie), ключ не попадает в лог,
 *     смена ключа выбрасывает старые телефоны.
 * Ключ и файл игрока — временные: настоящие local/access.json и лог игрока не трогаются.
 * Запуск: node game/test_server.js */

const assert = require("assert");
const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("ok   " + name); }
  catch (e) { console.error("FAIL " + name + "\n     " + e.message); process.exitCode = 1; }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on("error", reject);
  });
}

const root = path.join(__dirname, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arzsrv-"));

// Минимальный лог игрока: сервер, деньги, один слот инвентаря с полной загрузкой — чтобы /api/player отвечал 200.
function writePlayerLog(file) {
  const blk = (name, payload, n) => "[2026-11-18 10:00:0" + n + "] #" + n + " " + name + "\nwindow.executeEvent('" + name + "', `" + payload + "`);\n-----\n";
  fs.writeFileSync(file,
    blk("event.arizonahud.serverInfo", JSON.stringify([{ id: 1, title: "Yuma", project: "arizona" }]), 1) +
    blk("event.player.updateMoney", "[123456]", 2) +
    blk("event.inventory.playerInventory", JSON.stringify([{ action: 0, data: { type: 1, items: [{ slot: 0, available: 1, blackout: 0, item: 5818, amount: 3 }] } }]), 3) +
    // окно банка открывали давно: депозит 200 млн, лимит 120 млн
    blk("event.bank.updateDepositData", JSON.stringify([{ bankDeposit: { money: 200000000, level: 1, maxLevel: 5, limit: 120000000, percents: { withdraw: 7, deposit: 0 }, disabledTime: { deposit: 0, upgrade: 100 } }, income: { poyDayIncome: 357540 } }]), 4) +
    blk("event.bank.updateMainData", JSON.stringify([{ bankAccounts: [{ id: 0, money: 30000000, percents: { withdraw: 1 } }] }]), 5));
  // чек PayDay позже (20:24) — свежие остатки
  const ck = (ts) => {
    const L = (t) => "[2026-11-18 " + ts + "] CHAT " + t + "\n";
    return L(" БАНКОВСКИЙ ЧЕК ") + L("Текущая сумма в банке: $33.807.078 (+$389.451)") +
      L("Текущая сумма на депозите: $267.131.102 (+$357.540)") + L("Общая заработная плата: $389.451") +
      L("Баланс на донат-счет: 12610 AZ (+8 AZ)");
  };
  fs.writeFileSync(file.replace("events-", "payday-"), ck("19:54:03") + ck("20:24:03"));
}

async function startServer(extraEnv) {
  const port = await freePort();
  const playerLog = path.join(tmp, "events-" + port + ".log");
  writePlayerLog(playerLog);
  const env = Object.assign({}, process.env, {
    PORT: String(port), HOST: "127.0.0.1", ARZ_FIREBASE: "0",
    ARZ_EVENTS_FILE: playerLog, ARZ_MARKET_DIALOGS_FILE: path.join(tmp, "none.log"), ARZ_HISTORY_FILE: path.join(tmp, "hist-" + port + ".jsonl"),
    ARZ_PAYDAY_FILE: path.join(tmp, "payday-" + port + ".log"),
    ARZ_BANK_HISTORY_FILE: path.join(tmp, "bank-" + port + ".jsonl"), ARZ_ACCESS_FILE: path.join(tmp, "access-" + port + ".json"),
  }, extraEnv || {});
  const child = spawn(process.execPath, ["server.js"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { out += d; });
  const base = "http://127.0.0.1:" + port;
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(base + "/api/health"); if (r.ok) break; } catch (_) { /* ещё не поднялся */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return { base, child, accessFile: env.ARZ_ACCESS_FILE, log: () => out, stop: () => child.kill() };
}

(async () => {
  // ---------- 1. обычный режим (запросы с ПК = «свои») ----------
  const A = await startServer({});
  const status = async (p, init) => (await fetch(A.base + p, Object.assign({ redirect: "manual" }, init))).status;
  try {
    await test("публичное отдаётся: страница, стили, скрипты, данные, манифест, иконки", async () => {
      for (const p of ["/", "/index.html", "/styles.css", "/js/app.js", "/js/cloudclient.js", "/data/deposit.json", "/manifest.webmanifest", "/sw.js", "/icons/icon-192.png"]) {
        assert.strictEqual(await status(p), 200, p);
      }
    });

    await test("секреты НЕ отдаются: local/ (токен облака, ключ телефона, история), server.js, package.json, game/, scripts/, deploy/", async () => {
      for (const p of ["/local/firebase.json", "/local/firebase_auth.json", "/local/access.json", "/local/player_history.jsonl", "/local/bank_history.jsonl",
        "/local/", "/server.js", "/package.json", "/game/arz_firebase.js", "/game/arz_access.js", "/game/arz_export.lua", "/scripts/run_server.bat",
        "/deploy/FIREBASE.md", "/README.md", "/.git/config", "/.gitignore"]) {
        assert.strictEqual(await status(p), 404, p + " должен быть недоступен");
      }
    });

    await test("обход каталога и кривые адреса не раскрывают файлы и не валят сервер", async () => {
      for (const p of ["/../server.js", "/js/../server.js", "/js/..%2fserver.js", "/%2e%2e/server.js", "/js/%00", "/%E0", "/data/../local/access.json", "/js/..%5C..%5Cserver.js"]) {
        const s = await status(p);
        assert.ok(s === 400 || s === 404, p + " -> " + s);
      }
      assert.strictEqual(await status("/api/health"), 200, "сервер жив");
    });

    await test("ссылки для телефона: ключ 48 hex, адреса с ?key=, смена ключа только POST с заголовком; старый ключ перестаёт работать", async () => {
      const j = await (await fetch(A.base + "/api/phone-link")).json();
      assert.ok(j.ok && /^[0-9a-f]{48}$/.test(j.key), JSON.stringify(j).slice(0, 120));
      assert.ok(Array.isArray(j.urls));
      for (const u of j.urls) assert.ok(u.url.endsWith("/?key=" + j.key) && /^http:\/\/\d+\.\d+\.\d+\.\d+:\d+\//.test(u.url), u.url);
      assert.strictEqual(JSON.parse(fs.readFileSync(A.accessFile, "utf8")).key, j.key, "ключ лежит во временном файле, не в настоящем local/");
      assert.strictEqual(await status("/api/phone-link", { method: "POST" }), 400, "без X-Requested-With смена ключа запрещена (чужая страница не сможет)");
      const r = await fetch(A.base + "/api/phone-link", { method: "POST", headers: { "X-Requested-With": "arz" } });
      const j2 = await r.json();
      assert.ok(j2.ok && j2.key !== j.key, "новый ключ");
      assert.strictEqual(await status("/?key=" + j.key), 403, "старый ключ не принимается");
      assert.strictEqual(await status("/?key=" + j2.key), 302, "новый принимается");
      assert.strictEqual(await status("/api/phone-link", { method: "PUT" }), 405);
    });

    await test("PayDay: чек из чата даёт доход за выплату, интервал, а свежие остатки подменяют старые данные окна банка", async () => {
      const j = await (await fetch(A.base + "/api/player")).json();
      assert.strictEqual(j.payday.count, 2);
      assert.strictEqual(j.payday.intervalMin, 30);
      assert.strictEqual(j.payday.incomePerPayday, 389451 + 357540);
      assert.strictEqual(j.payday.incomePerHour, (389451 + 357540) * 2);
      assert.strictEqual(j.payday.last.salary, 389451);
      assert.strictEqual(j.payday.last.az.delta, 8);
      assert.ok(typeof j.payday.sinceLastSec === "number");
      // окно банка: депозит 200 млн / счёт 30 млн; чек новее: 267,13 млн / 33,81 млн
      assert.strictEqual(j.bank.deposit.money, 267131102, "остаток депозита из чека");
      assert.strictEqual(j.bank.deposit.moneyFrom, "payday");
      assert.strictEqual(j.bank.accounts[0].money, 33807078, "счёт из чека");
      assert.strictEqual(j.bank.deposit.limit, 120000000, "лимит остаётся из окна банка");
      assert.strictEqual(j.bank.deposit.incomePerPayday, 357540);
      assert.strictEqual(j.bank.deposit.analysis.idle, 147131102, "простаивает считается по свежему остатку");
      assert.strictEqual(j.bank.total, 267131102 + 33807078);
    });

    await test("пароль/ключи облака не утекают через /api/phone-config", async () => {
      const txt = await (await fetch(A.base + "/api/phone-config")).text();
      assert.ok(!/password/i.test(txt.replace(/"error":"[^"]*"/g, "")));
    });
  } finally {
    A.stop();
  }

  // ---------- 2. телефон: запросы считаются «чужими» (ARZ_FORCE_REMOTE) ----------
  const B = await startServer({ ARZ_FORCE_REMOTE: "1" });
  const get = (p, headers) => fetch(B.base + p, { redirect: "manual", headers: headers || {} });
  try {
    const key = JSON.parse(fs.readFileSync(B.accessFile, "utf8")).key;

    await test("телефон без ключа: данные игрока и поток закрыты (401), служебные ручки ПК — 403", async () => {
      const r = await get("/api/player");
      assert.strictEqual(r.status, 401);
      const j = await r.json();
      assert.strictEqual(j.needKey, true);
      assert.strictEqual((await get("/api/player/stream")).status, 401);
      assert.strictEqual((await get("/api/phone-link")).status, 403, "ключ телефону не отдаём");
      assert.strictEqual((await get("/api/phone-config")).status, 403);
      assert.strictEqual((await get("/", {})).status, 200, "сам сайт открывается и без ключа (в нём нет данных игрока)");
    });

    await test("неверный ключ/cookie не пускают; ключ в адресе проверяется без разницы регистра подсказок", async () => {
      assert.strictEqual((await get("/?key=wrong")).status, 403);
      assert.strictEqual((await get("/?key=")).status, 403);
      assert.strictEqual((await get("/api/player", { Cookie: "arz_key=wrong" })).status, 401);
      assert.strictEqual((await get("/api/player", { Cookie: "arz_key=" + key.slice(0, -1) })).status, 401, "обрезанный ключ");
      assert.strictEqual((await get("/api/player", { Cookie: "other=1; arz_key=" + key.toUpperCase() })).status, 401);
    });

    let cookie;
    await test("ссылка с верным ключом ставит HttpOnly+SameSite=Strict cookie и ведёт на чистый адрес (ключа в адресе нет)", async () => {
      const r = await get("/?key=" + key + "&x=1");
      assert.strictEqual(r.status, 302);
      assert.strictEqual(r.headers.get("location"), "/?x=1", "ключ убран, остальной запрос сохранён");
      const sc = r.headers.get("set-cookie");
      assert.ok(/arz_key=/.test(sc) && /HttpOnly/i.test(sc) && /SameSite=Strict/i.test(sc) && /Max-Age=\d+/.test(sc), sc);
      assert.ok(!/;\s*Secure/i.test(sc), "по обычному HTTP Secure не ставим (cookie не придёт)");
      cookie = sc.split(";")[0];
      const rs = await get("/?key=" + key, { "x-forwarded-proto": "https" });
      assert.ok(/;\s*Secure/i.test(rs.headers.get("set-cookie")), "за HTTPS-прокси — Secure");
    });

    await test("с cookie данные игрока и поток открываются; ответ тот же, что у ПК", async () => {
      const r = await get("/api/player", { Cookie: cookie });
      assert.strictEqual(r.status, 200);
      const j = await r.json();
      assert.strictEqual(j.ok, true);
      assert.strictEqual(j.summary.money, 123456);
      assert.strictEqual(j.summary.server, "Yuma");
      const ctl = new AbortController();
      const rs = await fetch(B.base + "/api/player/stream", { headers: { Cookie: cookie }, signal: ctl.signal });
      assert.strictEqual(rs.status, 200);
      assert.ok(/text\/event-stream/.test(rs.headers.get("content-type")));
      ctl.abort();
    });

    await test("/api/flip: без ключа 401, с ключом — расчёт; параметры ограничены и не ломают ответ", async () => {
      assert.strictEqual((await get("/api/flip")).status, 401);
      const r = await get("/api/flip?budget=26000000&comm=5&cat=" + encodeURIComponent("Кейсы"), { Cookie: "arz_key=" + key });
      assert.strictEqual(r.status, 200);
      const j = await r.json();
      assert.ok(j.ok && j.server === "yuma" && Array.isArray(j.items) && j.portfolio && j.assumptions.budget === 26e6, JSON.stringify(j).slice(0, 200));
      for (const x of j.items) assert.strictEqual(x.cat, "Кейсы");
      const dflt = await (await get("/api/flip", { Cookie: "arz_key=" + key })).json();
      assert.ok(dflt.assumptions.comm === 0.02 && dflt.assumptions.minRoi === 0.08 && dflt.assumptions.budget === 26e6, "без параметров — значения по умолчанию, не нули: " + JSON.stringify(dflt.assumptions));
      const bad = await (await get("/api/flip?budget=-5&comm=999&roi=abc&server=../x", { Cookie: "arz_key=" + key })).json();
      assert.ok(bad.ok && bad.assumptions.budget === 26e6 && bad.assumptions.comm === 0.02 && bad.server === "yuma", "мусор в параметрах -> значения по умолчанию");
    });

    await test("ключ не попадает в журнал сервера (server.log)", async () => {
      await get("/?key=" + key);
      await get("/?key=wrong-key-123");
      await new Promise((r) => setTimeout(r, 200));
      const log = B.log();
      assert.ok(!log.includes(key), "полный ключ в логе");
      assert.ok(!log.includes("wrong-key-123"), "и чужие попытки тоже не пишем");
      assert.ok(/key=\*\*\*/.test(log), "вместо него ***");
    });
  } finally {
    B.stop();
  }

  console.log(`\n${passed} passed${process.exitCode ? ", есть падения" : ""}`);
})();
