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
const gameprices = require("./arz_gameprices");

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

/* ---------------- игровые цены Центрального рынка ---------------- */

// Структура реального блока (образец из игры), цены вымышленные.
const gpBlock = (ts, title, rows) =>
  `[${ts}] DIALOG id=15073 style=5 title={BFBBBA}${title}\n{ffff00}Предмет\t{ffff00}За последние 30 дней\n` +
  `{cccccc}Поиск по названию\t \n{ff0000}Предыдущая страница\t \n{ff0000}Следующая страница\t \n` +
  rows.map((r) => `${r[0]}\t${r[1]}`).join("\n") + "\n-----\n";

test("parseGamePrices: цены с точками, служебные строки отброшены, SA$ и VC$ раздельно", () => {
  const text = gpBlock("2026-11-18 16:31:03", "Средняя цена товаров при продаже", [
    ["Case Capture", ":CASH:11.877.792"], ["Дрова", ":CASH:34.183"], ["VC вещь", ":CASHV:1.500"] ]);
  const g = gameprices.parseGamePrices(text);
  assert.strictEqual(g.sale.sa["case capture"].price, 11877792);
  assert.strictEqual(g.sale.sa["дрова"].price, 34183);
  assert.strictEqual(g.sale.vc["vc вещь"].price, 1500);
  assert.strictEqual(g.rows, 3);
  assert.ok(!g.sale.sa["поиск по названию"] && !g.sale.sa["следующая страница"] && !g.sale.sa["предмет"]);
  assert.ok(g.updatedAt > 0);
});

test("parseGamePrices: страницы дополняют друг друга, позднее перекрывает раннее; чужие диалоги игнорируются", () => {
  const text =
    gpBlock("2026-11-18 16:31:03", "Средняя цена товаров при продаже", [["А", ":CASH:100"], ["Б", ":CASH:200"]]) +
    gpBlock("2026-11-18 16:31:20", "Средняя цена товаров при продаже", [["Б", ":CASH:250"], ["В", ":CASH:300"]]) +
    gpBlock("2026-11-18 16:31:30", "Основная статистика", [["Секрет", ":CASH:999"]]);
  const g = gameprices.parseGamePrices(text);
  assert.deepStrictEqual(["а", "б", "в"].map((k) => g.sale.sa[k].price), [100, 250, 300]);
  assert.ok(!g.sale.sa["секрет"], "диалог не про цены читать не должны");
  assert.strictEqual(g.dialogs, 2);
});

test("parseGamePrices: пустой/мусорный лог не падает", () => {
  assert.strictEqual(gameprices.parseGamePrices("").rows, 0);
  assert.strictEqual(gameprices.parseGamePrices("мусор\n-----\nещё мусор").rows, 0);
});

// Окно истории одного предмета: дата, число продаж, средняя цена за день (новые сверху, как в игре).
const histBlock = (ts, name, days, tail) =>
  `[${ts}] DIALOG id=15074 style=5 title={BFBBBA}Продажа товара '${name}' за последние 30 дней${tail || ""}\n` +
  `{ffff00}Дата\t{ffff00}Количество продаж\t{ffff00}Средняя цена за день\n` +
  days.map((d) => `${d[0]}\t${d[1]}\t:CASH:${String(d[2]).replace(/\B(?=(\d{3})+$)/g, ".")}`).join("\n") + "\n-----\n";

test("история предмета: разбор по дням, сводка за 7/30 дней, вес по числу продаж", () => {
  const days = [];
  for (let i = 0; i < 30; i++) days.push(["2026-11-" + String(30 - i).padStart(2, "0"), i < 7 ? 100 : 50, i < 7 ? 2000 : 1000]);
  // хвост " b1=.. b2=.." (так пишет разведчик) парсер терпит
  const g = gameprices.parseGamePrices(histBlock("2026-11-18 16:35:00", "Case Capture", days, " b1=Назад b2=Закрыть"));
  const h = g.history.sale.sa["case capture"];
  assert.strictEqual(g.historyItems, 1);
  assert.strictEqual(h.days.length, 30);
  assert.strictEqual(h.summary.avg7, 2000);
  assert.strictEqual(h.summary.vol7, 700);
  // 30 дн.: (7*100*2000 + 23*50*1000) / (700 + 1150) = 2 550 000 / 1850 ... проверяем через формулу
  assert.strictEqual(h.summary.avg30, Math.round((7 * 100 * 2000 + 23 * 50 * 1000) / (7 * 100 + 23 * 50)));
  assert.ok(h.summary.trendPct > 0, "цена за неделю выше месячной -> тренд вверх");
  assert.strictEqual(h.summary.lastDate, "2026-11-30");
});

