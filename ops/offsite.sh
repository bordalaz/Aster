#!/bin/sh
# Копия снимков вне ноутбука (служба aster-offsite, docs/deploy.md): раз в час дампы bd-*.dump из BACKUP_DIR —
# в шифрованное облако (remote OFFSITE_REMOTE, по умолчанию aster: — crypt поверх Google Drive).
# Вложения в облако не идут (20 ГБ) — их копия на USB-диске (BACKUP_FILES=1).
R=${OFFSITE_REMOTE:-aster:}
OUT=${BACKUP_DIR:-/backups}
log() { echo "$(date '+%F %T') $*"; }
while :; do
  if ! rclone listremotes | grep -qx "${R%%:*}:"; then
    log "облако не настроено (нет remote ${R%%:*}) — docs/deploy.md, «Копия в облако»"
  elif ! ls "$OUT"/bd-*.dump >/dev/null 2>&1; then
    log "ОШИБКА: в $OUT нет снимков — облако не трогаю"   # пустой/неподключённый диск не должен стереть облако
  else
    # flock: ручной запуск и служба не копируют разом (Google Drive допускает дубли имён)
    # --max-delete: за раз стирается не больше 3 (год хранения — 1 в сутки); больше — что-то не так, ничего не стирать
    flock -n /tmp/aster-offsite.lock rclone sync "$OUT" "$R" --include '/bd-*.dump' --max-delete 3 && log "облако: снимки скопированы" ||
      log "ОШИБКА: копия в облако не удалась"
  fi
  sleep 3600
done
