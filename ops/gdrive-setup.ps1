# Подключение Google Drive к rclone на сервере Aster (копия снимков, docs/deploy.md).
# Спрашивает client_id и client_secret, открывает браузер для входа в Google, токен уходит на сервер по ssh —
# на экран ничего секретного не выводится.
$ErrorActionPreference = 'Stop'
# rclone для Windows (rclone.org/downloads) — путь первым аргументом, иначе rclone.exe рядом со скриптом
$rc  = if ($args[0]) { $args[0] } else { Join-Path $PSScriptRoot 'rclone.exe' }
$srv = 'aster-su@192.168.1.57'

# ssh с повторами: связь с ноутбуком через расширитель иногда рвётся
function OnServer([string]$in, [string]$cmd) {
  for ($i = 1; $i -le 4; $i++) {
    $out = $in | ssh -p 2222 -o ConnectTimeout=15 $srv $cmd
    if ($LASTEXITCODE -ne 255) { return $out }
    Write-Host "нет связи с сервером, повтор $i…"
    Start-Sleep 3
  }
  throw 'Сервер 192.168.1.57:2222 не отвечает — проверьте сеть и повторите'
}
# строки с ПК приходят с \r — убираем
$clean = 'IFS= read -r A; A=$(printf %s "$A" | tr -d "\r"); IFS= read -r B; B=$(printf %s "$B" | tr -d "\r");'

$id  = (Read-Host 'client_id').Trim()
$sec = (Read-Host 'client_secret' -MaskInput).Trim()

# 1. на сервере — remote gdrive со своим client_id, доступ только к своим файлам (drive.file)
$out = OnServer "$id`n$sec`n" ($clean + ' rclone config create gdrive drive scope=drive.file client_id="$A" client_secret="$B" config_is_local=false --non-interactive 2>/dev/null')
$st = ($out -join "`n") | ConvertFrom-Json
if ($st.Option.Help -notmatch 'rclone authorize "drive" "([^"]+)"') { throw "rclone на сервере ответил не так, как ждали: $($st.State) $($st.Error)" }
$blob = $Matches[1]

# 2. здесь — вход в Google в браузере
Write-Host 'Сейчас откроется браузер: войдите в Google и разрешите доступ ("приложение не проверено" — "Дополнительно" → "Перейти").'
$auth = @(& $rc authorize 'drive' $blob 2>$null)
$at = [array]::FindIndex($auth, [Predicate[string]] { param($l) $l -match '--->' })
$tok = if ($at -ge 0 -and $at + 1 -lt $auth.Count) { $auth[$at + 1].Trim() } else { '' }
if (-not $tok) { throw 'Токен не получен — вход в Google не завершён' }

# 3. токен — на сервер штатным продолжением настройки rclone; дальше вопросы — по умолчанию (не общий диск)
$state = $st.State
$result = $tok
for ($i = 0; $i -lt 4 -and $state; $i++) {
  $out = OnServer "$state`n$result`n" ($clean + ' rclone config create gdrive drive --continue --state "$A" --result "$B" --non-interactive 2>/dev/null')
  $st = ($out -join "`n") | ConvertFrom-Json
  if ($st.Error) { throw "rclone: $($st.Error)" }
  $state = $st.State
  $result = if ($st.Option.DefaultStr) { $st.Option.DefaultStr } else { 'false' }
}
OnServer "`n`n" 'rclone mkdir gdrive:aster && rclone lsd gdrive: >/dev/null && echo "Google Drive подключён"'
