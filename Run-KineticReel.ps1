param(
    [string]$Topic,
    [int]$Duration = 30,
    [string]$Voice = "Puck",
    [string]$Lang = "French",
    [string]$ApiKey
)

# Assurer FFmpeg dans le PATH
$env:Path = "C:\Users\bbouzid\AppData\Local\Scoop\shims;" + $env:Path

if (-not $ApiKey -and -not $env:GEMINI_API_KEY) {
    Write-Host "Veuillez entrer votre cle Google AI Studio (GEMINI_API_KEY):" -ForegroundColor Yellow
    $ApiKey = Read-Host
    if ($ApiKey) {
        $env:GEMINI_API_KEY = $ApiKey
    }
}

if (-not $Topic) {
    Write-Host "Entrez le sujet de votre video (ex: Pourquoi le cafe de specialite coute si cher):" -ForegroundColor Cyan
    $Topic = Read-Host
}

if (-not $Topic) {
    Write-Host "Aucun sujet specifie. Annulation." -ForegroundColor Red
    exit 1
}

$scriptPath = Join-Path $PSScriptRoot "create-reel.mjs"
node $scriptPath --topic "$Topic" --duration $Duration --voice "$Voice" --lang "$Lang"
