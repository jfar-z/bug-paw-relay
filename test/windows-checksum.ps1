# 对实际安装脚本的校验步骤做回归，覆盖二进制下载、损坏校验值与非法格式。
param([Parameter(Mandatory = $true)][string]$ServerUrl, [Parameter(Mandatory = $true)][string]$Package)
$ErrorActionPreference = 'Stop'
$sourcePath = Join-Path $PSScriptRoot '../public/install.ps1'
$source = [IO.File]::ReadAllText($sourcePath, [Text.Encoding]::UTF8)
$tokens = $null
$parseErrors = $null
[void][Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { throw '安装脚本语法检查失败。' }
$start = $source.IndexOf('  $archive =')
$end = $source.IndexOf('  Expand-Archive', $start)
$verifyStart = $source.IndexOf('  $expected =', $start)
if ($start -lt 0 -or $end -lt 0 -or $verifyStart -lt 0) { throw '找不到安装器校验步骤。' }
$downloadAndVerify = [ScriptBlock]::Create($source.Substring($start, $end - $start))
$verifyOnly = [ScriptBlock]::Create($source.Substring($verifyStart, $end - $verifyStart))
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('relay-checksum-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $temporary | Out-Null
try {

  . $downloadAndVerify
  Write-Output 'PASS: HTTPS 发行包与校验文件下载、UTF-8 解码及 SHA-256 匹配。'
  [IO.File]::WriteAllText($checksumFile, ('0' * 64) + '  package.tar.gz', [Text.Encoding]::UTF8)
  $rejected = $false
  try { . $verifyOnly } catch { $rejected = $true }
  if (-not $rejected) { throw '损坏的校验值未被拒绝。' }
  Write-Output 'PASS: 不匹配的 SHA-256 被拒绝。'
  [IO.File]::WriteAllText($checksumFile, '<html>gateway error</html>', [Text.Encoding]::UTF8)
  $rejected = $false
  try { . $verifyOnly } catch { $rejected = $true }
  if (-not $rejected) { throw '非法校验文件未被拒绝。' }
  Write-Output 'PASS: 非法校验文件被拒绝。'
} finally { Remove-Item $temporary -Recurse -Force -ErrorAction SilentlyContinue }
