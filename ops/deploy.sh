#!/bin/sh
# Установка и обновление Aster на сервере без Docker (docs/deploy.md). Из папки проекта: sh ops/deploy.sh
# Ставит зависимости, собирает веб, ставит службы systemd и Caddyfile, перезапускает. Повторный запуск безопасен.
set -eu
DIR=$(cd "$(dirname "$0")/.." && pwd) VENV=${VENV:-$HOME/venv} USER=$(id -un)
cd "$DIR"
[ -f .env ] || { echo "нет .env — скопируйте ops/server.env.example в .env и заполните"; exit 1; }
set -a; . ./.env; set +a

echo "== API: зависимости"
[ -x "$VENV/bin/python" ] || python3 -m venv "$VENV"
# ponytail: PyPI с сервера может быть недоступен — тогда колёса скачать на ПК в ~/aster-wheels (docs/deploy.md)
"$VENV/bin/pip" install -q -r api/requirements.txt --find-links "$HOME/aster-wheels"

echo "== веб"
# ponytail: сборщик веба (vite) не работает на процессорах без AVX (Pentium N3540) — веб собирается на ПК
# и приходит готовым в web/dist (docs/deploy.md, «Обновление»)
[ -f web/dist/index.html ] || { echo "нет web/dist — соберите веб на ПК и скопируйте (docs/deploy.md)"; exit 1; }
sudo mkdir -p /srv/aster && sudo rsync -a --delete web/dist/ /srv/aster/

echo "== службы"
for f in ops/systemd/*.service; do
  sed "s|@USER@|$USER|g; s|@DIR@|$DIR|g; s|@VENV@|$VENV|g" "$f" | sudo tee "/etc/systemd/system/$(basename "$f")" >/dev/null
done
sudo cp ops/Caddyfile /etc/caddy/Caddyfile
sudo mkdir -p /etc/systemd/system/caddy.service.d
printf '[Service]\nEnvironment=ASTER_HOST=%s ASTER_TLS=%s\n' "$ASTER_HOST" "${ASTER_TLS:-internal}" |
  sudo tee /etc/systemd/system/caddy.service.d/aster.conf >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable -q aster-api aster-snapshot-api aster-backup aster-offsite caddy
sudo systemctl restart aster-api aster-snapshot-api aster-backup aster-offsite caddy
sleep 3
systemctl --no-pager --lines=0 status aster-api aster-snapshot-api aster-backup aster-offsite caddy | grep -E "^●|Active:"
echo "готово: https://$ASTER_HOST"
