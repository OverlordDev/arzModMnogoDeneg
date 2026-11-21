"use strict";
/* ARZ Terminal — игровые средние цены Центрального рынка.
 *
 * Источник — окно «Средняя цена товаров при продаже» (цены за последние 30 дней),
 * которое экспортёр (arz_export.lua) пишет в arz_market_dialogs.log. Это официальные
 * цифры самой игры; открыть окно и листать страницы («Следующая страница») должен игрок —
 * скрипт только читает то, что уже показано, и сам ничего не нажимает.
 *
 * Формат блока в логе:
 *   [2026-11-18 16:31:03] DIALOG id=15073 style=5 title={BFBBBA}Средняя цена товаров при продаже
 *   {ffff00}Предмет<TAB>{ffff00}За последние 30 дней
 *   {cccccc}Поиск по названию<TAB>
 *   Case Capture<TAB>:CASH:11.877.792
 *   -----
 * Валюта в строке: ":CASH:" = SA$ (Yuma и остальные обычные), ":CASHV:" = VC$.
 *
 * Второе окно — история одного предмета (открывается выбором строки в списке):
 *   title={BFBBBA}Продажа товара 'Case Capture' за последние 30 дней
 *   {ffff00}Дата<TAB>{ffff00}Количество продаж<TAB>{ffff00}Средняя цена за день
 *   2026-11-18<TAB>81<TAB>:CASH:14.787.942
 * — по дням: сколько продано и по какой средней цене. Из неё берём «текущую» цену
 * (за 7 дней, с весом по числу продаж) и ликвидность (сколько продаж в неделю).
 *
 * Честно: «средняя цена» в игре — именно СРЕДНЯЯ, её перекашивают единичные странные сделки
 * (у «Опыта депозита» обычно ~350 тыс., но в отдельные дни «средняя» 1–14 млн; из-за этого
 * 30-дневное среднее из списка у дров/хлопка/талонов/монет расходилось с ArzMarket в десятки
 * раз). По МЕДИАНЕ дневных цен из истории предмета игра и ArzMarket сходятся (медиана
 * отношения ~0,9). Поэтому текущая цена = медиана за 7 дней, а список (среднее) — запасной вариант;
 * valueInventory использует игровую цену как сверку и запасной вариант, а не подменяет ею рынок.
 */

const CONTROL_ROWS = ["поиск по названию", "предыдущая страница", "следующая страница", "предмет"];

function stripColors(s) {
  return String(s).replace(/\{[0-9a-fA-F]{6}\}/g, "").trim();
}

/** ":CASH:11.877.792" -> { cur: "sa", price: 11877792 } */
function parsePrice(cell) {
  const m = /:CASH(V?):\s*([\d.\s]+)/.exec(String(cell));
  if (!m) return null;
  const price = Number(m[2].replace(/[.\s]/g, ""));
  if (!Number.isFinite(price) || price <= 0) return null;
  return { cur: m[1] ? "vc" : "sa", price };
}

function kindOf(title) {
  const t = stripColors(title).toLowerCase();
  if (!t.includes("средняя цена товаров")) return null;
  if (t.includes("при продаже")) return "sale";
  if (t.includes("при покупке")) return "buy";
  return null;
}

/**
 * "{BFBBBA}Продажа товара 'Case Capture' за последние 30 дней" -> { kind:"sale", name, truncated:false }.
 * Сервер режет длинный заголовок: сперва пропадает хвост («... за последние»), у совсем
 * длинных названий — и часть имени без закрывающей кавычки: тогда truncated:true и name — только начало.
 */
function parseHistoryTitle(title) {
  const t = stripColors(title);
  const head = /^(Продажа|Покупка) товара '(.*)$/.exec(t);
  if (!head) return null;
  const kind = head[1] === "Продажа" ? "sale" : "buy";
  // Имя кончается на кавычке, после которой идёт начало (возможно, обрезанное где угодно) стандартного хвоста.
  const TAIL = " за последние 30 дней";
  const rest = head[2];
  for (let q = rest.indexOf("'"); q >= 0; q = rest.indexOf("'", q + 1)) {
    if (TAIL.startsWith(rest.slice(q + 1)) && rest.slice(0, q).trim()) {
      return { kind, name: rest.slice(0, q).trim(), truncated: false };
    }
  }
  return rest.trim() ? { kind, name: rest.trim(), truncated: true } : null;
}

