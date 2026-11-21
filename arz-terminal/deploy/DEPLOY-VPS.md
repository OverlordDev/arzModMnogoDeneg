# Деплой ARZ Terminal на VPS (2 пользователя)

Сервер — чистый Node без зависимостей (`server.js`): раздаёт ту же статику
(`index.html`, `js/*`, `data/*`) + API `/api/health`, `/api/market?server=yuma|vc`,
`/api/history-manifest`. Фронт менять не надо — он грузит `data/*.json` как раньше.

Почему VPS, а не Render-free: бесплатный Web Service засыпает без трафика
и теряет файлы (эфемерная ФС), а крон внутри него ненадёжен. На своём VPS диск
постоянный, cron ходит каждые 30 минут, для двоих хватит минималки.

## Какой VPS брать

- **Минималка:** 1 vCPU / 1 ГБ RAM / 10 ГБ SSD, Ubuntu 22.04 или 24.04.
- Трафик мизерный (даже с дампами ~десятки МБ/день), хватит любого тарифа.
- Где: Timeweb / Aeza / FirstVDS / Beget — что дешевле, то и бери (~300–500 ₽/мес).

## Установка (5–10 минут)

1. Купи VPS с Ubuntu, узнай его IP. Подключись:
   `ssh root@IP`
2. Залей код (вариант А — проще, с твоего ПК):
   `scp -r "C:\Users\negrozoido\Desktop\arzModMnogoDeneg\arz-terminal" root@IP:/opt/arz-terminal`
   Вариант Б — через GitHub:
   `git clone https://github.com/OverlordDev/arzModMnogoDeneg.git /tmp/arz && cp -r /tmp/arz/arz-terminal /opt/arz-terminal`
3. На VPS запусти:
   `bash /opt/arz-terminal/deploy/vps-setup.sh`
   Скрипт ставит Node 22 + python3, включает systemd-сервис `arz-terminal`
   (порт 3000) и открывает порт 3000 в ufw.
   Данные обновляются вручную через `scripts/snapshot.py`.
4. Открой в браузере: `http://IP:3000/`
   Проверка API: `http://IP:3000/api/health` → `{"ok":true,...}`

## Что дальше

- Логи сервера: `journalctl -u arz-terminal -f`
- Перезапуск после обновления кода:
  `cd /opt/arz-terminal && git pull` (или повтори scp) `&& systemctl restart arz-terminal`
- Обновление кода без потери истории: история лежит в `data/history/` —
  не удаляй папку при заливке, копируй поверх только `index.html`, `js/`, `server.js`.
- Хочешь красивый адрес без `:3000` — подними nginx reverse-proxy
  `80 -> 127.0.0.1:3000` (для двоих необязательно).
- Хочешь закрыть от посторонних — добавь в nginx `auth_basic` (логин/пароль),
  сайт сам по себе без авторизации.

## Сколько проживёт без тебя

- VPS включён всегда → дампы идут сами, сайт живёт сам.
- Твой ПК может быть выключен — ничего не сломается.
- GitHub Actions не используется (аккаунт заблокирован биллингом) — и не нужен.
