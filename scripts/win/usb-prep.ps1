# Prepara USB para testes locais com a central :8080
# Uso: .\scripts\win\usb-prep.ps1
$ErrorActionPreference = "Stop"
$adb = if ($env:ADB_PATH) { $env:ADB_PATH } else {
  Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe"
}
if (-not (Test-Path $adb)) { throw "adb nao encontrado: $adb" }

Write-Host "== devices =="
& $adb devices -l

Write-Host "== reverse 8080 =="
& $adb reverse tcp:8080 tcp:8080

Write-Host "== enable accessibility (Folder Backup Agent) =="
$svc = "com.folderbackup.agent/com.folderbackup.agent.registration.WhatsappRegistrationAccessibilityService"
& $adb shell settings put secure enabled_accessibility_services $svc
& $adb shell settings put secure accessibility_enabled 1
& $adb shell settings get secure enabled_accessibility_services

Write-Host "== open agent =="
& $adb shell am start -n com.folderbackup.agent/.MainActivity

Write-Host "OK — celular pronto para a central em http://127.0.0.1:8080"
