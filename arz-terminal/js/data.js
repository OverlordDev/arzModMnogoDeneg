/* ARZ Terminal — mock data for the visual skeleton */
window.ARZ = window.ARZ || {};

window.ARZ.data = {
  servers: [
    { id: "yuma", name: "Yuma", platform: "SA-MP", online: "640", economy: "$", color: "#c9a7ff" },
    { id: "vice", name: "Vice City", platform: "SA-MP", online: "1 100", economy: "VC$", color: "#ffb86b" }
  ],

  kpis: [
    {
      label: "Чистый капитал",
      value: 317.8e9,
      delta: 4.7,
      sub: "за 30 дней",
      icon: "wallet",
      spark: [240, 248, 255, 252, 268, 275, 290, 286, 300, 312, 318]
    },
    {
      label: "Дневной P&L",
      value: 14.2e9,
      delta: 4.7,
      sub: "сегодня",
      icon: "trend",
      spark: [8, 9, 7, 11, 10, 12, 13, 12, 14, 13, 14]
    },
    {
      label: "Свободные вирты",
      value: 46.4e9,
      delta: -2.1,
      sub: "14,6% ликвидность",
      icon: "database",
      spark: [62, 58, 55, 57, 52, 50, 48, 49, 47, 46, 46]
    },
    {
      label: "В инвентаре",
      value: 271.4e9,
      delta: 8.9,
      sub: "41 позиция",
      icon: "package",
      spark: [190, 205, 212, 220, 218, 232, 240, 251, 258, 264, 271]
    }
  ],

  opportunities: [
    {
      id: "iegovy",
      name: "Iegovy",
      sub: "GGLIMIT 1/2 · Аксессуар",
      short: "IG",
      buy: 12.5e9,
      sell: 15.8e9,
      buyServer: "Phoenix",
      sellServer: "Tucson",
      roi: 26.4,
      risk: "Низкий",
      liq: "Средняя"
    },
    {
      id: "hsr",
      name: "HSR-II",
      sub: "Limit-3 · Транспорт",
      short: "HS",
      buy: 138e9,
      sell: 171e9,
      buyServer: "Phoenix",
      sellServer: "Mesa",
      roi: 23.9,
      risk: "Средний",
      liq: "Низкая"
    },
    {
      id: "skullshop",
      name: "Skull-Shop",
      sub: "GGLIMIT 1/1 · Аксессуар",
      short: "SS",
      buy: 41e9,
      sell: 52e9,
      buyServer: "Tucson",
      sellServer: "Phoenix",
      roi: 26.8,
      risk: "Низкий",
      liq: "Средняя"
    },
    {
      id: "blackpearl",
      name: "Black Pearl",
      sub: "Ресурс · Крафт",
      short: "BP",
      buy: 1.8e6,
      sell: 2.6e6,
      buyServer: "Yuma",
      sellServer: "Red-Rock",
      roi: 44.4,
      risk: "Низкий",
      liq: "Высокая"
    },
    {
      id: "grgt",
      name: "GR GT",
      sub: "WILD NIGHT · Транспорт",
      short: "GR",
      buy: 3.2e9,
      sell: 4.1e9,
      buyServer: "Phoenix",
      sellServer: "Mesa",
      roi: 28.1,
      risk: "Средний",
      liq: "Средняя"
    }
  ],

  items: [
    { id: "iegovy", name: "Iegovy", short: "IG", cat: "Аксессуары", sub: "GGLIMIT 1/2", buy: 12.5e9, sell: 15.8e9, change: 8.4, liq: "Средняя", conf: 94, upd: "2 мин", server: "Phoenix", limited: "2 / сервер" },
    { id: "hsr", name: "HSR-II", short: "HS", cat: "Лимитки", sub: "Limit-3", buy: 138e9, sell: 171e9, change: 6.2, liq: "Низкая", conf: 91, upd: "5 мин", server: "Phoenix", limited: "3 / сервер" },
    { id: "gtd", name: "GTD Prototype", short: "GT", cat: "Лимитки", sub: "Limit-3", buy: 142e9, sell: 168e9, change: -2.4, liq: "Низкая", conf: 88, upd: "8 мин", server: "Mesa", limited: "3 / сервер" },
    { id: "sc40", name: "Ferrari SC40", short: "SC", cat: "Лимитки", sub: "Limit-3", buy: 147e9, sell: 173e9, change: 4.8, liq: "Низкая", conf: 90, upd: "6 мин", server: "Tucson", limited: "3 / сервер" },
    { id: "skullshop", name: "Skull-Shop", short: "SS", cat: "Аксессуары", sub: "GGLIMIT 1/1", buy: 41e9, sell: 52e9, change: 9.1, liq: "Средняя", conf: 93, upd: "3 мин", server: "Tucson", limited: "1 / сервер" },
    { id: "shadowmoon", name: "Shadow Moon", short: "SM", cat: "Скины", sub: "4,5 млн вариаций", buy: 2.4e9, sell: 3.1e9, change: 12.3, liq: "Высокая", conf: 96, upd: "1 мин", server: "Phoenix", limited: "—" },
    { id: "breakmark", name: "Break Mark II", short: "BM", cat: "Транспорт", sub: "Коллекционный", buy: 1.2e9, sell: 1.6e9, change: 3.2, liq: "Высокая", conf: 95, upd: "4 мин", server: "Mesa", limited: "—" },
    { id: "riotliner", name: "Riot Liner", short: "RL", cat: "Транспорт", sub: "WILD NIGHT", buy: 18.4e9, sell: 22.1e9, change: -1.8, liq: "Средняя", conf: 89, upd: "7 мин", server: "Phoenix", limited: "—" },
    { id: "grgt", name: "GR GT", short: "GR", cat: "Транспорт", sub: "WILD NIGHT · 9 деталей", buy: 3.2e9, sell: 4.1e9, change: 12.7, liq: "Средняя", conf: 92, upd: "3 мин", server: "Phoenix", limited: "—" },
    { id: "cowboy", name: "Cowboy set", short: "CW", cat: "Сеты", sub: "11 аксессуаров", buy: 6.8e9, sell: 8.4e9, change: -6.8, liq: "Низкая", conf: 84, upd: "12 мин", server: "Tucson", limited: "—" },
    { id: "druid", name: "Druid set", short: "DR", cat: "Сеты", sub: "Хэллоуин 2025", buy: 2.9e9, sell: 3.6e9, change: 5.2, liq: "Средняя", conf: 87, upd: "9 мин", server: "Red-Rock", limited: "—" },
    { id: "berserk", name: "Berserk set", short: "BE", cat: "Сеты", sub: "Хэллоуин 2025", buy: 3.1e9, sell: 3.9e9, change: 7.4, liq: "Средняя", conf: 86, upd: "11 мин", server: "Red-Rock", limited: "—" },
    { id: "blackpearl", name: "Black Pearl", short: "BP", cat: "Ресурсы", sub: "Крафт-материал", buy: 1.8e6, sell: 2.6e6, change: 18.4, liq: "Высокая", conf: 98, upd: "1 мин", server: "Yuma", limited: "—" },
    { id: "sourceshard", name: "Source Shard", short: "SH", cat: "Ресурсы", sub: "Осколок истока", buy: 12.4e6, sell: 15.8e6, change: 3.4, liq: "Высокая", conf: 97, upd: "2 мин", server: "Yuma", limited: "—" },
    { id: "dye", name: "Dye", short: "DY", cat: "Ресурсы", sub: "Краситель", buy: 1.1e6, sell: 1.4e6, change: -2.1, liq: "Высокая", conf: 96, upd: "3 мин", server: "Mesa", limited: "—" },
    { id: "silver", name: "Silver", short: "SV", cat: "Ресурсы", sub: "Серебро", buy: 420e3, sell: 510e3, change: 1.2, liq: "Высокая", conf: 98, upd: "1 мин", server: "Phoenix", limited: "—" },
    { id: "gold", name: "Gold", short: "GD", cat: "Ресурсы", sub: "Золото", buy: 2.2e6, sell: 2.7e6, change: 4.5, liq: "Средняя", conf: 95, upd: "5 мин", server: "Phoenix", limited: "—" },
    { id: "flax", name: "Flax", short: "FX", cat: "Ресурсы", sub: "Лён", buy: 180e3, sell: 240e3, change: -4.8, liq: "Высокая", conf: 97, upd: "2 мин", server: "Tucson", limited: "—" },
    { id: "cotton", name: "Cotton", short: "CT", cat: "Ресурсы", sub: "Хлопок", buy: 210e3, sell: 270e3, change: 2.7, liq: "Высокая", conf: 97, upd: "2 мин", server: "Tucson", limited: "—" },
    { id: "monowheel", name: "Monowheel", short: "MW", cat: "Аксессуары", sub: "Легендарный аксессуар", buy: 4.8e9, sell: 5.9e9, change: 6.4, liq: "Низкая", conf: 82, upd: "18 мин", server: "Vice City", limited: "—" },
    { id: "bugatti", name: "Bugatti La Voiture Noire", short: "BV", cat: "Лимитки", sub: "Кейс Каптура", buy: 210e9, sell: 245e9, change: 8.1, liq: "Очень низкая", conf: 78, upd: "22 мин", server: "Tucson", limited: "5 / сервер" },
    { id: "chaos", name: "SP Automotive Chaos", short: "CH", cat: "Лимитки", sub: "Кейс Каптура", buy: 196e9, sell: 228e9, change: 5.6, liq: "Очень низкая", conf: 76, upd: "25 мин", server: "Mesa", limited: "5 / сервер" }
  ],

  events: [
    { name: "Эпицентр зла", kind: "Хэллоуин", end: "20 ноя", days: 3, progress: 78, color: "#e7c27d", note: "Шкатулки тьмы · лошади · WILD NIGHT" },
    { name: "Double Gang", kind: "Battle Pass", end: "30 ноя", days: 13, progress: 46, color: "#8fe3b0", note: "90 уровней · 180 ячеек" },
    { name: "Чёрная пятница", kind: "Скидки", end: "27 ноя", days: 10, progress: 0, color: "#9ab7ff", note: "x4 PayDay · скидки до 50%" },
    { name: "Зимний сезон", kind: "Сезон", end: "1 дек", days: 14, progress: 0, color: "#ff9a9a", note: "Новый БП и зимний ивент" }
  ],

  auctions: [
    { id: "auc-hsr", name: "HSR-II #3/3", kind: "Лимитка", server: "Phoenix", bid: 142e9, buyout: 190e9, ends: 872, max: 165e9, target: 18, hot: true, short: "HS" },
    { id: "auc-springs", name: "Arizona Springs · дом", kind: "Недвижимость", server: "Ford Carson", bid: 8.4e9, buyout: 12e9, ends: 4330, max: 10.2e9, target: 22, hot: false, short: "AS" },
    { id: "auc-bugatti", name: "Bugatti La Voiture Noire", kind: "Лимитка", server: "Tucson", bid: 210e9, buyout: 260e9, ends: 404, max: 235e9, target: 16, hot: true, short: "BV" },
    { id: "auc-house", name: "Дом Dark Village", kind: "Недвижимость", server: "Phoenix", bid: 2.1e9, buyout: 3.2e9, ends: 2538, max: 2.8e9, target: 28, hot: false, short: "DV" },
    { id: "auc-sim", name: "SIM 777", kind: "SIM-карта", server: "Mesa", bid: 780e6, buyout: 1.1e9, ends: 192, max: 920e6, target: 18, hot: true, short: "777" },
    { id: "auc-container", name: "Контейнер 20×", kind: "Контейнер", server: "Yuma", bid: 1.2e9, buyout: 1.8e9, ends: 3480, max: 1.5e9, target: 25, hot: false, short: "20" }
  ],

  movers: [
    { name: "Black Pearl", short: "BP", price: 2.6e6, change: 18.4, cat: "Ресурс" },
    { name: "GR GT", short: "GR", price: 4.1e9, change: 12.7, cat: "Транспорт" },
    { name: "Shadow Moon", short: "SM", price: 3.1e9, change: 12.3, cat: "Скин" },
    { name: "Skull-Shop", short: "SS", price: 52e9, change: 9.1, cat: "Аксессуар" },
    { name: "Iegovy", short: "IG", price: 15.8e9, change: 8.4, cat: "Аксессуар" },
    { name: "Cowboy set", short: "CW", price: 8.4e9, change: -6.8, cat: "Сет" }
  ],

  tasks: [
    { text: "Собрать 10 000 шкатулок тьмы", meta: "6 200 / 10 000", done: false },
    { text: "Закрыть 3 задания бизнес-центра", meta: "1 / 3", done: false },
    { text: "Сдать 5 бочек нефти", meta: "5 / 5", done: true },
    { text: "Проверить аукцион HSR-II", meta: "до 14:32", done: false },
    { text: "Обновить 10 цен в базе", meta: "4 / 10", done: false }
  ],

  farming: [
    { time: "09:00–09:30", title: "Бизнес-центр", desc: "3 задания · 24/7", profit: 45e6, tag: "Бизнес" },
    { time: "09:30–10:15", title: "Эпицентр зла", desc: "10 квестов · шкатулки", profit: 280e6, tag: "Ивент" },
    { time: "10:15–11:00", title: "Лесопилка", desc: "x2 зарплата · 8+ ур.", profit: 120e6, tag: "Работа" },
    { time: "11:00–11:20", title: "Аукционы", desc: "HSR-II, SIM 777", profit: null, tag: "Аукцион" },
    { time: "11:20–12:00", title: "Перепродажа", desc: "Iegovy · Black Pearl", profit: 340e6, tag: "Перекуп" },
    { time: "12:00–12:30", title: "Портфель", desc: "Проверить депозит и цены", profit: 0, tag: "Система" }
  ],

  activities: [
    { name: "Эпицентр зла", type: "Ивент", perHour: 280e6, time: "45 мин", req: "10+ ур.", risk: "Низкий", score: 94 },
    { name: "Лесопилка", type: "Работа", perHour: 120e6, time: "45 мин", req: "1+ ур.", risk: "Низкий", score: 88 },
    { name: "Перепродажа Iegovy", type: "Перекуп", perHour: 340e6, time: "40 мин", req: "12,5 млрд", risk: "Низкий", score: 91 },
    { name: "Крафт HSR-II", type: "Крафт", perHour: 210e6, time: "30 мин", req: "ресурсы", risk: "Высокий", score: 76 },
    { name: "Аукцион HSR-II", type: "Аукцион", perHour: 0, time: "15 мин", req: "165 млрд", risk: "Средний", score: 82 },
    { name: "Депозит", type: "Пассив", perHour: 18e6, time: "0 мин", req: "200 млн", risk: "Низкий", score: 70 }
  ],

  businesses: [
    { name: "Казино", price: 100e6, income: 6.8e6, occupancy: 91, payback: 24, risk: "Средний" },
    { name: "24/7", price: 18e6, income: 1.1e6, occupancy: 82, payback: 30, risk: "Низкий" },
    { name: "СТО", price: 34e6, income: 1.8e6, occupancy: 81, payback: 35, risk: "Низкий" },
    { name: "АЗС", price: 24e6, income: 1.2e6, occupancy: 76, payback: 39, risk: "Низкий" },
    { name: "Тюнинг-салон", price: 140e6, income: 5.5e6, occupancy: 68, payback: 56, risk: "Средний" },
    { name: "Рыболовный магазин", price: 350e6, income: 12e6, occupancy: 74, payback: 59, risk: "Высокий" }
  ],

  recipes: [
    {
      id: "hsr-recipe",
      name: "HSR-II (Limit-3)",
      output: 150e9,
      success: 30,
      fee: 8e9,
      inputs: [
        { name: "Source Shard", qty: 1000, price: 12.4e6 },
        { name: "Black Pearl", qty: 200, price: 1.8e6 },
        { name: "Mirage Coin", qty: 600, price: 0.9e6 },
        { name: "Dye", qty: 5000, price: 1.1e6 },
        { name: "Silver", qty: 20000, price: 420e3 },
        { name: "Family Token", qty: 10000, price: 180e3 }
      ]
    },
    {
      id: "iegovy-recipe",
      name: "Iegovy (GGLIMIT)",
      output: 12.5e9,
      success: 45,
      fee: 1.2e9,
      inputs: [
        { name: "Source Shard", qty: 300, price: 12.4e6 },
        { name: "Black Pearl", qty: 40, price: 1.8e6 },
        { name: "Dye", qty: 900, price: 1.1e6 },
        { name: "Gold", qty: 120, price: 2.2e6 },
        { name: "Family Token", qty: 1500, price: 180e3 }
      ]
    },
    {
      id: "skull-recipe",
      name: "Skull-Shop (GGLIMIT)",
      output: 41e9,
      success: 28,
      fee: 3e9,
      inputs: [
        { name: "Source Shard", qty: 600, price: 12.4e6 },
        { name: "Black Pearl", qty: 90, price: 1.8e6 },
        { name: "Mirage Coin", qty: 300, price: 0.9e6 },
        { name: "Dye", qty: 1500, price: 1.1e6 },
        { name: "Silver", qty: 6000, price: 420e3 }
      ]
    },
    {
      id: "breakmark-recipe",
      name: "Break Mark II",
      output: 1.2e9,
      success: 70,
      fee: 100e6,
      inputs: [
        { name: "Source Shard", qty: 12, price: 12.4e6 },
        { name: "Dye", qty: 120, price: 1.1e6 },
        { name: "Silver", qty: 800, price: 420e3 }
      ]
    }
  ],

  portfolio: [
    { name: "HSR-II", type: "Лимитка", qty: 1, buy: 138e9, current: 171e9, short: "HS" },
    { name: "Iegovy", type: "Аксессуар", qty: 2, buy: 12.5e9, current: 15.8e9, short: "IG" },
    { name: "Skull-Shop", type: "Аксессуар", qty: 1, buy: 41e9, current: 52e9, short: "SS" },
    { name: "Arizona Springs", type: "Дом", qty: 1, buy: 8.4e9, current: 9.6e9, short: "AS" },
    { name: "GR GT", type: "Транспорт", qty: 1, buy: 3.2e9, current: 4.1e9, short: "GR" },
    { name: "Black Pearl", type: "Ресурс", qty: 1200, buy: 1.8e6, current: 2.6e6, short: "BP" }
  ],

  deals: [
    { id: "d1", title: "HSR-II #2/3", item: "HSR-II", buy: 138e9, target: 171e9, profit: 33e9, contact: "Sk1nny", server: "Phoenix", stage: "lead", tag: "Лимитка" },
    { id: "d2", title: "Iegovy ×2", item: "Iegovy", buy: 12.2e9, target: 15.8e9, profit: 3.6e9, contact: "Mellow", server: "Tucson", stage: "nego", tag: "Аксессуар" },
    { id: "d3", title: "Black Pearl ×400", item: "Black Pearl", buy: 720e6, target: 1.04e9, profit: 320e6, contact: "Market", server: "Yuma", stage: "bought", tag: "Ресурс" },
    { id: "d4", title: "GR GT", item: "GR GT", buy: 3.1e9, target: 4.1e9, profit: 1e9, contact: "—", server: "Mesa", stage: "listed", tag: "Транспорт" },
    { id: "d5", title: "Cowboy set", item: "Cowboy set", buy: 6.4e9, target: 8.1e9, profit: 1.7e9, contact: "—", server: "Phoenix", stage: "sold", tag: "Сет" }
  ],

  alerts: [
    { id: "a1", name: "Iegovy < 13 млрд", condition: "Цена покупки", channel: "Telegram", active: true, last: "2 часа назад" },
    { id: "a2", name: "HSR-II > 175 млрд", condition: "Цена продажи", channel: "Telegram", active: true, last: "сегодня, 09:14" },
    { id: "a3", name: "Black Pearl < 1,6 млн", condition: "Цена покупки", channel: "Discord", active: false, last: "вчера" },
    { id: "a4", name: "Аукцион HSR-II · 15 мин", condition: "До конца аукциона", channel: "Telegram", active: true, last: "—" },
    { id: "a5", name: "Эпицентр зла · старт", condition: "Событие", channel: "Telegram", active: true, last: "1 ноя" }
  ],

  guides: [
    { title: "Первые 100 млн за 3 дня", tag: "Старт", time: "8 мин", desc: "Промокоды, соцжильё, календарь и первые работы без ошибок." },
    { title: "Тир-лист работ 2026", tag: "Фарм", time: "12 мин", desc: "Кто реально даёт 13–18 млн в час и что нужно для входа." },
    { title: "Бизнесы: окупаемость", tag: "Экономика", time: "15 мин", desc: "Казино, СТО, 24/7 и АЗС — что брать первым." },
    { title: "Перекуп: 10 правил", tag: "Перекуп", time: "10 мин", desc: "Спред, ликвидность, комиссии и как не влететь на лимитке." },
    { title: "Аукционы: снайпинг", tag: "Аукционы", time: "9 мин", desc: "Максимальная ставка, таймеры и психология переплаты." },
    { title: "Крафт: считаем EV", tag: "Крафт", time: "11 мин", desc: "Шанс success, стоимость ресурсов и когда крафт выгоднее покупки." }
  ]
};