test("история: дни-выбросы (одна странная сделка) не ломают цену и тренд — считаем по медиане", () => {
  // как у «Опыта депозита»: обычно ~350 тыс., но в отдельные дни «средняя» 1,1–14 млн из-за единичных сделок
  const days = [];
  for (let i = 0; i < 30; i++) days.push(["2026-11-" + String(30 - i).padStart(2, "0"), 200, 350000]);
  days[10][2] = 14121709;   // 20 ноября: выброс
  days[12][2] = 1119896;    // 18 ноября: выброс
  days[20][2] = 1295642;
  const s = gameprices.summarizeHistory(days.map((d) => ({ date: d[0], count: d[1], price: d[2] })));
  assert.strictEqual(s.med7, 350000);
  assert.strictEqual(s.med30, 350000);
  assert.strictEqual(s.trendPct, 0, "цена не падала — тренд 0, а не «−55%», как показало бы среднее");
  assert.ok(s.avg30 > 700000, "среднее за 30 дней действительно искажено (" + s.avg30 + ") — поэтому его не используем");
});

test("история предмета: мусор и чужие/неполные окна не ломают разбор", () => {
  const bad = "[2026-11-18 10:00:00] DIALOG id=1 style=5 title=Продажа товара 'X' за последние 30 дней\nСлучайный текст\n-----\n" +
    "[2026-11-18 10:00:01] DIALOG id=2 style=5 title=Покупка товара 'Y' за последние 30 дней\n2026-11-01\t5\t:CASH:100\n-----\n";
  const g = gameprices.parseGamePrices(bad);
  assert.ok(!g.history.sale.sa["x"], "без строк с ценой записи нет");
  assert.strictEqual(g.history.buy.sa["y"].days.length, 1, "«Покупка» попадает в buy");
  assert.strictEqual(gameprices.summarizeHistory([]), null);
});

