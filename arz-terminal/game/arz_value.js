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

function valueInventory(summary, market, now) {
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

  for (const t of summary.totals || []) {
    const m = lookup(index, t.name);
    const buy = m && m.buy > 0 ? m.buy : 0;
    const sell = m && m.sell > 0 ? m.sell : 0;
    if (!buy && !sell) {
      unpriced.push({ item: t.item, name: t.name, amount: t.amount });
      rows.push({ item: t.item, name: t.name, amount: t.amount, buy: 0, sell: 0, mid: 0, total: 0, priced: false });
      continue;
    }
    const mid = buy && sell ? Math.round((buy + sell) / 2) : buy || sell;
    const q = buy ? buy * t.amount : 0;
    const a = sell ? sell * t.amount : 0;
    quick += q;
    ask += a;
    estimate += mid * t.amount;
    rows.push({
      item: t.item, name: t.name, amount: t.amount, buy, sell, mid, total: mid * t.amount, priced: true,
      liq: m.liq || null, spreadPct: buy && sell ? Math.round(((sell - buy) / buy) * 1000) / 10 : null,
    });
  }
  rows.sort((a, b) => b.total - a.total);
  return {
    ok: true,
    server: key,
    quick, ask, estimate,
    pricedCount: rows.filter((r) => r.priced).length,
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

  if (valuation && valuation.ok) {
    if (valuation.pricesAgeDays != null && valuation.pricesAgeDays >= 3) {
      push("warn", "Рыночные цены устарели на " + valuation.pricesAgeDays + " дн. — оценка приблизительная.");
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
