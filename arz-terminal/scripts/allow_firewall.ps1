# ARZ Terminal — разрешить телефону открывать сайт на этом ПК (брандмауэр Windows).
#
# Запуск (спросит права администратора — это системная настройка, без них Windows её не даст изменить):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/allow_firewall.ps1
# Убрать правила:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/allow_firewall.ps1 -Remove
#
# Что создаётся (входящие TCP на порт сайта, по умолчанию 3000):
#   1) для ЧАСТНЫХ сетей (домашний Wi-Fi) — чтобы телефон открыл сайт дома;
#   2) для адресов Tailscale 100.64.0.0/10 — чтобы телефон открыл сайт откуда угодно через Tailscale.
# В публичных сетях (кафе, вокзал) порт остаётся закрытым. Данные игрока и так отдаются только по ключу.
param([int]$Port = 3000, [switch]$Remove)

$names = @("ARZ Terminal $Port (private network)", "ARZ Terminal $Port (Tailscale)")

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    $extra = if ($Remove) { " -Remove" } else { "" }
    Start-Process -FilePath powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Port $Port$extra"
    exit
}

foreach ($n in $names) { Remove-NetFirewallRule -DisplayName $n -ErrorAction SilentlyContinue }
if ($Remove) {
    Write-Host "Правила ARZ Terminal удалены."
} else {
    New-NetFirewallRule -DisplayName $names[0] -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Private | Out-Null
    New-NetFirewallRule -DisplayName $names[1] -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -RemoteAddress 100.64.0.0/10 | Out-Null
    Write-Host "Готово: порт $Port открыт для домашней сети и для Tailscale."
}
Start-Sleep -Seconds 3
