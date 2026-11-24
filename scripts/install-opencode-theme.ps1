<#
  Installs the transparent OpenCode theme and makes it the default.
  Run from anywhere:  powershell -File "...\scripts\install-opencode-theme.ps1"
#>
$ErrorActionPreference = 'Stop'

$projectTheme = Join-Path (Split-Path -Parent $PSScriptRoot) 'opencode-theme\transparent.json'
$configRoot   = Join-Path $env:USERPROFILE '.config\opencode'
$themeDir     = Join-Path $configRoot 'themes'
$targetTheme  = Join-Path $themeDir 'transparent.json'
$cliPath      = Join-Path $configRoot 'cli.json'

if (-not (Test-Path $projectTheme)) { throw "Theme source missing: $projectTheme" }

New-Item -ItemType Directory -Force -Path $themeDir | Out-Null
Copy-Item -LiteralPath $projectTheme -Destination $targetTheme -Force
Write-Output "Installed theme -> $targetTheme"

# Back up cli.json once, then select the transparent theme.
if (Test-Path $cliPath) {
  $backup = "$cliPath.before-transparent.bak"
  if (-not (Test-Path $backup)) {
    Copy-Item -LiteralPath $cliPath -Destination $backup -Force
    Write-Output "Backed up cli.json -> $backup"
  }
  $cli = Get-Content -LiteralPath $cliPath -Raw | ConvertFrom-Json
} else {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $cliPath) | Out-Null
  $cli = [PSCustomObject]@{ '$schema' = 'https://opencode.ai/v2/cli.json' }
  Write-Output "Created new cli.json at $cliPath"
}

if (-not $cli.PSObject.Properties['theme']) {
  $cli | Add-Member -NotePropertyName 'theme' -NotePropertyValue ([PSCustomObject]@{})
}
$cli.theme | Add-Member -NotePropertyName 'name' -NotePropertyValue 'transparent' -Force

$json = $cli | ConvertTo-Json -Depth 20
[System.IO.File]::WriteAllText($cliPath, $json + "`n", [System.Text.UTF8Encoding]::new($false))
Write-Output "Set cli.json theme.name = transparent"

# Verify installation.
$installed = Get-Content -LiteralPath $targetTheme -Raw | ConvertFrom-Json
$selected  = (Get-Content -LiteralPath $cliPath -Raw | ConvertFrom-Json).theme.name
$baseBg    = $installed.base.background.base

Write-Output '--- verification ---'
Write-Output "theme file valid JSON : $($null -ne $installed)"
Write-Output "base.background.base  : $baseBg"
Write-Output "cli.json theme.name   : $selected"

if ($baseBg -ne 'transparent' -or $selected -ne 'transparent') {
  throw 'Verification failed'
}
Write-Output 'INSTALL OK'
