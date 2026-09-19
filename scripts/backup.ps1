<#
.SYNOPSIS
    Snapshot the FounderOS databases and an encrypted .env.local to Google Drive.

.DESCRIPTION
    The two things `git push` deliberately leaves behind:

      data\*.db      -> VACUUM INTO snapshots. All three stores (founder-os,
                        bank, ledger). Business content, no credentials.
      .env.local     -> env.local.enc, AES-256-GCM under a passphrase you keep
                        in your password manager. It holds a live Stripe key and
                        your email app passwords, so it never reaches Drive in
                        plaintext.

    The first run asks you to choose the passphrase; later runs check you typed
    the same one before replacing the file.

.EXAMPLE
    .\scripts\backup.ps1
    .\scripts\backup.ps1 -BackupDir 'D:\sync\FounderOS' -KeepDays 90
    .\scripts\backup.ps1 -SkipSecrets        # databases only, no passphrase prompt
#>
[CmdletBinding()]
param(
    [string]$BackupDir,
    [int]$KeepDays = 30,
    [switch]$SkipSecrets,
    # For unattended use (e.g. read from a vault). Omit to be prompted.
    [System.Security.SecureString]$Passphrase
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

    # The databases are already safe by this point, so abandoning the passphrase
    # prompt below never costs a DB backup.
    if (-not $SkipSecrets) {
        $envLocal = Join-Path $repo '.env.local'
        $encrypted = Join-Path $dest $SecretsFileName
        if (-not (Test-Path $envLocal)) {
            Write-Warning "No .env.local to back up (fine if you haven't wired any connectors yet)."
        } else {
            Write-Host ""
            $existing = Test-Path $encrypted
            if (-not $Passphrase) {
                if ($existing) {
                    $Passphrase = Read-Passphrase -Prompt 'Secrets passphrase'
                } else {
                    Write-Host "First secrets backup: choose a passphrase to encrypt .env.local." -ForegroundColor Yellow
                    Write-Host "  Save it in your password manager. Without it the file cannot be opened." -ForegroundColor Yellow
                    $Passphrase = Read-Passphrase -Prompt 'New secrets passphrase' -Confirm
                }
            }

            if ($existing) {
                # Hold one passphrase across backups: re-encrypting under a
                # mistyped one would quietly swap a file you can open for one you
                # can't.
                $code = Invoke-SecretsTool -RepoRoot $repo -Passphrase $Passphrase -Arguments @('verify', $encrypted)
                if ($code -eq 2) { throw "That doesn't match the passphrase of the existing $SecretsFileName. Nothing was changed." }
                if ($code -ne 0) { throw "Could not check the existing $SecretsFileName (exit $code)." }
            } elseif ((ConvertFrom-SecureStringPlain $Passphrase).Length -lt 12) {
                # The encrypted file sits in cloud storage indefinitely; a short
                # passphrase is the only realistic way it gets opened by someone else.
                throw 'Use a passphrase of at least 12 characters. Nothing was written.'
            }

            $code = Invoke-SecretsTool -RepoRoot $repo -Passphrase $Passphrase -Arguments @('encrypt', $envLocal, $encrypted)
            if ($code -ne 0) { throw "Encrypting .env.local failed (exit $code)." }
        }
    }

    Write-Host "`nBackup complete." -ForegroundColor Cyan
}
finally {
    Pop-Location
}
