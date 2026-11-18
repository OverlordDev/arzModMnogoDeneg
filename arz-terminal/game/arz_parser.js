"use strict";
/* ARZ Terminal — парсер CEF-событий Arizona -> состояние игрока.
 *
 * Ноль зависимостей. Принимает поток событий вида
 *   window.executeEvent('event.inventory.playerInventory', `[{...}]`);
 * (так их пишет game/arz_recon.lua) и собирает из них состояние:
 * инвентарь по вкладкам и слотам, деньги, сытость, розыск, сервер, скин.
 *
 * Что известно о формате (по реальному логу, 2026-11-18):
 *   event.inventory.playerInventory, аргумент [{action, data}]:
 *     action 0 — полная загрузка вкладки (при входе): data.type, data.items[]
 *     action 2 — обновление слотов: те же data.type + data.items[];
 *                слот без поля `item` = слот опустел
 *     action 1 — вкладка персонажа: data.skin.model и т.п.
 *     action 3 — служебное {type, slot, bits}; для состояния не нужно
 *   data.type — вкладка: 1 = основной инвентарь (72 слота), 22 = надетый скин;
 *   остальные типы (2, 10, 17, 24, 30, 33, 50) пока пустые — смысл не расшифрован.
 *   event.player.updateMoney [N] — деньги (считаем абсолютным значением).
 *
 * Используем только белый список событий: всё остальное (в т.ч. любые
 * auth/token) отбрасывается до разбора содержимого.
 *
 * CLI:  node game/arz_parser.js <лог.log> [data/items_names.json]
 */

const fs = require("fs");
const path = require("path");

const WATCH = new Set([
  "event.inventory.playerInventory",
  "event.player.updateMoney",
  "event.arizonahud.playerSatiety",
  "event.arizonahud.playerWanted",
  "event.arizonahud.playerPower",
  "event.arizonahud.playerPowerType",
  "event.arizonahud.serverInfo",
]);

function createState() {
  return {
    server: null,
    money: null,
    satiety: null,
    wanted: null,
    power: null,
    powerType: null,
    character: null, // data из action:1 (скин, число страниц аксессуаров)
    inv: {}, // { [type]: { [slotKey]: {slot, item, amount, text} } }
    avail: {}, // { [type]: { [slotKey]: true } } — слоты, доступные игроку (пустые тоже)
    baseline: false, // видели ли полную загрузку основного инвентаря (action 0, type 1)
    unknownActions: {}, // action -> сколько раз видели (кроме известных)
    events: 0,
    updatedAt: null,
  };
}

function slotKey(it) {
  // вкладки 30/33 адресуют слот парой (id, slot)
  return it.id !== undefined ? it.id + ":" + it.slot : String(it.slot);
}

function applyItems(state, type, items) {
  const bag = state.inv[type] || (state.inv[type] = {});
  const av = state.avail[type] || (state.avail[type] = {});
  for (const it of items) {
    const key = slotKey(it);
    if (it.available === 1) av[key] = true;
    if (it.item === undefined || it.item === null || it.item === 0) {
      delete bag[key];
    } else {
      bag[key] = {
        slot: it.slot,
        item: it.item,
        amount: it.amount ?? 1,
        text: it.text || "",
      };
    }
  }
}

function applyEvent(state, name, args, ts) {
  if (!WATCH.has(name) || !Array.isArray(args)) return;
  state.events++;
  if (ts) state.updatedAt = ts;
  const v = args[0];
  switch (name) {
    case "event.inventory.playerInventory": {
      if (!v || typeof v !== "object" || !v.data) return;
      if (v.action === 0 || v.action === 2) {
        if (v.action === 0 && v.data.type === 1) state.baseline = true;
        if (Array.isArray(v.data.items)) applyItems(state, v.data.type, v.data.items);
      } else if (v.action === 1) {
        state.character = v.data;
      } else if (v.action !== 3) {
        state.unknownActions[v.action] = (state.unknownActions[v.action] || 0) + 1;
      }
      return;
    }
    case "event.player.updateMoney": state.money = Number(v); return;
    case "event.arizonahud.playerSatiety": state.satiety = Number(v); return;
    case "event.arizonahud.playerWanted": state.wanted = Number(v); return;
    case "event.arizonahud.playerPower": state.power = Number(v); return;
    case "event.arizonahud.playerPowerType": state.powerType = Number(v); return;
    case "event.arizonahud.serverInfo":
      if (v && typeof v === "object") state.server = { id: v.id, title: v.title, project: v.project };
      return;
  }
}

