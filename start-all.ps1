# 启动低空 MVP：TileServer GL (z16) + Vite
# 用法：在项目根目录执行  .\start-all.ps1
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$server = Join-Path $root 'maputnik\server'
$node22 = 'C:\Users\半秋\.workbuddy\binaries\node\versions\22.22.2-6\node.exe'

if (-not (Test-Path $node22)) {
  $node22 = (Get-Command node).Source
}

$config = Get-Content (Join-Path $root 'maputnik\config.json') -Raw | ConvertFrom-Json
$config.options.paths.root = (Join-Path $root 'maputnik').Replace('\', '/')
$configPath = Join-Path $root 'maputnik\config.local.json'
[System.IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 10), (New-Object System.Text.UTF8Encoding($false)))

$already = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
if (-not $already) {
  Start-Process -FilePath $node22 -ArgumentList @(
    'node_modules/tileserver-gl/src/main.js',
    '--config', $configPath,
    '--port', '8080'
  ) -WorkingDirectory $server -WindowStyle Hidden
  Write-Host 'TileServer GL started on http://localhost:8080'
  Start-Sleep -Seconds 3
} else {
  Write-Host 'TileServer GL already running on 8080'
}

Write-Host 'Starting Vite...'
Push-Location $root
try { npm run dev } finally { Pop-Location }
