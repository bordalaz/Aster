#!/bin/sh
# Закрыть сервер (docs/security.md): брандмауэр — только локальные сети и нужные порты; SSH — только по ключу.
# Повторный запуск безопасен. Запуск: sh ops/harden.sh   (sudo без пароля убирается отдельно — см. docs/security.md)
set -eu

echo "== брандмауэр (ufw)"
# страховка: если после включения связь пропала — через 3 мин ufw выключится сам; снимаем её в конце
sudo systemd-run --quiet --unit=aster-ufw-undo --on-active=180 /usr/sbin/ufw disable
sudo ufw --force reset >/dev/null
sudo ufw default deny incoming >/dev/null
sudo ufw default allow outgoing >/dev/null
# 22 — SSH (снаружи роутер пробрасывает 2222), 80/443 — веб и страница /trust, 5201 — «Открыть снимок»
for net in 192.168.0.0/16 10.0.0.0/8 172.16.0.0/12; do
  for port in 22 80 443 5201; do
    sudo ufw allow from "$net" to any port "$port" proto tcp >/dev/null
  done
done
sudo ufw --force enable >/dev/null
sudo ufw status | head -3

echo "== SSH: только по ключу"
# 00- — раньше 50-cloud-init.conf: у sshd действует первое найденное значение
printf '%s\n' "PasswordAuthentication no" "KbdInteractiveAuthentication no" "PermitRootLogin no" "MaxAuthTries 3" |
  sudo tee /etc/ssh/sshd_config.d/00-aster-hardening.conf >/dev/null
sudo sshd -t
sudo systemctl reload ssh
sudo sshd -T | grep -Ei '^(passwordauthentication|permitrootlogin|maxauthtries) '

echo "готово. Проверьте НОВЫМ подключением: ssh -p 2222 aster-su@<адрес> true"
echo "работает — снимите страховку: sudo systemctl stop aster-ufw-undo.timer"
