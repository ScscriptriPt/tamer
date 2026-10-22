#!/usr/bin/env pwsh
# Project-local Pi, isolated from ~/.pi. Paths derive from this script location.
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$env:PI_CODING_AGENT_DIR = Join-Path $root ".pi-agent"
$env:PI_CODING_AGENT_SESSION_DIR = Join-Path $env:PI_CODING_AGENT_DIR "sessions"
$cli = Join-Path $root "vendor/pi/packages/coding-agent/dist/bundle/cli.js"
if (-not (Test-Path $cli)) {
    Write-Error "[pi-dev] bundle not built: $cli. Run bin\pi-dev-rebuild.cmd."
    exit 1
}
& node $cli @args
exit $LASTEXITCODE
