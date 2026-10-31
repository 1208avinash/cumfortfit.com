$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pages = @("index.html", "lookbook.html")
$missing = @()
foreach ($page in $pages) {
  $file = Join-Path $root $page
  if (!(Test-Path $file)) { $missing += $page; continue }
  $html = Get-Content -LiteralPath $file -Raw
  $matches = [regex]::Matches($html, '(?:src|poster)=["'']([^"'']+)["'']')
  foreach ($m in $matches) {
    $ref = $m.Groups[1].Value
    if ($ref -match '^(https?:|data:|#|mailto:|tel:)') { continue }
    $local = Join-Path $root ($ref -split '[?#]')[0]
    if (!(Test-Path -LiteralPath $local)) { $missing += "$page -> $ref" }
  }
}
if ($missing.Count) {
  Write-Host "Missing files:" -ForegroundColor Red
  $missing | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
  exit 1
}
Write-Host "SUCCESS: Homepage, Lookbook and all referenced local assets are present." -ForegroundColor Green
Write-Host "Now double-click OPEN_LOOKBOOK_PREVIEW.bat to open the gallery." -ForegroundColor Cyan
