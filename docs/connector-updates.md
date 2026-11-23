# Connector updates / 连接器更新

连接器协议三使用薄更新：当前连接器下载、验证并安全解包；临时监督进程正常停止旧进程、切换完整应用目录、启动新进程，随后退出。没有自动数据备份、回滚或循环重启。只有目标构建通过原身份认证并完成对账后才显示更新成功。

Protocol 3 prepares and validates the complete package in the running connector. A temporary supervisor stops the old process normally, switches the complete application directory, starts the new process, and exits. It does not back up data, roll back, or restart repeatedly. Success requires the target build to authenticate with the original identity and reconcile.

首发仅接受协议三更新，不再执行协议一、二的自动回滚或 `update-recover` 命令。旧更新状态只作为历史事实展示；旧节点须先正常停止并手工安装完整包，不能通过修改元数据绕过准入。

The first release accepts protocol 3 only. Protocol 1/2 automatic rollback and the `update-recover` command are no longer executed. Legacy update states are historical facts only. Stop older connectors normally and install a complete package manually; editing metadata cannot bypass eligibility checks.

## 安装与人工恢复 / Installation and manual recovery

1. 正常停止旧连接器，确认没有仍在切换的监督进程。停止结果未知时先本机诊断，不并行启动。
2. 将最新兼容完整包解压到新的独立应用目录，不覆盖正在运行的目录、不混合新旧文件、不复制旧 `.relay-update/current.txt`。
3. 使用原用户和原数据目录启动。默认数据在用户目录的 `.bugpaw-relay`；自定义目录使用原 `BUGPAW_HOME` 或 `--data-home`。保留配置、身份、Vault、数据库、原生会话与项目。
4. 使用新包的 `bugpaw-relay`（Windows 为 `bugpaw-relay.exe`）启动。启用过自启动时更新已有入口，确保不再启动旧包；不自动开启自启动。
5. 查看本机状态、诊断和服务端实际版本。网络不可达时等待正常重连；不要删数据库、更新账本或重新注册身份。损坏或未知数据格式需维护者处理，重新安装不保证修复数据损坏。

1. Stop the old connector normally and verify that no supervisor is still switching versions. Diagnose uncertain shutdown locally; do not start parallel instances.
2. Extract the latest compatible full package into a new application directory. Do not overwrite a running directory, mix files, or copy the old `.relay-update/current.txt`.
3. Start as the original user with the original data directory. The default is `.bugpaw-relay` under the user home; retain the original `BUGPAW_HOME` or `--data-home` for custom locations. Preserve configuration, identity, Vault, database, native sessions and projects.
4. Run the new package's `bugpaw-relay` (`bugpaw-relay.exe` on Windows). Update any existing autostart entry to prevent the old package starting again. Do not enable new autostart.
5. Check local diagnostics and the server's actual version. Allow normal reconnection during network outages. Do not delete ledgers or re-register identity. Unknown or damaged data requires maintainer assistance; reinstalling does not repair damaged data.

旧协议若留有未结束更新，并且重装到新目录，启动时加 `--previous-install-root <旧安装绝对路径>`。程序会只读核对旧目录绑定的原数据目录、更新日志和监督器 PID；监督器仍存活、身份不完整或目录不匹配时继续阻止解除维护。不要复制旧指针或手工删除账本。此参数仅用于人工恢复核验，不启动旧版本。

For an unfinished legacy update when reinstalling into a new directory, start with `--previous-install-root <absolute-old-installation-path>`. The connector checks the old installation's data-directory binding, journal and supervisor PID without changing the old files. A live supervisor, missing identity evidence or mismatched directory keeps recovery blocked. Do not copy the old pointer or delete journals. This argument only verifies manual recovery; it never launches the old version.

## 状态和兼容 / Status and compatibility

下载失败保持原包。停旧未确认时不换包。启动失败或离线超时表示需要检查、结果未确认，不代表已回滚或数据损坏。人工安装其他版本后记录“已由人工安装恢复”，不将原目标伪报成功。旧协议历史保留原始回滚状态。旧节点不能通过修改格式号、版本或回滚开关进入新通路，需完整包手工过渡。

Download failure leaves the original package intact. Unconfirmed shutdown prevents switching. Startup failure or an offline timeout requires local inspection and means the outcome is unconfirmed, not rollback or data corruption. Manual installation is recorded as manual recovery rather than success of the original target. Legacy rollback history retains its original meaning. Older nodes require manual installation; changing format numbers, versions or rollback flags cannot enable protocol 3.

