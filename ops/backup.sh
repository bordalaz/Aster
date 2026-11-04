#!/bin/sh
# Снимки базы, как в Airtable (контейнер backup; docs/backups.md).
# - автоматический снимок — раз в сутки после BACKUP_HOUR (часы — по TZ);
# - ручной снимок, «Открыть снимок», «Вернуть базу» — задания из раздела «Снимки» (таблица job служебной
#   базы bd_ops; проверяются каждые 10 с, по одному);
# - каждый снимок проверяется восстановлением во временную базу (число строк во всех таблицах);
# - хранятся BACKUP_DAYS дней (365), старые стираются; список снимков — bd_ops.snapshot: откат базы его не трогает;
# - вложения — только при BACKUP_FILES=1 (одна копия на другом диске, каждую ночь докопируются новые).
# Разово снимок из консоли: docker compose exec backup sh /ops/backup.sh now
set -u
OUT=${BACKUP_DIR:-/backups} DAYS=${BACKUP_DAYS:-365} HOUR=${BACKUP_HOUR:-3} FILES=${BACKUP_FILES:-0}
DATA=${ATTACH_ROOT:-/data/snapshot}   # вложения (в контейнере — /data/snapshot; на сервере без Docker — из .env)
export PGHOST=${PGHOST:-db} PGUSER=bd PGPASSWORD="$POSTGRES_PASSWORD"

q() { psql -d bd_ops -v ON_ERROR_STOP=1 -tAqc "$1"; }
lit() { [ -n "$1" ] && printf "'%s'" "$(printf %s "$1" | sed "s/'/''/g")" || printf null; }   # строка → SQL-литерал
log() { echo "$(date '+%F %T') $*" >&2; }

init_ops() {
  psql -d postgres -tAc "select 1 from pg_database where datname = 'bd_ops'" | grep -q 1 || psql -d postgres -qc "create database bd_ops"
  psql -d bd_ops -q -v ON_ERROR_STOP=1 <<'SQL'
create table if not exists snapshot (id serial primary key, created_at timestamptz not null default now(), kind text not null,
  file text not null unique, size bigint, rows bigint, by_user text);
create table if not exists job (id serial primary key, kind text not null, snapshot_id int, by_user text,
  status text not null default 'pending', message text not null default '', created_at timestamptz not null default now(),
  done_at timestamptz);
create table if not exists state (key text primary key, value text not null);
SQL
  for f in "$OUT"/bd-*.dump; do   # дампы, сделанные до списка снимков
    [ -e "$f" ] || continue
    q "insert into snapshot (created_at, kind, file, size) values (to_timestamp($(stat -c %Y "$f")), 'auto',
       '$(basename "$f")', $(stat -c %s "$f")) on conflict (file) do nothing" >/dev/null
  done
  q "update job set status = 'failed', message = 'Прервано перезапуском', done_at = now() where status = 'running'" >/dev/null
}

