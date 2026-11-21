"use strict";
/* Тесты game/arz_firebase.js с фейковым fetch — без сети и без реального проекта.
 * Запуск: node game/test_firebase.js */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createFirebase, toValue, hintFor } = require("./arz_firebase");

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("ok   " + name); }
  catch (e) { console.error("FAIL " + name + "\n     " + e.message); process.exitCode = 1; }
}

function fake() {
  const f = { calls: [], failFirestore: 0, failSignUp: null, refreshStatus: 200, n: 0, signIn: "ok", emailExists: false, updateMode: "ok" };
  const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
  f.fetch = async (url, init = {}) => {
    f.calls.push({ url, method: init.method || "GET", body: init.body ? (init.body[0] === "{" ? JSON.parse(init.body) : init.body) : null });
    if (url.includes("accounts:signUp")) {
      const b = JSON.parse(init.body);
      if (b.email) { // регистрация по e-mail
        if (f.emailExists) return json(400, { error: { message: "EMAIL_EXISTS" } });
        return json(200, { idToken: "T" + ++f.n, refreshToken: "RE", localId: "E1", expiresIn: "3600" });
      }
      if (f.failSignUp) return json(400, { error: { message: f.failSignUp } });
      return json(200, { idToken: "T" + ++f.n, refreshToken: "R1", localId: "U1", expiresIn: "3600" });
    }
    if (url.includes("accounts:signInWithPassword")) {
      if (f.signIn === "ok") return json(200, { idToken: "T" + ++f.n, refreshToken: "RE", localId: "E1", expiresIn: "3600" });
      return json(400, { error: { message: "INVALID_LOGIN_CREDENTIALS" } });
    }
    if (url.includes("accounts:update")) { // привязка e-mail к анонимному аккаунту: uid прежний
      if (f.updateMode === "exists") return json(400, { error: { message: "EMAIL_EXISTS" } });
      if (f.updateMode === "notallowed") return json(400, { error: { message: "OPERATION_NOT_ALLOWED" } });
      return json(200, { idToken: "T" + ++f.n, refreshToken: "R2", localId: "U1", expiresIn: "3600" });
    }
    if (url.includes("securetoken.googleapis.com")) {
      if (f.refreshStatus !== 200) return json(f.refreshStatus, { error: { message: "TOKEN_EXPIRED" } });
      return json(200, { id_token: "T" + ++f.n, expires_in: "3600", refresh_token: "R1" });
    }
    if (url.includes("firestore.googleapis.com")) {
      if (f.failFirestore) return json(f.failFirestore, { error: { message: "Missing or insufficient permissions.", status: "PERMISSION_DENIED" } });
      return json(200, {});
    }
    return json(404, {});
  };
  f.of = (re) => f.calls.filter((c) => re.test(c.url));
  return f;
}

const CFG = { apiKey: "KEY", projectId: "proj" };
const SNAP = { server: "Yuma", money: 1000, capital: 5000, items: [{ item: 1, name: "Дрова", amount: 5 }], earnings: { active: true } };
const tmpAuth = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "arzfb-")), "auth.json");

