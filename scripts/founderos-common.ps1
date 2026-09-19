# Shared helpers for the Windows setup scripts. Dot-sourced, never run directly.
#
# The one job here is finding Node 22 without depending on the user's shell
# profile: fnm puts Node on PATH via a per-shell hook, and a script launched by
# double-click, a scheduler, or a fresh terminal may not have that hook loaded.

Set-StrictMode -Version Latest

function Get-RepoRoot {
    Split-Path -Parent $PSScriptRoot
}

function Find-Fnm {
    $onPath = Get-Command fnm -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }

    # winget installs to a versioned package folder and adds it to the *user*
    # PATH, which an already-open shell hasn't picked up yet.
    $packages = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
    if (Test-Path $packages) {
        $exe = Get-ChildItem $packages -Directory -Filter 'Schniz.fnm*' -ErrorAction SilentlyContinue |
            ForEach-Object { Join-Path $_.FullName 'fnm.exe' } |
            Where-Object { Test-Path $_ } |
            Select-Object -First 1
        if ($exe) { return $exe }
    }
    return $null
}

# Puts a Node 22 toolchain on PATH for this process only. Returns the node.exe
# path, or $null if none is installed.
function Initialize-Node22 {
    $current = Get-Command node -ErrorAction SilentlyContinue
    if ($current) {
        $version = & $current.Source -v
        if ($version -like 'v22.*') { return $current.Source }
    }

    $fnmDir = if ($env:FNM_DIR) { $env:FNM_DIR } else { Join-Path $env:APPDATA 'fnm' }
    $versionsDir = Join-Path $fnmDir 'node-versions'
    if (-not (Test-Path $versionsDir)) { return $null }

    # Sort as versions, not strings — otherwise v22.9.0 sorts above v22.23.2.
    $newest = Get-ChildItem $versionsDir -Directory -Filter 'v22.*' -ErrorAction SilentlyContinue |
        Sort-Object { [version]($_.Name.TrimStart('v')) } -Descending |
        Select-Object -First 1
    if (-not $newest) { return $null }

    $bin = Join-Path $newest.FullName 'installation'
    $node = Join-Path $bin 'node.exe'
    if (-not (Test-Path $node)) { return $null }

    $env:PATH = "$bin;$env:PATH"
    return $node
}

function Assert-Node22 {
    $node = Initialize-Node22
    if (-not $node) {
        throw "Node 22 not found. Run scripts\bootstrap.ps1 first — it installs fnm and Node 22."
    }
    $version = & node -v
    if ($version -notlike 'v22.*') {
        throw "This repo pins Node 22 (.node-version, engines), but '$version' is active. Run ``fnm use 22``."
    }
    return $version
}

# Where snapshots live. Overridable so the same scripts work on a PC where
# Google Drive mounted on a different letter.
function Get-BackupDir {
    param([string]$Override)
    if ($Override) { return $Override }
    if ($env:FOUNDER_OS_BACKUP_DIR) { return $env:FOUNDER_OS_BACKUP_DIR }
    return 'H:\My Drive\FounderOS'
}

# Google Drive for Desktop streams by default: if it isn't running, the whole
# drive letter is simply absent. Silently "backing up" into a path that doesn't
# exist is the worst possible failure, so distinguish the two cases loudly.
function Assert-BackupDir {
    param([Parameter(Mandatory)][string]$Path, [switch]$Create)

    $qualifier = if ($Path -match '^([A-Za-z]:)') { $Matches[1] } else { $null }
    if ($qualifier -and -not (Test-Path "$qualifier\")) {
        throw "Drive $qualifier is not mounted. Start Google Drive for Desktop and wait for it to appear, then retry. (Override with -BackupDir or `$env:FOUNDER_OS_BACKUP_DIR.)"
    }
    # Drive for Desktop mounts one letter per signed-in account, and the letters
    # say nothing about which account is which. Show the volume label (which
    # names the account) so a backup landing in the wrong Drive is visible.
    if ($qualifier) {
        $volume = Get-PSDrive -Name $qualifier.TrimEnd(':') -ErrorAction SilentlyContinue
        if ($volume -and $volume.Description) {
            Write-Host "Using $qualifier  ($($volume.Description))" -ForegroundColor DarkGray
        }
    }
    if (-not (Test-Path $Path)) {
        if (-not $Create) { throw "Backup folder not found: $Path" }
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
    return (Resolve-Path $Path).Path
}

# Parse a .env file into a hashtable of key -> value, with inline comments
# stripped. .env.example writes things like
#
#   STRIPE_SECRET_KEY=            # full client implemented
#
# so a naive parse reads the comment as the value, and it declares some keys
# (PAYPAL_CLIENT_ID) twice with a comment on only one of them. Both make a
# blank template entry look like a filled-in credential.
function Get-EnvPairs {
    param([Parameter(Mandatory)][string]$Path)

    $pairs = @{}
    if (-not (Test-Path $Path)) { return $pairs }
    foreach ($line in Get-Content $Path) {
        if ($line -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') { continue }
        $key = $Matches[1]
        $value = $Matches[2]
        # Drop a trailing comment, then anything that was only a comment.
        $value = ($value -replace '\s+#.*$', '').Trim()
        if ($value.StartsWith('#')) { $value = '' }
        $pairs[$key] = $value
    }
    return $pairs
}

# Name of the encrypted .env.local inside the backup folder.
$script:SecretsFileName = 'env.local.enc'

function ConvertFrom-SecureStringPlain {
    param([Parameter(Mandatory)][System.Security.SecureString]$Secure)
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

# Prompt without echo. -Confirm asks twice: a typo in a brand-new passphrase
# would otherwise produce a backup nobody can ever open.
function Read-Passphrase {
    param([string]$Prompt = 'Passphrase', [switch]$Confirm)
    $first = Read-Host -Prompt $Prompt -AsSecureString
    if ($Confirm) {
        $second = Read-Host -Prompt 'Type it again' -AsSecureString
        if ((ConvertFrom-SecureStringPlain $first) -cne (ConvertFrom-SecureStringPlain $second)) {
            throw 'Passphrases did not match. Nothing was written.'
        }
    }
    return $first
}

# Runs scripts/secrets.ts with the passphrase on stdin rather than the command
# line, where any process on the machine could read it. Returns the exit code:
# 0 ok, 2 wrong passphrase, anything else a real failure.
function Invoke-SecretsTool {
    param(
        [Parameter(Mandatory)][string]$RepoRoot,
        [Parameter(Mandatory)][System.Security.SecureString]$Passphrase,
        [Parameter(Mandatory)][string[]]$Arguments
    )
    $tsx = Join-Path $RepoRoot 'node_modules/tsx/dist/cli.mjs'
    $tool = Join-Path $RepoRoot 'scripts/secrets.ts'
    # Send base64, not the raw passphrase. PowerShell re-encodes pipes to native
    # programs with the session's $OutputEncoding (a BOM under UTF-8, '?' for
    # non-ASCII under ASCII), and that setting varies by terminal and can't be
    # reliably overridden here. Base64 is ASCII, so it arrives intact everywhere.
    $bytes = [Text.Encoding]::UTF8.GetBytes((ConvertFrom-SecureStringPlain $Passphrase))
    # Out-Host keeps the tool's messages on screen and out of the return value.
    [Convert]::ToBase64String($bytes) | & node $tsx $tool @Arguments | Out-Host
    return $LASTEXITCODE
}