test("история: заголовок обрезан сервером (хвост без «30 дней» / обрезано внутри имени)", () => {
  const long = "Инструкция для снятия коллекционных характеристик";
  const days = [["2026-11-18", 25, 2979999], ["2026-11-17", 29, 3797349]];
  const list = gpBlock("2026-11-18 16:00:00", "Средняя цена товаров при продаже", [[long, ":CASH:3.000.000"]]);
  // 1) как в реальной игре: " за последние" без "30 дней"
  const raw1 = histBlock("2026-11-18 16:58:02", long, days).replace(" за последние 30 дней", " за последние");
  const g1 = gameprices.parseGamePrices(list + raw1);
  assert.strictEqual(g1.historyItems, 1);
  assert.strictEqual(g1.history.sale.sa[long.toLowerCase()].days.length, 2);
  // 2) обрезано внутри имени, кавычки нет -> имя достраиваем по списку (однозначное совпадение)
  const raw2 = histBlock("2026-11-18 16:58:02", long, days).replace(/'.*? за последние 30 дней/, "'Инструкция для снятия колл");
  const g2 = gameprices.parseGamePrices(list + raw2);
  assert.strictEqual(g2.historyItems, 1);
  assert.strictEqual(g2.history.sale.sa[long.toLowerCase()].name, long);
  // 3) неоднозначное начало -> не гадаем
  const list2 = gpBlock("2026-11-18 16:00:00", "Средняя цена товаров при продаже", [[long, ":CASH:1"], [long + " 2", ":CASH:2"]]);
  const g3 = gameprices.parseGamePrices(list2 + raw2);
  assert.strictEqual(g3.historyItems, 0);
  assert.strictEqual(g3.unresolvedHistories, 1);
});

test("история: пробел на конце имени, апостроф и обрезка хвоста в любом месте", () => {
  const tail = " за последние 30 дней";
  // «Аркана ИО » — пробел на конце есть и в списке, и в заголовке
  assert.deepStrictEqual(gameprices.parseHistoryTitle("{BFBBBA}Продажа товара 'Аркана ИО ' за последние 30 дней"),
    { kind: "sale", name: "Аркана ИО", truncated: false });
  assert.strictEqual(gameprices.parseHistoryTitle("Продажа товара 'O'Neil Box 7' за последние 30 дней").name, "O'Neil Box 7");
  for (let cut = 0; cut <= tail.length; cut++) {          // 0 — полный хвост, tail.length — остался только «'»
    const t = gameprices.parseHistoryTitle("Продажа товара 'Case Capture'" + tail.slice(0, tail.length - cut));
    assert.ok(t && t.name === "Case Capture" && !t.truncated, "cut=" + cut + " -> " + JSON.stringify(t));
  }
  // без кавычки — обрезано внутри имени
  assert.strictEqual(gameprices.parseHistoryTitle("Продажа товара 'Case Capt").truncated, true);
  // и через разбор лога: ключ без пробела на конце совпадает с ключом списка
  const list = gpBlock("2026-11-18 16:00:00", "Средняя цена товаров при продаже", [["Аркана ИО ", ":CASH:517.973.695"]]);
  const hist = histBlock("2026-11-18 17:09:00", "Аркана ИО ", [["2026-11-16", 1, 600000000]]);
  const g = gameprices.parseGamePrices(list + hist);
  assert.ok(g.sale.sa["аркана ио"] && g.history.sale.sa["аркана ио"], "ключи списка и истории совпадают");
});

test("«нет операций за 30 дней»: пустое окно истории = предмет не продаётся, цену из списка не берём", () => {
  const empty = (ts, name, tail) =>
    `[${ts}] DIALOG id=15074 style=0 title={BFBBBA}Продажа товара '${name}' за последние 30 дней${tail || ""}\n` +
    `{ffffff}За последние 30 дней не найдено ни одной операции с этим товаром.\n-----\n`;
  const list = gpBlock("2026-11-18 16:00:00", "Средняя цена товаров при продаже", [["Нашивка", ":CASH:5.000"], ["Мёртвая вещь", ":CASH:9.000"], ["Живая вещь", ":CASH:100"]]);
  // второе окно обрезано сервером прямо внутри имени: ни кавычки, ни хвоста
  const cutInside = "[2026-11-18 17:00:05] DIALOG id=15074 style=0 title={BFBBBA}Продажа товара 'Мёртв\n" +
    "{ffffff}За последние 30 дней не найдено ни одной операции с этим товаром.\n-----\n";
  const text = list + empty("2026-11-18 17:00:00", "Нашивка") + cutInside
    + histBlock("2026-11-18 17:00:10", "Живая вещь", [["2026-11-17", 3, 110]]);
  const g = gameprices.parseGamePrices(text);
  assert.ok(g.noSales.sale["нашивка"], "пустое окно запоминается");
  assert.ok(g.noSales.sale["мёртвая вещь"], "обрезанное имя достраивается по списку");
  assert.strictEqual(g.noSalesItems, 2);
  assert.strictEqual(g.historyItems, 1, "пустые окна историей не считаются");
  // позднее окно с продажами снимает «нет продаж»
  const g2 = gameprices.parseGamePrices(text + histBlock("2026-11-18 18:00:00", "Нашивка", [["2026-11-18", 1, 6000]]));
  assert.ok(!g2.noSales.sale["нашивка"] && g2.history.sale.sa["нашивка"]);
  // а позднее «нет продаж» снимает старую историю
  const g3 = gameprices.parseGamePrices(histBlock("2026-11-18 10:00:00", "Нашивка", [["2026-11-01", 1, 6000]]) + empty("2026-11-18 11:00:00", "Нашивка"));
  assert.ok(g3.noSales.sale["нашивка"] && !g3.history.sale.sa["нашивка"]);

  const market = { server: "yuma", data_date_max: "2026-11-16", items: [{ name: "Мёртвая вещь", buy: 900, sell: 1100 }] };
  const summary = { server: "Yuma", totals: [
    { item: 1, name: "Мёртвая вещь", amount: 10 },    // на рынке есть, в игре 0 сделок
    { item: 2, name: "Нашивка", amount: 1 },          // на рынке нет, в игре 0 сделок
    { item: 3, name: "Живая вещь", amount: 2 } ] };   // на рынке нет, в игре есть история
  const v = value.valueInventory(summary, market, Date.parse("2026-11-18"), g);
  const row = (n) => v.rows.find((r) => r.name === n);
  assert.strictEqual(row("Мёртвая вещь").gameNoSales, true);
  assert.strictEqual(row("Мёртвая вещь").game, 0, "устаревшую цену списка не используем");
  assert.strictEqual(row("Нашивка").priced, false, "цену из списка для непродающегося не берём");
  assert.strictEqual(row("Нашивка").noSales, true);
  assert.strictEqual(row("Живая вещь").src, "game");
  assert.strictEqual(v.noSalesCount, 1);
  assert.strictEqual(v.noSalesValue, 10 * 1000);
  assert.ok(value.advise({ baseline: true, slots: {} }, v).some((t) => t.text.includes("не продавались")));
});

test("valueInventory: если есть история, игровая цена = за 7 дней, и видна ликвидность", () => {
  const market = { server: "yuma", data_date_max: "2026-11-16", items: [{ name: "Case Capture", buy: 1900, sell: 2100 }] };
  const summary = { server: "Yuma", totals: [{ item: 1, name: "Case Capture", amount: 3 }] };
  const days = [["2026-11-18", 10, 2000], ["2026-11-17", 30, 2200]];       // avg7 = (10*2000+30*2200)/40 = 2150
  const gp = gameprices.parseGamePrices(
    gpBlock("2026-11-18 16:31:03", "Средняя цена товаров при продаже", [["Case Capture", ":CASH:9.999"]]) +
    histBlock("2026-11-18 16:35:00", "Case Capture", days));
  const v = value.valueInventory(summary, market, Date.parse("2026-11-18"), gp);
  const r = v.rows[0];
  assert.strictEqual(r.game, 2100, "история важнее среднего за 30 дней из списка; берём медиану дневных цен (2000 и 2200)");
  assert.strictEqual(r.gameHist.vol7, 40);
  assert.strictEqual(r.gameDiverge, false);
  assert.strictEqual(v.estimate, 3 * 2000, "оценка по-прежнему от ArzMarket");
});

test("valueInventory + игровые цены: сверка, запасной вариант, расхождение и валюта", () => {
  const market = { server: "yuma", data_date_max: "2026-11-16", items: [
    { name: "Металл", buy: 340, sell: 360 }, { name: "Дрова", buy: 722, sell: 902 } ] };
  const summary = { server: "Yuma", totals: [
    { item: 1, name: "Металл", amount: 10 }, { item: 2, name: "Дрова", amount: 10 },
    { item: 3, name: "Case Capture", amount: 2 }, { item: 4, name: "Нет нигде", amount: 1 } ] };
  const gp = gameprices.parseGamePrices(gpBlock("2026-11-18 16:31:03", "Средняя цена товаров при продаже", [
    ["Металл", ":CASH:332"], ["Дрова", ":CASH:34.183"], ["Case Capture", ":CASH:1.000"] ]));
  const v = value.valueInventory(summary, market, Date.parse("2026-11-18"), gp);
  const row = (n) => v.rows.find((r) => r.name === n);
  // совпадает с ArzMarket -> просто сверка, цена прежняя
  assert.strictEqual(row("Металл").mid, 350);
  assert.strictEqual(row("Металл").gameDiverge, false);
  // расходится в десятки раз -> флаг, но цена остаётся рыночной
  assert.strictEqual(row("Дрова").gameDiverge, true);
  assert.strictEqual(row("Дрова").mid, 812);
  // на рынке цены нет, игра знает -> запасной вариант, помечен и не входит в quick/ask
  assert.strictEqual(row("Case Capture").src, "game");
  assert.strictEqual(row("Case Capture").total, 2000);
  assert.strictEqual(v.gameOnly, 1);
  assert.strictEqual(v.quick, 10 * 340 + 10 * 722);
  assert.strictEqual(v.estimate, 10 * 350 + 10 * 812 + 2000);
  assert.strictEqual(v.unpriced.length, 1, "«Нет нигде» остаётся без цены");
  // советы упоминают сомнительную позицию
  assert.ok(value.advise({ baseline: true, slots: {} }, v).some((t) => t.text.includes("Дрова")));
  // без игровых цен всё как раньше
  const v0 = value.valueInventory(summary, market, Date.parse("2026-11-18"));
  assert.strictEqual(v0.gameOnly, 0);
  assert.strictEqual(v0.unpriced.length, 2);
  // валюты не смешиваются: на VC SA$-цены игнорируются
  const vcMarket = { server: "vc", data_date_max: "2026-11-16", items: [] };
  const vv = value.valueInventory({ server: "Vice City", totals: summary.totals }, vcMarket, Date.parse("2026-11-18"), gp);
  assert.strictEqual(vv.gameOnly, 0);
});

/* ---------------- банк и депозит ---------------- */

const bank = require("./arz_bank");
// Структура реальных событий (суммы вымышленные): депозит 266 млн при лимите 120 млн.
const depositPayload = (o) => JSON.stringify([{ bankDeposit: Object.assign({ money: 266000000, percents: { withdraw: 7, deposit: 0 },
  disabledTime: { withdraw: 0, deposit: 3325, upgrade: 6904 }, level: 1, maxLevel: 5, limit: 120000000, description: "x" }, o),
  income: { poyDayIncome: 178772 } }]);
const mainPayload = JSON.stringify([{ bankAccounts: [{ id: 0, money: 32000000, percents: { withdraw: 1, deposit: 0, transfer: 0 } },
  { id: 1, buyCost: 100000000 }, { id: 2, buyCost: 100000000 }], organization: { enable: true, id: 25, money: 198000000 } }]);

test("банк: события попадают в состояние (депозит и купленные счета), чужие суммы организации не берём", () => {
  const text =
    block("[2026-11-18 18:25:31] #1 e", "event.bank.updateDepositData", depositPayload()) +
    block("[2026-11-18 18:25:32] #2 e", "event.bank.updateMainData", mainPayload);
  const s = parser.summarize(parser.replay(text), {});
  assert.strictEqual(s.bank.deposit.money, 266000000);
  assert.strictEqual(s.bank.deposit.limit, 120000000);
  assert.strictEqual(s.bank.deposit.incomePerPayday, 178772);
  assert.strictEqual(s.bank.deposit.withdrawPct, 7);
  assert.strictEqual(s.bank.deposit.upgradeCooldownSec, 6904);
  assert.deepStrictEqual(s.bank.accounts.map((a) => [a.id, a.money]), [[0, 32000000]], "только купленные счета (у непроданных buyCost, а не money)");
  assert.strictEqual(s.bank.depositIdx, 0);
  assert.strictEqual(s.bank.accountsIdx, 1);
});

test("банк: без окна банка данных нет; битое событие не затирает прежние", () => {
  const empty = parser.summarize(parser.replay(""), {});
  assert.strictEqual(empty.bank.deposit, null);
  const good = block("[10:00:00] #1 e", "event.bank.updateDepositData", depositPayload());
  const broken = block("[10:01:00] #2 e", "event.bank.updateDepositData", JSON.stringify([{ nothing: 1 }]));
  assert.strictEqual(parser.summarize(parser.replay(good + broken), {}).bank.deposit.money, 266000000);
});

test("analyzeDeposit: деньги сверх лимита не приносят, считаем упущенное", () => {
  const dep = bank.parseDeposit(JSON.parse(depositPayload())[0]);
  const a = bank.analyzeDeposit(dep);
  assert.strictEqual(a.covered, 120000000);
  assert.strictEqual(a.idle, 146000000);
  assert.strictEqual(a.ratePerMillion, Math.round(178772 / 120));            // ≈ 1490 за PayDay на каждый миллион лимита
  assert.strictEqual(a.lostPerPayday, Math.round((178772 / 120) * 146));      // ≈ 217 тыс. за PayDay
  assert.strictEqual(a.potentialPerPayday, 178772 + a.lostPerPayday);
  // рост лимита: пока есть простаивающие деньги — прибавка; больше, чем простаивает, не засчитываем
  assert.strictEqual(bank.gainForLimit(dep, 30000000), Math.round((178772 / 120) * 30));
  assert.strictEqual(bank.gainForLimit(dep, 500000000), a.lostPerPayday);
  // следующий уровень берём из таблицы проекта
  const next = bank.nextLevelGain(dep, [{ level: 1, limit_add: 20000000 }, { level: 2, limit_add: 30000000 }]);
  assert.deepStrictEqual([next.level, next.limitAdd], [2, 30000000]);
  assert.strictEqual(bank.nextLevelGain(dep, [{ level: 1, limit_add: 1 }]), null, "уровня выше нет — null");
  // деньги меньше лимита: ничего не простаивает, остаётся запас
  const small = bank.analyzeDeposit(bank.parseDeposit(JSON.parse(depositPayload({ money: 50000000 }))[0]));
  assert.strictEqual(small.idle, 0);
  assert.strictEqual(small.headroom, 70000000);
  assert.strictEqual(small.lostPerPayday, 0);
  assert.strictEqual(bank.analyzeDeposit(null), null);
});

test("банк + чек PayDay: лимит вырос (семья +100 млн, ранг 8) — окно банка помечается устаревшим, а формула дохода подтверждается", () => {
  // доход линеен по сумме до лимита, надбавки перемножаются: 357 540 × (220/120) × (1,30/1,15) ≈ 740 993 (в чеке 740 996)
  assert.ok(Math.abs(357540 * (220 / 120) * (1.30 / 1.15) - 740996) < 10, "совпадает до округления игры (740 993 против 740 996)");
  const sb = () => ({ deposit: { money: 267131102, limit: 120000000, incomePerPayday: 357540, level: 1, maxLevel: 5 }, depositIdx: 0, accounts: [{ id: 0, money: 33000000 }], accountsIdx: 0 });
  const times = [new Date(2026, 10, 18, 18, 31, 0).getTime()];
  const pdAt = (income) => ({ last: { at: new Date(2026, 10, 18, 21, 30, 2).getTime(), depositTotal: 268229638, depositIncome: income, bankTotal: 36268192 } });
  const b = sb();
  bank.freshenBank(b, times, pdAt(740996));
  assert.strictEqual(b.deposit.money, 268229638, "остаток из чека");
  assert.ok(b.deposit.stale && b.deposit.stale.checkIncome === 740996 && b.deposit.stale.windowIncome === 357540, "доход в чеке вдвое выше окна — окно устарело");
  assert.strictEqual(b.accounts[0].money, 36268192);
  // тот же доход (лимит не менялся) — ничего не устарело
  const same = sb();
  bank.freshenBank(same, times, pdAt(357540));
  assert.ok(!same.deposit.stale, "доход совпал — окно в порядке");
  // чек старее окна — ничего не трогаем
  const old = sb();
  bank.freshenBank(old, [new Date(2026, 10, 19, 0, 0, 0).getTime()], pdAt(740996));
  assert.strictEqual(old.deposit.money, 267131102);
  assert.ok(!old.deposit.stale);
  // совет: не «простаивает 148 млн», а просьба открыть окно банка
  const tips = value.advise({ baseline: true, slots: {}, bank: b }, null);
  assert.ok(tips.some((t) => /Окно банка устарело/.test(t.text) && /740/.test(t.text.replace(/\s/g, ""))), JSON.stringify(tips));
  assert.ok(!tips.some((t) => /Депозит работает на/.test(t.text)), "расчёт по устаревшему лимиту не показываем");
  assert.strictEqual(bank.freshenBank(null, [], null), undefined, "нет данных — не падаем");
});

test("совет про депозит: простаивающие деньги упомянуты, а при заполненном запасе совета нет", () => {
  const withIdle = parser.summarize(parser.replay(block("[10:00:00] #1 e", "event.bank.updateDepositData", depositPayload())), {});
  const tips = value.advise(withIdle, null);
  assert.ok(tips.some((t) => /Депозит работает на 120 из 266 млн/.test(t.text) && /146 млн/.test(t.text)), JSON.stringify(tips));
  assert.ok(tips.find((t) => /Депозит работает/.test(t.text)).level === "warn", "простаивает больше 20% — предупреждение");
  const ok = parser.summarize(parser.replay(block("[10:00:00] #1 e", "event.bank.updateDepositData", depositPayload({ money: 100000000 }))), {});
  assert.ok(!value.advise(ok, null).some((t) => /Депозит работает/.test(t.text)));
});

/* ---------------- PayDay: банковский чек из чата ---------------- */

const payday = require("./arz_payday");
// Строки — как на реальном скрине чека (цвета уже вырезаны экспортёром).
const chk = (ts, o) => {
  o = Object.assign({ bank: 33807078, bd: 389451, dep: 267131102, dd: 357540, sal: 389451, az: 12610, azd: 8, exp: 6 }, o || {});
  const f = (n) => String(n).replace(/\B(?=(\d{3})+$)/g, ".");
  return `[${ts}] CHAT  БАНКОВСКИЙ ЧЕК \n` +
    `[${ts}] CHAT Текущая сумма в банке: $${f(o.bank)} (+$${f(o.bd)})\n` +
    `[${ts}] CHAT В данный момент у вас 48-й уровень и 41/196 респектов (+${o.exp} EXP)\n` +
    `[${ts}] CHAT Текущая сумма на депозите: $${f(o.dep)} (+$${f(o.dd)})\n` +
    `[${ts}] CHAT Общая заработная плата: $${f(o.sal)}\n` +
    `[${ts}] CHAT Баланс на донат-счет: ${o.az} AZ (+${o.azd} AZ)\n`;
};

test("PayDay: чек разбирается по строкам реального скрина (банк, депозит, зарплата, уровень, AZ)", () => {
  const c = payday.parsePaydayLog(chk("2026-11-18 20:24:03"));
  assert.strictEqual(c.length, 1);
  assert.deepStrictEqual(c[0].bank, { total: 33807078, delta: 389451 });
  assert.deepStrictEqual(c[0].deposit, { total: 267131102, delta: 357540 });
  assert.strictEqual(c[0].salary, 389451);
  assert.deepStrictEqual(c[0].level, { level: 48, respect: 41, respectMax: 196, exp: 6 });
  assert.deepStrictEqual(c[0].az, { balance: 12610, delta: 8 });
  assert.strictEqual(c[0].t, new Date(2026, 10, 18, 20, 24, 3).getTime());
  // вариант записи знака «($+389.451)» и строка без прибавки
  assert.deepStrictEqual(payday.parseLine("Текущая сумма в банке: $33.807.078 ($+389.451)"), { key: "bank", total: 33807078, delta: 389451 });
  assert.deepStrictEqual(payday.parseLine("Текущая сумма на депозите: $267.131.102"), { key: "deposit", total: 267131102, delta: 0 });
  assert.strictEqual(payday.parseLine("Leonardo_Cash[59] кричит: Скуп Всего"), null);
});

test("PayDay: НАСТОЯЩИЙ лог игры (деньги как :CASH:…, значки :u1F4B0:, рамка «| »)", () => {
  // дословно из arz_payday.log, записанного экспортёром 18.11.2026 19:59:57
  const real = [
    "[2026-11-18 19:59:57] CHAT    :u1F4B0: БАНКОВСКИЙ ЧЕК :u1F4B0:",
    "[2026-11-18 19:59:57] CHAT | Текущая сумма в банке: :CASH:34.196.529 (+:CASH:389.451)",
    "[2026-11-18 19:59:57] CHAT | В данный момент у вас 48-й уровень и 47/196 респектов (+6 EXP)",
    "[2026-11-18 19:59:57] CHAT | Текущая сумма на депозите: :CASH:267.488.642 (+:CASH:357.540)",
    "[2026-11-18 19:59:57] CHAT | Общая заработная плата: :CASH:389.451",
    "[2026-11-18 19:59:57] CHAT | Баланс на донат-счет: 12642 AZ (+8 AZ)",
  ].join("\n");
  const c = payday.parsePaydayLog(real);
  assert.strictEqual(c.length, 1, "чек должен разобраться");
  assert.deepStrictEqual(c[0].bank, { total: 34196529, delta: 389451 });
  assert.deepStrictEqual(c[0].deposit, { total: 267488642, delta: 357540 });
  assert.strictEqual(c[0].salary, 389451);
  assert.deepStrictEqual(c[0].level, { level: 48, respect: 47, respectMax: 196, exp: 6 });
  assert.deepStrictEqual(c[0].az, { balance: 12642, delta: 8 });
  assert.deepStrictEqual(payday.parseLine("| Текущая сумма в банке: :CASHV:1.000 (+:CASHV:50)"), { key: "bank", total: 1000, delta: 50 }, "VC$ тоже");
});

test("PayDay: пропущенные выплаты — между чеками 90 минут, а банк вырос на ОДНУ выплату (реальный случай 18.11 19:59 -> 21:30)", () => {
  const text = chk("2026-11-18 19:59:57", { bank: 34196529, dep: 267488642, bd: 389451, dd: 357540, sal: 389451, exp: 6 }) +
    chk("2026-11-18 21:30:02", { bank: 36268192, dep: 268229638, bd: 2071663, dd: 740996, sal: 2071663, exp: 8 });
  const c = payday.parsePaydayLog(text);
  assert.strictEqual(c.length, 2);
  assert.strictEqual(c[1].bank.total - c[0].bank.total, c[1].salary, "банк вырос ровно на одну зарплату — остальные выплаты не засчитались");
  const st = payday.paydayStats(c, 0);
  assert.strictEqual(st.nominalMin, 30);
  assert.strictEqual(st.intervalMin, 90.1, "наблюдаемая пауза между чеками");
  assert.strictEqual(st.missed, 2, "90 минут = 3 слота по 30, засчитан один");
  assert.strictEqual(st.creditedShare, 0.33);
  assert.strictEqual(st.incomePerPayday, Math.round((389451 + 357540 + 2071663 + 740996) / 2), "медиана двух выплат");
  const latest = payday.paydayStats(c.slice(1), 0);
  assert.strictEqual(latest.incomePerPayday, 2071663 + 740996);
  assert.strictEqual(latest.incomePerHour, (2071663 + 740996) * 2, "если засчитываются все выплаты: ×2 в час");
  // а при ровных 30-минутных выплатах пропусков нет и «по журналу» = номинал
  const ok = payday.paydayStats(payday.parsePaydayLog(chk("2026-11-18 19:30:00") + chk("2026-11-18 20:00:00") + chk("2026-11-18 20:30:00")), 0);
  assert.strictEqual(ok.missed, 0);
  assert.strictEqual(ok.creditedShare, 1);
  assert.strictEqual(ok.incomePerHourActual, ok.incomePerHour);
  // настроенный интервал 60 минут
  assert.strictEqual(payday.paydayStats(c.slice(1), 0, { nominalMin: 60 }).incomePerHour, 2071663 + 740996);
});

test("PayDay: несколько выплат подряд, шапка отделяет чеки, пауза >8 с рвёт блок, мусор не мешает", () => {
  const text = "мусор без формата\n" +
    chk("2026-11-18 19:24:03", { bank: 33417627, dep: 266773562 }) +
    chk("2026-11-18 19:54:04", { bank: 33807078, dep: 267131102 }) +
    "[2026-11-18 19:54:30] CHAT Баланс на донат-счет: 1 AZ (+1 AZ)\n";           // «осиротевшая» строка не создаёт чек
  const c = payday.parsePaydayLog(text);
  assert.strictEqual(c.length, 2);
  assert.strictEqual(c[0].deposit.total, 266773562);
  assert.strictEqual(c[1].deposit.total, 267131102);
  // чек без шапки (если её не поймали) тоже собирается по первой строке полей
  const nohead = chk("2026-11-18 20:00:00").split("\n").slice(1).join("\n");
  assert.strictEqual(payday.parsePaydayLog(nohead).length, 1);
});

test("PayDay: статистика — доход за выплату, интервал, доход в час, AZ, сумма за сегодня; выбросы не ломают", () => {
  let text = "";
  const times = ["19:24:03", "19:54:04", "20:24:03", "20:54:03"];
  times.forEach((t) => { text += chk("2026-11-18 " + t); });
  text += chk("2026-11-18 21:24:03", { sal: 100, bd: 100, dd: 1 });                 // странная выплата: в медиане тонет
  const st = payday.paydayStats(payday.parsePaydayLog(text), new Date(2026, 10, 18, 21, 30, 0).getTime());
  assert.strictEqual(st.count, 5);
  assert.strictEqual(st.intervalMin, 30);
  assert.strictEqual(st.incomePerPayday, 389451 + 357540, "медиана: выброс не в счёт");
  assert.strictEqual(st.incomePerHour, (389451 + 357540) * 2, "30-минутные выплаты = ×2 в час");
  assert.strictEqual(st.azPerPayday, 8);
  assert.strictEqual(st.today.paydays, 5);
  assert.strictEqual(st.today.depositIncome, 357540 * 4 + 1);
  assert.strictEqual(st.last.depositTotal, 267131102);
  assert.strictEqual(st.sinceLastSec, 357, "21:30:00 минус 21:24:03");
  // разрыв больше 3 часов (другая сессия) интервалом не считается
  const two = payday.paydayStats(payday.parsePaydayLog(chk("2026-11-17 10:00:00") + chk("2026-11-18 20:00:00")), 0);
  assert.strictEqual(two.intervalMin, null);
  assert.strictEqual(two.incomePerHour, (389451 + 357540) * 2, "«в час» — по номиналу 30 мин, а не по случайной паузе");
  assert.strictEqual(two.incomePerHourActual, null, "фактическую долю по журналу считаем только когда есть соседние чеки одной сессии");
  assert.strictEqual(payday.paydayStats([], 0), null);
});

/* ---------------- что уходит в облако ---------------- */

const cloudmap = require("./arz_cloudmap");

test("облако: зеркало /api/player — точная копия одной JSON-строкой, подпись без «плавающих» полей", () => {
  const body = { ok: true, fileUpdated: "2026-11-18T10:00:00Z", summary: { money: 5 }, valuation: { ok: true, estimate: 9 }, tips: [],
    bank: null, netWorth: null, gamePrices: null, history: [[1, 2, 3, 4]], earnings: { a: 1 }, ageSec: 5, parsedAgoSec: 1,
    cloud: { enabled: true, uid: "SECRET-UID" } };
  const m = cloudmap.mirrorOf(body, Date.parse("2026-11-18T10:00:10Z"));
  const back = JSON.parse(m.data.payloadJson);
  assert.strictEqual(back.summary.money, 5);
  assert.strictEqual(back.valuation.estimate, 9);
  assert.ok(!("cloud" in back), "статус облака ПК (uid, проект) в зеркало не кладём");
  assert.strictEqual(m.data.schema, 1);
  // меняется только время/заработок -> подпись та же; меняются деньги -> другая
  const m2 = cloudmap.mirrorOf(Object.assign({}, body, { ageSec: 999, earnings: { a: 2 } }), 1);
  assert.strictEqual(m2.sig, m.sig);
  const m3 = cloudmap.mirrorOf(Object.assign({}, body, { summary: { money: 6 } }), 1);
  assert.notStrictEqual(m3.sig, m.sig);
  // слишком большой документ урезается по истории, а не теряется целиком
  const big = Object.assign({}, body, { history: Array.from({ length: 60000 }, (_, i) => [i, i, i, i]) });
  const mb = cloudmap.mirrorOf(big, 1);
  assert.ok(mb.data.payloadJson.length < 900 * 1000, "влезает в лимит Firestore");
  assert.strictEqual(JSON.parse(mb.data.payloadJson).history.length, 100);
});

test("облако: каталог игровых цен — чанки, сводка, дни одной строкой, «нет продаж»", () => {
  const list = [];
  for (let i = 0; i < 250; i++) list.push(["Предмет " + i, ":CASH:" + (1000 + i)]);
  const text = gpBlock("2026-11-18 16:00:00", "Средняя цена товаров при продаже", list) +
    histBlock("2026-11-18 17:00:00", "Предмет 3", [["2026-11-17", 5, 1100], ["2026-11-16", 7, 1200]]) +
    "[2026-11-18 17:00:05] DIALOG id=15074 style=0 title={BFBBBA}Продажа товара 'Предмет 4' за последние 30 дней\n" +
    "{ffffff}За последние 30 дней не найдено ни одной операции с этим товаром.\n-----\n";
  const g = gameprices.parseGamePrices(text);
  const { docs, meta } = cloudmap.catalogDocs(g, 100);
  const chunks = docs.filter((d) => /^gameprices\/sa-/.test(d.rel));
  assert.strictEqual(chunks.length, 3, "250 предметов по 100 = 3 документа");
  assert.deepStrictEqual(chunks.map((d) => d.data.items.length), [100, 100, 50]);
  assert.ok(chunks.every((d) => d.data.of === 3));
  const it3 = chunks[0].data.items[3];
  assert.strictEqual(it3.n, "Предмет 3");
  assert.strictEqual(it3.p, 1003);
  assert.strictEqual(it3.d, "2026-11-17:5:1100|2026-11-16:7:1200", "дни одной строкой: дата:продаж:цена");
  assert.strictEqual(it3.v7, 12);
  assert.strictEqual(chunks[0].data.items[4].z, 1, "ни одной сделки за 30 дней");
  assert.ok(!("d" in chunks[0].data.items[4]));
  const m = docs.find((d) => d.rel === "gameprices/_meta").data;
  assert.strictEqual(m.items, 250);
  assert.deepStrictEqual(m.chunks, { sa: 3 });
  assert.strictEqual(meta.noSalesItems, 1);
  // ни один документ не содержит массив массивов (Firestore не принимает)
  assert.doesNotThrow(() => docs.forEach((d) => require("./arz_firebase").toFields(d.data)));
  assert.deepStrictEqual(cloudmap.catalogDocs(null).docs, []);
});

test("облако: история банка — точки, дубли, суточные документы, структурированный снимок", () => {
  const bank = { total: 1, accountsAt: "2026-11-18T17:27:42.000Z", accounts: [{ id: 0, money: 32, withdrawPct: 1 }],
    deposit: { money: 266, limit: 120, level: 1, incomePerPayday: 178, at: "2026-11-18T17:29:53.000Z", analysis: { idle: 146 }, next: { level: 2 } } };
  const p = cloudmap.bankPoint(bank);
  assert.deepStrictEqual([p.deposit, p.limit, p.income, p.level, p.account, p.idle], [266, 120, 178, 1, 32, 146]);
  assert.strictEqual(p.t, Date.parse("2026-11-18T17:29:53.000Z"));
  assert.strictEqual(cloudmap.bankPoint(null), null);
  assert.strictEqual(cloudmap.bankPoint({ deposit: null }), null);
  assert.ok(cloudmap.samePoint(p, Object.assign({}, p, { t: p.t + 60000 })), "то же состояние в другое время — дубль");
  assert.ok(!cloudmap.samePoint(p, Object.assign({}, p, { limit: 150 })), "лимит вырос — новая точка");
  const days = cloudmap.bankDays([{ t: Date.parse("2026-11-16T10:00:00Z") }, { t: Date.parse("2026-11-17T10:00:00Z") }, { t: Date.parse("2026-11-18T10:00:00Z") }], 2);
  assert.deepStrictEqual(Object.keys(days), ["2026-11-17", "2026-11-18"], "только последние сутки");
  const c = cloudmap.bankForCloud(bank);
  assert.ok(c.deposit.at instanceof Date && c.accountsAt instanceof Date);
  assert.strictEqual(c.deposit.analysis.idle, 146);
  assert.strictEqual(cloudmap.bankForCloud(null), null);
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
