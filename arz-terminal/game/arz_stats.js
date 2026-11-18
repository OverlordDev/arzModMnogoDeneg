"use strict";
/* ARZ Terminal — заработок в час по событиям денег из игры.
 *
 * Вход: события из game/arz_parser.js (parseLog). Деньги приходят как
 * event.player.updateMoney [N] — АБСОЛЮТНЫЙ баланс. Заработок = разница
 * между соседними значениями:
 *   приход  — положительные разницы (зарплата, продажи, переводы, подарки…),
 *   расход  — отрицательные (покупки, налоги, аренда, переводы другим),
 *   чистыми — приход + расход.
 * «Приход» — это любые поступления, а не только доход от работы: честно
 * отделить работу от продажи предмета по одним событиям денег нельзя.
 *
 * Сессия = непрерывный отрезок активности игры (между любыми событиями
 * не больше SESSION_GAP_MS). Первое значение денег в сессии — точка отсчёта,
 * разницы считаются со второго.
 *
 * Время: новые строки лога несут дату ([YYYY-MM-DD hh:mm:ss]); старые — только
 * время суток, их дата восстанавливается от более позднего события назад
 * (в конце — по времени изменения файла).
 */

const SESSION_GAP_MS = 15 * 60 * 1000;
const MIN_ELAPSED_MS = 3 * 60 * 1000; // меньше — «в час» не считаем, слишком шумно
const DAY_MS = 86400000;

function parseTod(ts) {
  const m = /^(\d\d):(\d\d):(\d\d)$/.exec(ts || "");
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null;
}

function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Проставляет каждому событию epoch-время (мс). Идём с конца к началу. */
function assignTimes(events, anchorMs) {
  const out = new Array(events.length);
  let ref = anchorMs;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    const tod = parseTod(e.ts);
    let t = null;
    if (e.date && tod != null) {
      const [y, mo, d] = e.date.split("-").map(Number);
      t = new Date(y, mo - 1, d).getTime() + tod * 1000;
    } else if (tod != null) {
      t = startOfDay(ref) + tod * 1000;
      if (t > ref) t -= DAY_MS; // не может быть позже следующего за ним события
    }
    if (t == null) t = ref;
    out[i] = { name: e.name, args: e.args, t };
    ref = t;
  }
  return out;
}

/** Лёгкая «шкала времени» для кэша: время всех событий + ряд денег. */
function timeline(events, anchorMs) {
  const timed = assignTimes(events, anchorMs);
  const times = [];
  const money = [];
  let last = null;
  for (const e of timed) {
    times.push(e.t);
    if (e.name === "event.player.updateMoney") {
      const m = Number(e.args && e.args[0]);
      if (Number.isFinite(m) && m !== last) {
        money.push([e.t, m]);
        last = m;
      }
    }
  }
  return { times, money };
}

const iso = (ms) => new Date(ms).toISOString();

/** Приход/расход по окнам. now — «сейчас» (мс). */
function earnings(tl, now) {
  const times = tl && tl.times;
  if (!times || !times.length) return null;
  const lastEventAt = times[times.length - 1];

  let idx = times.length - 1;
  while (idx > 0 && times[idx] - times[idx - 1] <= SESSION_GAP_MS) idx--;
  const sessionStart = times[idx];

  const active = now - lastEventAt <= SESSION_GAP_MS;
  const end = active ? now : lastEventAt;

  const deltas = [];
  let prev = null;
  for (const [t, m] of tl.money) {
    if (t < sessionStart) continue;
    if (prev !== null) deltas.push({ t, d: m - prev });
    prev = m;
  }

  function win(ms) {
    const ws = ms == null ? sessionStart : Math.max(end - ms, sessionStart);
    const elapsed = end - ws;
    let income = 0;
    let spend = 0;
    let maxIncome = 0;
    for (const x of deltas) {
      if (x.t < ws || x.t > end) continue;
      if (x.d > 0) { income += x.d; if (x.d > maxIncome) maxIncome = x.d; } else spend += x.d;
    }
    const ok = elapsed >= MIN_ELAPSED_MS;
    const hours = elapsed / 3600000;
    return {
      income, spend, net: income + spend,
      // одно крупное поступление (продажа, подарок) делает «$/ч» ставкой заработка только на вид
      maxIncome,
      oneOff: income > 0 && maxIncome / income > 0.6 && deltas.length > 1,
      elapsedSec: Math.round(elapsed / 1000),
      incomePerHour: ok ? Math.round(income / hours) : null,
      netPerHour: ok ? Math.round((income + spend) / hours) : null,
    };
  }

  return {
    active,
    sessionStart: iso(sessionStart),
    lastEventAt: iso(lastEventAt),
    samples: deltas.length,
    windows: { m15: win(15 * 60 * 1000), h1: win(60 * 60 * 1000), session: win(null) },
    recent: deltas.slice(-8).reverse().map((x) => ({ at: iso(x.t), delta: x.d })),
  };
}

module.exports = { assignTimes, timeline, earnings, SESSION_GAP_MS, MIN_ELAPSED_MS };
