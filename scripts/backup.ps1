<#
.SYNOPSIS
    Snapshot the FounderOS databases to Google Drive, and hand .env.local to your
    password manager.

.DESCRIPTION
    The two things `git push` deliberately leaves behind, handled separately
    because they carry very different risk:

      data\*.db      -> VACUUM INTO snapshots in Google Drive. All three stores
                        (founder-os, bank, ledger). Business content, no
                        credentials.
      .env.local     -> copied to your clipboard only, for pasting into a
                        password-manager secure note. It holds a live Stripe key
                        and your email app passwords, so this script never
                        writes it anywhere outside the repo.

.EXAMPLE
    .\scripts\backup.ps1
    .\scripts\backup.ps1 -BackupDir 'D:\sync\FounderOS' -KeepDays 90
    .\scripts\backup.ps1 -SkipSecrets        # databases only, no clipboard step
#>
[CmdletBinding()]
param(
    [string]$BackupDir,
    [int]$KeepDays = 30,
    [switch]$SkipSecrets
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'founderos-common.ps1')

$repo = Get-RepoRoot
Push-Location $repo
try {
    Assert-Node22 | Out-Null
    $dest = Assert-BackupDir -Path (Get-BackupDir $BackupDir) -Create

    # snapshot.ts covers every store and writes the manifest.json that
    # restore.ps1 reads back, so neither side hard-codes the list.
    $stamp = Get-Date -Format 'yyyy-MM-dd-HHmm'
    Write-Host "Snapshotting to $dest" -ForegroundColor Cyan
    # Call tsx's entrypoint through node directly. The npx/npm .ps1 shims build
    # their argument list by string interpolation and choke on paths with spaces
    # (which "H:\My Drive\..." always has).
    $tsx = Join-Path $repo 'node_modules/tsx/dist/cli.mjs'
    if (-not (Test-Path $tsx)) { throw "tsx is not installed. Run scripts/bootstrap.ps1 (or npm ci) first." }
    & node $tsx (Join-Path $PSScriptRoot 'snapshot.ts') $dest $stamp
    if ($LASTEXITCODE -ne 0) { throw "snapshot.ts failed (exit $LASTEXITCODE)." }

    # Timestamped snapshots age out; the -latest copies never do.
    if ($KeepDays -gt 0) {
        $cutoff = (Get-Date).AddDays(-$KeepDays)
        $stale = Get-ChildItem $dest -Filter '*.db' |
            Where-Object { $_.Name -notlike '*-latest.db' -and $_.LastWriteTime -lt $cutoff }
        foreach ($file in $stale) {
            Remove-Item $file.FullName -Force
            Write-Host "  pruned $($file.Name)" -ForegroundColor DarkGray
        }
    }

    if (-not $SkipSecrets) {
        $envLocal = Join-Path $repo '.env.local'
        if (-not (Test-Path $envLocal)) {
            Write-Warning "No .env.local to back up (fine if you haven't wired any connectors yet)."
        } else {
            $size = [math]::Round((Get-Item $envLocal).Length / 1KB, 1)
            $copied = $true
            try {
                Get-Content $envLocal -Raw | Set-Clipboard
            } catch {
                # Set-Clipboard requires an STA thread; a host running MTA throws
                # here. The databases are already safe, so degrade to a pointer.
                $copied = $false
            }
            Write-Host ""
            if ($copied) {
                Write-Host ".env.local ($size KB) is on your clipboard." -ForegroundColor Yellow
            } else {
                Write-Host "Could not reach the clipboard from this host. Open it yourself:" -ForegroundColor Yellow
                Write-Host "  $envLocal" -ForegroundColor Yellow
            }
            Write-Host "  Paste it into your password manager as a secure note:" -ForegroundColor Yellow
            Write-Host "    FounderOS .env.local" -ForegroundColor Yellow
            Write-Host "  It is deliberately NOT written to Google Drive — it holds a live" -ForegroundColor DarkGray
            Write-Host "  Stripe secret key and your email app passwords." -ForegroundColor DarkGray
        }
    }

    Write-Host "`nBackup complete." -ForegroundColor Cyan
}
finally {
    Pop-Location
}