/** Разбор лога recon-скрипта: блоки разделены строкой -----. */
function parseLog(text) {
  const events = [];
  const re = /^window\.executeEvent\('([^']+)',\s*[`']([\s\S]*)[`']\);?\s*$/;
  for (const block of text.split("\n-----\n")) {
    const nl = block.indexOf("\n");
    if (nl < 0) continue;
    const head = block.slice(0, nl);
    const m = re.exec(block.slice(nl + 1).trim());
    if (!m) continue;
    const name = m[1];
    if (!WATCH.has(name)) continue; // секреты и мусор отсекаем до JSON.parse
    let args;
    try { args = JSON.parse(m[2]); } catch (_) { continue; }
    // [hh:mm:ss] (старый формат лога) или [YYYY-MM-DD hh:mm:ss]
    const ts = /^\[(?:(\d{4}-\d\d-\d\d) )?(\d\d:\d\d:\d\d)\]/.exec(head);
    events.push({ name, args, ts: ts ? ts[2] : null, date: ts && ts[1] ? ts[1] : null });
  }
  return events;
}

function nameOf(names, id) {
  const n = names && names[String(id)];
  return n && n !== "DELETED" && n.trim() ? n : "#" + id;
}

function summarize(state, names) {
  const main = Object.values(state.inv[1] || {}).sort((a, b) => a.slot - b.slot);
  const rows = main.map((x) => ({ slot: x.slot, item: x.item, name: nameOf(names, x.item), amount: x.amount }));
  const totals = new Map();
  for (const r of rows) {
    const t = totals.get(r.item) || { item: r.item, name: r.name, amount: 0 };
    t.amount += r.amount;
    totals.set(r.item, t);
  }
  const worn = Object.values(state.inv[22] || {}).map((x) => ({ slot: x.slot, item: x.item, name: nameOf(names, x.item) }));
  return {
    server: state.server && state.server.title,
    money: state.money,
    satiety: state.satiety,
    wanted: state.wanted,
    skinModel: state.character && state.character.skin ? state.character.skin.model : null,
    worn,
    // без полной загрузки общее число слотов неизвестно (видны только изменённые)
    baseline: state.baseline,
    slots: { used: rows.length, total: state.baseline ? Object.keys(state.avail[1] || {}).length : 0 },
    inventory: rows,
    totals: [...totals.values()],
    otherTabsWithItems: Object.keys(state.inv).filter((t) => t !== "1" && t !== "22" && Object.keys(state.inv[t]).length),
    unknownActions: state.unknownActions,
    events: state.events,
    updatedAt: state.updatedAt,
  };
}

function replayEvents(events) {
  const state = createState();
  for (const e of events) applyEvent(state, e.name, e.args, e.ts);
  return state;
}

function replay(text) {
  return replayEvents(parseLog(text));
}

module.exports = { createState, applyEvent, parseLog, replay, replayEvents, summarize, nameOf };

if (require.main === module) {
  const logPath = process.argv[2];
  if (!logPath) {
    console.error("usage: node game/arz_parser.js <log> [items_names.json]");
    process.exit(2);
  }
  const namesPath = process.argv[3] || path.join(__dirname, "..", "data", "items_names.json");
  const names = fs.existsSync(namesPath) ? JSON.parse(fs.readFileSync(namesPath, "utf8")) : {};
  const state = replay(fs.readFileSync(logPath, "utf8"));
  console.log(JSON.stringify(summarize(state, names), null, 2));
}
