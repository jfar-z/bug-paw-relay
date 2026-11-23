param([string]$ServerUrl = '__BUGPAW_SERVER_URL__', [string]$Package = '__BUGPAW_PACKAGE__', [string]$DownloadGrant = $env:BUGPAW_DOWNLOAD_GRANT, [string]$InstallDir = "$env:LOCALAPPDATA\BugPawRelay")
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# 兼容旧入口：下载完整发布包，无需 Node/npm；校验文件按 UTF-8 读取。
# 模板默认值由服务端生成；直接使用源码必须显式指定地址和发行包名。
if ($ServerUrl.StartsWith('__BUGPAW_') -or $Package.StartsWith('__BUGPAW_')) {
  throw '请从已部署的服务下载安装脚本，或指定 ServerUrl 和 Package。'
}
if ([string]::IsNullOrWhiteSpace($DownloadGrant)) { throw '请先登录获取临时下载授权，通过 DownloadGrant 参数传入。' }
$escapedGrant = [Uri]::EscapeDataString($DownloadGrant)
$temporary = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Force -Path $temporary | Out-Null
try {
  $archive = Join-Path $temporary $package
  $checksumFile = "$archive.sha256"
  Invoke-WebRequest -UseBasicParsing "$ServerUrl/downloads/${package}?grant=$escapedGrant" -OutFile $archive
  Invoke-WebRequest -UseBasicParsing "$ServerUrl/downloads/$package.sha256?grant=$escapedGrant" -OutFile $checksumFile
  $expected = ([IO.File]::ReadAllText($checksumFile, [Text.Encoding]::UTF8).Trim() -split '\s+')[0]
  if ($expected -notmatch '^[0-9a-fA-F]{64}$') { throw 'Invalid SHA-256' }
  if ((Get-FileHash $archive -Algorithm SHA256).Hash -ne $expected) { throw 'SHA-256 mismatch' }
  Expand-Archive -LiteralPath $archive -DestinationPath $temporary
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  # 归档目录包含完整发行标识，不能固定为不含提交后缀的版本名。
  $packageDirectory = $Package -replace '\.zip$', ''
  Copy-Item -Path (Join-Path $temporary ($packageDirectory + '\*')) -Destination $InstallDir -Recurse -Force
  Write-Host "发布包已解压，运行：$InstallDir\bugpaw-relay.exe"
} finally { Remove-Item -LiteralPath $temporary -Recurse -Force }