(async () => {
  await test("toValue: типы Firestore REST", () => {
    assert.deepStrictEqual(toValue(5), { integerValue: "5" });
    assert.deepStrictEqual(toValue(1.5), { doubleValue: 1.5 });
    assert.deepStrictEqual(toValue(null), { nullValue: null });
    assert.deepStrictEqual(toValue(NaN), { nullValue: null });
    assert.deepStrictEqual(toValue("x"), { stringValue: "x" });
    assert.deepStrictEqual(toValue(true), { booleanValue: true });
    assert.deepStrictEqual(toValue({ a: 1, b: undefined }), { mapValue: { fields: { a: { integerValue: "1" } } } });
    assert.throws(() => toValue([[1, 2]]), /массивы массивов/);
  });

  await test("первый tick: анонимный вход один раз, документ players/{uid}, токен сохранён", async () => {
    const f = fake(); const authFile = tmpAuth(); let t = 1_800_000_000_000;
    const fb = createFirebase({ config: CFG, authFile, fetch: f.fetch, now: () => t });
    fb.offerSnapshot(SNAP);
    await fb.tick();
    assert.strictEqual(f.of(/signUp/).length, 1);
    const patch = f.of(/firestore/)[0];
    assert.strictEqual(patch.method, "PATCH");
    assert.ok(patch.url.endsWith("/documents/players/U1"), patch.url);
    assert.deepStrictEqual(patch.body.fields.money, { integerValue: "1000" });
    assert.ok(patch.body.fields.updatedAt.timestampValue);
    assert.strictEqual(patch.body.fields.items.arrayValue.values[0].mapValue.fields.name.stringValue, "Дрова");
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(authFile, "utf8")), { projectId: "proj", uid: "U1", refreshToken: "R1", mode: "anonymous", email: null });
    assert.strictEqual(fb.status().lastError, null);
    assert.ok(fb.status().lastOkAt);
  });

  await test("не пишет без изменений, не чаще 30 с, заработок в подпись не входит", async () => {
    const f = fake(); let t = 1_800_000_000_000;
    const fb = createFirebase({ config: CFG, fetch: f.fetch, now: () => t });
    fb.offerSnapshot(SNAP); await fb.tick();
    const base = f.of(/firestore/).length;
    t += 60_000; await fb.tick();
    assert.strictEqual(f.of(/firestore/).length, base, "то же состояние — записи нет");
    fb.offerSnapshot(Object.assign({}, SNAP, { earnings: { active: true, h1: { income: 999 } } }));
    t += 60_000; await fb.tick();
    assert.strictEqual(f.of(/firestore/).length, base, "изменился только заработок — записи нет");
    fb.offerSnapshot(Object.assign({}, SNAP, { money: 2000 }));
    await fb.tick();
    assert.strictEqual(f.of(/firestore/).length, base + 1, "после долгого простоя изменение пишется сразу");
    fb.offerSnapshot(Object.assign({}, SNAP, { money: 3000 }));
    t += 10_000; await fb.tick();
    assert.strictEqual(f.of(/firestore/).length, base + 1, "второе изменение через 10 с — рано, троттлинг 30 с");
    t += 21_000; await fb.tick();
    assert.strictEqual(f.of(/firestore/).length, base + 2, "прошло 30 с — пишется");
  });

  await test("история: точки группируются в документ часа (карты, не вложенные массивы)", async () => {
    const f = fake(); let t = Date.parse("2026-11-18T08:10:00Z");
    const fb = createFirebase({ config: CFG, fetch: f.fetch, now: () => t });
    fb.queuePoint([Date.parse("2026-11-18T08:01:00Z"), 100, 40, 60]);
    fb.queuePoint([Date.parse("2026-11-18T08:02:00Z"), 110, 40, 70]);
    fb.queuePoint([Date.parse("2026-11-18T08:03:00Z"), 120, 50, 70]);
    await fb.tick();
    const h = f.of(/history/);
    assert.strictEqual(h.length, 1);
    assert.ok(h[0].url.endsWith("/players/U1/history/2026-11-18T08"), h[0].url);
    const pts = h[0].body.fields.points.arrayValue.values;
    assert.strictEqual(pts.length, 3);
    assert.deepStrictEqual(pts[2].mapValue.fields.capital, { integerValue: "120" });
    // следующую точку отправляем не раньше чем через 5 минут
    fb.queuePoint([Date.parse("2026-11-18T08:04:00Z"), 130, 50, 80]);
    t += 60_000; await fb.tick();
    assert.strictEqual(f.of(/history/).length, 1);
    t += 5 * 60_000; await fb.tick();
    assert.strictEqual(f.of(/history/).length, 2);
    assert.strictEqual(f.of(/history/)[1].body.fields.points.arrayValue.values.length, 4);
  });

  await test("seedPoints не пишет сам, но сохраняет уже имеющиеся точки часа", async () => {
    const f = fake(); let t = Date.parse("2026-11-18T08:30:00Z");
    const fb = createFirebase({ config: CFG, fetch: f.fetch, now: () => t });
    fb.seedPoints([[Date.parse("2026-11-18T08:01:00Z"), 100, 40, 60], [Date.parse("2026-11-18T08:02:00Z"), 110, 40, 70]]);
    await fb.tick();
    assert.strictEqual(f.calls.length, 0, "само по себе ничего не отправляется");
    fb.queuePoint([Date.parse("2026-11-18T08:29:00Z"), 150, 60, 90]);
    await fb.tick();
    assert.strictEqual(f.of(/history/)[0].body.fields.points.arrayValue.values.length, 3, "иначе перезапуск затёр бы начало часа");
  });

  await test("ошибка 403: статус + подсказка про правила, backoff, затем восстановление", async () => {
    const f = fake(); let t = 1_800_000_000_000; const logs = [];
    const fb = createFirebase({ config: CFG, fetch: f.fetch, now: () => t, log: (m) => logs.push(m) });
    f.failFirestore = 403;
    fb.offerSnapshot(SNAP); await fb.tick();
    const s = fb.status();
    assert.ok(/403/.test(s.lastError), s.lastError);
    assert.ok(/правила/.test(s.hint), s.hint);
    const n = f.calls.length;
    t += 10_000; await fb.tick();
    assert.strictEqual(f.calls.length, n, "в паузу backoff новых запросов нет");
    t += 25_000; await fb.tick(); // повтор после 30 с — снова 403
    assert.ok(f.calls.length > n);
    assert.strictEqual(logs.filter((m) => /не удалось/.test(m)).length, 1, "одну и ту же ошибку не спамим в лог");
    f.failFirestore = 0;
    t += 61_000; await fb.tick(); // пауза удвоилась до 60 с
    assert.strictEqual(fb.status().lastError, null);
    assert.ok(fb.status().lastOkAt);
    assert.ok(logs.some((m) => /снова работает/.test(m)));
  });

  await test("Anonymous не включён -> понятная подсказка", async () => {
    const f = fake(); f.failSignUp = "OPERATION_NOT_ALLOWED";
    const fb = createFirebase({ config: CFG, fetch: f.fetch, now: () => 1_800_000_000_000 });
    fb.offerSnapshot(SNAP); await fb.tick();
    assert.ok(/Anonymous/.test(fb.status().hint), fb.status().hint);
    assert.strictEqual(f.of(/firestore/).length, 0);
  });

  await test("после перезапуска вход по сохранённому токену, нового пользователя не заводим", async () => {
    const authFile = tmpAuth(); let t = 1_800_000_000_000;
    const f1 = fake();
    const a = createFirebase({ config: CFG, authFile, fetch: f1.fetch, now: () => t });
    a.offerSnapshot(SNAP); await a.tick();
    const f2 = fake();
    const b = createFirebase({ config: CFG, authFile, fetch: f2.fetch, now: () => t });
    b.offerSnapshot(SNAP); await b.tick();
    assert.strictEqual(f2.of(/signUp/).length, 0);
    assert.strictEqual(f2.of(/securetoken/).length, 1);
    assert.ok(f2.of(/firestore/)[0].url.endsWith("/players/U1"));
  });

  await test("токен отозван (400) -> новый анонимный вход; сетевой сбой пользователей не плодит", async () => {
    const authFile = tmpAuth(); let t = 1_800_000_000_000;
    const f1 = fake();
    const a = createFirebase({ config: CFG, authFile, fetch: f1.fetch, now: () => t });
    a.offerSnapshot(SNAP); await a.tick();

    const f2 = fake(); f2.refreshStatus = 400;
    const b = createFirebase({ config: CFG, authFile, fetch: f2.fetch, now: () => t });
    b.offerSnapshot(SNAP); await b.tick();
    assert.strictEqual(f2.of(/signUp/).length, 1);

    const f3 = fake(); f3.refreshStatus = 503;
    const c = createFirebase({ config: CFG, authFile, fetch: f3.fetch, now: () => t });
    c.offerSnapshot(SNAP); await c.tick();
    assert.strictEqual(f3.of(/signUp/).length, 0, "5xx при обновлении токена — не повод заводить пользователя");
    assert.ok(c.status().lastError);
  });

  await test("токен истекает -> обновляется через refresh, а не новый вход", async () => {
    const f = fake(); let t = 1_800_000_000_000;
    const fb = createFirebase({ config: CFG, fetch: f.fetch, now: () => t });
    fb.offerSnapshot(SNAP); await fb.tick();
    t += 2 * 3600_000;
    fb.offerSnapshot(Object.assign({}, SNAP, { money: 7 })); await fb.tick();
    assert.strictEqual(f.of(/signUp/).length, 1);
    assert.strictEqual(f.of(/securetoken/).length, 1);
  });

  await test("hintFor: 404 -> создай базу; нет конфига -> ошибка конструктора", () => {
    assert.ok(/Firestore Database/.test(hintFor({ status: 404, message: "x" })));
    assert.throws(() => createFirebase({ config: {} }), /apiKey/);
  });

  /* ---------- вход по e-mail (для мобильного приложения: один uid на всех устройствах) ---------- */

  const EMAIL_CFG = Object.assign({ email: "me@example.com", password: "secret1" }, CFG);

  await test("e-mail: анонимный аккаунт привязывается, uid и данные сохраняются", async () => {
    const authFile = tmpAuth(); let t = 1_800_000_000_000;
    const f1 = fake();
    const a = createFirebase({ config: CFG, authFile, fetch: f1.fetch, now: () => t });
    a.offerSnapshot(SNAP); await a.tick();
    assert.strictEqual(a.status().uid, "U1");

    const f2 = fake();
    const b = createFirebase({ config: EMAIL_CFG, authFile, fetch: f2.fetch, now: () => t });
    b.offerSnapshot(Object.assign({}, SNAP, { money: 5 })); await b.tick();
    assert.strictEqual(f2.of(/accounts:update/).length, 1, "привязка e-mail");
    assert.strictEqual(f2.of(/signUp|signInWithPassword/).length, 0, "нового пользователя не заводим");
    assert.ok(f2.of(/firestore/)[0].url.endsWith("/players/U1"), "uid прежний -> данные те же");
    assert.strictEqual(b.status().mode, "email");
    assert.strictEqual(b.status().email, "me@example.com");
    const saved = JSON.parse(fs.readFileSync(authFile, "utf8"));
    assert.deepStrictEqual([saved.mode, saved.email, saved.uid], ["email", "me@example.com", "U1"]);
    assert.ok(!JSON.stringify(saved).includes("secret1"), "пароль в файл входа не пишем");

    // следующий запуск: сессия уже e-mail — привязка не повторяется
    const f3 = fake();
    const c = createFirebase({ config: EMAIL_CFG, authFile, fetch: f3.fetch, now: () => t });
    c.offerSnapshot(SNAP); await c.tick();
    assert.strictEqual(f3.of(/accounts:update/).length, 0);
  });

  await test("e-mail уже занят (создан приложением) -> вход под ним", async () => {
    const authFile = tmpAuth(); let t = 1_800_000_000_000;
    await (async () => { const f = fake(); const a = createFirebase({ config: CFG, authFile, fetch: f.fetch, now: () => t }); a.offerSnapshot(SNAP); await a.tick(); })();
    const f = fake(); f.updateMode = "exists";
    const fb = createFirebase({ config: EMAIL_CFG, authFile, fetch: f.fetch, now: () => t });
    fb.offerSnapshot(SNAP); await fb.tick();
    assert.strictEqual(f.of(/signInWithPassword/).length, 1);
    assert.ok(f.of(/firestore/)[0].url.endsWith("/players/E1"));
    assert.strictEqual(fb.status().mode, "email");
  });

  await test("e-mail не включён в проекте -> сохраняем анонимно с предупреждением, привязку повторяем при следующем обновлении токена", async () => {
    const authFile = tmpAuth(); let t = 1_800_000_000_000;
    await (async () => { const f = fake(); const a = createFirebase({ config: CFG, authFile, fetch: f.fetch, now: () => t }); a.offerSnapshot(SNAP); await a.tick(); })();
    const f = fake(); f.updateMode = "notallowed"; t += 2 * 3600_000; // токен истёк -> refresh -> попытка привязки
    const fb = createFirebase({ config: EMAIL_CFG, authFile, fetch: f.fetch, now: () => t });
    fb.offerSnapshot(SNAP); await fb.tick();
    assert.strictEqual(f.of(/firestore/).length, 1, "сохранение не заблокировано");
    assert.ok(/Email\/Password/.test(fb.status().authWarning), fb.status().authWarning);
    assert.strictEqual(fb.status().mode, "anonymous");
    assert.strictEqual(f.of(/accounts:update/).length, 1);
    t += 2 * 3600_000; // токен снова истёк -> новое обновление токена -> новая попытка привязки
    fb.offerSnapshot(Object.assign({}, SNAP, { money: 9 })); await fb.tick();
    assert.strictEqual(f.of(/accounts:update/).length, 2, "повтор привязки при следующем refresh");
    assert.strictEqual(f.of(/firestore/).length, 2, "сохранение всё это время работает");
  });

  await test("e-mail с нуля: вход, а если пользователя нет — регистрация; неверный пароль -> понятная ошибка", async () => {
    let t = 1_800_000_000_000;
    const f = fake();
    const a = createFirebase({ config: EMAIL_CFG, fetch: f.fetch, now: () => t });
    a.offerSnapshot(SNAP); await a.tick();
    assert.strictEqual(f.of(/signUp/).length, 0, "анонимных не плодим");
    assert.strictEqual(f.of(/signInWithPassword/).length, 1);

    const f2 = fake(); f2.signIn = "none";
    const b = createFirebase({ config: EMAIL_CFG, fetch: f2.fetch, now: () => t });
    b.offerSnapshot(SNAP); await b.tick();
    assert.strictEqual(f2.of(/signUp/).length, 1, "нет такого пользователя -> регистрируем");
    assert.ok(f2.of(/firestore/)[0].url.endsWith("/players/E1"));

    const f3 = fake(); f3.signIn = "none"; f3.emailExists = true;
    const c = createFirebase({ config: EMAIL_CFG, fetch: f3.fetch, now: () => t });
    c.offerSnapshot(SNAP); await c.tick();
    assert.ok(/пароль/.test(c.status().hint), c.status().hint);
    assert.strictEqual(f3.of(/firestore/).length, 0);
  });

  await test("смена e-mail в конфиге отбрасывает старую e-mail-сессию", async () => {
    const authFile = tmpAuth(); let t = 1_800_000_000_000;
    const f1 = fake();
    const a = createFirebase({ config: EMAIL_CFG, authFile, fetch: f1.fetch, now: () => t });
    a.offerSnapshot(SNAP); await a.tick();
    const f2 = fake();
    const b = createFirebase({ config: Object.assign({}, EMAIL_CFG, { email: "other@example.com" }), authFile, fetch: f2.fetch, now: () => t });
    b.offerSnapshot(SNAP); await b.tick();
    assert.strictEqual(f2.of(/securetoken/).length, 0, "старый токен не используем");
    assert.strictEqual(f2.of(/signInWithPassword/).length, 1);
  });

  /* ---------- лента денег ---------- */

  await test("offerMoney: суточные документы с delta, только последние двое суток, без лишних перезаписей", async () => {
    const f = fake(); let t = Date.parse("2026-11-18T12:00:00Z");
    const fb = createFirebase({ config: CFG, fetch: f.fetch, now: () => t });
    const P = (s, bal) => [Date.parse(s), bal];
    const pts = [P("2026-11-15T10:00:00Z", 100), P("2026-11-17T23:00:00Z", 300), P("2026-11-17T23:30:00Z", 250), P("2026-11-18T08:00:00Z", 1250)];
    fb.offerMoney(pts);
    await fb.tick();
    const docs = f.of(/\/money\//);
    assert.strictEqual(docs.length, 2, "три дня в данных, в облако — двое суток");
    assert.ok(docs[0].url.endsWith("/players/U1/money/2026-11-17"));
    const p17 = docs[0].body.fields.points.arrayValue.values.map((v) => v.mapValue.fields);
    assert.deepStrictEqual(p17[0].delta, { integerValue: "200" }, "delta от предыдущего баланса (даже из прошлых суток)");
    assert.deepStrictEqual(p17[1].delta, { integerValue: "-50" });
    const p18 = docs[1].body.fields.points.arrayValue.values.map((v) => v.mapValue.fields);
    assert.deepStrictEqual(p18[0].delta, { integerValue: "1000" });
    fb.offerMoney(pts); t += 10 * 60_000; await fb.tick();
    assert.strictEqual(f.of(/\/money\//).length, 2, "ничего не изменилось — не пишем");
    fb.offerMoney(pts.concat([P("2026-11-18T09:00:00Z", 1300)]));
    t += 10 * 60_000; await fb.tick();
    assert.strictEqual(f.of(/\/money\//).length, 3, "изменился только документ сегодняшних суток");
  });

  await test("offerDoc: произвольные документы под players/{uid}, дедупликация, пауза, собственная подпись, освежение", async () => {
    const f = fake(); let t = 1_800_000_000_000;
    const fb = createFirebase({ config: CFG, fetch: f.fetch, now: () => t });
    fb.offerDoc("web/latest", { payloadJson: "{\"a\":1}" }, { minIntervalMs: 30_000, refreshMs: 5 * 60_000, sig: "A" });
    await fb.tick();
    let docs = f.of(/\/web\/latest/);
    assert.strictEqual(docs.length, 1);
    assert.ok(docs[0].url.endsWith("/documents/players/U1/web/latest"), docs[0].url);
    assert.strictEqual(docs[0].body.fields.payloadJson.stringValue, "{\"a\":1}");
    assert.ok(docs[0].body.fields.updatedAt.timestampValue);
    // та же подпись: данные поменялись только в «плавающих» полях — не пишем
    fb.offerDoc("web/latest", { payloadJson: "{\"a\":1,\"age\":99}" }, { minIntervalMs: 30_000, refreshMs: 5 * 60_000, sig: "A" });
    t += 10_000; await fb.tick();
    assert.strictEqual(f.of(/\/web\/latest/).length, 1);
    // новая подпись, но пауза не вышла (с последней записи прошло всего 15 с)
    fb.offerDoc("web/latest", { payloadJson: "{\"a\":2}" }, { minIntervalMs: 30_000, refreshMs: 5 * 60_000, sig: "B" });
    t += 5_000; await fb.tick();
    assert.strictEqual(f.of(/\/web\/latest/).length, 1, "рано: пауза 30 с");
    t += 20_000; await fb.tick();
    docs = f.of(/\/web\/latest/);
    assert.strictEqual(docs.length, 2);
    assert.strictEqual(docs[1].body.fields.payloadJson.stringValue, "{\"a\":2}");
    // ничего не менялось, но прошло 5 минут — освежаем, чтобы зеркало не протухало
    t += 6 * 60_000; await fb.tick();
    assert.strictEqual(f.of(/\/web\/latest/).length, 3);
    // подпись по умолчанию — JSON данных
    fb.offerDoc("bank/2026-11-18", { points: [{ t: 1, deposit: 5 }] });
    await fb.tick();
    await fb.tick();
    assert.strictEqual(f.of(/\/bank\/2026-11-18/).length, 1, "тот же документ второй раз не пишется");
  });

  await test("offerDoc: много документов уходят порциями (не больше 25 за проход), остальное на следующем", async () => {
    const f = fake(); let t = 1_800_000_000_000;
    const fb = createFirebase({ config: CFG, fetch: f.fetch, now: () => t });
    for (let i = 0; i < 30; i++) fb.offerDoc("gameprices/" + i, { i, items: [{ n: "x" + i }] });
    await fb.tick();
    assert.strictEqual(f.of(/gameprices/).length, 25);
    await fb.tick();
    assert.strictEqual(f.of(/gameprices/).length, 30);
    assert.strictEqual(fb.status().writes, 30);
  });

  await test("offerDoc: при ошибке документ не считается сохранённым и уходит после восстановления", async () => {
    const f = fake(); let t = 1_800_000_000_000;
    const fb = createFirebase({ config: CFG, fetch: f.fetch, now: () => t });
    f.failFirestore = 403;
    fb.offerDoc("web/latest", { payloadJson: "x" });
    await fb.tick();
    assert.ok(fb.status().lastError);
    f.failFirestore = 0; t += 31_000; await fb.tick();
    assert.strictEqual(f.of(/\/web\/latest/).filter((c) => c.method === "PATCH").length, 2, "первая попытка упала, вторая прошла");
    assert.strictEqual(fb.status().lastError, null);
  });

  console.log(`\n${passed} passed${process.exitCode ? ", есть падения" : ""}`);
})();
