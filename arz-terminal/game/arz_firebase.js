"use strict";
/* ARZ Terminal — сохранение данных игрока в Firebase (Firestore) без SDK.
 *
 * Только встроенный fetch (Node >= 18) и REST API Google:
 *   - вход: по e-mail/паролю из local/firebase.json (тот же аккаунт, под которым
 *     будет входить мобильное приложение — тогда у обоих один uid) или, если
 *     e-mail не задан, анонимный. Анонимный аккаунт при появлении e-mail
 *     ПРИВЯЗЫВАЕТСЯ к нему (accounts:update): uid и уже сохранённые данные те же.
 *     Refresh-токен хранится в local/firebase_auth.json (ключ к данным — в .gitignore);
 *   - запись: Firestore REST (PATCH документа).
 *
 * Схема данных — deploy/FIREBASE.md (раздел «Схема для приложения»). Коротко, всё
 * под players/{uid}:
 *   (сам документ)       — последний снимок: состояние, слоты, предметы с ценами,
 *                          оценка, заработок, советы;
 *   history/{ГГГГ-ММ-ДДTЧЧ} — точки капитала за час (UTC);
 *   money/{ГГГГ-ММ-ДД}   — лента изменений денег за сутки (UTC).
 *
 * Безопасность — правила Firestore (deploy/firestore.rules): пользователь видит
 * и пишет только свой players/{uid}. apiKey веб-проекта секретом не является.
 *
 * Надёжность: любая ошибка (нет сети, не включён провайдер, закрыты правила) не
 * роняет сервер и не блокирует сайт — пишется в status() и лог один раз, повторы
 * идут с нарастающей паузой (30 с → 15 мин).
 */

const fs = require("fs");
const path = require("path");

const SNAPSHOT_MIN_MS = 30 * 1000;
const HISTORY_FLUSH_MS = 5 * 60 * 1000;
const TICK_MS = 10 * 1000;
const BACKOFF_START_MS = 30 * 1000;
const BACKOFF_MAX_MS = 15 * 60 * 1000;
const LINK_RETRY_MS = 10 * 60 * 1000;
const KEEP_BUCKET_MS = 3 * 3600 * 1000;
const MAX_MONEY_POINTS_PER_DAY = 3000;

/* ---------- JS -> формат значений Firestore REST ---------- */

function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  switch (typeof v) {
    case "boolean": return { booleanValue: v };
    case "number":
      if (!Number.isFinite(v)) return { nullValue: null };
      return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    case "string": return { stringValue: v };
    default: break;
  }
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) {
    if (v.some(Array.isArray)) throw new Error("Firestore не поддерживает массивы массивов — используй массив карт");
    return { arrayValue: { values: v.map(toValue) } };
  }
  return { mapValue: { fields: toFields(v) } };
}

function toFields(obj) {
  const fields = {};
  for (const k of Object.keys(obj)) {
    if (obj[k] !== undefined) fields[k] = toValue(obj[k]);
  }
  return fields;
}

/* ---------- человеческие подсказки по типичным ошибкам настройки ---------- */

function hintFor(e) {
  const c = String((e && (e.code || e.message)) || "");
  if (e && e.ctx === "email") {
    if (/OPERATION_NOT_ALLOWED/.test(c)) return "Firebase Console → Authentication → Sign-in method → включи «Email/Password».";
    if (/WEAK_PASSWORD/.test(c)) return "Пароль в local/firebase.json слишком короткий (нужно минимум 6 символов).";
    if (/INVALID_EMAIL/.test(c)) return "e-mail в local/firebase.json не похож на адрес.";
    if (/WRONG_PASSWORD/.test(c)) return "Этот e-mail уже есть в проекте, но пароль из local/firebase.json не подходит.";
    if (/TOO_MANY_ATTEMPTS/.test(c)) return "Слишком много попыток входа — подожди несколько минут.";
  }
  if (/OPERATION_NOT_ALLOWED|ADMIN_ONLY_OPERATION/.test(c)) {
    return "Firebase Console → Authentication → Sign-in method → включи «Anonymous».";
  }
  if (/CONFIGURATION_NOT_FOUND/.test(c)) {
    return "В проекте не включена Authentication: Firebase Console → Authentication → Get started.";
  }
  if (/API_KEY_INVALID|API key not valid/i.test(c)) {
    return "apiKey не принят: проверь local/firebase.json и ограничения ключа в Google Cloud.";
  }
  if (/Cloud Firestore API has not been used|SERVICE_DISABLED/i.test(c)) {
    return "Включи Cloud Firestore API (Firebase Console → Firestore Database → Create database).";
  }
  if (e && e.status === 404) {
    return "База Firestore не найдена: создай Firestore Database (Native mode) в проекте.";
  }
  if (e && (e.status === 403 || /PERMISSION_DENIED/.test(c))) {
    return "Firestore отклонил запись: вставь правила из deploy/firestore.rules и включи нужный вход (Anonymous / Email).";
  }
  return null;
}

