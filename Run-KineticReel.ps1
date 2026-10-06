# Kinetic Reel Engine — interactive launcher for Windows PowerShell.
# Keeps no machine-specific paths: FFmpeg is resolved from PATH (or FFMPEG_PATH).
param(
    [string]$Topic,
    [int]$Duration = 30,
    [string]$Voice = "Fenrir",
    [string]$Style = "fares-editorial",
    [string]$Pace = "standard",
    [string]$Lang,
    [string]$Aspect = "9:16"
)

$ErrorActionPreference = "Stop"

if (-not $env:GEMINI_API_KEY) {
    $secure = Read-Host "Google AI Studio key (GEMINI_API_KEY)" -AsSecureString
    $env:GEMINI_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}

if (-not $Topic) { $Topic = Read-Host "Topic or idea" }
if (-not $Topic) { Write-Host "No topic given — nothing to do." -ForegroundColor Red; exit 1 }

$script = Join-Path $PSScriptRoot "create-reel.mjs"
$args = @($script, $Topic, "--duration", $Duration, "--voice", $Voice, "--style", $Style, "--pace", $Pace, "--aspect", $Aspect)
if ($Lang) { $args += @("--lang", $Lang) }

node @args