/** Строки вида "2026-11-18<TAB>81<TAB>:CASH:14.787.942" -> { cur, days:[{date,count,price}] } (новые сверху, как в окне) */
function parseHistoryRows(body) {
  const days = [];
  let cur = null;
  for (const line of String(body).split(/\r?\n/)) {
    const c = line.split("\t");
    if (c.length < 3) continue;
    const date = stripColors(c[0]);
    if (!/^\d{4}-\d\d-\d\d$/.test(date)) continue;
    const count = Number(stripColors(c[1]).replace(/[.\s]/g, ""));
    const p = parsePrice(c[2]);
    if (!p || !Number.isFinite(count)) continue;
    cur = cur || p.cur;
    if (p.cur !== cur) continue;
    days.push({ date, count, price: p.price });
  }
  return { cur, days };
}

/**
 * Сводка по дням: avg7 — средняя цена за 7 последних дней (с весом по числу продаж),
 * avg30 — за все дни окна, vol7 — продаж за 7 дней, last — цена последнего дня,
 * trendPct — на сколько avg7 выше/ниже avg30 (%).
 */
function summarizeHistory(days) {
  if (!days || !days.length) return null;
  const sorted = days.slice().sort((a, b) => (a.date < b.date ? 1 : -1)); // новые первыми
  const wavg = (arr) => {
    let n = 0, sum = 0;
    for (const d of arr) { n += d.count; sum += d.count * d.price; }
    if (n > 0) return { avg: sum / n, vol: n };
    const plain = arr.reduce((a, d) => a + d.price, 0) / arr.length; // продаж 0 — просто среднее цен
    return { avg: plain, vol: 0 };
  };
  // Дневная средняя цена в игре — именно СРЕДНЯЯ: одна странная сделка (14 млн вместо 340 тыс.) перекашивает день
  // и всё 30-дневное среднее. Поэтому для «текущей цены» и тренда берём МЕДИАНУ дневных цен.
  const med = (arr) => {
    const v = arr.map((d) => d.price).sort((x, y) => x - y);
    const n = v.length;
    return n % 2 ? v[(n - 1) / 2] : Math.round((v[n / 2 - 1] + v[n / 2]) / 2);
  };
  const w7 = wavg(sorted.slice(0, 7));
  const w30 = wavg(sorted);
  const med7 = med(sorted.slice(0, 7));
  const med30 = med(sorted);
  return {
    last: sorted[0].price, lastDate: sorted[0].date,
    avg7: Math.round(w7.avg), vol7: w7.vol, avg30: Math.round(w30.avg), vol30: w30.vol,
    med7, med30,
    trendPct: med30 > 0 ? Math.round((med7 / med30 - 1) * 1000) / 10 : null,   // по медианам, а не по средним
    days: sorted.length,
  };
}

/** "2026-11-18 16:31:03" (локальное время ПК) -> мс */
function tsMs(s) {
  const m = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)$/.exec(s || "");
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
}

/**
 * Разбор всего лога. Более поздние страницы перекрывают более ранние (по порядку в файле).
 * Возвращает { sale: {sa:{ключ:{name,price,at}}, vc:{}}, buy: {...}, dialogs, rows, updatedAt }.
 * Ключ — название в нижнем регистре.
 */
