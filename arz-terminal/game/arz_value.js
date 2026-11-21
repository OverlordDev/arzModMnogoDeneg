"use strict";
/* ARZ Terminal — оценка стоимости инвентаря и советы.
 *
 * Берёт сводку игрока (game/arz_parser.js -> summarize) и рыночный файл
 * сервера (data/market_<server>.json, дневные агрегаты ArzMarket) и считает:
 *   quick — по скупке (сколько реально дадут лавки сразу),
 *   ask   — по ценам продажи (сколько просят лавки, верхняя граница),
 *   estimate — середина между ними (это и есть «примерная стоимость»).
 *
 * Честные ограничения:
 *  - цены дневные, не живые; свежесть = data_date_max рыночного файла;
 *  - предметы без цены на рынке (непродаваемые, скины, талоны, редкие)
 *    в сумму не входят и перечисляются отдельно, а не оцениваются в 0 молча;
 *  - у стопки из многих штук реальная цена продажи ниже (рынок «проседает»):
 *    для больших стопок estimate оптимистичен.
 */

const bankMod = require("./arz_bank");

function fmtNum(n) {
  return Math.round(n).toLocaleString("ru-RU");
}

function serverKey(title) {
  const t = String(title || "").toLowerCase();
  if (t.includes("yuma")) return "yuma";
  if (t.includes("vice") || t === "vc") return "vc";
  return null;
}

function buildPriceIndex(market) {
  const exact = new Map();
  const loose = new Map();
  for (const it of (market && market.items) || []) {
    exact.set(it.name, it);
    const k = String(it.name).toLowerCase().trim();
    if (!loose.has(k)) loose.set(k, it);
  }
  return { exact, loose };
}

function lookup(index, name) {
  if (!name) return null;
  return index.exact.get(name) || index.loose.get(String(name).toLowerCase().trim()) || null;
}

function daysOld(dateStr, now) {
  if (!dateStr) return null;
  const t = Date.parse(dateStr);
  if (Number.isNaN(t)) return null;
  return Math.floor(((now || Date.now()) - t) / 86400000);
}

// Во сколько раз игровая средняя цена может отличаться от ArzMarket, чтобы считать их согласованными.
const GAME_DIVERGE = 3;

/**
 * gamePrices — результат game/arz_gameprices.js (по желанию). Игровая средняя цена за 30 дней
 * НЕ подменяет рыночную: она сверяется с ней (row.game, row.gameRatio, row.gameDiverge) и
 * используется только как запасной вариант для предметов без цены ArzMarket (row.src = "game",
 * входит в estimate, но не в quick/ask — это не живая цена лавок).
 */
