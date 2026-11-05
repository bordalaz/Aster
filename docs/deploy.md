# Рабочий сервер (ноутбук, без Docker)

Ноутбук: Ubuntu Server 26.04 LTS, Pentium N3540, 4 ГБ ОЗУ. Тестовый стенд (Docker, vite) остаётся на ПК разработки;
на сервере всё стоит прямо в системе и поднимается само после перезагрузки (службы systemd).

| Служба | Что делает |
|---|---|
| `caddy` | собранный веб из `/srv/aster`, `/api` → API, HTTPS; порт 5201 — «Открыть снимок» |
| `aster-api` | программа (127.0.0.1:8000); после «Вернуть базу» выходит сама — systemd поднимает заново |
| `aster-snapshot-api` | экземпляр для открытого снимка, только чтение (127.0.0.1:8001) |
| `aster-backup` | снимки базы — `ops/backup.sh` (docs/backups.md) |
| `aster-offsite` | раз в час — копия снимков в шифрованное облако (`ops/offsite.sh`) |
| `postgresql` | Postgres 18, только локально |

Настройки — `~/aster/.env` (образец `ops/server.env.example`). Службы и Caddyfile ставит `ops/deploy.sh`.

**Ограничения этого ноутбука и сети:**
- с ноутбука недоступны PyPI и файлы релизов GitHub — пакеты Python и .deb качаются на ПК и копируются по ssh;
- процессор без AVX — сборщик веба (vite) на нём падает, веб собирается на ПК.

Подключение с ПК: `ssh -p 2222 aster-su@192.168.1.57` (ноутбук за роутером-расширителем, адрес в его сети 192.168.8.50;
на расширителе проброшены 2222 → 22, 443, 80, 5201 → 192.168.8.50).

## Установка с нуля

1. Пакеты из Ubuntu: `sudo apt install postgresql python3-venv rsync`.
2. Caddy и rclone — официальные .deb с GitHub (скачать на ПК, проверить суммы, скопировать): `sudo dpkg -i caddy.deb rclone.deb`.
3. Код: `git clone https://github.com/bordalaz/Aster.git ~/aster`.
4. Python: на ПК `pip download -r api/requirements.txt -d aster-wheels --platform manylinux2014_x86_64 --python-version 3.14 --implementation cp --only-binary=:all:`,
   папку `aster-wheels` — в `~` ноутбука (`ops/deploy.sh` берёт колёса оттуда).
5. Postgres: `sudo -u postgres psql -c "create role bd login superuser password '<пароль>'"`,
   `sudo -u postgres psql -c "alter system set shared_buffers = '256MB'"`, `sudo systemctl restart postgresql`.
6. `cp ops/server.env.example .env && chmod 600 .env` — пароль (4 места), `ASTER_HOST`, пути.
7. Данные с ПК (Git Bash, из папки проекта): `tar -cf - data backups | ssh -p 2222 aster-su@192.168.1.57 "tar -C ~/aster -xf -"`.
8. База из последнего снимка:
   `set -a; . ./.env; set +a; PGPASSWORD=$POSTGRES_PASSWORD sh ops/restore.sh backups/bd-….dump`.
9. Веб — собрать на ПК и скопировать (см. «Обновление»), затем `sh ops/deploy.sh`.

## Обновление

На ПК (Git Bash, из папки проекта, на нужной ветке):

```
npm --prefix web run build && tar -C web -cf - dist | ssh -p 2222 aster-su@192.168.1.57 "tar -C ~/aster/web -xf -"
```

На ноутбуке:

```
cd ~/aster && git pull && sh ops/deploy.sh   # с ПК: ssh -t -p 2222 … — sudo спросит пароль (docs/security.md)
```

Миграции базы применяются сами при старте `aster-api`. Новые пакеты Python — снова через `aster-wheels` (шаг 4).

## Проверка и журналы

```
systemctl status aster-api aster-snapshot-api aster-backup aster-offsite caddy
journalctl -u aster-backup -n 50          # снимки
journalctl -u aster-offsite -n 20         # облако
journalctl -u aster-api -f                # программа
```

