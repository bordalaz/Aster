# Бэкапы

Сервис `backup` в `docker-compose.yml` (образ `postgres:16-alpine`, скрипт `ops/backup.sh`).

**Что делает раз в сутки** (после `BACKUP_HOUR`, по умолчанию 3:00 по `BACKUP_TZ`):

1. `pg_dump` базы → `BACKUP_DIR/bd-ГГГГ-ММ-ДД_ЧЧММ.dump`.
2. **Проверка:** дамп восстанавливается во временную базу `bd_restore_check`, число строк во всех таблицах сверяется с рабочей. Не совпало — файл `.bad`, в логе `ОШИБКА`, повтор через 10 минут.
3. **Вложения** (`data/snapshot/files`, 19+ ГБ) — только при `BACKUP_FILES=1`: копия в `BACKUP_DIR/files/`, **одна**, каждую ночь докопируются только новые файлы, затем сверяется число файлов. По умолчанию выключено: включать, только когда `BACKUP_DIR` на другом диске — копия на том же диске место тратит, а от поломки диска не спасает.
4. Хранятся последние `BACKUP_KEEP` дампов (по умолчанию 14), старые удаляются. Копия вложений — одна, дополняется.

Два запуска одновременно не идут (блокировка `BACKUP_DIR/.lock`).

**Настройки** (`.env`): `BACKUP_DIR`, `BACKUP_HOUR`, `BACKUP_KEEP`, `BACKUP_TZ`, `BACKUP_FILES`.

**Место:** дамп ~9 МБ × `BACKUP_KEEP` (14) ≈ 130 МБ; с `BACKUP_FILES=1` — плюс одна копия вложений (размер `data/snapshot/files`) и прирост новых файлов.
На NAS `BACKUP_DIR` — **другой диск или том**: копия на том же диске погибнет вместе с базой.

## Команды

Сделать бэкап сейчас:

```
docker compose exec backup sh /ops/backup.sh now
```

Лог (результат каждого запуска):

```
docker compose logs backup
```

Проверить дамп, не трогая рабочую базу (восстановит в отдельную `bd_test`):

```
docker compose exec backup sh /ops/restore.sh /backups/bd-2026-11-03_0300.dump bd_test
```

## Восстановление после сбоя

```
docker compose stop api
docker compose exec backup sh /ops/restore.sh /backups/bd-2026-11-03_0300.dump
docker compose run --rm -v ./data:/data backup sh -c 'cp -Rp /backups/files/. /data/snapshot/'
docker compose start api
```

Вторая команда **заменяет данные** базы `bd` содержимым дампа.

В Git Bash на Windows перед командами с `/ops`, `/backups` добавлять `MSYS_NO_PATHCONV=1`, иначе пути подменятся.
