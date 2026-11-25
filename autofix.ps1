# agywe 自动重装：Antigravity 自动更新会换掉 app.asar，把壁纸插件冲掉。这个脚本负责装回去。
#   -Mode update ：Antigravity 退出去装更新时由插件启动，等更新装完再装回
#   -Mode logon  ：开机时检查一次（注册在 HKCU\...\Run 的 agywe-autofix）
param([string]$Mode = "logon")
$ErrorActionPreference = "Continue"
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
$Dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Log = Join-Path $Dir "autofix.log"
# v0.10.2：程序位置交给 findag.ps1 找（环境变量 / 插件记下的位置 / 默认位置 / 注册表），找不到再用默认位置
$Exe = $null
try { $Exe = (& (Join-Path $Dir "findag.ps1") | Select-Object -First 1) } catch { }
if (-not $Exe) { $Exe = Join-Path $env:LOCALAPPDATA "Programs\antigravity\Antigravity.exe"; if ($env:AGYWE_EXE) { $Exe = $env:AGYWE_EXE } }
$Exe = [string]$Exe
$AgDir = Split-Path -Parent $Exe
$Asar = Join-Path $AgDir "resources\app.asar"
$CfgFile = Join-Path $env:APPDATA "Antigravity\agywe\config.json"

function Log([string]$m) {
  try {
    if ((Test-Path $Log) -and ((Get-Item $Log).Length -gt 512KB)) { $keep = Get-Content $Log -Tail 200 -Encoding UTF8; Set-Content $Log $keep -Encoding UTF8 }
    Add-Content -Path $Log -Value ((Get-Date -Format "yyyy-MM-dd HH:mm:ss") + " [" + $Mode + "] " + $m) -Encoding UTF8
  } catch { }
}

function Toast([string]$title, [string]$msg) {
  try {
    $null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
    $null = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
    $t = [Security.SecurityElement]::Escape($title); $b = [Security.SecurityElement]::Escape($msg)
    $x = New-Object Windows.Data.Xml.Dom.XmlDocument
    $x.LoadXml("<toast><visual><binding template=""ToastGeneric""><text>$t</text><text>$b</text></binding></visual></toast>")
    $aumid = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($aumid).Show((New-Object Windows.UI.Notifications.ToastNotification $x))
    return
  } catch { Log ("系统通知失败，改用气泡：" + $_.Exception.Message) }
  try {
    Add-Type -AssemblyName System.Windows.Forms, System.Drawing
    $n = New-Object System.Windows.Forms.NotifyIcon
    $n.Icon = [System.Drawing.SystemIcons]::Information; $n.Visible = $true
    $n.ShowBalloonTip(10000, $title, $msg, [System.Windows.Forms.ToolTipIcon]::Info)
    Start-Sleep -Seconds 11; $n.Dispose()
  } catch { }
}

# 同一时间只跑一个
$mtx = New-Object System.Threading.Mutex($false, "Local\agywe-autofix")
$got = $false
try { $got = $mtx.WaitOne(0) } catch { $got = $true }   # 上一个实例异常退出时会抛"被放弃的互斥体"，当作拿到了
if (-not $got) { exit 0 }

if (Test-Path (Join-Path $Dir "autofix.off")) { exit 0 }   # 卸载过：不再自动装
# 配置里可能有很大的图片数据，不做完整 JSON 解析，只找这两个开关
$raw = ""
try { $raw = [IO.File]::ReadAllText($CfgFile, [Text.Encoding]::UTF8) } catch { }
if ($raw -match '"autoFix"\s*:\s*false') { exit 0 }
$AllowRestart = -not ($raw -match '"autoFixRestart"\s*:\s*false')