function parseGamePrices(text) {
  const out = {
    sale: { sa: {}, vc: {} }, buy: { sa: {}, vc: {} },
    history: { sale: { sa: {}, vc: {} }, buy: { sa: {}, vc: {} } },   // по предметам, по дням
    // «За последние 30 дней не найдено ни одной операции с этим товаром»: предмет не продавался (ключ -> когда видели)
    noSales: { sale: {}, buy: {} },
    dialogs: 0, rows: 0, historyItems: 0, updatedAt: null,
  };
  if (!text) return out;
  const pending = [];
  function storeHistory(kind, cur, name, days, at) {
    const key = name.toLowerCase();
    if (!out.history[kind][cur][key]) out.historyItems++;
    out.history[kind][cur][key] = { name, days, summary: summarizeHistory(days), at };
    delete out.noSales[kind][key];              // продажи появились — «нет продаж» устарело
    if (at && (!out.updatedAt || at > out.updatedAt)) out.updatedAt = at;
  }
  function storeNoSales(kind, name, at) {
    const key = name.toLowerCase();
    for (const cur of ["sa", "vc"]) {            // более поздний «нет продаж» перекрывает прежнюю историю
      if (out.history[kind][cur][key]) { delete out.history[kind][cur][key]; out.historyItems--; }
    }
    out.noSales[kind][key] = at;
    if (at && (!out.updatedAt || at > out.updatedAt)) out.updatedAt = at;
  }
  for (const block of String(text).split(/\r?\n-----\r?\n/)) {
    const nl = block.indexOf("\n");
    if (nl < 0) continue;
    const head = /^\[([^\]]+)\] DIALOG .*?title=(.*)$/.exec(block.slice(0, nl).replace(/\r$/, ""));
    if (!head) continue;
    const at = tsMs(head[1]);
    // лог разведчика дописывает к заголовку " b1=... b2=..." — отрезаем
    const title = head[2].replace(/\s+b1=.*$/, "");
    const ht = parseHistoryTitle(title);
    if (ht) {                                   // история одного предмета
      const body = block.slice(nl + 1);
      const h = parseHistoryRows(body);
      const empty = !h.days.length && /не найдено ни одной операции/.test(body);
      if ((h.cur && h.days.length) || empty) {
        if (ht.truncated) pending.push({ ht, h, at, empty });      // имя обрезано сервером — достроим по списку ниже
        else if (empty) storeNoSales(ht.kind, ht.name, at);
        else storeHistory(ht.kind, h.cur, ht.name, h.days, at);
      }
      continue;
    }
    const kind = kindOf(title);
    if (!kind) continue;
    let got = 0;
    for (const line of block.slice(nl + 1).split(/\r?\n/)) {
      const tab = line.indexOf("\t");
      if (tab < 0) continue;
      const name = stripColors(line.slice(0, tab));
      if (!name || CONTROL_ROWS.includes(name.toLowerCase())) continue;
      const p = parsePrice(line.slice(tab + 1));
      if (!p) continue;
      out[kind][p.cur][name.toLowerCase()] = { name, price: p.price, at };
      got++;
    }
    if (got) {
      out.dialogs++;
      out.rows += got;
      if (at && (!out.updatedAt || at > out.updatedAt)) out.updatedAt = at;
    }
  }
  // Обрезанные заголовки: полное имя ищем среди предметов списка по началу, берём только однозначное совпадение.
  out.unresolvedHistories = 0;
  for (const p of pending) {
    const start = p.ht.name.toLowerCase();
    const pool = p.empty ? Object.assign({}, out.sale.sa, out.sale.vc) : out.sale[p.h.cur];
    const hits = Object.keys(pool).filter((k) => k.startsWith(start));
    if (hits.length !== 1) { out.unresolvedHistories++; continue; }
    if (p.empty) storeNoSales(p.ht.kind, pool[hits[0]].name, p.at);
    else storeHistory(p.ht.kind, p.h.cur, pool[hits[0]].name, p.h.days, p.at);
  }
  out.noSalesItems = Object.keys(out.noSales.sale).length;
  return out;
}

module.exports = { parseGamePrices, parsePrice, kindOf, stripColors, parseHistoryTitle, parseHistoryRows, summarizeHistory };

if (require.main === module) {
  const fs = require("fs");
  const f = process.argv[2];
  if (!f) { console.error("usage: node game/arz_gameprices.js <arz_market_dialogs.log>"); process.exit(1); }
  const r = parseGamePrices(fs.readFileSync(f, "utf8"));
  console.log("диалогов:", r.dialogs, "строк:", r.rows, "SA$ продажа:", Object.keys(r.sale.sa).length, "историй предметов:", r.historyItems);
}
