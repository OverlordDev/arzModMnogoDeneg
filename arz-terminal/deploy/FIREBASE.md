# Сохранение в Firebase (Firestore)

Терминал (`node server.js` на ПК с игрой) сохраняет в Firestore всё, что нужно мобильному
приложению: состояние игрока, инвентарь с ценами, оценку, заработок, советы, историю капитала
и ленту денег. Без SDK: только REST. По умолчанию **выключено**: включается, если есть
`local/firebase.json` (`ARZ_FIREBASE=0` — принудительно выключить).

## Настройка (один раз, в Firebase Console проекта)

1. **Authentication → Sign-in method:** включить **Anonymous** (для первого входа) и
   **Email/Password** (для приложения, см. ниже).
2. **Firestore Database → Create database** (Native mode, production mode).
3. **Firestore Database → Rules** → вставить `deploy/firestore.rules` → Publish.
4. `arz-terminal/local/firebase.json` (шаблон `deploy/firebase.example.json`, файл в `.gitignore`):
   `apiKey`, `authDomain`, `projectId` и, для мобильного приложения, `email` и `password`.
5. Перезапустить сервер. В логе: `[firebase] сохранение включено: проект …`; в разделе Player
   появится строка «Firebase: сохранено N назад».

Если что-то не настроено, сайт не ломается: в Player показывается причина и подсказка, повторы
идут с нарастающей паузой (30 с → 15 мин).

## Один аккаунт для ПК и приложения

Анонимный `uid` привязан к ПК, телефон под анонимным входом получил бы другой `uid` и не увидел
бы данных. Поэтому в `local/firebase.json` задаётся e-mail и пароль:

- терминал при первом запуске **привязывает e-mail к уже существующему анонимному аккаунту**
  (`uid` и сохранённые данные те же). Если такого пользователя нет вообще, создаёт его;
- приложение входит под этим же e-mail/паролем и получает **тот же `uid`**;
- если e-mail уже был создан раньше (например, из приложения), терминал входит под ним, а
  данные, записанные под прежним анонимным `uid`, остаются в базе отдельно;
- пароль хранится открытым текстом в `local/firebase.json` (на ПК, вне git). Не используй
  пароль, который у тебя где-то ещё. Refresh-токен — `local/firebase_auth.json`, пароль в него не пишется.

## Схема для приложения (`schema: 1`)

Всё лежит под `players/{uid}`. Деньги — целые числа в игровой валюте сервера ($ для Yuma,
VC$ для Vice City). Время — Firestore `Timestamp`, если не сказано иное.

### `players/{uid}` — последний снимок

Обновляется при изменениях, не чаще раза в 30 с. **Пока нет полной загрузки инвентаря
(игрок не заходил на сервер после запуска скрипта), документ не пишется.**

| Поле | Тип | Что это |
|---|---|---|
| `schema` | int | версия схемы (сейчас 1) |
| `updatedAt` | Timestamp | когда записано в облако |
| `gameUpdatedAt` | Timestamp | время последнего события из игры |
| `server` | string | `Yuma`, `Vice City` |
| `money` | int | деньги на руках |
| `satiety` | int | сытость, % |
| `wanted` | int | уровень розыска |
| `skinModel` | int | модель скина |
| `capital` | int \| null | деньги + оценка инвентаря |
| `netWorth` | int \| null | капитал + счета + депозит (`capital + bank.total`); банк может быть старше остального |
| `bank` | map \| null | банк и депозит (`null`, пока игрок не открывал окно банка), см. ниже |
| `valuation` | map | `{ok, quick, ask, estimate, pricedCount, unpricedCount, pricesDate, pricesAgeDays}`; при `ok:false` — `{ok:false, reason}` |
| `slotsUsed`, `slotsTotal` | int | занято / всего слотов основного инвентаря |
| `slots` | array\<map\> | `[{slot, item, name, amount}]` — по слотам |
| `items` | array\<map\> | сгруппировано по предмету: `{item, name, amount, priced, buy, sell, mid, total, liq, spreadPct}` |
| `worn` | array\<map\> | надетое: `[{slot, item, name}]` |
| `tips` | array\<map\> | советы: `[{level: info\|warn\|danger, text}]` |
| `earnings` | map | заработок, см. ниже |

