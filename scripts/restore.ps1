<#
.SYNOPSIS
    Restore the FounderOS databases from a Google Drive snapshot onto this PC.

.DESCRIPTION
    Reads manifest.json from the backup folder and copies each store's
    `-latest.db` into place, then reminds you to paste .env.local back from your
    password manager.

    Refuses to clobber existing databases unless you pass -Force, in which case
    the current ones are renamed aside rather than deleted.

.EXAMPLE
    .\scripts\restore.ps1
    .\scripts\restore.ps1 -Force
    .\scripts\restore.ps1 -BackupDir 'D:\sync\FounderOS'
#>
[CmdletBinding()]
param(
    [string]$BackupDir,
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'founderos-common.ps1')

$repo = Get-RepoRoot
Push-Location $repo
try {
    $dir = Assert-BackupDir -Path (Get-BackupDir $BackupDir)
    $manifestPath = Join-Path $dir 'manifest.json'
    if (-not (Test-Path $manifestPath)) {
        throw "No manifest.json in $dir. Run scripts\backup.ps1 on the other PC first, and let Google Drive finish syncing."
    }
    $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
    Write-Host "Restoring snapshot from $($manifest.created)" -ForegroundColor Cyan

    $restored = 0
    foreach ($store in $manifest.stores) {
        $source = Join-Path $dir $store.latest
        if (-not (Test-Path $source)) {
            Write-Warning "$($store.name): $($store.latest) is missing from $dir — skipped."
            continue
        }

        # Honour a per-store env override the same way the app does, so a
        # relocated database is restored where it actually lives.
        $target = if ($store.envVar -and (Get-Item "env:$($store.envVar)" -ErrorAction SilentlyContinue)) {
            (Get-Item "env:$($store.envVar)").Value
        } else {
            Join-Path $repo ($store.target -replace '/', '\')
        }
        New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null

        if ((Test-Path $target) -and -not $Force) {
            throw "$target already exists. Re-run with -Force to replace it (the current one is renamed aside, not deleted)."
        }
        if (Test-Path $target) {
            $aside = "$target.bak-$(Get-Date -Format 'yyyy-MM-dd-HHmm')"
            Move-Item $target $aside -Force
            Write-Host "  $($store.name): existing database moved aside -> $(Split-Path -Leaf $aside)" -ForegroundColor DarkGray
        }

        # The -wal and -shm sidecars belong to the database we just displaced.
        # Left behind, SQLite would try to apply them to the restored file and
        # either refuse to open it or graft stale pages onto it.
        foreach ($suffix in '-wal', '-shm') {
            $sidecar = "$target$suffix"
            if (Test-Path $sidecar) { Remove-Item $sidecar -Force }
        }

        Copy-Item $source $target -Force
        $size = [math]::Round((Get-Item $target).Length / 1KB, 0)
        Write-Host "  $($store.name): restored ($size KB) -> $target" -ForegroundColor Green
        $restored++
    }
    if ($restored -eq 0) { throw "Nothing was restored — every store listed in the manifest was missing." }

    # .env.example ships some non-empty defaults (INBOX_1_HOST, for one), so
    # "does it have any values" cannot tell a filled-in file from a fresh copy
    # of the template. Compare against the template instead: a real credential
    # is a key whose value differs from what .env.example ships.
    $envLocal = Join-Path $repo '.env.local'
    $envExample = Join-Path $repo '.env.example'
    $template = @{}
    if (Test-Path $envExample) {
        foreach ($line in Get-Content $envExample) {
            if ($line -match '^\s*([A-Z][A-Z0-9_]*)\s*=(.*)$') { $template[$Matches[1]] = $Matches[2].Trim() }
        }
    }
    $needsSecrets = $true
    if (Test-Path $envLocal) {
        foreach ($line in Get-Content $envLocal) {
            if ($line -notmatch '^\s*([A-Z][A-Z0-9_]*)\s*=(.*)$') { continue }
            $key = $Matches[1]
            $value = $Matches[2].Trim()
            if (-not $value) { continue }
            # Written by bootstrap.ps1 as a Windows default, not a credential.
            if ($key -eq 'BRAIN_PROVIDER') { continue }
            if ($template.ContainsKey($key) -and $template[$key] -eq $value) { continue }
            $needsSecrets = $false
            break
        }
    }
    Write-Host ""
    if ($needsSecrets) {
        Write-Host "Next: paste your saved .env.local over $envLocal" -ForegroundColor Yellow
        Write-Host "  It's the 'FounderOS .env.local' secure note in your password manager." -ForegroundColor Yellow
        Write-Host "  Without it every connector reports an honest 'not configured' —" -ForegroundColor DarkGray
        Write-Host "  a working app, just an unwired one." -ForegroundColor DarkGray
    } else {
        Write-Host ".env.local already has values — leaving it alone." -ForegroundColor Green
    }
    Write-Host ""
    Write-Host "Then: npm run dev  ->  http://localhost:4100" -ForegroundColor Cyan
}
finally {
    Pop-Location
}
