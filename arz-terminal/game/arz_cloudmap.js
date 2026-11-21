"use strict";
/* ARZ Terminal — что именно и в каком виде уходит в облако (Firestore).
 *
 * Чистые функции без сети и файлов: их собирает server.js и отдаёт game/arz_firebase.js (offerDoc).
 * Раскладка под players/{uid}/ — см. deploy/FIREBASE.md:
 *   web/latest         — точная копия ответа /api/player одной JSON-строкой: сайт на телефоне читает её тем же
 *                        кодом отрисовки, что и локальный сайт;
 *   gameprices/<cur>-N — каталог игровых цен Центрального рынка (все предметы списка, история по дням);
 *   gameprices/_meta   — сводка каталога;
 *   bank/<ГГГГ-ММ-ДД>  — снимки депозита/счёта за сутки (UTC) — для графиков в приложении.
 * Документ Firestore ограничен 1 МиБ, массивы массивов запрещены — поэтому строки и массивы карт.
 */

const MAX_JSON = 900 * 1000; // запас до лимита 1 МиБ на документ

/** Зеркало ответа /api/player: { data, sig }. sig не включает «плавающие» поля (возраст, заработок по часам). */
function mirrorOf(body, nowMs) {
  const copy = Object.assign({}, body);
  delete copy.cloud; // статус облака относится к ПК, на телефоне он свой
  let json = JSON.stringify(copy);
  if (json.length > MAX_JSON && Array.isArray(copy.history)) {
    copy.history = copy.history.slice(-100); // главное — не потерять сам документ
    json = JSON.stringify(copy);
  }
  const sig = JSON.stringify([
    body.fileUpdated, body.summary, body.valuation, body.tips, body.bank, body.netWorth, body.gamePrices,
    body.payday && body.payday.last,      // sinceLastSec меняется каждую секунду — в подпись не берём
    (body.history || []).slice(-1),
  ]);
  return { data: { schema: 1, generatedAt: new Date(nowMs).toISOString(), payloadJson: json }, sig };
}

/** Банк для структурированного снимка: даты -> Date, остальное как есть (карты и числа). */
function bankForCloud(bank) {
  if (!bank) return null;
  const dep = bank.deposit;
  return {
    total: Math.round(bank.total),
    accountsAt: bank.accountsAt ? new Date(bank.accountsAt) : null,
    accounts: (bank.accounts || []).map((a) => ({ id: a.id, money: a.money, withdrawPct: a.withdrawPct })),
    deposit: dep ? Object.assign({}, dep, { at: dep.at ? new Date(dep.at) : null }) : null,
  };
}

const daysString = (days) => days.map((d) => d.date + ":" + d.count + ":" + d.price).join("|");

/**
 * Каталог игровых цен: все предметы списка «Средняя цена товаров» (+ те, у кого есть только история).
 * Предмет: n — название, p — цена из общего списка (среднее за 30 дней, искажается выбросами),
 * m7/m30 — медианы дневных цен, v7/v30 — число продаж, t — тренд %, d — «дата:продаж:цена|…» (новые первыми),
 * z:1 — за 30 дней не было ни одной сделки.
 * Возвращает { docs:[{rel,data}], meta } — по chunkSize предметов в документе.
 */
function catalogDocs(gp, chunkSize) {
  chunkSize = chunkSize || 120;
  const docs = [];
  const meta = { items: 0, chunks: {}, historyItems: gp ? gp.historyItems : 0, noSalesItems: gp ? gp.noSalesItems : 0 };
  if (!gp) return { docs, meta };
  for (const cur of ["sa", "vc"]) {
    const list = gp.sale[cur] || {};
    const hist = gp.history.sale[cur] || {};
    const keys = Object.keys(list);
    for (const k of Object.keys(hist)) if (!list[k]) keys.push(k);          // история есть, а в списке не видели
    for (const k of Object.keys(gp.noSales.sale)) if (!list[k] && !hist[k] && cur === "sa") keys.push(k);
    if (!keys.length) continue;
    const items = keys.map((k) => {
      const l = list[k], h = hist[k], s = h && h.summary;
      const it = { n: (l && l.name) || (h && h.name) || k };
      if (l) it.p = l.price;
      if (s) Object.assign(it, { m7: s.med7, m30: s.med30, v7: s.vol7, v30: s.vol30, t: s.trendPct, d: daysString(h.days) });
      if (gp.noSales.sale[k] && !h) it.z = 1;
      return it;
    });
    const of = Math.ceil(items.length / chunkSize);
    for (let i = 0; i < of; i++) {
      docs.push({ rel: "gameprices/" + cur + "-" + i, data: { cur, chunk: i, of, items: items.slice(i * chunkSize, (i + 1) * chunkSize) } });
    }
    meta.items += items.length;
    meta.chunks[cur] = of;
  }
  docs.push({
    rel: "gameprices/_meta",
    data: { items: meta.items, chunkSize, chunks: meta.chunks, historyItems: meta.historyItems, noSalesItems: meta.noSalesItems,
            gameUpdatedAt: gp.updatedAt ? new Date(gp.updatedAt) : null },
  });
  return { docs, meta };
}

/** Точка банка для истории: null, пока игрок не открывал окно банка. */
function bankPoint(bank) {
  const d = bank && bank.deposit;
  if (!d || !d.at) return null;
  return {
    t: Date.parse(d.at),
    deposit: d.money, limit: d.limit, income: d.incomePerPayday, level: d.level,
    idle: d.analysis ? d.analysis.idle : null,
    account: (bank.accounts || []).reduce((a, x) => a + x.money, 0),
  };
}

const samePoint = (a, b) => !!a && !!b && ["deposit", "limit", "income", "level", "account"].every((k) => a[k] === b[k]);

/** Точки по суткам (UTC): { "2026-11-18": [точки] } — для документов bank/<день>. */
function bankDays(points, lastDays) {
  const by = {};
  for (const p of points) {
    const day = new Date(p.t).toISOString().slice(0, 10);
    (by[day] = by[day] || []).push(p);
  }
  const keep = Object.keys(by).sort().slice(-(lastDays || 2));
  const out = {};
  for (const k of keep) out[k] = by[k];
  return out;
}

module.exports = { mirrorOf, bankForCloud, catalogDocs, bankPoint, samePoint, bankDays, daysString };
