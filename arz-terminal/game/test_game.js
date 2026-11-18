"use strict";
/* Тесты game/*.js на синтетических данных (реальные логи аккаунта в репо не кладём).
 * Запуск: node game/test_game.js   (или npm test) */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const parser = require("./arz_parser");
const value = require("./arz_value");
const stats = require("./arz_stats");
const { createHistory } = require("./arz_history");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("ok   " + name); }
  catch (e) { console.error("FAIL " + name + "\n     " + e.message); process.exitCode = 1; }
}

const block = (head, name, payload) => `${head}\nwindow.executeEvent('${name}', \`${payload}\`);\n-----\n`;
const inv = (action, type, items) => JSON.stringify([{ action, data: { type, items } }]);
const slot = (n, item, amount) => (item ? { slot: n, available: 1, blackout: 0, item, amount } : { slot: n, available: 1, blackout: 0 });

/* ---------------- парсер ---------------- */

test("parseLog: оба формата заголовка и отсев не из белого списка", () => {
  const text =
    block("[08:45:48] #1 event.player.updateMoney", "event.player.updateMoney", "[1000]") +
    block("[2026-11-18 09:00:01] #2 event.player.updateMoney", "event.player.updateMoney", "[2000]") +
    block("[09:00:02] #3 event.api.setToken", "event.api.setToken", '["SECRET"]');
  const ev = parser.parseLog(text);
  assert.strictEqual(ev.length, 2, "токен-событие должно быть отброшено");
  assert.deepStrictEqual([ev[0].date, ev[0].ts], [null, "08:45:48"]);
  assert.deepStrictEqual([ev[1].date, ev[1].ts], ["2026-11-18", "09:00:01"]);
});

test("replay: split и перенос слотов, пустой слот = удаление", () => {
  const load = inv(0, 1, [slot(0, 8141, 1), slot(3, 5818, 10), slot(4, 0)]);
  const upd1 = inv(2, 1, [slot(3, 5818, 5)]);
  const upd2 = inv(2, 1, [slot(6, 5818, 5)]);
  const upd3 = inv(2, 1, [slot(7, 8141, 1), slot(0, 0)]);
  let text = "";
  [load, upd1, upd2, upd3].forEach((p, i) => { text += block(`[10:00:0${i}] #${i} e`, "event.inventory.playerInventory", p); });
  const s = parser.summarize(parser.replay(text), { 8141: "Справочник", 5818: "Талон" });
  assert.deepStrictEqual(s.inventory.map((r) => [r.slot, r.name, r.amount]), [[3, "Талон", 5], [6, "Талон", 5], [7, "Справочник", 1]]);
  assert.strictEqual(s.totals.find((t) => t.item === 5818).amount, 10);
  assert.strictEqual(s.baseline, true);
  assert.deepStrictEqual(s.slots, { used: 3, total: 5 });
});

test("baseline=false без полной загрузки, слоты неизвестны", () => {
  const text = block("[10:00:00] #1 e", "event.inventory.playerInventory", inv(2, 1, [slot(3, 5818, 5)]));
  const s = parser.summarize(parser.replay(text), {});
  assert.strictEqual(s.baseline, false);
  assert.strictEqual(s.slots.total, 0);
});

/* ---------------- оценка стоимости ---------------- */

test("valueInventory: скупка/продажа/середина и предметы без цены", () => {
  const market = { server: "yuma", data_date_max: "2026-11-16", items: [
    { name: "Дрова", buy: 722, sell: 902 }, { name: "Материалы", buy: 1317, sell: 2426 }, { name: "Только продажа", buy: 0, sell: 500 } ] };
  const summary = { server: "Yuma", totals: [
    { item: 1, name: "Дрова", amount: 100 }, { item: 2, name: "Материалы", amount: 10 },
    { item: 3, name: "Справочник", amount: 1 }, { item: 4, name: "Только продажа", amount: 2 } ] };
  const v = value.valueInventory(summary, market, Date.parse("2026-11-18"));
  assert.strictEqual(v.quick, 100 * 722 + 10 * 1317);
  assert.strictEqual(v.ask, 100 * 902 + 10 * 2426 + 2 * 500);
  assert.strictEqual(v.estimate, 100 * 812 + 10 * 1872 + 2 * 500);
  assert.strictEqual(v.unpriced.length, 1);
  assert.strictEqual(v.pricesAgeDays, 2);
});

test("valueInventory: чужой сервер -> ok:false, а не молчаливый ноль", () => {
  const v = value.valueInventory({ server: "Phoenix", totals: [] }, null);
  assert.strictEqual(v.ok, false);
});

/* ---------------- время и заработок ---------------- */