function valueInventory(summary, market, now, gamePrices) {
  const key = serverKey(summary && summary.server);
  if (!key) {
    return { ok: false, reason: "Сервер «" + (summary && summary.server) + "» не Yuma/Vice City — рыночных данных нет" };
  }
  if (!market || market.server !== key) {
    return { ok: false, reason: "Нет рыночного файла для сервера " + key };
  }
  const index = buildPriceIndex(market);
  const rows = [];
  const unpriced = [];
  let quick = 0, ask = 0, estimate = 0;
  let gameOnly = 0, gameOnlyValue = 0;
  let noSalesCount = 0, noSalesValue = 0;
  // :CASH: (SA$) у Yuma, :CASHV: (VC$) у Vice City — валюты не смешиваем.
  const gameTable = gamePrices && gamePrices.sale ? gamePrices.sale[key === "vc" ? "vc" : "sa"] : null;
  const histTable = gamePrices && gamePrices.history ? gamePrices.history.sale[key === "vc" ? "vc" : "sa"] : null;
  // «За 30 дней не найдено ни одной операции с этим товаром» — предмет в игре не продавался (ключ без валюты).
  const noSalesMap = gamePrices && gamePrices.noSales ? gamePrices.noSales.sale : null;

  for (const t of summary.totals || []) {
    const m = lookup(index, t.name);
    const buy = m && m.buy > 0 ? m.buy : 0;
    const sell = m && m.sell > 0 ? m.sell : 0;
    const gkey = String(t.name || "").toLowerCase().trim();
    const g = gameTable ? gameTable[gkey] : null;
    // История предмета по дням (если игрок открывал её) точнее среднего за 30 дней: берём цену за 7 дней.
    const hs = histTable && histTable[gkey] ? histTable[gkey].summary : null;
    // нет продаж за 30 дней -> цена в общем списке устарела, её не используем
    const ns = !hs && !!(noSalesMap && noSalesMap[gkey]);
    const game = hs ? hs.med7 : g && !ns ? g.price : 0;      // медиана дневных цен за 7 дней: устойчива к странным сделкам
    const gameHist = hs ? { med7: hs.med7, med30: hs.med30, avg7: hs.avg7, avg30: hs.avg30, vol7: hs.vol7, trendPct: hs.trendPct, last: hs.last, lastDate: hs.lastDate } : null;
    if (!buy && !sell) {
      if (game) {
        // у ArzMarket цены нет, а игра её знает: считаем по игровой, но помечаем
        gameOnly++;
        gameOnlyValue += game * t.amount;
        estimate += game * t.amount;
        rows.push({ item: t.item, name: t.name, amount: t.amount, buy: 0, sell: 0, mid: game, total: game * t.amount, priced: true, src: "game", game, gameHist });
        continue;
      }
      unpriced.push({ item: t.item, name: t.name, amount: t.amount, noSales: ns });
      rows.push({ item: t.item, name: t.name, amount: t.amount, buy: 0, sell: 0, mid: 0, total: 0, priced: false, noSales: ns });
      continue;
    }
    const mid = buy && sell ? Math.round((buy + sell) / 2) : buy || sell;
    const gameRatio = game ? Math.round((game / mid) * 100) / 100 : null;
    const q = buy ? buy * t.amount : 0;
    const a = sell ? sell * t.amount : 0;
    quick += q;
    ask += a;
    estimate += mid * t.amount;
    if (ns) { noSalesCount++; noSalesValue += mid * t.amount; }
    rows.push({
      item: t.item, name: t.name, amount: t.amount, buy, sell, mid, total: mid * t.amount, priced: true,
      liq: m.liq || null, spreadPct: buy && sell ? Math.round(((sell - buy) / buy) * 1000) / 10 : null,
      game: game || 0, gameHist, gameRatio, gameNoSales: ns,
      gameDiverge: gameRatio != null && (gameRatio > GAME_DIVERGE || gameRatio < 1 / GAME_DIVERGE),
    });
  }
  rows.sort((a, b) => b.total - a.total);
  return {
    ok: true,
    server: key,
    quick, ask, estimate,
    pricedCount: rows.filter((r) => r.priced).length,
    gameOnly, gameOnlyValue,
    noSalesCount, noSalesValue,
    gameChecked: rows.filter((r) => r.gameRatio != null).length,
    unpriced,
    rows,
    pricesDate: market.data_date_max || null,
    pricesAgeDays: daysOld(market.data_date_max, now),
  };
}

