# 连接器存储与连接诊断

连接器把原生执行及环境 SQLite 访问放在独立工作线程。事件从首条待写开始按 50ms 固定窗口批量提交；查询、审批、交接、终态与正常关闭会提前刷新。提交成功后才通知服务端。每执行最多等待 1000 条或 4 MiB，先到上限即刷新；4–10 MiB 的单事件不进入队列，直接提交，超出消息限制明确失败。历史仍保留每执行最近 1000 条，超窗显示缺口；原生会话记录仍是完整历史的权威来源。

## 查看诊断

连接器用户数据目录的 `connection-diagnostics.log` 保存 JSON 行，自动轮转为 `.1` 至 `.4`，每份最多 10 MiB。日志写入异步且有界；日志目录无法写入不阻断业务。原有 `connector.log` 保留进程启动输出。服务端诊断使用现有标准输出通道，其保留期限由部署日志驱动管理。

- `connection.connecting/open/authenticated/authentication_failed/close`：连接与认证生命周期。
- `connection.reconnect_scheduled`：重连次数与延迟；认证成功时的 `recoveryMs` 是从本机观察到断开至恢复认证的耗时。
- `heartbeat.timeout`：服务端因缺失 pong 终止连接。检查周期仍为 20 秒，连续一次检查发现前次 ping 未得到回应即断开。
- `connection.summary`、`event_loop.delay`、`heartbeat.delay`：事件循环及心跳耗时。RTT 只在 ping payload 对应时记录，不可测时为 null；连接器自动回复标准 pong，仅记录收到 ping 的时间，不猜测往返延迟。
- `storage.summary`、`storage.slow`、`storage.failure`：批次、接收/提交计数、写耗时、待写数量/字节及最长等待。计数与 max 值为本进程累计值，批次字段为最近一批，待写字段为采样瞬间值。
- `shutdown.failure`：关闭刷新失败或超过 5 秒。超时时主线程无法读取工作线程待写数，`pendingEvents: null` 表示未知，不能当成零。

时间戳为 UTC；毫秒耗时使用单调时钟。两端 connectionId 各自生成，需要用环境 ID、认证时间和版本关联，不能仅凭相似时间认定是同一断开。工作线程性能摘要属于本机 instanceId；主线程连接摘要额外包含 connectionId。

正常摘要每 60 秒一次，同类性能告警每 60 秒最多一次。阈值为事件循环 max 1000ms、可测 RTT 2000ms、写入 500ms、待写 1000ms。关闭原因只记录白名单分类，不保存不可信的远端原因原文；日志不包含事件正文、提示词、审批参数或凭据。

## 存储失败与停止

SQLite 忙锁等待上限为 50ms。发生写入失败后不自动重试，停止本机原生运行时并锁定新执行、交接和涉及执行账本的查询，返回 `STORAGE_UNAVAILABLE`；不能将未提交事件或终态报告为成功。故障锁定持续至重启，重连不会清除它。本机受认证的状态接口仍可查询，状态为 `storage_error`，可选 `errorCode` 说明 `STORAGE_UNAVAILABLE` 或 `SHUTDOWN_FAILED`。停止命令遇到失败返回 `SHUTDOWN_FAILED`，不会伪报已停止。应先保存诊断、检查磁盘和本机进程；故障原因解决后再重新启动。

执行线程请求最多 128 个在途，超限返回 `ENGINE_BUSY`。超时 `ENGINE_TIMEOUT` 只表示未取得结果，绝不重放请求；请查询原 operationId/executionId。其他线程故障使用 `ENGINE_UNAVAILABLE` 或 `ENGINE_FAILURE`。错误资源同时维护简体中文与英文，RPC/HTTP 对这些码提供可选 messageKey/messageParams，原 message 仍兼容。

正常停止优先终止原生进程，再提交尾批；关闭期限 5 秒，保留原生进程三秒强杀兜底。SIGKILL、断电或系统崩溃不保证未提交窗口内的事件；重启会将无法确认的原执行标记失败，不自动重放。

## 当前格式与升级

新安装直接创建格式 2，事件独立、有界存储；运行配置、回复、审批与序号同事务提交。正常启动不再迁移旧 JSON 事件或修复开发期错类型记录，不提供旧格式导出或降级写库。

升级前须结束活动任务和审批，正常停止并做 SQLite 一致性备份。存量格式 2 必须先一次性提取仅在事件缓存中的必要运行配置和回复，核对事件计数账本；保留身份、配置、关联、防重和历史失败事实。旧格式或错类型记录须先经维护人员处理，不能直接启动本版。不得清库或用升级前备份覆盖升级后的业务记录。

使用新的独立应用目录完整安装，并沿用原用户和数据目录；当前薄更新协议为 3，启动失败使用最新兼容完整包人工恢复，不自动回滚。停止仅使用带令牌的 worker.json 控制通道；控制接口无法确认时返回 WORKER_UNREACHABLE，不按 PID 杀进程。

## Current format and upgrades

Fresh installations create format 2 directly. Events are bounded; runtime configuration, replies, approvals and sequence numbers are committed atomically. Startup no longer migrates embedded events or repairs development-era records. Legacy export and downgrade writes are not supported.

Before upgrading, finish active tasks and approvals, stop normally and take a consistent SQLite backup. Existing format 2 data needs a one-time extraction of required configuration and replies that exist only in the event cache, and verification of cache accounting. Preserve identity, configuration, relationships, deduplication records and historical failures. Older formats or incorrectly typed records require maintenance before starting this version. Never clear the database or overwrite newer business records with an older backup.

Install the full package in a separate application directory using the original user and data directory. Thin updates use protocol 3; recover a failed start with a compatible full package, without automatic rollback. Stop uses the authenticated worker.json control endpoint; an unverifiable endpoint returns WORKER_UNREACHABLE and never causes a PID-based kill.

Windows 实机及异常断电恢复需要独立验证，不能用 Linux 单测替代。Windows hardware and power-loss recovery require separate validation.