# app.asar 里有没有插件："yes" / "no" / "busy"（正被写，读不了）
function MarkState {
  try {
    $fs = [IO.File]::Open($Asar, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)
    try {
      $h = New-Object byte[] 16
      if ($fs.Read($h, 0, 16) -ne 16) { return "busy" }
      if ([BitConverter]::ToUInt32($h, 0) -ne 4) { return "busy" }
      $len = [BitConverter]::ToUInt32($h, 12)
      if ($len -le 0 -or $len -gt 64MB) { return "busy" }
      $buf = New-Object byte[] $len
      $n = 0
      while ($n -lt $len) { $r = $fs.Read($buf, $n, $len - $n); if ($r -le 0) { break }; $n += $r }
      if ($n -ne $len) { return "busy" }
      $s = [Text.Encoding]::UTF8.GetString($buf)
      if ([regex]::IsMatch($s, '"agywe"\s*:\s*\{\s*"files"')) { return "yes" }
      if ($s.Contains('"package.json"')) { return "no" }
      return "busy"
    } finally { $fs.Dispose() }
  } catch { return "busy" }
}

function AgProcs {
  @(Get-Process -Name Antigravity -ErrorAction SilentlyContinue | Where-Object {
    try { (-not $_.Path) -or $_.Path.StartsWith($AgDir, [StringComparison]::OrdinalIgnoreCase) } catch { $true }
  })
}
function InstallerRunning {
  $p = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
    try { $_.ProcessName -match '^(Un_A|Un_B|Au_)$' -or $_.ProcessName -match 'antigravity.*setup|setup.*antigravity' -or ($_.Path -and $_.Path -match '\\[^\\]*-updater\\') } catch { $false }
  })
  return $p.Count -gt 0
}
# 等安装程序结束、程序包不再变化
function WaitStable([int]$sec) {
  $t = Get-Date
  while (((Get-Date) - $t).TotalSeconds -lt $sec) {
    if (-not (InstallerRunning) -and (Test-Path $Asar)) {
      $a = Get-Item $Asar; $s1 = "$($a.Length)|$($a.LastWriteTimeUtc.Ticks)"
      Start-Sleep -Seconds 4
      if (-not (Test-Path $Asar)) { continue }
      $a = Get-Item $Asar; $s2 = "$($a.Length)|$($a.LastWriteTimeUtc.Ticks)"
      if ($s1 -eq $s2 -and -not (InstallerRunning) -and (MarkState) -ne "busy") { return $true }
    } else { Start-Sleep -Seconds 3 }
  }
  return $false
}
function RecentlyStarted {
  $ps = AgProcs
  if ($ps.Count -eq 0) { return $false }
  $first = $ps | ForEach-Object { try { $_.StartTime } catch { Get-Date } } | Sort-Object | Select-Object -First 1
  return (((Get-Date) - $first).TotalSeconds -lt 150)
}

function DoInstall {
  if (-not (Test-Path $Exe)) { Log "找不到 $Exe"; return "fail" }
  # 先看 Electron 安全开关：RunAsNode 被关或开了程序包完整性校验时，不碰任何文件
  $fc = Join-Path $Dir "fusecheck.ps1"
  if (Test-Path $fc) {
    $fo = ""
    try { $fo = (& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $fc -Exe $Exe -For install 2>&1 | Out-String) } catch { }
    $fcode = $LASTEXITCODE
    if ($fcode -eq 2) { Log ("安全开关：" + (($fo -replace "\r?\n", " ").Trim())); return "nonode" }
    if ($fcode -eq 3) { Log ("安全开关：" + (($fo -replace "\r?\n", " ").Trim())); return "integrity" }
  }
  $old = $env:ELECTRON_RUN_AS_NODE
  $env:ELECTRON_RUN_AS_NODE = "1"
  $out = ""
  try { $out = (& $Exe (Join-Path $Dir "install.cjs") install --exe $Exe 2>&1 | Out-String) }
  catch { $out = "运行安装器失败：" + $_.Exception.Message }
  finally { if ($null -eq $old) { Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue } else { $env:ELECTRON_RUN_AS_NODE = $old } }
  $code = $LASTEXITCODE
  Log ("安装器退出码 " + $code + "：" + (($out -replace "\r?\n", " | ").Trim()))
  if ($code -eq 0 -and (MarkState) -eq "yes") { return "ok" }
  if ($out -match "结构和插件预期不一致") { return "incompatible" }
  if ($out -match "程序包完整性校验") { return "integrity" }
  return "fail"
}