rows() {   # точное число строк во всех таблицах базы $1
  t=$(psql -d "$1" -tAc "select string_agg(format('select count(*) n from %I.%I', schemaname, tablename), ' union all ')
                         from pg_tables where schemaname = 'public'")
  [ -n "$t" ] && psql -d "$1" -tAc "select sum(n) from ($t) x"
}

restore_into() {   # $1 — база (пересоздаётся), $2 — файл дампа
  psql -d postgres -qc "drop database if exists $1 with (force)" -c "create database $1" >/dev/null &&
    pg_restore -d "$1" --no-owner "$2" 2>/dev/null
  [ -n "$(rows "$1")" ]
}

_snap() {   # $1 — auto | manual | before_restore, $2 — кто; печатает id снимка
  f="bd-$(date +%F_%H%M%S).dump"
  a0=$(rows bd)
  pg_dump -d bd -Fc -f "$OUT/$f.part" || { log "ОШИБКА: pg_dump не удался"; rm -f "$OUT/$f.part"; return 1; }
  a1=$(rows bd)
  restore_into bd_restore_check "$OUT/$f.part"
  b=$(rows bd_restore_check)
  psql -d postgres -qc "drop database if exists bd_restore_check" >/dev/null
  # проверка: строк в восстановленном столько же, сколько в базе (правки во время дампа — между «до» и «после»)
  lo=$a0 hi=$a1; [ "${a1:-0}" -lt "${a0:-0}" ] && lo=$a1 hi=$a0
  if [ -z "$b" ] || [ -z "$lo" ] || [ "$b" -lt "$lo" ] || [ "$b" -gt "$hi" ]; then
    log "ОШИБКА: снимок не восстанавливается как надо (в базе $a0…$a1 строк, после восстановления ${b:-0}) — $f.bad"
    mv "$OUT/$f.part" "$OUT/$f.bad"; return 1
  fi
  mv "$OUT/$f.part" "$OUT/$f"
  id=$(q "insert into snapshot (kind, file, size, rows, by_user) values ('$1', '$f', $(stat -c %s "$OUT/$f"), $b, $(lit "$2")) returning id")
  log "снимок #$id ($1) готов: $f, $(du -h "$OUT/$f" | cut -f1), строк $b — проверен восстановлением"
  echo "$id"
}

snap() { ( flock 9; _snap "$@" ) 9>"$OUT/.lock"; }   # снимки по одному (и из консоли, и из очереди)

copy_files() {   # BACKUP_FILES=1 — только если BACKUP_DIR на другом диске
  [ "$FILES" = 1 ] || return 0
  for d in files uploads; do
    [ -d "$DATA/$d" ] || continue
    # ponytail: перебор файлов (busybox cp -n не заходит в существующие папки); тысячи файлов — секунды
    (cd "$DATA/$d" && find . -type f) | while IFS= read -r x; do
      [ -e "$OUT/files/$d/$x" ] && continue
      mkdir -p "$(dirname "$OUT/files/$d/$x")" && cp -p "$DATA/$d/$x" "$OUT/files/$d/$x.part" &&
        mv "$OUT/files/$d/$x.part" "$OUT/files/$d/$x" || log "ОШИБКА: не скопирован $d/$x"
    done
    src=$(find "$DATA/$d" -type f | wc -l) dst=$(find "$OUT/files/$d" -type f | wc -l)
    [ "$dst" -ge "$src" ] || log "ОШИБКА: вложений $d в копии $dst из $src"
  done
}

prune() {   # снимки старше BACKUP_DAYS — стереть (файл и строку списка)
  q "select file from snapshot where created_at < now() - make_interval(days => $DAYS)" | while read -r f; do
    rm -f "$OUT/$f"; q "delete from snapshot where file = '$f'" >/dev/null; log "снимок $f старше $DAYS дн. — стёрт"
  done
}

sessions_save() { psql -d bd -qc "\\copy (select * from app_session where expires_at > now()) to '/tmp/sessions.csv' csv"; }
sessions_load() {   # вошедшие сейчас остаются вошедшими (если такой пользователь есть в снимке)
  psql -d "$1" -q <<'SQL'
create temp table s (like app_session);
\copy s from '/tmp/sessions.csv' csv
insert into app_session select s.* from s join app_user u on u.id = s.user_id on conflict do nothing;
SQL
}

file_of() { q "select file from snapshot where id = $1"; }

open_snap() {   # снимок → база bd_snapshot; её показывает экземпляр API «только чтение» (snapshot-api)
  f=$(file_of "$1"); [ -n "$f" ] && [ -f "$OUT/$f" ] || { echo "Нет файла снимка"; return 1; }
  sessions_save && restore_into bd_snapshot "$OUT/$f" || { echo "Снимок не восстановился"; return 1; }
  sessions_load bd_snapshot
  q "insert into state values ('open', '$1') on conflict (key) do update set value = excluded.value" >/dev/null
  echo "Снимок #$1 открыт"
}

restore_base() {   # вернуть рабочую базу к снимку; перед этим — снимок текущего состояния (откат можно отменить)
  f=$(file_of "$1"); [ -n "$f" ] && [ -f "$OUT/$f" ] || { echo "Нет файла снимка"; return 1; }
  before=$(snap before_restore "$2") || { echo "Не удалось снять текущее состояние — откат не делался"; return 1; }
  sessions_save
  # сначала в отдельную базу: если восстановление сорвётся, рабочая база не тронута
  restore_into bd_new "$OUT/$f" || { psql -d postgres -qc "drop database if exists bd_new" >/dev/null; echo "Снимок не восстановился — рабочая база не тронута"; return 1; }
  sessions_load bd_new
  for i in 1 2 3 4 5; do   # подмена: соединения API рвутся, он переподключится к новой базе
    psql -d postgres -qc "select pg_terminate_backend(pid) from pg_stat_activity where datname = 'bd' and pid <> pg_backend_pid()" >/dev/null
    psql -d postgres -qc "alter database bd rename to bd_prev" 2>/dev/null && break
    sleep 1
  done
  psql -d postgres -tAc "select 1 from pg_database where datname = 'bd_prev'" | grep -q 1 || { echo "База занята — откат не сделан"; return 1; }
  psql -d postgres -qc "alter database bd_new rename to bd" -c "drop database bd_prev with (force)" >/dev/null
  q "insert into state values ('generation', '$(date +%s)') on conflict (key) do update set value = excluded.value" >/dev/null   # API перезапустится
  echo "База возвращена к снимку #$1; состояние до отката — снимок #$before"
}

do_job() {   # одно задание из очереди; 1 — заданий нет
  j=$(q "update job set status = 'running' where id = (select id from job where status = 'pending' order by id limit 1
         for update skip locked) returning id || '|' || kind || '|' || coalesce(snapshot_id, 0) || '|' || coalesce(by_user, '')")
  [ -n "$j" ] || return 1
  id=${j%%|*} r=${j#*|}; kind=${r%%|*} r=${r#*|}; sid=${r%%|*} by=${r#*|}
  case $kind in
    snapshot) new=$(snap manual "$by") && msg="Снимок #$new готов" ok=1 || { msg="Снимок не удался"; ok=0; } ;;
    open) msg=$(open_snap "$sid") && ok=1 || ok=0 ;;
    restore) msg=$(restore_base "$sid" "$by") && ok=1 || ok=0 ;;
    *) msg="Неизвестное задание" ok=0 ;;
  esac
  q "update job set status = '$([ "$ok" = 1 ] && echo done || echo failed)', message = $(lit "$msg"), done_at = now() where id = $id" >/dev/null
  log "задание #$id $kind: $msg"
}

init_ops
if [ "${1:-}" = now ]; then snap manual "консоль" >/dev/null; exit $?; fi
while true; do
  while do_job; do :; done
  today=$(date +%F)
  if [ "$(expr "$(date +%H)" + 0)" -ge "$HOUR" ] && [ "$(q "select value from state where key = 'last_auto'")" != "$today" ]; then
    snap auto "" >/dev/null && q "insert into state values ('last_auto', '$today') on conflict (key) do update set value = excluded.value" >/dev/null &&
      copy_files && prune
  fi
  sleep 10
done