Браузер предупредит о сертификате — его выдал сам сервер (Caddy). Убрать предупреждение: http://<адрес>/trust, см. [docs/https-local.md](https-local.md).
Чтобы предупреждения не было, корневой сертификат ставится на компьютеры один раз:
`sudo cat /var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt` → сохранить как `aster-root.crt`
→ двойной клик → «Установить сертификат» → «Доверенные корневые центры сертификации».

## Копия в облако (Google Drive, шифрованная)

Снимки шифруются на ноутбуке; Google видит только зашифрованные файлы. Вложения в облако не идут — их копия на USB-диске.

Общий client_id rclone для Google Drive отключается в 2026 году — нужен свой (бесплатно, Google Cloud):

1. console.cloud.google.com → новый проект (`aster-backup`) → APIs & Services → включить **Google Drive API**.
2. **OAuth consent screen** → Get started: имя `rclone`, своя почта, Audience **External** → Create.
   - **Data Access** → Manually add scopes: `https://www.googleapis.com/auth/drive.file` → Update → Save;
   - **Audience** → Add users (своя почта) и **Publish app** — в режиме Testing Google отзывает доступ каждые 7 дней;
   - **Clients** → Create client, тип **Desktop app** → Client ID и Client secret.
3. Шифрование — на ноутбуке (пароли генерируются там же, в чат и на экран не выводятся):
   ```
   umask 077; P1=$(openssl rand -base64 32); P2=$(openssl rand -base64 32)
   printf "password:  %s\npassword2: %s\n" "$P1" "$P2" > ~/aster-cloud-passwords.txt
   rclone config create aster crypt remote=gdrive:aster filename_encryption=standard directory_name_encryption=true password="$P1" password2="$P2" --non-interactive
   ```
   **Оба пароля — в менеджер паролей** (`cat ~/aster-cloud-passwords.txt`, без скриншотов), затем `shred -u ~/aster-cloud-passwords.txt`.
   Без них копия не расшифровывается. В `~/.config/rclone/rclone.conf` они только замаскированы — от кражи ноутбука не защищают.
4. Google Drive — на ПК с браузером: скачать rclone для Windows (rclone.org/downloads), положить `rclone.exe` рядом
   с `ops\gdrive-setup.ps1` и запустить его в PowerShell. Скрипт спросит Client ID и secret, откроет вход в Google
   («приложение не проверено» — «Дополнительно» → «Перейти»), токен передаст на ноутбук по ssh. В конце — «Google Drive подключён».
5. `sudo systemctl restart aster-offsite && journalctl -u aster-offsite -f` — ждать «облако: снимки скопированы».
   Проверка: `rclone check ~/aster/backups aster: --include "/bd-*.dump"` — «N matching files».

Защита: если на ноутбуке снимков нет (диск отвалился), облако не трогается; за проход стирается не больше 3 снимков.
Достать из облака: `rclone copy aster: ~/aster/backups`.

## USB-диск (снимки + вложения)

Диск будет отформатирован. `lsblk` — найти его (например `sdb`), затем:

```
sudo mkfs.ext4 -L aster-backup /dev/sdb1                          # ⚠ сотрёт диск
sudo mkdir -p /mnt/usb && echo 'LABEL=aster-backup /mnt/usb ext4 defaults,nofail 0 2' | sudo tee -a /etc/fstab
sudo mount -a && sudo mkdir -p /mnt/usb/aster && sudo chown aster-su: /mnt/usb/aster && cp -a ~/aster/backups/. /mnt/usb/aster/
```

В `.env`: `BACKUP_DIR=/mnt/usb/aster`, `BACKUP_FILES=1`; `sudo systemctl restart aster-backup aster-offsite`.

## Позже: доступ из интернета (дома)

Нужен белый IP (лучше статический), проброс 80 и 443 на ноутбук, домен (A-запись на IP).
В `.env`: `ASTER_HOST=aster.example.ru`, `ASTER_TLS=<e-mail>`; `sh ops/deploy.sh` — Caddy сам получит сертификат Let's Encrypt.
Учесть R7: не-админы входят только из `OFFICE_NETS` (по умолчанию — частные сети).