/** Простые детерминированные советы (без ИИ). */
function advise(summary, valuation) {
  const tips = [];
  const push = (level, text) => tips.push({ level, text });

  if (summary.baseline === false) {
    push("warn", "Нет полной загрузки инвентаря (скрипт запущен посреди сессии): видны только слоты, изменённые после старта. Перезайди на сервер — данные и оценка станут полными.");
  }

  if (summary.satiety != null) {
    if (summary.satiety <= 15) push("danger", "Сытость " + summary.satiety + "% — срочно поешь, иначе пойдёт урон здоровью.");
    else if (summary.satiety <= 35) push("warn", "Сытость " + summary.satiety + "% — пора перекусить, пока не мешает фарму.");
  }
  if (summary.wanted > 0) push("warn", "Розыск " + summary.wanted + " — не ходи по рынку и банку, пока не спадёт.");
  if (summary.slots && summary.slots.total && summary.slots.total - summary.slots.used <= 5) {
    push("warn", "Инвентарь почти полон: " + summary.slots.used + " из " + summary.slots.total + " слотов.");
  }

  // Депозит: деньги сверх лимита дохода не приносят (по данным последнего открытия окна банка).
  const dep = summary.bank && summary.bank.deposit;
  const da = dep && !dep.stale && bankMod.analyzeDeposit(dep);
  if (dep && dep.stale) {
    push("info", "Окно банка устарело: чек PayDay показывает доход депозита " + fmtNum(dep.stale.checkIncome) + " вместо " + fmtNum(dep.stale.windowIncome) +
      " (лимит или бонусы поменялись) — открой в игре окно банка, чтобы обновить лимит; расчёт «простаивает» пока не показываю.");
  }
  if (da && da.idle > 0) {
    push(da.idle >= 0.2 * dep.money ? "warn" : "info",
      "Депозит работает на " + fmtNum(da.covered / 1e6) + " из " + fmtNum(dep.money / 1e6) + " млн: " + fmtNum(da.idle / 1e6) +
      " млн сверх лимита дохода не приносят" + (da.lostPerPayday ? " (≈ " + fmtNum(da.lostPerPayday) + " за PayDay упускается)" : "") +
      ". Лимит растёт от уровня депозита, домов с улучшением и семейного улучшения (по данным последнего открытия банка).");
  }

  if (valuation && valuation.ok) {
    if (valuation.pricesAgeDays != null && valuation.pricesAgeDays >= 3) {
      push("warn", "Рыночные цены устарели на " + valuation.pricesAgeDays + " дн. — оценка приблизительная.");
    }
    if (valuation.noSalesCount > 0 && valuation.estimate > 0) {
      const share = Math.round((valuation.noSalesValue / valuation.estimate) * 100);
      push(share >= 20 ? "warn" : "info", valuation.noSalesCount + " поз. не продавались в игре ни разу за 30 дней (" + share + "% оценки) — это цена по ArzMarket, но реально продать по ней может не получиться.");
    }
    if (valuation.gameOnly > 0) {
      push("info", valuation.gameOnly + " поз. оценены по игровой средней цене за 30 дней (в ArzMarket их нет), ≈ " + fmtNum(valuation.gameOnlyValue) + " — это не живая цена лавок, а медиана цен сделок в игре.");
    }
    const diverge = valuation.rows.filter((r) => r.gameDiverge && r.total >= valuation.estimate * 0.05);
    for (const r of diverge.slice(0, 2)) {
      push("warn", "«" + r.name + "»: игра даёт ср. цену " + fmtNum(r.game) + ", ArzMarket — " + fmtNum(r.mid) + " (в " + (r.gameRatio >= 1 ? r.gameRatio : Math.round(100 / r.gameRatio) / 100) + " раза " + (r.gameRatio >= 1 ? "выше" : "ниже") + "). Цена этой позиции сомнительна — проверь на рынке вручную.");
    }
    if (valuation.unpriced.length) {
      push("info", valuation.unpriced.length + " поз. без рыночной цены (не торгуются или нет данных ArzMarket) — в сумму не входят.");
    }
    if (valuation.estimate > 0) {
      const top = valuation.rows[0];
      if (top && top.total / valuation.estimate > 0.6 && valuation.rows.length > 1) {
        push("info", "Больше 60% стоимости — один предмет: «" + top.name + "». Риск: цена одной позиции решает всё.");
      }
      const wide = valuation.rows.filter((r) => r.priced && r.spreadPct != null && r.spreadPct >= 30 && r.total >= valuation.estimate * 0.1);
      for (const r of wide.slice(0, 2)) {
        push("info", "«" + r.name + "»: скупка " + fmtNum(r.buy) + " против продажи " + fmtNum(r.sell) + " (спред " + r.spreadPct + "%). Выгоднее ставить свою лавку, чем сдавать в скупку.");
      }
    }
    if (valuation.estimate === 0 && !valuation.unpriced.length) push("info", "Инвентарь пуст — оценивать нечего.");
  } else if (valuation && !valuation.ok) {
    push("info", valuation.reason);
  }
  return tips;
}

module.exports = { serverKey, buildPriceIndex, lookup, valueInventory, advise };
