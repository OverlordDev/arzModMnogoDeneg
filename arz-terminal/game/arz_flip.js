"use strict";
/* ARZ Terminal — «Скуп»: что выставить на скупку в лавке, чтобы перепродать с прибылью.
 *
 * Идея: ставишь заявку на скупку по цене чуть выше текущей скупки лавок (иначе она не первая в очереди),
 * потом продаёшь товар по цене рынка. Прибыль с штуки = цена продажи × (1 − комиссия) − цена скупки.
 *
 * Источники (только чтение, ничего не пишем в игру):
 *   • ArzMarket (data/market_<server>.json): buy — цена скупки лавок, sell — цена продажи лавок, dealsBuy/dealsSell —
 *     число сделок за окно (это и есть «сколько штук реально проходит» на каждой стороне), history — дневные цены.
 *   • Игровые цены ЦР (game/arz_gameprices.js): медиана дневных цен за 7 дней — реальная цена сделок СЕГОДНЯ.
 *     Цена продажи по ArzMarket бывает сильно выше реальной (лавки выставляют «с запасом»), поэтому берём МЕНЬШУЮ из двух.
 *
 * Честные границы расчёта: мы не видим заявки скупки конкурентов в реальном времени — только то, что было в сделках.
 * Доля рынка, которую удастся забрать, — допущение (по умолчанию 10% оборота); цены ArzMarket могут быть старше на пару дней.
 */

const DEFAULTS = {
  budget: 26e6,        // сколько денег пустить на скуп
  comm: 0.02,          // комиссия ЦР при продаже: 2% с ADD VIP (проверено: кейс 12CILINDRI 39 000 000 -> получено 38 220 000)
  minRoi: 0.08,        // не показывать связки с чистой прибылью меньше 8% на вложенные
  outbid: 0.01,        // на сколько перебить текущую цену скупки, чтобы встать первым (1%)
  share: 0.25,         // не больше 25% бюджета в один предмет
  capture: 0.10,       // какую долю дневного оборота реально забираем
  holdDays: 3,         // сколько дней товар готовы держать (ограничивает размер лота)
  minDeals: 3,         // минимум сделок в сутки на каждой стороне (скупка и продажа)
  maxRoi: 0.60,        // выше — цифры нереальны (мусорные заявки в скупке, кривая цена): такие связки отбрасываем
  minBid: 100,         // предметы дешевле 100$ — шум заявок
  minGameVol7: 20,     // в игре за неделю должно пройти хотя бы столько сделок (иначе предмет «мёртвый»)
  maxStaleDays: 7,     // цены ArzMarket старше — предупреждаем
};

const median = (arr, allowZero) => {
  const v = arr.filter((x) => Number.isFinite(x) && (allowZero ? x >= 0 : x > 0)).sort((a, b) => a - b);
  if (!v.length) return null;
  const n = v.length;
  return n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
};

/** Разброс цены: медианное отклонение от медианы / медиана (0.1 = цена гуляет на ±10%). */
function dispersion(prices) {
  const m = median(prices);
  if (!m) return null;
  const dev = median(prices.map((p) => Math.abs(p - m)), true);   // нули (цена не менялась) — это не «нет данных»
  return dev == null ? null : dev / m;
}

const daysBetween = (a, b) => Math.max(0, Math.round((b - a) / 86400000));

/**
 * market — разобранный data/market_<server>.json, gp — результат parseGamePrices (может быть null).
 * Возвращает { ok, assumptions, items[], portfolio, categories, ... }. items отсортированы по ожидаемой прибыли в сутки.
 */