function RestartFix {
  $ps = AgProcs
  Log ("关掉更新器刚重新打开的 Antigravity：" + (($ps | ForEach-Object { $_.Id }) -join ","))
  foreach ($p in $ps) { try { & taskkill.exe /T /F /PID $p.Id 2>&1 | Out-Null } catch { } }
  Get-Process -Name language_server -ErrorAction SilentlyContinue | Where-Object { try { $_.Path.StartsWith($AgDir, [StringComparison]::OrdinalIgnoreCase) } catch { $false } } | ForEach-Object { try { $_.Kill() } catch { } }
  $t = Get-Date
  while ((AgProcs).Count -gt 0 -and ((Get-Date) - $t).TotalSeconds -lt 15) { Start-Sleep -Milliseconds 500 }
  Start-Sleep -Seconds 1
  $r = DoInstall
  try { Start-Process -FilePath $Exe } catch { Log ("重新打开 Antigravity 失败：" + $_.Exception.Message) }
  return $r
}

function Report([string]$r, [string]$how) {
  if ($r -eq "ok") {
    if ($how -eq "restart") { Toast "壁纸插件已自动装回" "Antigravity 刚更新完，已经装好插件并重新打开。" }
    else { Toast "壁纸插件已自动装回" "下次打开 Antigravity 就有壁纸了。" }
  } elseif ($r -eq "integrity") {
    Toast "新版 Antigravity 不允许改动程序包" "它打开了程序包完整性校验，装上插件会打不开，所以没有改任何文件。等插件更新。"
  } elseif ($r -eq "nonode") {
    Toast "新版 Antigravity 暂时装不上壁纸插件" "它关掉了安装器要用的 RunAsNode，没有改任何文件。等插件更新。"
  } elseif ($r -eq "incompatible") {
    Toast "新版 Antigravity 暂时装不上壁纸插件" "它的代码结构变了，为了安全没有改任何文件。详情见插件文件夹里的 autofix.log。"
  } else {
    Toast "壁纸插件自动重装失败" "可以手动运行插件文件夹里的 install.cmd，详情见 autofix.log。"
  }
}

function HandleMissing {
  if (-not (WaitStable 600)) { Log "等更新装完超时"; return }
  if ((MarkState) -eq "yes") { Log "插件已经在了"; return }
  if ((AgProcs).Count -gt 0) {
    if ($AllowRestart -and $Mode -eq "update" -and (RecentlyStarted)) { Report (RestartFix) "restart"; return }
    Log "插件丢了，Antigravity 还开着，等它退出"
    Toast "Antigravity 更新后壁纸插件失效了" "退出 Antigravity（托盘图标 → 退出）后会自动装回，下次打开就恢复。"
    while ((AgProcs).Count -gt 0) { Start-Sleep -Seconds 5 }
    Start-Sleep -Seconds 2
    if (-not (WaitStable 120)) { return }
    if ((MarkState) -eq "yes") { return }
  }
  Report (DoInstall) "quiet"
}

if ($Mode -eq "update") {
  Log "Antigravity 退出去装更新，开始守候"
  $t = Get-Date
  while ((AgProcs).Count -gt 0 -and ((Get-Date) - $t).TotalSeconds -lt 60) { Start-Sleep -Seconds 1 }
  $t = Get-Date; $seen = $false
  while (((Get-Date) - $t).TotalMinutes -lt 10) {
    if ((MarkState) -eq "no") { $seen = $true; HandleMissing; break }
    Start-Sleep -Seconds 3
  }
  if (-not $seen) { Log "10 分钟内程序包没被换掉，结束守候" }
} else {
  Start-Sleep -Seconds 20
  $m = MarkState
  Log ("开机检查：" + $m)
  if ($m -eq "no") { HandleMissing }
}
try { $mtx.ReleaseMutex() } catch { }