## 数据缓存 / Data cache

完整历史以原生 session 为准。必要结果、运行配置、交互、交接及防重事实独立保存。事件缓存单执行最多 1,000 条且 8 MiB，全节点 64 MiB，终态至多保留 24 小时；容量压力可提前淘汰。每次后台维护至多 500 条，缓存不足显示缺口并按需读取原生历史，不重放任务。不执行活动期全库压缩；逻辑删除后 SQLite 可复用页，不保证文件立即缩小。

Native sessions remain the source of complete history. Results, runtime configuration, interactions, handoffs and deduplication facts are stored independently. Event caches are limited to 1,000 entries and 8 MiB per execution, 64 MiB per node, and up to 24 hours after completion, with earlier eviction under pressure. Maintenance removes at most 500 entries per batch. Missing events produce a gap and native-history fallback, never task replay. No full-database compaction runs during activity; deletion frees reusable SQLite pages without guaranteeing immediate file shrinkage.

完整包的 Windows/Ubuntu 实机验收仍应覆盖连续更新、文件占用、自定义目录和人工恢复；Linux 容器或 ZIP 检查不替代这些验收。

Validate consecutive updates, file locks, custom data directories and manual recovery on supported Windows and Ubuntu systems. Linux containers or ZIP checks do not replace platform acceptance.

升级前须完成当前格式 2 的一次性必要事实提取与缓存计数核查，见 connector-diagnostics.md；本版不再启动迁移旧格式。
Before upgrading, complete the one-time fact extraction and cache accounting checks for format 2 described in connector-diagnostics.md. Startup no longer migrates legacy formats.

## Claude 组件升级 / Claude support

升级后，原先使用内置 Claude SDK 的用户需要联网安装一次。在本机控制台的 CLI 工具页保存 Claude 模式，查看安装计划后点击「安装 Claude 支持」。无桌面环境可运行 bugpaw-relay claude status 和 bugpaw-relay claude install。环境 Claude 模式复用官方 CLI，自定义端点模式另安装锁定版本的 SDK。

If you used the bundled Claude SDK, this upgrade requires a one-time online installation. Save the Claude mode on the CLI tools tab of the local console, review the plan, and choose Install Claude support. On headless systems, run bugpaw-relay claude status and bugpaw-relay claude install. Environment mode uses the official CLI. Custom endpoint mode also installs the pinned SDK. SDK files and notices are kept under BUGPAW_HOME/components. Keep the same connector account and data directory when upgrading. Check the CLI version before signing in or testing model credentials.

## Windows 登录自启动 / Windows login startup

全新安装默认关闭。需要自启动时，用日常使用连接器的账户在普通终端运行新版安装目录中的命令。已启用旧计划任务的用户，在升级（含薄更新）后也执行一次开启命令。将示例数据目录替换为原目录；一直使用默认目录时可省略 `--data-home` 及其值。

Use an ordinary terminal in the new installation directory as the original connector user. New installations start with login startup off. If the old scheduled task was enabled, run the enable command once after upgrading, including after a thin update. Substitute the original data directory or omit the option for the default location.

```powershell
.\bugpaw-relay.exe autostart enable --data-home "D:\Relay Data"
.\bugpaw-relay.exe status --data-home "D:\Relay Data"
```

登录后可用上述 status 命令和服务端环境页检查原环境是否上线，启动日志在数据目录的 connector.log。重复开启会更新当前用户的同一个启动快捷方式。运行 `autostart disable` 关闭后续登录启动，另用 `stop` 停止当前进程，两者均可沿用上述数据目录参数。若报告旧任务残留，请让获授权账户在任务计划程序库中核实并删除旧的 `\BugPawRelay` 任务，再用日常账户重试原命令。清理前旧程序仍可能在登录时启动。回退至旧版前，先使用新版关闭启动项。

After login, check status and the original environment on the server. Worker output goes to connector.log in the data directory. Repeating enable updates the same per-user Startup shortcut. Use autostart disable for future logins and stop to stop the current worker, retaining the same data option. If legacy cleanup fails, have an authorized account verify and remove the old \BugPawRelay task in Task Scheduler Library, then retry the original command as the everyday user. Until cleared, the old task may launch at login. Before reverting to an older release, disable the shortcut using the new CLI.
