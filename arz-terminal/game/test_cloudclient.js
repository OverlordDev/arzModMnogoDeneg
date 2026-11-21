"use strict";
/* Тесты js/cloudclient.js (клиент облака для телефона) с фейковым fetch и хранилищем.
 * Запуск: node game/test_cloudclient.js */

const assert = require("assert");
const { createCloudClient, decodeValue, explain, phoneLink } = require("../js/cloudclient");
const { toFields } = require("./arz_firebase");

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("ok   " + name); }
  catch (e) { console.error("FAIL " + name + "\n     " + e.message); process.exitCode = 1; }
}

const CFG = { apiKey: "KEY", projectId: "proj", email: "игрок@пример.рф" };
const memStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), dump: () => Array.from(m.values()).join("|") }; };

function fake(docs) {
  const f = { calls: [], t: 0, signIn: "ok", refresh: 200, docStatus: 200 };
  const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
  f.fetch = async (url, init = {}) => {
    f.calls.push({ url, method: init.method || "GET", body: init.body || null, auth: init.headers && init.headers.Authorization });
    if (url.includes("signInWithPassword")) {
      if (f.signIn !== "ok") return json(400, { error: { message: f.signIn } });
      return json(200, { idToken: "ID" + ++f.t, refreshToken: "RT1", localId: "UID1", expiresIn: "3600" });
    }
    if (url.includes("securetoken")) {
      if (f.refresh !== 200) return json(f.refresh, { error: { message: "TOKEN_EXPIRED" } });
      return json(200, { id_token: "ID" + ++f.t, refresh_token: "RT2", expires_in: "3600" });
    }
    if (url.includes("firestore.googleapis.com")) {
      if (f.docStatus !== 200) return json(f.docStatus, { error: { message: f.docStatus === 403 ? "Missing or insufficient permissions." : "not found", status: f.docStatus === 403 ? "PERMISSION_DENIED" : "NOT_FOUND" } });
      const rel = decodeURIComponent(url.split("/documents/")[1]);
      return docs[rel] ? json(200, { fields: toFields(docs[rel]) }) : json(404, { error: { message: "not found" } });
    }
    return json(404, {});
  };
  return f;
}

const BODY = { ok: true, fileUpdated: "2026-11-18T10:00:00.000Z", summary: { money: 5, server: "Yuma" }, valuation: { ok: true, estimate: 123, rows: [{ name: "Дрова", amount: 3 }] },
  tips: [{ level: "info", text: "Депозит работает на 120 из 266 млн" }], history: [[1, 2, 3, 4]], bank: null };
const DOCS = () => ({ "UID1/web/latest": null, "players/UID1/web/latest": undefined });

