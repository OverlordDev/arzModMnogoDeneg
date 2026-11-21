"use strict";
/* Тесты game/arz_flip.js (расчёт скупа). Запуск: node game/test_flip.js */

const assert = require("assert");
const { scanFlips, dispersion } = require("./arz_flip");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("ok   " + name); }
  catch (e) { console.error("FAIL " + name + "\n     " + e.message); process.exitCode = 1; }
}

const NOW = Date.parse("2026-11-18T12:00:00");
const item = (o) => Object.assign({ id: "i" + Math.random(), name: "Ларец", cat: "Кейсы", buy: 100000, sell: 150000, dealsBuy: 14000, dealsSell: 14000, history: [150000, 151000, 149000, 150500, 150000], change: 0 }, o);
const market = (items) => ({ window_days: 14, data_date_max: "2026-11-16", items });
// игровые цены: key -> {med7, vol7}
const game = (map, noSales) => ({
  history: { sale: { sa: Object.fromEntries(Object.entries(map).map(([k, v]) => [k, { name: k, days: [], summary: { med7: v.med7, vol7: v.vol7 == null ? 700 : v.vol7, trendPct: v.trend || 0 } }])) } },
  sale: { sa: {} }, noSales: { sale: Object.fromEntries((noSales || []).map((k) => [k, 1])) }, updatedAt: NOW,
});

test("прибыль с штуки: цена продажи × (1 − комиссия) − (скупка + 1%)", () => {
  const r = scanFlips(market([item({})]), game({ "ларец": { med7: 150000 } }), { comm: 0.05 }, NOW);
  const x = r.items[0];
  assert.strictEqual(x.bid, 101000);
  assert.strictEqual(x.profitPerUnit, Math.round(150000 * 0.95 - 101000));
  assert.ok(x.roi > 40 && x.roi < 41.5, "ROI " + x.roi);
});

test("цена продажи — меньшая из «лавки просят» и «в игре реально проходит»", () => {
  const r = scanFlips(market([item({ sell: 300000 })]), game({ "ларец": { med7: 140000 } }), {}, NOW);
  assert.strictEqual(r.items[0].ask, 140000);
  assert.strictEqual(r.items[0].askSource, "game");
  assert.ok(r.items[0].flags.includes("askInflated"), "просят вдвое выше реального — флаг");
});

test("нет игровой цены — берём продажу ArzMarket с запасом 10% и ставим флаг", () => {
  const r = scanFlips(market([item({})]), game({}), {}, NOW);
  assert.strictEqual(r.items[0].ask, 135000);
  assert.ok(r.items[0].flags.includes("noGameData"));
});

test("мусор в данных: ROI выше 60% отбрасывается и считается подозрительным (скупка 11$ при продаже 15 000$)", () => {
  const r = scanFlips(market([item({ name: "Автомат", buy: 11, sell: 15000 }), item({ name: "Ларец" })]), game({ "автомат": { med7: 15000 }, "ларец": { med7: 150000 } }), {}, NOW);
  assert.ok(!r.items.some((x) => x.name === "Автомат"));
  assert.strictEqual(r.suspicious, 1);
  assert.ok(r.items.some((x) => x.name === "Ларец"));
});

test("предмет без продаж в игре, «мёртвый» (мало сделок) и с тонкой маржой не попадают в список", () => {
  const r = scanFlips(market([
    item({ name: "А" }), item({ name: "Б" }), item({ name: "В", buy: 145000 }), item({ name: "Г", dealsBuy: 10 }),
  ]), game({ "а": { med7: 150000 }, "б": { med7: 150000, vol7: 5 }, "в": { med7: 150000 }, "г": { med7: 150000 } }, ["а"]), {}, NOW);
  assert.strictEqual(r.items.length, 0, r.items.map((x) => x.name).join());
});

test("размер лота: не больше доли бюджета и не больше того, что разойдётся за holdDays при 10% оборота", () => {
  // игровой оборот 70/нед = 10/сутки -> 10% = 1/сутки -> за 3 дня 3 штуки, хотя бюджет позволил бы 64
  const r = scanFlips(market([item({})]), game({ "ларец": { med7: 150000, vol7: 70 } }), { budget: 26e6 }, NOW);
  assert.strictEqual(r.items[0].units, 3);
  assert.ok(r.items[0].cost <= 26e6 * 0.25);
  // с оборотом побольше упираемся уже в долю бюджета
  const r2 = scanFlips(market([item({})]), game({ "ларец": { med7: 150000, vol7: 70000 } }), { budget: 1e6 }, NOW);
  assert.ok(r2.items[0].cost <= 1e6 * 0.25 + 1, "доля бюджета: " + r2.items[0].cost);
});

test("раскладка бюджета не тратит больше бюджета, остаток считается", () => {
  const items = []; const g = {};
  for (let i = 0; i < 20; i++) { items.push(item({ name: "Ларец " + i, buy: 50000 + i * 1000, sell: 90000 + i * 1000 })); g["ларец " + i] = { med7: 90000 + i * 1000 }; }
  const r = scanFlips(market(items), game(g), { budget: 5e6 }, NOW);
  assert.ok(r.portfolio.spent <= 5e6, "потрачено " + r.portfolio.spent);
  assert.strictEqual(r.portfolio.left, 5e6 - r.portfolio.spent);
  assert.ok(r.portfolio.profitPerCycle > 0 && r.portfolio.profitPerDay > 0);
});

test("риск-флаги режут рейтинг: падающий предмет ниже стабильного с той же маржой", () => {
  const r = scanFlips(market([item({ name: "Падает", change: -20 }), item({ name: "Стабилен" })]), game({ "падает": { med7: 150000 }, "стабилен": { med7: 150000 } }), {}, NOW);
  assert.strictEqual(r.items[0].name, "Стабилен");
  assert.ok(r.items[1].flags.includes("falling"));
});

test("фильтры: категория и поиск по названию; устаревшие цены ArzMarket помечаются", () => {
  const items = [item({ name: "Ларец А", cat: "Кейсы" }), item({ name: "Бронза", cat: "Прочее" })];
  const g = game({ "ларец а": { med7: 150000 }, "бронза": { med7: 150000 } });
  assert.deepStrictEqual(scanFlips(market(items), g, { cat: "Кейсы" }, NOW).items.map((x) => x.name), ["Ларец А"]);
  assert.deepStrictEqual(scanFlips(market(items), g, { q: "брон" }, NOW).items.map((x) => x.name), ["Бронза"]);
  const old = scanFlips(market(items), g, {}, Date.parse("2026-12-10T00:00:00"));
  assert.ok(old.staleDays > 7 && old.items[0].flags.includes("stale"));
});

test("пустые и кривые входные данные не роняют расчёт", () => {
  assert.strictEqual(scanFlips(null, null, {}, NOW).ok, false);
  assert.strictEqual(scanFlips({ items: [{ name: "x" }, null, { name: "y", buy: 0, sell: 5 }] }, null, {}, NOW).items.length, 0);
  assert.strictEqual(dispersion([]), null);
  assert.ok(dispersion([100, 100, 100]) === 0);
});

console.log(`\n${passed} passed${process.exitCode ? ", есть падения" : ""}`);