`valuation`: `quick` — по скупке (реально дадут лавки сразу), `ask` — по ценам продажи (верхняя
граница), `estimate` — середина. `pricesDate` — дата дневных цен ArzMarket (строка `ГГГГ-ММ-ДД`).
`items[].priced = false` — у предмета нет рыночной цены, он в оценку не входит (`buy/sell/mid/total` = 0).

`bank` (данные приходят только при открытии окна банка — «на момент последнего открытия»):
`{total, accountsAt, accounts: [{id, money, withdrawPct}], deposit: {money, level, maxLevel, limit,
incomePerPayday, withdrawPct, at, idle, lostPerPayday}}`. Доход депозита считается только с суммы **до `limit`**:
`idle = max(0, money − limit)` — деньги сверх лимита дохода не приносят, `lostPerPayday` — сколько за PayDay
из-за этого упускается. `incomePerPayday` — ожидаемый доход за один PayDay; `withdrawPct` — комиссия снятия.

`earnings`: `{active, sessionStart, lastEventAt, windows: {m15, h1, session}, recent: [{at, delta}]}`.
Каждое окно: `{income, spend, net, elapsedSec, incomePerHour, netPerHour, maxIncome, oneOff}`.
`incomePerHour/netPerHour` = `null`, пока набралось меньше 3 минут. `oneOff = true` — больше 60%
прихода это одно поступление, «$/ч» тогда не ставка заработка. Приход — любые поступления
(не только работа), расход — покупки/налоги/аренда.

### `players/{uid}/web/latest` — зеркало для сайта на телефоне

`{schema, generatedAt, updatedAt, payloadJson}`. `payloadJson` — **точная копия ответа локального `/api/player`**
одной JSON-строкой (инвентарь, оценка, советы, банк, заработок, история капитала за 7 дней). Сайт на телефоне
читает именно её и рисует тем же кодом, что и локальный сайт (`js/cloudclient.js` → `js/player.js`). Пишется не чаще
раза в 30 с при изменениях и раз в 5 минут «для свежести». Статус облака ПК (uid, проект) в копию не кладётся.

### `players/{uid}/gameprices/{sa|vc}-N`, `gameprices/_meta` — каталог игровых цен

Все предметы окна «Средняя цена товаров» Центрального рынка (по 120 в документе). Предмет: `n` — название,
`p` — цена из общего списка (среднее за 30 дней: искажается выбросами), `m7`/`m30` — **медианы** дневных цен,
`v7`/`v30` — число продаж, `t` — тренд %, `d` — история по дням одной строкой `дата:продаж:цена|…` (новые первыми),
`z: 1` — за 30 дней не было ни одной сделки. `_meta`: `{items, chunkSize, chunks:{sa:N}, historyItems, noSalesItems,
gameUpdatedAt}`. Обновляется не чаще раза в 10 минут и только изменившиеся документы.

### `players/{uid}/bank/{ГГГГ-ММ-ДД}` — депозит и счёт по времени (UTC)

`{day, points: [{t, deposit, limit, income, level, idle, account}]}` — точка при каждом изменении
депозита/лимита/дохода/уровня/счёта (данные приходят, когда игрок открывает окно банка).

### `players/{uid}/history/{ГГГГ-ММ-ДДTЧЧ}` — капитал за час (UTC)

`{hour, updatedAt, points: [{t, capital, money, estimate}]}` — `t` в миллисекундах Unix.
Точка раз в минуту при изменениях (минимум раз в 5 мин), пока терминал запущен. Пишется раз в 5 мин.

### `players/{uid}/money/{ГГГГ-ММ-ДД}` — лента денег за сутки (UTC)

`{day, updatedAt, points: [{t, balance, delta}]}` — баланс после каждого изменения и разница
с предыдущим значением (`delta = null` у самой первой записи). Хранятся последние двое суток
по данным лога игры, документ суток перезаписывается целиком.

