"use strict";
/* ARZ Terminal — разбор банка и депозита (события event.bank.*).
 *
 * Что известно о формате (реальный лог игры, 2026-11-18):
 *   event.bank.updateDepositData [{bankDeposit:{money, level, maxLevel, limit, percents:{withdraw,deposit},
 *                                  disabledTime:{withdraw,deposit,upgrade}}, income:{poyDayIncome}}]
 *     limit — «сумма на депозите, на которую действует доход»: по опыту игрока деньги сверх лимита
 *             дохода НЕ прибавляют (50 млн -> N, 120 млн -> X, 200 млн -> тоже X);
 *     poyDayIncome — ожидаемый доход за один PayDay (опечатка в названии — в самой игре);
 *     percents.withdraw — комиссия за снятие с депозита (7% в будни по старой вики);
 *     disabledTime — секунды до следующего пополнения/улучшения на момент отправки события.
 *   event.bank.updateMainData [{bankAccounts:[{id, money, percents}, {id, buyCost}...], organization, taxes, ...}]
 *     у купленного счёта есть money, у непроданных — buyCost.
 * Эти события приходят ТОЛЬКО когда игрок открывает окно банка — данные «на момент последнего открытия».
 *
 * Здесь нет ничего, что ходит в сеть или в игру: чистые функции над уже разобранным состоянием.
 */

const n = (x) => (Number.isFinite(Number(x)) ? Number(x) : null);

/** Сырой аргумент события депозита -> компактная запись или null. */
function parseDeposit(v) {
  const d = v && v.bankDeposit;
  if (!d || typeof d !== "object") return null;
  const t = d.disabledTime || {};
  return {
    money: n(d.money),
    level: n(d.level),
    maxLevel: n(d.maxLevel),
    limit: n(d.limit),
    withdrawPct: d.percents ? n(d.percents.withdraw) : null,
    depositPct: d.percents ? n(d.percents.deposit) : null,
    incomePerPayday: v.income ? n(v.income.poyDayIncome) : null,
    depositCooldownSec: n(t.deposit),
    upgradeCooldownSec: n(t.upgrade),
  };
}

/** Сырой аргумент основных данных банка -> купленные счета ({id, money, withdrawPct}) или null. */
function parseAccounts(v) {
  if (!v || !Array.isArray(v.bankAccounts)) return null;
  return v.bankAccounts
    .filter((a) => a && typeof a === "object" && n(a.money) != null)
    .map((a) => ({ id: a.id, money: n(a.money), withdrawPct: a.percents ? n(a.percents.withdraw) : null }));
}

/**
 * Использование лимита депозита.
 *  covered — сколько денег реально работает (min(деньги, лимит)); idle — простаивает сверх лимита;
 *  ratePerMillion — доход за PayDay на каждый миллион работающих денег (при нынешних бонусах/штрафах);
 *  lostPerPayday — сколько за PayDay упускается из-за простаивающих денег (если бы лимит был не меньше суммы).
 */
function analyzeDeposit(dep) {
  if (!dep || dep.money == null || dep.limit == null || dep.limit <= 0) return null;
  const covered = Math.min(dep.money, dep.limit);
  const idle = Math.max(0, dep.money - dep.limit);
  const income = dep.incomePerPayday;
  const ratePerMillion = income != null && covered > 0 ? income / (covered / 1e6) : null;
  const lost = ratePerMillion != null && idle > 0 ? Math.round(ratePerMillion * (idle / 1e6)) : 0;
  return {
    covered, idle,
    headroom: Math.max(0, dep.limit - dep.money),                         // сколько ещё можно положить под доход
    fillPct: Math.round(Math.min(1, dep.money / dep.limit) * 1000) / 10,   // насколько лимит заполнен деньгами
    ratePerMillion: ratePerMillion == null ? null : Math.round(ratePerMillion),
    lostPerPayday: lost,
    potentialPerPayday: income != null ? income + lost : null,
  };
}

/** Сколько добавит к доходу за PayDay рост лимита на addLimit (имеет смысл, пока есть простаивающие деньги). */
function gainForLimit(dep, addLimit) {
  const a = analyzeDeposit(dep);
  if (!a || dep.incomePerPayday == null || a.covered <= 0 || !(addLimit > 0)) return 0;
  const rate = dep.incomePerPayday / (a.covered / 1e6);          // не округлённая ставка: ошибка округления × десятки млн заметна
  return Math.round(rate * (Math.min(addLimit, a.idle) / 1e6));
}

/**
 * Следующий уровень депозита (по таблице data/deposit.json: надбавка к лимиту «накопительно» — это допущение
 * калькулятора проекта, вики его не уточняет; реальный новый лимит покажет игра после повышения).
 * Учитывается только эффект лимита; прибавку процента уровня (+5/10/18/26/35%) не считаем.
 */
function nextLevelGain(dep, levels) {
  if (!dep || dep.level == null || !Array.isArray(levels)) return null;
  const next = levels.find((l) => l.level === dep.level + 1);
  if (!next || !next.limit_add) return null;
  return { level: next.level, limitAdd: next.limit_add, gainPerPayday: gainForLimit(dep, next.limit_add) };
}

/**
 * Остатки из чека PayDay новее данных окна банка — подставляем их (окно открывают редко, чек приходит на каждую
 * выплату). Лимит, уровень и доход за выплату берутся ТОЛЬКО из окна. Но если лимит/бонусы поменялись (семейное
 * улучшение, ранг), доход в чеке уже не совпадёт с окном: тогда окно помечаем устаревшим (dep.stale), а расчёты
 * «простаивает/упускается» не делаем — смешать новый доход со старым лимитом значит выдать цифры вдвое мимо.
 * sb — состояние банка из парсера, times — время событий по номеру, pd — статистика PayDay (arz_payday.js).
 */
function freshenBank(sb, times, pd) {
  if (!sb || !pd || !pd.last) return;
  const t = pd.last.at;
  const at = (idx) => (idx != null && times && times[idx] != null ? times[idx] : 0);
  const depNewer = t > at(sb.depositIdx);
  if (pd.last.depositTotal != null && sb.deposit && depNewer) {
    sb.deposit.money = pd.last.depositTotal;
    sb.deposit.moneyAt = t;
    sb.deposit.moneyFrom = "payday";
  }
  if (sb.deposit && depNewer && pd.last.depositIncome > 0 && sb.deposit.incomePerPayday > 0) {
    const ratio = pd.last.depositIncome / sb.deposit.incomePerPayday;
    if (Math.abs(ratio - 1) > 0.05) sb.deposit.stale = { checkIncome: pd.last.depositIncome, windowIncome: sb.deposit.incomePerPayday, ratio: Math.round(ratio * 100) / 100 };
  }
  if (pd.last.bankTotal != null && t > at(sb.accountsIdx)) {
    const acc = (sb.accounts || []).slice();
    const i = acc.findIndex((a) => a.id === 0);
    if (i >= 0) acc[i] = Object.assign({}, acc[i], { money: pd.last.bankTotal });
    else acc.unshift({ id: 0, money: pd.last.bankTotal, withdrawPct: null });
    sb.accounts = acc;
    sb.accountsPaydayAt = t;
  }
}

module.exports = { parseDeposit, parseAccounts, analyzeDeposit, gainForLimit, nextLevelGain, freshenBank };
