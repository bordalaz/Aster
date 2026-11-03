#!/bin/sh
# Бэкап БД и вложений (контейнер backup, см. docker-compose.yml).
# Раз в сутки после BACKUP_HOUR (часы — по TZ): pg_dump → проверка восстановлением во временную базу
# (число строк во всех таблицах должно совпасть) → копия новых вложений (если BACKUP_FILES=1) → хранить BACKUP_KEEP дампов.
# Не прошла проверка — дамп помечается .bad, повтор через 10 минут.  Разово: docker compose exec backup sh /ops/backup.sh now
set -u
OUT=/backups KEEP=${BACKUP_KEEP:-14} HOUR=${BACKUP_HOUR:-3} FILES=${BACKUP_FILES:-0}
export PGHOST=db PGUSER=bd PGPASSWORD="$POSTGRES_PASSWORD"

rows() {   # точное число строк во всех таблицах базы $1
  q=$(psql -d "$1" -tAc "select string_agg(format('select count(*) n from %I.%I', schemaname, tablename), ' union all ')
                         from pg_tables where schemaname = 'public'")
  psql -d "$1" -tAc "select coalesce(sum(n), 0) from ($q) t"
}

once() {
  exec 9>"$OUT/.lock"
  flock -n 9 || { echo "бэкап уже идёт — пропуск"; return 0; }   # не два запуска сразу
  f="$OUT/bd-$(date +%F_%H%M).dump"
  pg_dump -d bd -Fc -f "$f.part" || { echo "ОШИБКА: pg_dump не удался"; rm -f "$f.part"; return 1; }
  psql -d postgres -qc "drop database if exists bd_restore_check" -c "create database bd_restore_check" >/dev/null
  pg_restore -d bd_restore_check --no-owner "$f.part" 2>/dev/null
  a=$(rows bd) b=$(rows bd_restore_check)
  psql -d postgres -qc "drop database if exists bd_restore_check" >/dev/null
  if [ -z "$a" ] || [ "$a" != "$b" ]; then
    echo "ОШИБКА: дамп не восстанавливается как надо (строк в базе $a, после восстановления $b) — $f.bad"
    mv "$f.part" "$f.bad"; return 1
  fi
  mv "$f.part" "$f"
  # вложения не меняются и не удаляются (имена — uuid) — копируем только новые; затем сверяем число файлов
  # BACKUP_FILES=1 — только если BACKUP_DIR на другом диске: копия на том же диске место тратит, а от поломки не спасает
  [ "$FILES" = 1 ] && mkdir -p "$OUT/files"
  [ "$FILES" = 1 ] && for d in files uploads; do
    [ -d "/data/snapshot/$d" ] || continue
    # ponytail: перебор файлов (busybox cp -n не заходит в существующие папки); тысячи файлов — секунды
    (cd "/data/snapshot/$d" && find . -type f) | while IFS= read -r x; do
      [ -e "$OUT/files/$d/$x" ] && continue
      mkdir -p "$(dirname "$OUT/files/$d/$x")" && cp -p "/data/snapshot/$d/$x" "$OUT/files/$d/$x.part" &&
        mv "$OUT/files/$d/$x.part" "$OUT/files/$d/$x" || echo "ОШИБКА: не скопирован $d/$x"
    done
    src=$(find "/data/snapshot/$d" -type f | wc -l) dst=$(find "$OUT/files/$d" -type f | wc -l)
    [ "$dst" -ge "$src" ] || { echo "ОШИБКА: вложений $d в копии $dst из $src"; return 1; }
  done
  ls -1t "$OUT"/bd-*.dump | tail -n +$((KEEP + 1)) | xargs -r rm -f
  date +%F > "$OUT/.last"
  echo "$(date '+%F %T') бэкап готов: $(basename "$f"), $(du -h "$f" | cut -f1), строк $a — проверен восстановлением"
}

[ "${1:-}" = now ] && { once; exit $?; }
while true; do
  if [ "$(expr "$(date +%H)" + 0)" -ge "$HOUR" ] && [ "$(cat "$OUT/.last" 2>/dev/null)" != "$(date +%F)" ]; then once; fi
  sleep 600
done