function scanFlips(market, gp, options, now) {
  const o = Object.assign({}, DEFAULTS, options || {});
  const t = now == null ? Date.now() : now;
  if (!market || !Array.isArray(market.items)) return { ok: false, error: "нет данных ArzMarket (data/market_<server>.json)" };
  const windowDays = Number(market.window_days) > 0 ? Number(market.window_days) : 14;
  const dataDate = market.data_date_max ? Date.parse(market.data_date_max + "T00:00:00") : null;
  const staleDays = dataDate ? daysBetween(dataDate, t) : null;
  const query = String(o.q || "").trim().toLowerCase();
  const cat = o.cat ? String(o.cat) : "";
  const categories = {};
  const rows = [];
  let suspicious = 0;

  for (const it of market.items) {
    if (!it || !(it.buy > 0) || !(it.sell > 0)) continue;
    categories[it.cat || "—"] = (categories[it.cat || "—"] || 0) + 1;
    if (cat && it.cat !== cat) continue;
    if (query && !String(it.name).toLowerCase().includes(query)) continue;

    const key = String(it.name).toLowerCase();
    const gh = gp && gp.history && gp.history.sale.sa[key];
    const gs = gh && gh.summary;
    const listPrice = gp && gp.sale && gp.sale.sa[key] ? gp.sale.sa[key].price : null;
    const noSales = !!(gp && gp.noSales && gp.noSales.sale[key] != null);
    const gamePrice = gs ? gs.med7 : listPrice;          // цена сделок в игре сегодня (медиана), иначе цена из списка

    const bid = Math.ceil(it.buy * (1 + o.outbid));
    // цена продажи: меньшая из «лавки просят» и «реально проходит в игре»
    // нет игровых сделок для сверки — берём цену продажи с запасом 10%
    const ask = gamePrice ? Math.min(it.sell, gamePrice) : it.sell * 0.9;
    const askSource = gamePrice && gamePrice < it.sell ? "game" : "market";
    const profit = ask * (1 - o.comm) - bid;
    const roi = profit / bid;

    const fills = (it.dealsBuy || 0) / windowDays;        // штук/сутки уходит в заявки скупки (наша сторона покупки)
    const sells = (it.dealsSell || 0) / windowDays;       // штук/сутки покупают с продажи (наша сторона перепродажи)
    // Счётчики ArzMarket завышены (считают штуки по всем лавкам): темп оценки — не выше реальных сделок в игре за 7 дней.
    const gameDay = gs && gs.vol7 > 0 ? gs.vol7 / 7 : null;
    const flow = gameDay != null ? Math.min(fills, sells, gameDay) : Math.min(fills, sells);

    const flags = [];
    if (noSales) flags.push("noSales");
    if (!gamePrice) flags.push("noGameData");
    else if (gs && gs.vol7 < o.minGameVol7) flags.push("lowGameVol");
    if (staleDays != null && staleDays > o.maxStaleDays) flags.push("stale");
    if (gamePrice && it.sell / gamePrice > 1.5) flags.push("askInflated");   // лавки просят сильно выше реальных сделок
    const disp = dispersion(it.history || []);
    if (disp != null && disp > 0.15) flags.push("volatile");
    const trend = Number.isFinite(it.change) ? it.change : null;
    if (trend != null && trend < -10) flags.push("falling");
    if (gs && gs.trendPct != null && gs.trendPct < -10) flags.push("gameFalling");

    const row = {
      name: it.name, cat: it.cat || "—", id: it.id,
      buy: it.buy, sell: it.sell, gamePrice: gamePrice || null, gameVol7: gs ? gs.vol7 : null,
      bid, ask: Math.round(ask), askSource,
      profitPerUnit: Math.round(profit), roi: Math.round(roi * 1000) / 10,
      fillsPerDay: Math.round(fills * 10) / 10, sellsPerDay: Math.round(sells * 10) / 10, flowPerDay: Math.round(flow * 10) / 10,
      dispersionPct: disp == null ? null : Math.round(disp * 1000) / 10,
      trendPct: trend, flags,
    };
    const tooGood = roi > o.maxRoi;                        // ROI 100–100000% — это не удача, это мусор в данных
    if (tooGood) { flags.push("tooGood"); suspicious++; }
    row.eligible = !noSales && !tooGood && !flags.includes("lowGameVol") && bid >= o.minBid &&
      roi >= o.minRoi && fills >= o.minDeals && sells >= o.minDeals && bid <= o.budget * o.share;
    // Лот: не больше доли бюджета и не больше того, что реально разойдётся за holdDays при нашей доле оборота.
    const perDay = flow * o.capture;                       // сколько штук в сутки реально забираем
    const byBudget = Math.floor((o.budget * o.share) / bid);
    const byFlow = Math.max(1, Math.floor(perDay * o.holdDays));
    row.units = row.eligible ? Math.max(0, Math.min(byBudget, byFlow)) : 0;
    row.unitsPerDay = Math.round(perDay * 100) / 100;
    row.cost = row.units * bid;
    row.cycleDays = perDay > 0 ? Math.max(1, Math.round((row.units / perDay) * 10) / 10) : null;
    row.profitLot = Math.round(row.units * profit);
    row.profitPerDay = row.cycleDays ? Math.round(row.profitLot / row.cycleDays) : 0;
    rows.push(row);
  }

  // Рейтинг: сначала прибыль в сутки на вложенный рубль (ROI в сутки), чтобы 26 млн не лежали мёртвым грузом.
  // Риск-штраф: падающая/скачущая цена, завышенные «просят», нет игровой сверки — каждый флаг режет рейтинг на 20% (не ниже 20%).
  const RISKY = ["volatile", "falling", "gameFalling", "askInflated", "noGameData", "stale"];
  const score = (r) => {
    if (!(r.cost > 0 && r.cycleDays)) return -1;
    const k = Math.max(0.2, 1 - 0.2 * r.flags.filter((f) => RISKY.includes(f)).length);
    return (r.profitLot / r.cost / r.cycleDays) * k;
  };
  rows.sort((a, b) => score(b) - score(a) || b.profitPerDay - a.profitPerDay);

  // Раскладка бюджета: берём лоты сверху списка, пока хватает денег (вторая, урезанная покупка — когда остаток меньше лота).
  const portfolio = { items: [], spent: 0, profitPerCycle: 0, profitPerDay: 0 };
  let left = o.budget;
  for (const r of rows) {
    if (r.units <= 0 || left < r.bid) continue;
    const units = Math.min(r.units, Math.floor(left / r.bid));
    if (units < 1) continue;
    const cost = units * r.bid;
    const lot = Math.round(units * r.profitPerUnit);
    const cd = r.unitsPerDay > 0 ? Math.max(1, units / r.unitsPerDay) : null;   // за сколько суток этот лот разойдётся
    const perDay = cd ? lot / cd : 0;
    portfolio.items.push({ name: r.name, units, bid: r.bid, ask: r.ask, cost, profit: lot, perDay: Math.round(perDay) });
    portfolio.spent += cost; portfolio.profitPerCycle += lot; portfolio.profitPerDay += Math.round(perDay);
    left -= cost;
    if (portfolio.items.length >= 12) break;
  }
  portfolio.left = left;

  const limit = Number(o.limit) > 0 ? Number(o.limit) : 60;
  const shown = rows.filter((r) => r.eligible).slice(0, limit);
  return {
    ok: true,
    assumptions: { budget: o.budget, comm: o.comm, minRoi: o.minRoi, outbid: o.outbid, share: o.share, capture: o.capture, holdDays: o.holdDays, minDeals: o.minDeals, maxRoi: o.maxRoi },
    dataDate: market.data_date_max || null, staleDays, windowDays,
    gameUpdatedAt: gp && gp.updatedAt ? new Date(gp.updatedAt).toISOString() : null,
    suspicious, total: market.items.length, eligible: rows.filter((r) => r.eligible).length,
    categories, items: shown, portfolio,
  };
}

module.exports = { scanFlips, dispersion, median, DEFAULTS };
