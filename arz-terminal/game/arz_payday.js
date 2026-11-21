"use strict";
/* ARZ Terminal — «банковский чек» PayDay из чата.
 *
 * На каждый PayDay сервер присылает в чат чек (экспортёр arz_export.lua пишет только эти строки в arz_payday.log):
 *
 *   БАНКОВСКИЙ ЧЕК
 *   Текущая сумма в банке: $33.807.078 (+$389.451)
 *   В данный момент у вас 48-й уровень и 41/196 респектов (+6 EXP)
 *   Текущая сумма на депозите: $267.131.102 (+$357.540)
 *   Общая заработная плата: $389.451
 *   Баланс на донат-счет: 12610 AZ (+8 AZ)
 *
 * Зачем: деньги PayDay идут НА СЧЁТ и НА ДЕПОЗИТ, а не в наличные, поэтому «заработок» по событиям денег их не видит.
 * Чек даёт реальный доход за выплату, интервал между выплатами и свежие остатки банка без открытия окна банка.
 *
 * Формат строки лога: "[2026-11-18 20:24:03] CHAT <текст без цветовых кодов>".
 */

const num = (s) => Number(String(s).replace(/[.\s]/g, ""));

/** "2026-11-18 20:24:03" (время ПК) -> мс */
function tsMs(s) {
  const m = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)$/.exec(s || "");
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
}

/**
 * Одна строка чека -> { key, ...поля } или null. Деньги в чате приходят как «:CASH:34.196.529» (так выглядит значок $
 * в чате Arizona; «:CASHV:» — VC$), на скрине это «$»: вырезаем и то и другое, чтобы «(+:CASH:389.451)» и «(+$389.451)»
 * разбирались одинаково. Перед строкой может стоять рамка «| ».
 */
function parseLine(text) {
  const t = String(text).replace(/:CASHV?:/g, "").replace(/\$/g, "");
  let m;
  if (/БАНКОВСКИЙ ЧЕК/.test(t)) return { key: "header" };
  if ((m = /Текущая сумма в банке:\s*([\d.]+)\s*(?:\(\s*([+-]?)\s*([\d.]+)\s*\))?/.exec(t))) {
    return { key: "bank", total: num(m[1]), delta: m[3] ? (m[2] === "-" ? -1 : 1) * num(m[3]) : 0 };
  }
  if ((m = /Текущая сумма на депозите:\s*([\d.]+)\s*(?:\(\s*([+-]?)\s*([\d.]+)\s*\))?/.exec(t))) {
    return { key: "deposit", total: num(m[1]), delta: m[3] ? (m[2] === "-" ? -1 : 1) * num(m[3]) : 0 };
  }
  if ((m = /Общая заработная плата:\s*([\d.]+)/.exec(t))) return { key: "salary", value: num(m[1]) };
  if ((m = /(\d+)-й уровень и (\d+)\/(\d+) респектов(?:\s*\(\s*([+-]?\d+)\s*EXP\s*\))?/.exec(t))) {
    return { key: "level", level: +m[1], respect: +m[2], respectMax: +m[3], exp: m[4] ? +m[4] : 0 };
  }
  if ((m = /Баланс на донат-счет:\s*(\d+)\s*AZ(?:\s*\(\s*([+-]?\d+)\s*AZ\s*\))?/.exec(t))) {
    return { key: "az", balance: +m[1], delta: m[2] ? +m[2] : 0 };
  }
  return null;
}

/**
 * Весь лог -> [чек, ...] по возрастанию времени. Чек начинается с шапки (или с первой строки полей, если шапки
 * не было), заканчивается строкой AZ, новой шапкой или паузой больше 8 с.
 */
function parsePaydayLog(text) {
  const checks = [];
  let cur = null;
  const flush = () => { if (cur && (cur.bank || cur.deposit || cur.salary != null)) checks.push(cur); cur = null; };
  for (const raw of String(text || "").split(/\r?\n/)) {
    const m = /^\[([^\]]+)\] CHAT (.*)$/.exec(raw);
    if (!m) continue;
    const t = tsMs(m[1]);
    const p = parseLine(m[2]);
    if (!p || t == null) continue;
    if (p.key === "header") { flush(); cur = { t }; continue; }
    if (cur && t - cur.t > 8000) flush();
    if (!cur) cur = { t };
    if (p.key === "bank") cur.bank = { total: p.total, delta: p.delta };
    else if (p.key === "deposit") cur.deposit = { total: p.total, delta: p.delta };
    else if (p.key === "salary") cur.salary = p.value;
    else if (p.key === "level") cur.level = { level: p.level, respect: p.respect, respectMax: p.respectMax, exp: p.exp };
    else if (p.key === "az") { cur.az = { balance: p.balance, delta: p.delta }; flush(); }
  }
  flush();
  return checks.sort((a, b) => a.t - b.t);
}

