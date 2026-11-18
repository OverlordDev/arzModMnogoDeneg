#!/usr/bin/env bash
# ARZ Terminal — установка на чистый Ubuntu 22.04/24.04 (VPS на 2 пользователей).
# Запуск:  scp -r arz-terminal root@IP:/opt/  ИЛИ  git clone ... (см. DEPLOY-VPS.md)
# Затем:   bash /opt/arz-terminal/deploy/vps-setup.sh
set -euo pipefail

APP_DIR="/opt/arz-terminal"
SERVICE="arz-terminal"

echo "[1/5] пакеты..."
apt-get update -qq
apt-get install -y -qq curl git python3 ufw > /dev/null

echo "[2/5] Node 22..."
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs > /dev/null
fi
node --version
python3 --version

echo "[3/5] код в $APP_DIR..."
if [ ! -f "$APP_DIR/server.js" ]; then
  echo "ОШИБКА: положи arz-terminal в $APP_DIR (scp или git clone) и запусти снова."
  exit 1
fi

echo "[4/5] systemd-сервис..."
cp "$APP_DIR/deploy/$SERVICE.service" "/etc/systemd/system/$SERVICE.service"
systemctl daemon-reload
systemctl enable --now "$SERVICE"
sleep 2
systemctl --no-pager --lines=5 status "$SERVICE" || true

echo "[5/5] cron дампов каждые 30 минут..."
CRON="*/30 * * * * cd $APP_DIR && /usr/bin/python3 scripts/snapshot.py --server yuma vc --window 14 >> /var/log/arz-snapshot.log 2>&1"
( crontab -l 2>/dev/null | grep -v "scripts/snapshot.py" ; echo "$CRON" ) | crontab -
crontab -l | grep snapshot || true

echo "--- первый дамп (может занять 1-3 мин, качает агрегаты GitHub) ---"
cd "$APP_DIR" && /usr/bin/python3 scripts/snapshot.py --server yuma vc --window 14 | tail -5 || true

echo "--- фаервол: открываем 3000 ---"
ufw allow 3000/tcp >/dev/null 2>&1 || true
ufw --force enable >/dev/null 2>&1 || true

IP=$(hostname -I | awk '{print $1}')
echo ""
echo "ГОТОВО. Проверка:"
echo "  curl http://127.0.0.1:3000/api/health"
echo "  открой в браузере:  http://$IP:3000/"
echo "Логи: journalctl -u $SERVICE -f   и   tail -f /var/log/arz-snapshot.log"