## Чего в базе НЕТ и где это брать

- **Цены всего рынка.** Только цены предметов из инвентаря (`items`). Остальной рынок (дневные
  агрегаты ArzMarket) приложение берёт само из публичного файла
  `https://raw.githubusercontent.com/FREYM1337/forumnick/main/avg_price/info_users_{buy|sell}_{yuma|vc}.json`
  либо из `data/market_{yuma,vc}.json` этого репозитория.
- **Названия предметов по `id`:** `data/items_names.json` (в `players/*` имя уже лежит в поле `name`).
- **Данные, пока терминал не запущен или игра закрыта.** Облако отражает последнее известное состояние;
  свежесть — `gameUpdatedAt` и `updatedAt`. Заработок и лента денег восстанавливаются из лога игры
  при запуске терминала, а история капитала в это время не пишется (будут дыры).
- **Чтение из облака обратно в терминал** не реализовано, только запись.

## Пример чтения в приложении (Web SDK; для Flutter/Kotlin те же пути и поля)

```js
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, doc, onSnapshot, collection, query, orderBy, limit } from "firebase/firestore";

const cred = await signInWithEmailAndPassword(getAuth(), email, password);
const uid = cred.user.uid;                         // тот же uid, под которым пишет ПК
const db = getFirestore();

onSnapshot(doc(db, "players", uid), (snap) => render(snap.data()));   // состояние в реальном времени
const hours = query(collection(db, "players", uid, "history"), orderBy("hour", "desc"), limit(24));
```

## Безопасность и стоимость

- `apiKey` веб-проекта секретом не является, безопасность держат **правила Firestore**
  (`deploy/firestore.rules`): пользователь читает и пишет только `players/{свой uid}`. Без правил
  любой с этим ключом мог бы писать в базу.
- Данные — состояние твоего игрового аккаунта (деньги, предметы). С включённым Firebase копия
  лежит в Google Cloud; раньше она не покидала ПК.
- Бесплатный тариф (Spark): ~20 тыс. записей в сутки. Здесь порядка 300–500 в сутки.

## Телефон через облако (запасной вариант)

> Основной способ открыть сайт на телефоне — раздавать его с ПК по ссылке с ключом (см. README, «Телефон»).
> Ниже — режим для случая, когда сайт лежит на статическом хостинге без сервера: тогда данные читаются из Firestore.

(Раздел остаётся для справки.)

Сайт — это то же приложение, только открытое на телефоне: PWA (manifest + service worker + иконки), его можно
«Добавить на главный экран». На телефоне нет сервера ПК, поэтому данные игрока берутся из облака (зеркало
`web/latest`), а всё остальное (цены ArzMarket, история, предметы) — из статических файлов самого сайта.

Нужно один раз:

1. **Разместить сайт по HTTPS** (иначе нет ни установки, ни офлайн-режима): статический хостинг из этого
   репозитория (Render Static Site, GitHub Pages, Netlify — папка `arz-terminal/`) или свой VPS (`DEPLOY-VPS.md`).
2. **Включить вход по e-mail/паролю**: Firebase Console → Authentication → Sign-in method → Email/Password → Enable.
3. **Добавить e-mail и пароль** в `arz-terminal/local/firebase.json` (поля `"email"` и `"password"`, пароль придумай
   сам) и перезапустить сервер ПК. Он привяжет e-mail к текущему облачному аккаунту (uid и данные остаются).
4. На ПК: сайт `http://localhost:3000` → **Player** → блок «Телефон»: впиши адрес сайта, скопируй ссылку и открой её
   на телефоне. В ссылке только проект и e-mail, **пароля в ней нет** — его вводишь на телефоне один раз.

Безопасность: данные защищает правило Firestore (`deploy/firestore.rules`) — читать и писать можно только под своим
`uid`. `apiKey` веб-приложения Firebase не секрет. Пароль на телефоне не хранится (только refresh-токен), на ПК лежит
в `local/` (в `.gitignore`, статический сервер эту папку **не отдаёт** — раньше отдавал, см. `game/test_server.js`).
