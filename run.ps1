Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$port = 8000
$con = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($con) {
  Write-Host "Stopping PID $($con.OwningProcess) on port $port..."
  Stop-Process -Id $con.OwningProcess -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 300
}

Set-Location -Path $PSScriptRoot
Write-Host "Starting server..."
Write-Host "Open: http://127.0.0.1:8000"
Write-Host "Login: admin / 1234"
Write-Host "Admin: http://127.0.0.1:8000/admin"
Start-Process "http://127.0.0.1:8000/login"

python -u 1.py

