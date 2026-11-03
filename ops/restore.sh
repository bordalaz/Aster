#!/bin/sh
# Восстановить БД из дампа:  docker compose stop api
#   docker compose exec backup sh /ops/restore.sh /backups/bd-2026-11-03_0300.dump      (в базу bd — заменит данные!)
#   docker compose start api
# Вложения:  docker compose run --rm -v ./data:/data backup sh -c 'cp -Rpn /backups/files/. /data/snapshot/'
# Второй аргумент — другая база (проверить дамп, не трогая рабочую): sh /ops/restore.sh <дамп> bd_test
set -eu
f=$1 db=${2:-bd}
export PGHOST=db PGUSER=bd PGPASSWORD="$POSTGRES_PASSWORD"
[ -f "$f" ] || { echo "нет файла $f"; exit 1; }
psql -d postgres -qc "drop database if exists $db with (force)" -c "create database $db"
pg_restore -d "$db" --no-owner "$f"
echo "восстановлено в $db из $(basename "$f")"