const T0 = new Date(2026, 10, 18, 12, 0, 0).getTime(); // 18.11.2026 12:00 local
const MIN = 60 * 1000;
const fmtDt = (ms) => {
  const d = new Date(ms), p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const fmtTm = (ms) => {
  const d = new Date(ms), p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const ev = (t, name, arg, dated = true) => ({ name, args: [arg], ts: fmtTm(t), date: dated ? fmtDt(t) : null });
const money = (t, m, d) => ev(t, "event.player.updateMoney", m, d);
const sat = (t, s) => ev(t, "event.arizonahud.playerSatiety", s);

test("assignTimes: недатированные события через полночь", () => {
  const events = [
    { name: "a", args: [], ts: "23:50:00", date: null },
    { name: "b", args: [], ts: "00:10:00", date: null },
  ];
  const anchor = new Date(2026, 10, 19, 0, 15, 0).getTime(); // файл менялся 19.11 00:15
  const t = stats.assignTimes(events, anchor);
  assert.strictEqual(fmtDt(t[1].t), "2026-11-19");
  assert.strictEqual(fmtDt(t[0].t), "2026-11-18");
  assert.strictEqual(fmtTm(t[0].t), "23:50:00");
});

test("earnings: приход/расход, первое значение — точка отсчёта", () => {
  const events = [
    money(T0, 1000), sat(T0 + 5 * MIN, 90),
    money(T0 + 10 * MIN, 6000),   // +5000
    sat(T0 + 15 * MIN, 89),
    money(T0 + 20 * MIN, 4000),   // -2000
    sat(T0 + 25 * MIN, 88),
    money(T0 + 30 * MIN, 7000),   // +3000
  ];
  const now = T0 + 31 * MIN;
  const e = stats.earnings(stats.timeline(events, now), now);
  assert.strictEqual(e.active, true);
  assert.strictEqual(e.samples, 3);
  const s = e.windows.session;
  assert.strictEqual(s.income, 8000);
  assert.strictEqual(s.spend, -2000);
  assert.strictEqual(s.net, 6000);
  assert.strictEqual(s.incomePerHour, Math.round(8000 / (31 / 60)));
  // окно 15 минут: ws = T0+16 -> только -2000 (на 20-й) и +3000 (на 30-й)
  assert.strictEqual(e.windows.m15.income, 3000);
  assert.strictEqual(e.windows.m15.spend, -2000);
});

test("earnings: одно крупное поступление помечается oneOff", () => {
  const events = [
    money(T0, 1000), sat(T0 + 3 * MIN, 90), money(T0 + 5 * MIN, 1500), sat(T0 + 8 * MIN, 89),
    money(T0 + 10 * MIN, 951500), // +950000 разово
  ];
  const now = T0 + 11 * MIN;
  const w = stats.earnings(stats.timeline(events, now), now).windows.session;
  assert.strictEqual(w.maxIncome, 950000);
  assert.strictEqual(w.oneOff, true);
  // ровная работа без выбросов — не oneOff
  const even = [money(T0, 0), money(T0 + 4 * MIN, 1000), money(T0 + 8 * MIN, 2000), money(T0 + 12 * MIN, 3000)];
  const w2 = stats.earnings(stats.timeline(even, T0 + 13 * MIN), T0 + 13 * MIN).windows.session;
  assert.strictEqual(w2.oneOff, false);
});

test("earnings: меньше 3 минут -> «в час» не считаем", () => {
  const events = [money(T0, 1000), money(T0 + 1 * MIN, 5000)];
  const now = T0 + 2 * MIN;
  const e = stats.earnings(stats.timeline(events, now), now);
  assert.strictEqual(e.windows.session.income, 4000);
  assert.strictEqual(e.windows.session.incomePerHour, null);
});

test("earnings: разрыв > 15 мин начинает новую сессию", () => {
  const events = [
    money(T0, 1000), money(T0 + 5 * MIN, 9000),            // старая сессия: +8000
    money(T0 + 60 * MIN, 2000), sat(T0 + 62 * MIN, 80),     // новая: точка отсчёта 2000
    money(T0 + 70 * MIN, 2500),                             // +500
  ];
  const now = T0 + 71 * MIN;
  const e = stats.earnings(stats.timeline(events, now), now);
  assert.strictEqual(e.windows.session.income, 500, "доход старой сессии не должен просачиваться");
  assert.strictEqual(e.sessionStart, new Date(T0 + 60 * MIN).toISOString());
});

test("earnings: игра неактивна -> окна считаются до последнего события", () => {
  const events = [money(T0, 1000), sat(T0 + 5 * MIN, 90), money(T0 + 10 * MIN, 4000)];
  const now = T0 + 5 * 60 * MIN; // через 5 часов
  const e = stats.earnings(stats.timeline(events, now), now);
  assert.strictEqual(e.active, false);
  assert.strictEqual(e.windows.session.elapsedSec, 10 * 60);
  assert.strictEqual(e.windows.session.income, 3000);
});

test("timeline: повтор того же значения денег не создаёт точку", () => {
  const events = [money(T0, 1000), money(T0 + MIN, 1000), money(T0 + 2 * MIN, 1500)];
  const tl = stats.timeline(events, T0 + 3 * MIN);
  assert.strictEqual(tl.money.length, 2);
});

/* ---------------- история капитала ---------------- */

test("history: троттлинг, прореживание и вычистка старого", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arzhist-"));
  const file = path.join(dir, "h.jsonl");
  let now = 1_700_000_000_000;
  const h = createHistory(file, () => now);
  assert.strictEqual(h.record(now, 100, 10, 90), true);
  assert.strictEqual(h.record(now + 30_000, 120, 10, 110), false, "чаще раза в минуту нельзя");
  assert.strictEqual(h.record(now + 61_000, 120, 10, 110), true, "изменилось и прошла минута");
  assert.strictEqual(h.record(now + 2 * 60_000, 120, 10, 110), false, "не менялось < 5 мин");
  assert.strictEqual(h.record(now + 7 * 60_000, 120, 10, 110), true, "не менялось, но прошло 5+ мин");
  assert.strictEqual(h.size(), 3);

  // перезапуск читает файл с диска
  const again = createHistory(file, () => now + 8 * 60_000);
  assert.strictEqual(again.size(), 3);

  // прореживание: последняя точка всегда на месте
  const big = createHistory(path.join(dir, "big.jsonl"), () => now + 1e9);
  for (let i = 0; i < 1000; i++) big.record(now + 1e9 - (1000 - i) * 120_000, i, 0, 0);
  const s = big.series(100);
  assert.ok(s.length <= 100);
  assert.strictEqual(s[s.length - 1][1], 999);

  // вычистка старше 14 дней
  const old = createHistory(file, () => now + 20 * 86400000);
  assert.strictEqual(old.size(), 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

console.log(`\n${passed} passed${process.exitCode ? ", есть падения" : ""}`);
