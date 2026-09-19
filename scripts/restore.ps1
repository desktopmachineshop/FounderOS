<#
.SYNOPSIS
    Restore the FounderOS databases from a Google Drive snapshot onto this PC.

.DESCRIPTION
    Reads manifest.json from the backup folder and copies each store's
    `-latest.db` into place, then decrypts env.local.enc back to .env.local
    (prompting for the passphrase from your password manager).

    Refuses to clobber existing databases, or a .env.local that already holds
    credentials, unless you pass -Force — in which case the current ones are
    renamed aside rather than deleted.

.EXAMPLE
    .\scripts\restore.ps1
    .\scripts\restore.ps1 -Force
    .\scripts\restore.ps1 -BackupDir 'D:\sync\FounderOS'
    .\scripts\restore.ps1 -SkipSecrets       # databases only
#>
[CmdletBinding()]
param(
    [string]$BackupDir,
    [switch]$Force,
    [switch]$SkipSecrets,
    # For unattended use. Omit to be prompted.
    [System.Security.SecureString]$Passphrase
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

    # Compare .env.local against the template rather than asking "does it have
    # any values": .env.example ships real defaults (INBOX_1_HOST), so a fresh
    # copy of it is full of values while holding no credentials at all.
    $envLocal = Join-Path $repo '.env.local'
    $template = Get-EnvPairs (Join-Path $repo '.env.example')
    $local = Get-EnvPairs $envLocal
    $hasCredentials = $false
    foreach ($key in $local.Keys) {
        $value = $local[$key]
        if (-not $value) { continue }
        # Written by bootstrap.ps1 as a Windows default, not a credential.
        if ($key -eq 'BRAIN_PROVIDER') { continue }
        if ($template.ContainsKey($key) -and $template[$key] -eq $value) { continue }
        $hasCredentials = $true
        break
    }

    Write-Host ""
    $encrypted = Join-Path $dir $SecretsFileName
    if ($SkipSecrets) {
        Write-Host ".env.local skipped (-SkipSecrets)." -ForegroundColor DarkGray
    } elseif (-not (Test-Path $encrypted)) {
        if (-not $hasCredentials) {
            Write-Warning "No $SecretsFileName in $dir, so .env.local can't be restored. Fill it in from .env.example by hand; until then every connector reports an honest 'not configured'."
        }
    } elseif ($hasCredentials -and -not $Force) {
        Write-Host ".env.local already holds credentials — leaving it alone (-Force to replace it)." -ForegroundColor Green
    } else {
        Assert-Node22 | Out-Null
        # Decrypt into a temp file first, so a wrong passphrase never touches
        # the .env.local that's already here.
        $staged = "$envLocal.restoring"
        $attempts = if ($Passphrase) { 1 } else { 3 }
        $code = $null
        for ($i = 1; $i -le $attempts; $i++) {
            $secret = if ($Passphrase) { $Passphrase } else { Read-Passphrase -Prompt 'Secrets passphrase' }
            $code = Invoke-SecretsTool -RepoRoot $repo -Passphrase $secret -Arguments @('decrypt', $encrypted, $staged)
            if ($code -ne 2) { break }
        }
        if ($code -ne 0) {
            Remove-Item $staged -Force -ErrorAction SilentlyContinue
            throw ".env.local was not restored (exit $code). The databases above were restored fine; re-run with -SkipSecrets to skip this step."
        }
        if ($hasCredentials) {
            $aside = "$envLocal.bak-$(Get-Date -Format 'yyyy-MM-dd-HHmm')"
            Move-Item $envLocal $aside -Force
            Write-Host "  existing .env.local moved aside -> $(Split-Path -Leaf $aside)" -ForegroundColor DarkGray
        }
        Move-Item $staged $envLocal -Force
        Write-Host ".env.local restored." -ForegroundColor Green
    }
    Write-Host ""
    Write-Host "Then: npm run dev  ->  http://localhost:4100" -ForegroundColor Cyan
}
finally {
    Pop-Location
}