const median = (arr) => {
  if (!arr.length) return null;
  const v = arr.slice().sort((a, b) => a - b);
  const n = v.length;
  return n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
};

const SESSION_GAP_MS = 3 * 3600 * 1000; // дольше — это уже другая игровая сессия, интервалом не считаем

/**
 * Статистика: доход за выплату (зарплата + депозит), интервал между выплатами, доход в час.
 * Берём медианы последних 10 выплат: одна «странная» выплата (повестка, ранг) картину не ломает.
 */
function paydayStats(checks, now, opts) {
  if (!checks || !checks.length) return null;
  // Номинальный интервал PayDay (минуты): у Arizona выплата раз в 30 минут. Выплата может НЕ засчитаться (игра закрыта,
  // нет нужного времени онлайн) — тогда между двумя чеками проходит больше интервала, а банк растёт на ОДНУ выплату.
  const nominalMin = (opts && opts.nominalMin) || 30;
  const last = checks[checks.length - 1];
  const recent = checks.slice(-10);
  const incomes = recent.map((c) => (c.salary || 0) + (c.deposit ? c.deposit.delta : 0)).filter((x) => x > 0);
  const gaps = [];
  for (let i = 1; i < recent.length; i++) {
    const g = recent[i].t - recent[i - 1].t;
    if (g > 0 && g <= SESSION_GAP_MS) gaps.push(g);
  }
  const intervalMs = median(gaps);
  // Пропущенные выплаты: каждый промежуток между чеками — это k интервалов номинала, из которых засчитана одна.
  let slots = 0;
  for (const g of gaps) slots += Math.max(1, Math.round(g / (nominalMin * 60000)));
  const missed = slots - gaps.length;
  const creditedShare = gaps.length ? gaps.length / slots : null;
  const incomePerPayday = median(incomes);
  const day0 = new Date(last.t); day0.setHours(0, 0, 0, 0);
  const today = checks.filter((c) => c.t >= day0.getTime());
  const sumSalary = (list) => list.reduce((a, c) => a + (c.salary || 0), 0);
  const sumDeposit = (list) => list.reduce((a, c) => a + (c.deposit ? c.deposit.delta : 0), 0);
  const azDeltas = recent.map((c) => (c.az ? c.az.delta : 0));
  return {
    count: checks.length,
    last: {
      at: last.t,
      salary: last.salary == null ? null : last.salary,
      depositIncome: last.deposit ? last.deposit.delta : null,
      bankTotal: last.bank ? last.bank.total : null,
      depositTotal: last.deposit ? last.deposit.total : null,
      az: last.az || null,
      level: last.level || null,
    },
    intervalMin: intervalMs == null ? null : Math.round((intervalMs / 60000) * 10) / 10,
    incomePerPayday: incomePerPayday == null ? null : Math.round(incomePerPayday),
    nominalMin,
    // «в час» считается от номинала (если засчитываются ВСЕ выплаты) и фактически (с учётом пропусков по журналу)
    incomePerHour: incomePerPayday != null ? Math.round(incomePerPayday * (60 / nominalMin)) : null,
    incomePerHourActual: incomePerPayday != null && creditedShare != null ? Math.round(incomePerPayday * (60 / nominalMin) * creditedShare) : null,
    missed,
    creditedShare: creditedShare == null ? null : Math.round(creditedShare * 100) / 100,
    azPerPayday: azDeltas.length ? median(azDeltas) : null,
    today: { paydays: today.length, salary: sumSalary(today), depositIncome: sumDeposit(today), total: sumSalary(today) + sumDeposit(today) },
    sinceLastSec: now == null ? null : Math.max(0, Math.round((now - last.t) / 1000)),
  };
}

module.exports = { parsePaydayLog, parseLine, paydayStats };

if (require.main === module) {
  const fs = require("fs");
  const f = process.argv[2];
  if (!f) { console.error("usage: node game/arz_payday.js <arz_payday.log>"); process.exit(1); }
  const checks = parsePaydayLog(fs.readFileSync(f, "utf8"));
  console.log(JSON.stringify(paydayStats(checks, Date.now()), null, 2));
}
