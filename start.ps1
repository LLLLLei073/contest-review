$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 24 or newer first.' }
$nodeMajor = [int]((node -p 'parseInt(process.versions.node)'))
if ($nodeMajor -lt 24) { throw 'Node.js 24 or newer is required.' }
if (-not (Test-Path -LiteralPath 'node_modules')) {
    npm.cmd ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
$env:NODE_ENV = 'production'
Write-Host ''
Write-Host 'Open http://127.0.0.1:3210 in your browser. Press Ctrl+C to stop.' -ForegroundColor Green
npm.cmd start
