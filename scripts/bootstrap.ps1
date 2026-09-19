<#
.SYNOPSIS
    Set up FounderOS on a fresh Windows PC. Safe to re-run.

.DESCRIPTION
    Everything this repo needs that git does not carry:
      1. fnm + Node 22 (the repo pins 22 via .node-version and engines)
      2. node_modules (never copied between PCs — better-sqlite3 is native)
      3. .env.local, from .env.example
      4. data\founder-os.db, optionally restored from your Google Drive snapshot

.EXAMPLE
    .\scripts\bootstrap.ps1
    .\scripts\bootstrap.ps1 -Restore          # also pull the DB snapshot back
#>
[CmdletBinding()]
param(
    [switch]$Restore,
    [string]$BackupDir
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'founderos-common.ps1')

$repo = Get-RepoRoot
Push-Location $repo
try {
    Write-Host "FounderOS bootstrap — $repo" -ForegroundColor Cyan

    # ── 1. fnm ───────────────────────────────────────────────────────────
    $fnm = Find-Fnm
    if (-not $fnm) {
        Write-Host "`n[1/4] Installing fnm..." -ForegroundColor Yellow
        winget install Schniz.fnm --accept-source-agreements --accept-package-agreements --silent
        $fnm = Find-Fnm
        if (-not $fnm) { throw "fnm install finished but fnm.exe still isn't findable. Open a new terminal and re-run." }
    } else {
        Write-Host "`n[1/4] fnm present: $fnm" -ForegroundColor Green
    }

    # ── 2. Node 22 ───────────────────────────────────────────────────────
    if (-not (Initialize-Node22)) {
        Write-Host "      Installing Node 22..." -ForegroundColor Yellow
        & $fnm install 22
        if (-not (Initialize-Node22)) { throw "Node 22 install did not produce a usable node.exe under fnm." }
    }
    # Fail here with a clear message rather than letting npm ci die on a native
    # build: better-sqlite3 only ships a Windows prebuild for Node 22's ABI, and
    # any other version silently falls back to node-gyp + Visual Studio.
    $nodeVersion = Assert-Node22
    Write-Host "[2/4] Node $nodeVersion" -ForegroundColor Green

    # Offer the shell hook so plain `cd` into this repo picks up Node 22 too.
    $profilePath = $PROFILE.CurrentUserAllHosts
    $hookPresent = (Test-Path $profilePath) -and ((Get-Content $profilePath -Raw) -match 'fnm env')
    if (-not $hookPresent) {
        Write-Host "      Tip: add fnm's auto-switch hook to your PowerShell profile so" -ForegroundColor DarkGray
        Write-Host "      'cd' into this repo selects Node 22 automatically:" -ForegroundColor DarkGray
        Write-Host "        fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression" -ForegroundColor DarkGray
        Write-Host "      (add that line to $profilePath)" -ForegroundColor DarkGray
    }

    # ── 3. Dependencies ──────────────────────────────────────────────────
    Write-Host "`n[3/4] npm ci..." -ForegroundColor Yellow
    npm ci
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed (exit $LASTEXITCODE)." }

    # ── 4. Local config and data ─────────────────────────────────────────
    $envLocal = Join-Path $repo '.env.local'
    if (-not (Test-Path $envLocal)) {
        Copy-Item (Join-Path $repo '.env.example') $envLocal
        Add-Content $envLocal "`n# Windows: the gbrain CLI isn't available here, so use the stub provider.`nBRAIN_PROVIDER=stub"
        Write-Host "`n[4/4] Created .env.local from .env.example (no credentials yet)." -ForegroundColor Yellow
    } else {
        Write-Host "`n[4/4] .env.local already present — left untouched." -ForegroundColor Green
    }

    if ($Restore) {
        $restoreArgs = @{}
        if ($BackupDir) { $restoreArgs['BackupDir'] = $BackupDir }
        & (Join-Path $PSScriptRoot 'restore.ps1') @restoreArgs
    }

    Write-Host "`nReady." -ForegroundColor Cyan
    Write-Host "  npm run dev     ->  http://localhost:4100   (DB seeds itself on first request)"
    Write-Host "  scripts\founderos restore   ->  pull databases + encrypted .env.local back from Google Drive"
    Write-Host ""
    Write-Host "  Use 'npm run dev' locally, not 'npm start' — the start script uses" -ForegroundColor DarkGray
    Write-Host "  POSIX `${PORT:-4100} expansion that cmd.exe passes through literally." -ForegroundColor DarkGray
}
finally {
    Pop-Location
}
