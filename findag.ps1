# agywe: find Antigravity.exe and print its full path (prints nothing when not found).
# Order: AGYWE_EXE env var -> antigravity-path.txt (written by the plugin every time Antigravity starts)
#        -> default per-user install -> uninstall entries in the registry -> Program Files.
# ASCII only on purpose: Windows PowerShell 5.1 misreads UTF-8 scripts without a BOM.
$ErrorActionPreference = "SilentlyContinue"
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
$Dir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Ok([string]$p) {
  if (-not $p) { return $false }
  $p = $p.Trim().Trim('"')
  return ($p -match '(?i)antigravity\.exe$') -and (Test-Path -LiteralPath $p -PathType Leaf)
}

$cands = New-Object System.Collections.Generic.List[string]
if ($env:AGYWE_EXE) { $cands.Add($env:AGYWE_EXE) }
$remember = Join-Path $Dir "antigravity-path.txt"
if (Test-Path -LiteralPath $remember) { try { $cands.Add(([IO.File]::ReadAllText($remember)).Trim()) } catch { } }
if ($env:LOCALAPPDATA) { $cands.Add((Join-Path $env:LOCALAPPDATA "Programs\antigravity\Antigravity.exe")) }

$keys = @(
  "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
  "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
  "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
)
foreach ($k in $keys) {
  try {
    Get-ItemProperty -Path $k -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like "Antigravity*" } | ForEach-Object {
      if ($_.InstallLocation) { $cands.Add((Join-Path ($_.InstallLocation.Trim('"')) "Antigravity.exe")) }
      if ($_.DisplayIcon) { $cands.Add((($_.DisplayIcon -replace '"', '') -replace ',\s*-?\d+$', '')) }
    }
  } catch { }
}
foreach ($pf in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
  if ($pf) { $cands.Add((Join-Path $pf "Antigravity\Antigravity.exe")) }
}

foreach ($c in $cands) {
  if (Ok $c) { Write-Output ($c.Trim().Trim('"')); exit 0 }
}
exit 1