(async () => {
  await test("ссылка для телефона: конфиг в #phone=..., кириллица в e-mail, хеш убирается из адреса, повторная ссылка с другим проектом сбрасывает вход", async () => {
    const link = phoneLink("https://arz.example.com/app/?x=1#old", CFG);
    assert.ok(link.startsWith("https://arz.example.com/app/#phone="), link);
    assert.ok(!/[+/=]/.test(link.split("#phone=")[1]), "base64url без + / =");
    const st = memStorage();
    const loc = { hash: "#" + link.split("#")[1], pathname: "/app/", search: "" };
    let replaced = null;
    const c = createCloudClient({ fetch: async () => { throw new Error("сети быть не должно"); }, storage: st, location: loc, history: { replaceState: (a, b, u) => { replaced = u; } } });
    assert.strictEqual(c.configured(), false);
    assert.strictEqual(c.consumeHash(), true);
    assert.strictEqual(c.configured(), true);
    assert.strictEqual(c.email(), CFG.email);
    assert.strictEqual(replaced, "/app/", "хеш с конфигом убран из адресной строки");
    assert.ok(!st.dump().includes("password"));
    // мусор вместо конфига — не падаем и ничего не меняем
    const c2 = createCloudClient({ fetch: async () => ({}), storage: memStorage(), location: { hash: "#phone=@@@@", pathname: "/" } });
    assert.strictEqual(c2.consumeHash(), false);
    assert.strictEqual(c2.configured(), false);
  });

  await test("вход по паролю: пароль не сохраняется, в хранилище только конфиг и refresh-токен; после перезагрузки страницы вход помнится", async () => {
    const f = fake({}); const st = memStorage();
    const c = createCloudClient({ fetch: f.fetch, storage: st, location: { hash: "#" + phoneLink("https://x", CFG).split("#")[1], pathname: "/" } });
    c.consumeHash();
    const uid = await c.signIn("секретный пароль 123");
    assert.strictEqual(uid, "UID1");
    assert.ok(c.signedIn());
    const saved = st.dump();
    assert.ok(!saved.includes("секретный"), "пароль в хранилище не попадает");
    assert.ok(saved.includes("RT1") && !saved.includes("idToken"), "refresh-токен сохраняем, короткоживущий idToken — нет");
    const c2 = createCloudClient({ fetch: f.fetch, storage: st });
    assert.ok(c2.configured() && c2.signedIn(), "новая страница: уже подключён и вошёл");
  });

  await test("fetchBody: зеркало web/latest разворачивается в тот же ответ, что отдаёт /api/player; возраст считается на момент чтения", async () => {
    const f = fake({ "players/UID1/web/latest": { schema: 1, generatedAt: "2026-11-18T10:00:05.000Z", updatedAt: new Date("2026-11-18T10:00:06.000Z"), payloadJson: JSON.stringify(BODY) } });
    let t = Date.parse("2026-11-18T10:01:00.000Z");
    const c = createCloudClient({ fetch: f.fetch, storage: memStorage(), now: () => t, location: { hash: "#" + phoneLink("https://x", CFG).split("#")[1], pathname: "/" } });
    c.consumeHash(); await c.signIn("p");
    const b = await c.fetchBody();
    assert.deepStrictEqual(b.summary, BODY.summary);
    assert.strictEqual(b.valuation.rows[0].name, "Дрова");
    assert.strictEqual(b.tips[0].text, "Депозит работает на 120 из 266 млн");
    assert.strictEqual(b.ageSec, 60, "возраст = сейчас − fileUpdated");
    assert.strictEqual(b.parsedAgoSec, 54, "и когда ПК положил копию");
    assert.deepStrictEqual([b.cloud.enabled, b.cloud.mirror, b.cloud.projectId], [true, true, "proj"]);
    const get = f.calls.find((x) => /web\/latest/.test(x.url));
    assert.ok(get.url.includes("/projects/proj/databases/(default)/documents/players/UID1/web/latest"), get.url);
    assert.ok(/^Bearer ID/.test(get.auth));
  });

  await test("токен: пока жив — не обновляем; истёк — refresh, новый refresh-токен сохраняется; отозван (400) — выход и просьба войти заново", async () => {
    const f = fake({ "players/UID1/web/latest": { payloadJson: JSON.stringify(BODY), updatedAt: new Date() } });
    let t = 1_800_000_000_000; const st = memStorage();
    const c = createCloudClient({ fetch: f.fetch, storage: st, now: () => t, location: { hash: "#" + phoneLink("https://x", CFG).split("#")[1], pathname: "/" } });
    c.consumeHash(); await c.signIn("p");
    await c.fetchBody(); await c.fetchBody();
    assert.strictEqual(f.calls.filter((x) => /securetoken/.test(x.url)).length, 0, "токен жив — обновления нет");
    t += 2 * 3600 * 1000;
    await c.fetchBody();
    assert.strictEqual(f.calls.filter((x) => /securetoken/.test(x.url)).length, 1, "токен истёк — одно обновление");
    assert.ok(st.dump().includes("RT2"), "новый refresh-токен сохранён");
    t += 2 * 3600 * 1000; f.refresh = 400;
    await assert.rejects(() => c.fetchBody(), (e) => e.code === "NOT_SIGNED_IN");
    assert.strictEqual(c.signedIn(), false);
  });

  await test("ошибки: неверный пароль, нет прав, нет данных, нет сети — человеческим языком", async () => {
    const f = fake({});
    const c = createCloudClient({ fetch: f.fetch, storage: memStorage(), location: { hash: "#" + phoneLink("https://x", CFG).split("#")[1], pathname: "/" } });
    c.consumeHash();
    f.signIn = "INVALID_LOGIN_CREDENTIALS";
    await assert.rejects(() => c.signIn("bad"), (e) => /Неверный e-mail или пароль/.test(explain(e)));
    f.signIn = "OPERATION_NOT_ALLOWED";
    await assert.rejects(() => c.signIn("p"), (e) => /Email\/Password/.test(explain(e)));
    f.signIn = "ok"; await c.signIn("p");
    f.docStatus = 403;
    await assert.rejects(() => c.fetchBody(), (e) => /правила Firestore/.test(explain(e)));
    f.docStatus = 200;
    await assert.rejects(() => c.fetchBody(), (e) => /Данных в облаке ещё нет/.test(explain(e)), "документа нет -> 404 -> понятная подсказка");
    assert.ok(/Нет связи/.test(explain(new Error("Failed to fetch"))));
  });

  await test("decodeValue: типы Firestore REST, вложенные карты и массивы карт", () => {
    const enc = toFields({ a: 1, b: 1.5, s: "я", t: true, n: null, d: new Date("2026-11-18T10:00:00Z"), m: { x: [{ i: 1 }, { i: 2 }] } });
    const dec = {};
    for (const k of Object.keys(enc)) dec[k] = decodeValue(enc[k]);
    assert.deepStrictEqual(dec, { a: 1, b: 1.5, s: "я", t: true, n: null, d: "2026-11-18T10:00:00.000Z", m: { x: [{ i: 1 }, { i: 2 }] } });
    assert.strictEqual(decodeValue(undefined), null);
  });

  await test("выйти и забыть: после forget() телефон снова «не подключён»", async () => {
    const st = memStorage();
    const c = createCloudClient({ fetch: fake({}).fetch, storage: st, location: { hash: "#" + phoneLink("https://x", CFG).split("#")[1], pathname: "/" } });
    c.consumeHash(); await c.signIn("p");
    c.signOut();
    assert.ok(c.configured() && !c.signedIn(), "после выхода конфиг остаётся, нужен пароль");
    c.forget();
    assert.ok(!c.configured());
    assert.ok(!createCloudClient({ fetch: fake({}).fetch, storage: st }).configured());
  });

  console.log(`\n${passed} passed${process.exitCode ? ", есть падения" : ""}`);
})();
