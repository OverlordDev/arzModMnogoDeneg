/* ARZ Terminal — клиент облака для сайта на телефоне (режим «приложение»).
 *
 * Локальный сайт (localhost) берёт данные игрока у server.js. На телефоне сервера нет, поэтому ПК кладёт
 * точную копию ответа /api/player в Firestore (players/{uid}/web/latest), а этот клиент её читает и отдаёт
 * player.js в том же виде — вся отрисовка остаётся прежней.
 *
 * Вход — по e-mail/паролю (тот же аккаунт, под которым пишет ПК: см. deploy/FIREBASE.md). Пароль НЕ хранится:
 * после входа в localStorage лежит только refresh-токен. Конфиг (apiKey, projectId, e-mail) приходит один раз
 * ссылкой вида  https://сайт/#phone=<base64url(JSON)>  и сразу убирается из адресной строки. apiKey веб-приложения
 * Firebase не секрет (так устроены все веб-клиенты Firebase), данные защищает правило Firestore — только владелец.
 *
 * Без зависимостей. Фабрика createCloudClient принимает fetch/storage/location/now — поэтому тестируется в Node.
 */
(function (root) {
  "use strict";

  var LS_KEY = "arz.cloud.v1";
  var TOKEN_MARGIN_MS = 60 * 1000;

  function b64urlDecode(s) {
    s = String(s).replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    var bin = typeof atob === "function" ? atob(s) : Buffer.from(s, "base64").toString("binary");
    // UTF-8 -> строка
    try { return decodeURIComponent(bin.split("").map(function (c) { return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2); }).join("")); }
    catch (_) { return bin; }
  }

  /** Значение Firestore REST -> обычное значение JS. */
  function decodeValue(v) {
    if (v == null) return null;
    if ("stringValue" in v) return v.stringValue;
    if ("integerValue" in v) return Number(v.integerValue);
    if ("doubleValue" in v) return v.doubleValue;
    if ("booleanValue" in v) return v.booleanValue;
    if ("timestampValue" in v) return v.timestampValue;
    if ("nullValue" in v) return null;
    if ("arrayValue" in v) return (v.arrayValue.values || []).map(decodeValue);
    if ("mapValue" in v) return decodeFields(v.mapValue.fields || {});
    return null;
  }
  function decodeFields(fields) {
    var o = {};
    Object.keys(fields || {}).forEach(function (k) { o[k] = decodeValue(fields[k]); });
    return o;
  }

  /** Понятное объяснение ошибок Google для экрана входа. */
  function explain(e) {
    // и код Google, и текст ошибки: «HTTP 404» бывает только в тексте
    var c = String(((e && e.code) || "") + " " + ((e && e.message) || ""));
    if (/INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND/.test(c)) return "Неверный e-mail или пароль (аккаунт создаёт ПК при первом сохранении в облако — проверь, что e-mail и пароль в local/firebase.json те же).";
    if (/TOO_MANY_ATTEMPTS/.test(c)) return "Слишком много попыток входа — подожди несколько минут.";
    if (/OPERATION_NOT_ALLOWED/.test(c)) return "В Firebase не включён вход по e-mail/паролю: Authentication → Sign-in method → Email/Password → Enable.";
    if (/PERMISSION_DENIED|Missing or insufficient/.test(c)) return "Нет доступа к данным: проверь правила Firestore (deploy/firestore.rules) — читать можно только под тем же аккаунтом, что пишет ПК.";
    if (/HTTP 404|NOT_FOUND/.test(c)) return "Данных в облаке ещё нет: запусти терминал на ПК и зайди в игру — первая запись появляется через ~30 секунд.";
    if (/Failed to fetch|NetworkError|network/i.test(c)) return "Нет связи с Google (Firebase). Проверь интернет.";
    return c || "Неизвестная ошибка";
  }

  function createCloudClient(opts) {
    var doFetch = opts.fetch;
    var storage = opts.storage || null;
    var loc = opts.location || null;
    var hist = opts.history || null;
    var now = opts.now || Date.now;
    var cfg = null;   // { apiKey, projectId, email }
    var sess = null;  // { uid, refreshToken, idToken, exp }

    function load() {
      try {
        var raw = storage && storage.getItem(LS_KEY);
        var o = raw ? JSON.parse(raw) : null;
        if (o && o.cfg && o.cfg.apiKey && o.cfg.projectId) { cfg = o.cfg; sess = o.sess || null; }
      } catch (_) { /* нет/битое хранилище — начнём с чистого листа */ }
    }
    function save() {
      try { if (storage) storage.setItem(LS_KEY, JSON.stringify({ cfg: cfg, sess: sess && { uid: sess.uid, refreshToken: sess.refreshToken } })); } catch (_) {}
    }

    /** #phone=... в адресе -> сохранить конфиг и убрать хеш. Возвращает true, если конфиг принят. */
    function consumeHash() {
      var h = loc && loc.hash || "";
      var m = /[#&]phone=([^&]+)/.exec(h);
      if (!m) return false;
      try {
        var o = JSON.parse(b64urlDecode(m[1]));
        if (!o.apiKey || !o.projectId) return false;
        var changed = !cfg || cfg.projectId !== o.projectId || cfg.email !== o.email;
        cfg = { apiKey: String(o.apiKey), projectId: String(o.projectId), email: o.email ? String(o.email) : "" };
        if (changed) sess = null;
        save();
        try { if (hist && hist.replaceState) hist.replaceState(null, "", loc.pathname + (loc.search || "")); } catch (_) {}
        return true;
      } catch (_) { return false; }
    }

    async function http(url, init) {
      var res = await doFetch(url, init);
      var body = null;
      try { body = await res.json(); } catch (_) {}
      if (!res.ok) {
        var err = new Error("HTTP " + res.status + (body && body.error && body.error.message ? ": " + body.error.message : ""));
        err.status = res.status;
        err.code = body && body.error && (body.error.message || body.error.status);
        throw err;
      }
      return body;
    }

    async function signIn(password) {
      if (!cfg) throw new Error("Сначала подключи телефон ссылкой с ПК");
      var b = await http("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + encodeURIComponent(cfg.apiKey), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: cfg.email, password: password, returnSecureToken: true }),
      });
      sess = { uid: b.localId, refreshToken: b.refreshToken, idToken: b.idToken, exp: now() + Number(b.expiresIn || 3600) * 1000 };
      save();
      return sess.uid;
    }

    async function token() {
      if (!sess) throw Object.assign(new Error("NOT_SIGNED_IN"), { code: "NOT_SIGNED_IN" });
      if (sess.idToken && now() < sess.exp - TOKEN_MARGIN_MS) return sess.idToken;
      try {
        var b = await http("https://securetoken.googleapis.com/v1/token?key=" + encodeURIComponent(cfg.apiKey), {
          method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "grant_type=refresh_token&refresh_token=" + encodeURIComponent(sess.refreshToken),
        });
        sess.idToken = b.id_token;
        sess.exp = now() + Number(b.expires_in || 3600) * 1000;
        if (b.refresh_token) sess.refreshToken = b.refresh_token;
        save();
        return sess.idToken;
      } catch (e) {
        if (e.status === 400) { sess = null; save(); e.code = "NOT_SIGNED_IN"; } // токен отозван — войти заново
        throw e;
      }
    }

    async function getDoc(rel) {
      var t = await token();
      var url = "https://firestore.googleapis.com/v1/projects/" + encodeURIComponent(cfg.projectId) +
        "/databases/(default)/documents/players/" + encodeURIComponent(sess.uid) + "/" + rel;
      var d = await http(url, { method: "GET", headers: { Authorization: "Bearer " + t } });
      return decodeFields(d.fields || {});
    }

    /** Тело ответа /api/player, собранное из зеркала web/latest (+ свежий «возраст» на момент чтения). */
    async function fetchBody() {
      var doc = await getDoc("web/latest");
      if (!doc.payloadJson) throw new Error("HTTP 404: в зеркале нет данных");
      var body = JSON.parse(doc.payloadJson);
      var t = now();
      body.ageSec = Math.round((t - Date.parse(body.fileUpdated)) / 1000);
      body.parsedAgoSec = doc.updatedAt ? Math.round((t - Date.parse(doc.updatedAt)) / 1000) : null;
      body.cloud = { enabled: true, mirror: true, projectId: cfg.projectId, updatedAt: doc.updatedAt || null, generatedAt: doc.generatedAt || null };
      return body;
    }

    function signOut() { sess = null; save(); }
    function forget() { cfg = null; sess = null; try { if (storage) storage.removeItem(LS_KEY); } catch (_) {} }

    load();
    return {
      consumeHash: consumeHash, signIn: signIn, signOut: signOut, forget: forget, fetchBody: fetchBody, getDoc: getDoc,
      configured: function () { return !!(cfg && cfg.apiKey && cfg.projectId); },
      signedIn: function () { return !!sess; },
      email: function () { return cfg ? cfg.email : ""; },
      projectId: function () { return cfg ? cfg.projectId : ""; },
    };
  }

  /** Ссылка для телефона: адрес сайта + #phone=<base64url(JSON конфига)> (собирает локальный сайт). */
  function phoneLink(siteUrl, cfg) {
    var json = JSON.stringify({ apiKey: cfg.apiKey, projectId: cfg.projectId, email: cfg.email || "" });
    var b64 = typeof btoa === "function"
      ? btoa(unescape(encodeURIComponent(json)))
      : Buffer.from(json, "utf8").toString("base64");
    b64 = b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return String(siteUrl).replace(/[#?].*$/, "").replace(/\/+$/, "") + "/#phone=" + b64;
  }

  var api = { createCloudClient: createCloudClient, decodeValue: decodeValue, decodeFields: decodeFields, explain: explain, phoneLink: phoneLink, b64urlDecode: b64urlDecode };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.ARZ = root.ARZ || {}; root.ARZ.cloudclient = api; }
})(typeof window !== "undefined" ? window : globalThis);
