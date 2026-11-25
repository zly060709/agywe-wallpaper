# agywe：运行 Antigravity.exe 之前，先看一眼它里面写死的 Electron 安全开关（fuses）
#   退出码 0 = 可以继续（读不到也当作可以）
#           2 = RunAsNode 被关了：安装器借不了 Antigravity.exe 跑 Node，硬跑只会打开 Antigravity 本身
#           3 = 打开了程序包完整性校验：改了 app.asar 就启动不了（只在 -For install 时拦）
param([string]$Exe = "", [string]$For = "install")
$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
if (-not $Exe -or -not (Test-Path -LiteralPath $Exe)) { exit 0 }
$Sentinel = "dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX"
$wire = $null
try {
  $enc = [Text.Encoding]::GetEncoding(28591)
  $fs = [IO.File]::Open($Exe, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
  try {
    $chunk = 8MB
    $keep = $Sentinel.Length - 1
    $buf = New-Object byte[] ($chunk + $Sentinel.Length)
    $base = [long]0
    $carry = 0
    while ($true) {
      $n = $fs.Read($buf, $carry, $chunk)
      if ($n -le 0) { break }
      $len = $carry + $n
      $i = $enc.GetString($buf, 0, $len).IndexOf($Sentinel, [StringComparison]::Ordinal)
      if ($i -ge 0) {
        $fs.Position = $base + $i + $Sentinel.Length
        $t = New-Object byte[] 40
        $got = $fs.Read($t, 0, 40)
        if ($got -ge 3) { $cnt = [Math]::Min([int]$t[1], $got - 2); $wire = $enc.GetString($t, 2, $cnt) }
        break
      }
      $k = [Math]::Min($len, $keep)
      [Array]::Copy($buf, $len - $k, $buf, 0, $k)
      $base += $len - $k
      $carry = $k
    }
  } finally { $fs.Dispose() }
} catch {
  Write-Host ("[agywe] 没读到 Antigravity.exe 的安全开关（" + $_.Exception.Message + "），继续。")
  exit 0
}
if (-not $wire) { exit 0 }
$runAsNode = $wire.Substring(0, 1)
$integrity = ""
if ($wire.Length -ge 5) { $integrity = $wire.Substring(4, 1) }
if ($runAsNode -ne "1") {
  Write-Host "[agywe] 这个版本的 Antigravity 关掉了 RunAsNode（Electron 的安全开关），安装器没法借用 Antigravity.exe 运行。"
  Write-Host "[agywe] 什么都没改。Antigravity 更新时已经换上了原版程序包，现在就是原版，不需要卸载；插件暂时装不上，等插件更新。"
  exit 2
}
if ($For -eq "install" -and $integrity -eq "1") {
  Write-Host "[agywe] 这个版本的 Antigravity 打开了「程序包完整性校验」，改动 app.asar 后它会启动失败。"
  Write-Host "[agywe] 这次没有修改任何文件，Antigravity 照常能用；插件暂时装不上，等插件更新。"
  exit 3
}
exit 0
