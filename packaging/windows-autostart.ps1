# 配置逻辑固定，路径仅通过进程环境传入，避免被当成 PowerShell 表达式解析。
$Mode = $env:BUGPAW_AUTOSTART_MODE
$ApplicationRoot = $env:BUGPAW_AUTOSTART_APP
$InstallRoot = $env:BUGPAW_INSTALL_ROOT
$DataDirectory = $env:BUGPAW_HOME
$ErrorActionPreference = 'Stop'
# 只有任务不存在的 HRESULT 才能作为未启用旧入口的证据。
function Get-LegacyTask($Folder) {
    try { return $Folder.GetTask('BugPawRelay') }
    catch {
        if ($_.Exception.GetBaseException().HResult -ne -2147024894) { throw }
    }
}

$option = if ($Mode -eq 'enable') { 'Create' } else { 'DoNotVerify' }
$startup = [Environment]::GetFolderPath('Startup', $option)
if (-not $startup) { throw 'Startup folder unavailable' }
$name = 'BugPaw Relay.lnk'
$linkPath = Join-Path $startup $name
if ($Mode -eq 'enable') {
    $launcher = Join-Path $ApplicationRoot 'bugpaw-relay-login.exe'
    if (-not [IO.File]::Exists($launcher)) { throw 'Login launcher missing' }
    $approved = [Microsoft.Win32.Registry]::GetValue('HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder', $name, $null)
    if ($approved -and $approved[0] -notin 2,6) { throw 'Startup entry disabled by Windows' }
}

try {
    $scheduler = New-Object -ComObject Schedule.Service
    $scheduler.Connect()
    $folder = $scheduler.GetFolder('\')
    $task = Get-LegacyTask $folder
    if ($task) {
        # 旧任务名称是机器级的，先核实所有者与动作。
        $principal = $task.Definition.Principal.UserId
        $current = [Security.Principal.WindowsIdentity]::GetCurrent()
        if ($principal -ne $current.User.Value) {
            $account = New-Object Security.Principal.NTAccount($principal)
            if ($account.Translate([Security.Principal.SecurityIdentifier]).Value -ne $current.User.Value) {
                throw 'Legacy task belongs to another account'
            }
        }
        $action = $task.Definition.Actions.Item(1)
        if ([IO.Path]::GetFileName($action.Path.Trim('"')) -ine 'bugpaw-relay.exe' -or
            $action.Arguments -notmatch '^run\s+--data-home\s') { throw 'Unexpected legacy task action' }
        $folder.DeleteTask('BugPawRelay', 0)
        if (Get-LegacyTask $folder) { throw 'Legacy task still exists' }
    }
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 2
}

if ($Mode -eq 'disable') {
    if (Test-Path -LiteralPath $linkPath) { [IO.File]::Delete($linkPath) }
    exit 0
}
# 结束引号前的反斜杠须加倍，保留盘符根目录等路径。
function Quote-PathArgument([string]$Value) { return '"' + ($Value -replace '(\\+)$', '$1$1') + '"' }
# 薄更新目录会被后续升级清理，快捷方式需要引用当前用户的持久入口。
if ($ApplicationRoot -ine $InstallRoot) {
    $helperDirectory = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'BugPaw Relay'
    [void][IO.Directory]::CreateDirectory($helperDirectory)
    $stableLauncher = Join-Path $helperDirectory 'bugpaw-relay-login.exe'
    [IO.File]::Copy($launcher, $stableLauncher, $true)
    $launcher = $stableLauncher
}
$arguments = (Quote-PathArgument $InstallRoot) + ' start --data-home ' + (Quote-PathArgument $DataDirectory)
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($linkPath)
$link.TargetPath = $launcher
$link.Arguments = $arguments
$link.WorkingDirectory = $InstallRoot
$link.Save()
$saved = $shell.CreateShortcut($linkPath)
if (-not [IO.File]::Exists($linkPath) -or $saved.TargetPath -ine $launcher -or $saved.Arguments -cne $arguments) {
    throw 'Startup shortcut verification failed'
}