/* ---------- клиент ---------- */

function createFirebase(opts) {
  const config = opts.config || {};
  const apiKey = config.apiKey;
  const projectId = config.projectId;
  if (!apiKey || !projectId) throw new Error("firebase: в конфиге нужны apiKey и projectId");
  const wantEmail = !!(config.email && config.password);
  const authFile = opts.authFile || null;
  const doFetch = opts.fetch || globalThis.fetch;
  const now = opts.now || Date.now;
  const log = opts.log || (() => {});
  if (typeof doFetch !== "function") throw new Error("firebase: нужен Node >= 18 (глобальный fetch)");

  const EMPTY_AUTH = { uid: null, refreshToken: null, mode: null, email: null };
  let auth = Object.assign({}, EMPTY_AUTH);
  try {
    if (authFile && fs.existsSync(authFile)) {
      const a = JSON.parse(fs.readFileSync(authFile, "utf8"));
      if (a && a.refreshToken && a.projectId === projectId) {
        auth = { uid: a.uid, refreshToken: a.refreshToken, mode: a.mode || "anonymous", email: a.email || null };
        // в конфиге сменили e-mail — старая сессия не годится
        if (wantEmail && auth.mode === "email" && auth.email !== config.email) auth = Object.assign({}, EMPTY_AUTH);
      }
    }
  } catch (_) { /* битый файл — войдём заново */ }

  function saveAuth() {
    if (!authFile) return;
    try {
      fs.mkdirSync(path.dirname(authFile), { recursive: true });
      fs.writeFileSync(authFile, JSON.stringify({ projectId, uid: auth.uid, refreshToken: auth.refreshToken, mode: auth.mode, email: auth.email }));
    } catch (_) { /* не критично: при перезапуске войдём заново */ }
  }

  let idToken = null;
  let tokenExp = 0;
  let busy = false;
  let backoffMs = 0;
  let nextTryAt = 0;
  let nextLinkAt = 0;
  let lastLogged = "";

  let snapshot = null;
  let snapshotSig = "";
  let lastSavedSig = "";
  let lastSnapshotAt = 0;

  const buckets = new Map(); // "2026-11-18T08" -> [{t, capital, money, estimate}]
  const dirty = new Set();
  const moneyDocs = new Map(); // "2026-11-18" -> [{t, balance, delta}]
  const moneySig = new Map();
  const moneyDirty = new Set();
  let lastHistoryFlush = 0;

  const st = {
    enabled: true, projectId, uid: auth.uid, mode: auth.mode, email: wantEmail ? config.email : null,
    lastOkAt: null, lastError: null, hint: null, authWarning: null, writes: 0,
  };

  async function http(url, init) {
    const res = await doFetch(url, init);
    let body = null;
    try { body = await res.json(); } catch (_) { /* пустой/не JSON */ }
    if (!res.ok) {
      const err = new Error("HTTP " + res.status + ((body && body.error && body.error.message) ? ": " + body.error.message : ""));
      err.status = res.status;
      err.code = body && body.error && (body.error.message || body.error.status);
      throw err;
    }
    return body;
  }

  async function idtCall(method, body, ctx) {
    try {
      return await http("https://identitytoolkit.googleapis.com/v1/accounts:" + method + "?key=" + encodeURIComponent(apiKey), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      if (ctx) e.ctx = ctx;
      throw e;
    }
  }

  function setSession(b, mode) {
    idToken = b.idToken;
    tokenExp = now() + Number(b.expiresIn || 3600) * 1000;
    auth = { uid: b.localId, refreshToken: b.refreshToken, mode, email: mode === "email" ? config.email : null };
    st.uid = auth.uid;
    st.mode = mode;
    saveAuth();
  }

  /** Вход по e-mail/паролю; если такого пользователя нет — создаём. */
  async function emailLogin() {
    const creds = { email: config.email, password: config.password, returnSecureToken: true };
    try {
      setSession(await idtCall("signInWithPassword", creds, "email"), "email");
      return;
    } catch (e) {
      // Google при включённой защите перебора не различает «нет такого» и «неверный пароль»:
      // пробуем создать, а «уже занят» значит именно неверный пароль.
      if (!/EMAIL_NOT_FOUND|INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD/.test(String(e.code || ""))) throw e;
    }
    try {
      setSession(await idtCall("signUp", creds, "email"), "email");
      log("создан аккаунт для e-mail " + config.email);
    } catch (e) {
      if (/EMAIL_EXISTS/.test(String(e.code || ""))) {
        const err = new Error("e-mail уже зарегистрирован, но пароль не подошёл");
        err.code = "WRONG_PASSWORD";
        err.ctx = "email";
        throw err;
      }
      throw e;
    }
  }

  /** Привязать e-mail к текущему анонимному аккаунту: uid и данные сохраняются. */
  async function tryLink() {
    try {
      setSession(await idtCall("update", { idToken, email: config.email, password: config.password, returnSecureToken: true }, "email"), "email");
      st.authWarning = null;
      log("анонимный аккаунт привязан к e-mail " + config.email + " (uid прежний, данные сохранены)");
    } catch (e) {
      if (/EMAIL_EXISTS/.test(String(e.code || ""))) {
        log("e-mail уже есть в проекте — вхожу под ним; данные под прежним анонимным uid остаются в базе отдельно");
        await emailLogin();
        return;
      }
      // Не блокируем сохранение: продолжаем под анонимным входом и повторим позже.
      nextLinkAt = now() + LINK_RETRY_MS;
      st.authWarning = e.message + (hintFor(e) ? " — " + hintFor(e) : "");
      if (st.authWarning !== lastLogged) { lastLogged = st.authWarning; log("e-mail не привязан: " + st.authWarning); }
    }
  }

  async function getToken() {
    if (idToken && now() < tokenExp - 60 * 1000) return idToken;

    if (auth.refreshToken) {
      let refreshed = false;
      try {
        const b = await http("https://securetoken.googleapis.com/v1/token?key=" + encodeURIComponent(apiKey), {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "grant_type=refresh_token&refresh_token=" + encodeURIComponent(auth.refreshToken),
        });
        idToken = b.id_token;
        tokenExp = now() + Number(b.expires_in || 3600) * 1000;
        if (b.refresh_token && b.refresh_token !== auth.refreshToken) {
          auth.refreshToken = b.refresh_token;
          saveAuth();
        }
        refreshed = true;
      } catch (e) {
        // Токен отозван/пользователь удалён — входим заново. Любая другая ошибка
        // (сеть, 5xx) НЕ должна плодить пользователей.
        if (e.status !== 400) throw e;
        auth = Object.assign({}, EMPTY_AUTH);
      }
      if (refreshed) {
        if (wantEmail && auth.mode !== "email" && now() >= nextLinkAt) await tryLink();
        return idToken;
      }
    }

    if (wantEmail) {
      await emailLogin();
      return idToken;
    }
    setSession(await idtCall("signUp", { returnSecureToken: true }), "anonymous");
    return idToken;
  }

  const docUrl = (p) => "https://firestore.googleapis.com/v1/projects/" + encodeURIComponent(projectId) + "/databases/(default)/documents/" + p;

  async function setDoc(docPath, data) {
    const token = await getToken();
    await http(docUrl(docPath), {
      method: "PATCH",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ fields: toFields(data) }),
    });
    st.writes++;
  }

  async function getDoc(docPath) {
    const token = await getToken();
    return http(docUrl(docPath), { method: "GET", headers: { Authorization: "Bearer " + token } });
  }

  async function deleteDoc(docPath) {
    const token = await getToken();
    await http(docUrl(docPath), { method: "DELETE", headers: { Authorization: "Bearer " + token } });
  }

  function fail(e) {
    st.lastError = e.message;
    st.hint = hintFor(e);
    backoffMs = backoffMs ? Math.min(backoffMs * 2, BACKOFF_MAX_MS) : BACKOFF_START_MS;
    nextTryAt = now() + backoffMs;
    const msg = e.message + (st.hint ? " — " + st.hint : "");
    if (msg !== lastLogged) { // одну и ту же ошибку в лог не спамим
      lastLogged = msg;
      log("не удалось сохранить: " + msg + " (повтор через " + Math.round(backoffMs / 1000) + " с)");
    }
  }

  /** Один проход: что накопилось — то и отправляем. Вызывается таймером, доступен для тестов. */
  async function tick() {
    if (busy || now() < nextTryAt) return;
    const needSnapshot = snapshot && snapshotSig !== lastSavedSig && now() - lastSnapshotAt >= SNAPSHOT_MIN_MS;
    const needHistory = (dirty.size > 0 || moneyDirty.size > 0) && now() - lastHistoryFlush >= HISTORY_FLUSH_MS;
    if (!needSnapshot && !needHistory) return;
    busy = true;
    try {
      await getToken();
      const uid = auth.uid;
      let wrote = false;
      if (needSnapshot) {
        const sig = snapshotSig;
        await setDoc("players/" + uid, Object.assign({}, snapshot, { updatedAt: new Date(now()) }));
        lastSavedSig = sig;
        lastSnapshotAt = now();
        wrote = true;
      }
      if (needHistory) {
        for (const key of Array.from(dirty)) {
          await setDoc("players/" + uid + "/history/" + key, { hour: key, updatedAt: new Date(now()), points: buckets.get(key) });
          dirty.delete(key);
        }
        for (const day of Array.from(moneyDirty)) {
          await setDoc("players/" + uid + "/money/" + day, { day, updatedAt: new Date(now()), points: moneyDocs.get(day) });
          moneyDirty.delete(day);
        }
        lastHistoryFlush = now();
        wrote = true;
      }
      if (wrote) {
        st.lastOkAt = now();
        if (st.lastError) log("снова работает");
      }
      st.lastError = null;
      st.hint = null;
      backoffMs = 0;
      lastLogged = "";
    } catch (e) {
      fail(e);
    } finally {
      busy = false;
    }
  }

  /** Новый снимок игрока; пишется не чаще раза в 30 с и только если изменилось. */
  function offerSnapshot(obj) {
    // earnings зависят от времени, а не от состояния: в подпись изменений не входят
    const { earnings, ...core } = obj;
    snapshot = obj;
    snapshotSig = JSON.stringify(core);
  }

  function bucketKey(t) { return new Date(t).toISOString().slice(0, 13); }

  function addPoint(p, markDirty) {
    const key = bucketKey(p.t);
    const list = buckets.get(key) || [];
    list.push(p);
    buckets.set(key, list);
    if (markDirty) dirty.add(key);
    const cutoff = now() - KEEP_BUCKET_MS;
    for (const k of Array.from(buckets.keys())) {
      if (Date.parse(k + ":59:59Z") < cutoff && !dirty.has(k)) buckets.delete(k);
    }
  }

  /** Точка истории капитала [t, capital, money, estimate]; уйдёт в документ часа. */
  function queuePoint(pt) {
    addPoint({ t: pt[0], capital: pt[1], money: pt[2], estimate: pt[3] }, true);
  }

  /** Уже записанные локально точки: нужны, чтобы после перезапуска не затереть документ часа неполным. */
  function seedPoints(points) {
    for (const pt of points) addPoint({ t: pt[0], capital: pt[1], money: pt[2], estimate: pt[3] }, false);
  }

  /**
   * Лента денег: points = [[t, баланс], ...] по возрастанию времени. Группируется по суткам (UTC);
   * в облако уходят только последние двое суток и только если документ суток изменился.
   */
  function offerMoney(points) {
    const byDay = new Map();
    let prev = null;
    for (const [t, balance] of points) {
      const day = new Date(t).toISOString().slice(0, 10);
      const list = byDay.get(day) || [];
      list.push({ t, balance, delta: prev == null ? null : balance - prev });
      byDay.set(day, list);
      prev = balance;
    }
    for (const day of Array.from(byDay.keys()).sort().slice(-2)) {
      const list = byDay.get(day).slice(-MAX_MONEY_POINTS_PER_DAY);
      const sig = JSON.stringify(list);
      if (moneySig.get(day) !== sig) {
        moneySig.set(day, sig);
        moneyDocs.set(day, list);
        moneyDirty.add(day);
      }
    }
  }

  function start() {
    const timer = setInterval(() => { tick(); }, TICK_MS);
    if (timer.unref) timer.unref();
    return timer;
  }

  function status() {
    return {
      enabled: true,
      projectId,
      uid: st.uid,
      mode: st.mode,
      email: st.email,
      authWarning: st.authWarning,
      lastOkAt: st.lastOkAt ? new Date(st.lastOkAt).toISOString() : null,
      lastError: st.lastError,
      hint: st.hint,
      writes: st.writes,
    };
  }

  return { offerSnapshot, queuePoint, seedPoints, offerMoney, tick, start, status, setDoc, getDoc, deleteDoc, getToken };
}

module.exports = { createFirebase, toValue, toFields, hintFor };
