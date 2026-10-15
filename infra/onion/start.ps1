# Starts the onion mirror on Windows (A6 T1): Kubo, the scanner if it exists, Caddy and Tor.
# Run from anywhere: powershell -ExecutionPolicy Bypass -File infra\onion\start.ps1
# Every service listens on 127.0.0.1 only. Close the window or press Ctrl-C to stop.
$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path "$PSScriptRoot\..\..").Path
Set-Location $Root
$Run = Join-Path $Root 'infra\onion\run'
New-Item -ItemType Directory -Force $Run | Out-Null
$env:IPFS_PATH = Join-Path $Root 'infra\kubo'

foreach ($tool in 'ipfs', 'caddy', 'tor') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "missing: $tool (README 9.1 B6)" }
}

$procs = @()
try {
  # Kubo: gateway 127.0.0.1:8080, API 127.0.0.1:5001 (never exposed); serves pinned content only.
  if (-not (Test-Path "$env:IPFS_PATH\config")) { ipfs init --profile server | Out-Null }
  ipfs config Addresses.API /ip4/127.0.0.1/tcp/5001
  ipfs config Addresses.Gateway /ip4/127.0.0.1/tcp/8080
  ipfs config --json Gateway.NoFetch true
  $procs += Start-Process ipfs -ArgumentList 'daemon' -NoNewWindow -PassThru `
    -RedirectStandardOutput "$Run\kubo.log" -RedirectStandardError "$Run\kubo.err.log"
  Write-Host 'kubo     starting (log: infra\onion\run\kubo.log)'

  # Scanner (A3) on 127.0.0.1:8000 with no access log, from the repo root. ClamAV is required.
  $env:ALEXANDRIA_REQUIRE_CLAMAV = '1'
  $py = if (Test-Path '.venv\Scripts\python.exe') { '.venv\Scripts\python.exe' } else { 'python' }
  $scanner = $env:SCANNER_CMD
  if (-not $scanner -and (Test-Path 'scanner\app.py')) {
    $scanner = "$py -m uvicorn scanner.app:app --host 127.0.0.1 --port 8000 --no-access-log"
  }
  if ($scanner) {
    $exe, $args_ = $scanner -split ' ', 2
    $procs += Start-Process $exe -ArgumentList $args_ -NoNewWindow -PassThru `
      -RedirectStandardOutput "$Run\scanner.log" -RedirectStandardError "$Run\scanner.err.log"
    Write-Host 'scanner  starting (log: infra\onion\run\scanner.log)'
  } else {
    Write-Host 'scanner  not built yet: /api/* returns 502 until it is'
  }
  Write-Host 'relayer  start it yourself on 127.0.0.1:8787 (P1/A2); it holds a hot key'

  # Caddy on 127.0.0.1:8088: the reader build, or the test page until it exists.
  $env:SITE_ROOT = Join-Path $Root 'apps\reader\dist'
  if (-not (Test-Path "$env:SITE_ROOT\index.html")) { $env:SITE_ROOT = Join-Path $Root 'infra\onion\test-site' }
  $procs += Start-Process caddy -ArgumentList 'run', '--config', 'infra\onion\Caddyfile', '--adapter', 'caddyfile' `
    -NoNewWindow -PassThru -RedirectStandardOutput "$Run\caddy.log" -RedirectStandardError "$Run\caddy.err.log"
  Write-Host "caddy    serving $env:SITE_ROOT"

  # Tor: the onion's private key lives in infra\tor\hs (gitignored).
  New-Item -ItemType Directory -Force 'infra\tor\hs', 'infra\tor\data' | Out-Null
  $procs += Start-Process tor -ArgumentList '-f', 'infra\onion\torrc' -NoNewWindow -PassThru `
    -RedirectStandardOutput "$Run\tor.log" -RedirectStandardError "$Run\tor.err.log"

  for ($i = 0; $i -lt 60 -and -not (Test-Path 'infra\tor\hs\hostname'); $i++) { Start-Sleep 1 }
  if (Test-Path 'infra\tor\hs\hostname') {
    Write-Host ''
    Write-Host "onion    http://$((Get-Content 'infra\tor\hs\hostname').Trim())/"
    Write-Host '         (reachable once Tor finishes publishing, usually under a minute)'
  } else {
    Write-Host 'tor      no hostname yet; see infra\onion\run\tor.log'
  }
  Write-Host ''
  Write-Host 'Running. Turn off sleep in Windows power settings. Ctrl-C stops everything.'
  Wait-Process -Id ($procs | ForEach-Object Id)
} finally {
  $procs | Where-Object { -not $_.HasExited } | Stop-Process -Force -ErrorAction SilentlyContinue
}
