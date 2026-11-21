/* ARZ Terminal — регистрация service worker (режим «приложение»). Работает только по HTTPS и на localhost. */
(function () {
  "use strict";
  if (!("serviceWorker" in navigator)) return;
  var h = location.hostname;
  var ok = location.protocol === "https:" || h === "localhost" || h === "127.0.0.1" || h === "[::1]";
  if (!ok) return;
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("sw.js").catch(function () { /* без офлайна сайт работает как раньше */ });
  });
})();
