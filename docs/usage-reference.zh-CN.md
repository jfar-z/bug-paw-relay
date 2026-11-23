# 部署、连接器与会话参考

[返回项目首页](../README.md)

## 开发

需要 Node.js 24。使用 `npm ci` 安装固定依赖，`npm run typecheck`、`npm test`、`npm run build` 检查工程。`npm start` 默认监听 `127.0.0.1:3180`。

本地 HTTP 调试设置 `RELAY_INSECURE_COOKIE=true` 和 `RELAY_PUBLIC_URL=http://localhost:3180`；对外部署使用 HTTPS 与安全 Cookie，不使用该调试开关。数据目录由 `RELAY_DATA_DIR` 指定。

首次初始化令牌位于数据目录的 `setup-token` 文件，仅服务器管理员可读取。初始化后令牌删除。密码至少 12 位；登录后可启用 TOTP。

## 部署

先执行 `npm run build && npm run package:connector` 生成 Windows/Linux 发布包，再使用 `docker build -t bugpaw-relay:<版本> .` 构建服务镜像。打包机需要 gcc、MinGW x64、curl、tar、zip、unzip；打包器校验官方 Node SHA-256，并从固定 lockfile 安装平台依赖。容器以 UID 1000 运行，挂载独立可写数据目录到 `/data`，设置 `RELAY_PUBLIC_URL` 为实际 HTTPS 域名，将容器 3180 端口交给反向代理。代理须支持 `/api/node/connect` WebSocket 升级。应用不信任转发头，客户端来源由配置的外部 URL 校验。

SQLite 数据库、`master.key` 与数据目录内的 `artifacts/` 产物文件必须配套备份。升级先备份数据库并保存上个镜像，不能将不同环境的数据互相覆盖。数据库遇到更高版本会拒绝启动，不自动重建。

`npm run admin -- backup <全新目录>` 创建一致性备份，包含加密主密钥。恢复前停止服务，将备份数据库与主密钥复制到全新数据目录再启动兼容版本；不要在服务运行时覆盖数据库。服务器管理员可通过 `npm run admin -- reset-totp` 恢复丢失的二要素访问，恢复会撤销所有登录。

## 环境连接器

登录后在服务端环境页下载 Windows x64 ZIP 或 Linux x64 tar.gz 完整发布包。发布包自带 Node 24。请为连接器运行账户自行安装所需的 Codex CLI。升级后，原先使用内置 Claude SDK 的用户需要联网安装一次。在本机控制台的 CLI 工具页保存 Claude 模式，查看安装计划后点击「安装 Claude 支持」。无桌面环境可运行 bugpaw-relay claude status 和 bugpaw-relay claude install。环境 Claude 模式复用官方 CLI，自定义端点模式另安装锁定版本的 SDK。可用 `codex.command`、`claude.command` 指定可执行文件路径，否则按该账户的 PATH 查找 `codex`、`claude`。完整解压后 Windows 双击 `bugpaw-relay.exe`，Linux 运行 `./bugpaw-relay`，默认打开本机 Web 配置页。无桌面的 Linux 使用命令行配置和运行。

CLI 命令：`--cli`（前台运行）、`configure`、`web`（兼容 `console`）、`register`、`run`、`start`、`stop`、`status`、`codex-login`、`autostart enable|disable`。`web --no-open` 不自动打开浏览器。本地控制台只监听 `127.0.0.1` 的空闲端口，访问令牌通过本机终端提供。设置 `BUGPAW_HOME` 可选择独立配置目录。关闭网页不会停止后台连接器；停止会终止本机任务。修改配置前先停止连接器。

实际域名仅放在部署环境的 Compose `environment.RELAY_PUBLIC_URL` 中，不写入源码。服务端据此与当前发行清单生成 `/install.sh`、`/install.ps1` 的默认下载地址和包名，不使用请求 Host 推断地址；更换部署域名无需重新构建。源码中的脚本是模板，直接执行时须显式指定地址与包名（Linux：`BUGPAW_SERVER_URL`、`BUGPAW_PACKAGE`；Windows：`-ServerUrl`、`-Package`）。

连接器首次启动不预填服务端地址，在本地控制台填写所属部署的 HTTPS 地址后保存；也可通过 `BUGPAW_SERVER_URL` 提供首次配置默认值。已有配置优先，不会被环境变量覆盖。

安装包不提供匿名直链。点击下载后生成绑定当前登录会话的临时授权，默认 10 分钟有效，可在“设置 → 安装包下载”修改；退出登录后链接失效。链接有效期修改只影响新链接，已开始的下载不会因到期主动中断。

使用安装脚本时，先在环境接入页点击对应平台下载并选择“复制安装授权”，Linux 通过 `BUGPAW_DOWNLOAD_GRANT` 环境变量、Windows 通过 `-DownloadGrant` 参数或同名环境变量提供该授权。授权只用于当前安装包及其校验文件，勿公开分享；过期后回到页面重新获取。无需向脚本提供登录 token。

`/install.sh`、`/install.ps1` 仅作为旧命令入口，改为下载、校验和解压完整发布包，不执行 npm 安装。安装不自动注册自启动。升级前停止旧连接器，再替换完整应用目录；用户配置保留在 `~/.bugpaw-relay`，不会被发布包覆盖。第三方许可证随包保留。Windows 包未进行代码签名。

在平台生成 10 分钟一次性接入码，在环境注册后回平台批准环境。私钥、原生会话与工具凭据保留在环境侧。工作根目录限制平台入口，不是操作系统沙箱。

Codex 使用所选本机 CLI 的 app-server，默认沿用本机官方登录，可通过 `bugpaw-relay codex-login` 完成官方登录；也可在本地控制台指定 Responses 兼容端点、模型与 API Key。环境 Claude 模式在官方客户端完成登录。结构化会话及看板使用自定义 Messages 端点和 API Key/Bearer Token。两种运行时保留原生权限语义。

停止连接器会中断原生任务。网络断线不会主动停止任务；连接器崩溃后的在途执行标记为失败，不自动重放。重连使用签名挑战并先对账再派发。节点身份认证 v2 在注册时验证私钥持有证明，签名绑定服务端、用途、身份与注册内容；挑战限时且仅使用一次。节点入口拒绝浏览器 Origin，连接单独限流，同一身份在对账期间也只能占用一个连接名额。升级到该身份协议时，服务端和完整连接器包须同步升级；旧版签名不再接受，原配置和身份密钥可保留。身份撤销阻止后续连接，不停止本地已运行的任务。

卸载前关闭自启动并停止连接器，删除安装目录及命令启动器；默认保留 `~/.bugpaw-relay` 配置和历史，如需清理数据由用户另行备份后删除。Windows 对应用户主目录 `.bugpaw-relay`。

## 权限与流程

工作台读操作直接执行；询问模式下写操作经持久化平台审批，完全权限仅跳过平台写审批。环境原生审批在环境会话页单独处理。平台助手不能替用户批准原生交互。

项目在会话页管理，供会话和看板引用。Agent 阶段进入后自动启动，离线时等待环境；同阶段并发不隔离工作树。阶段执行采用权限与职责快照，交接只允许配置的目标。已有工作项的流程结构不直接编辑，可创建配置副本；产物开关可单独修改。普通会话离线不可新发。

PWA 支持安装与移动端。离线页面只解释状态，不缓存认证接口、环境正文，不重放写操作，不提供推送通知。

## 验证边界

运行原生协议测试前，请在测试账户的 PATH 中提供 `codex` 和 `claude`。完整权限用例需使用普通账户执行。自动化测试包含三种模型协议的无凭据流式工具/审批恢复端点、数据库、防重、目录边界、账号和签名通信。它们不是供应商真实模型验收。实际模型能力、原生工具权限、精确替换用户规范，以及 Windows 11/Ubuntu 22.04/24.04 的完整安装运行矩阵仍需在对应环境验证。精确替换选项未通过验证时明确拒绝执行。

## 环境文件查看与传输

环境会话中的 Markdown 文件链接可查看元信息、预览和下载。相对路径以会话工作目录解析，定位后的文件可位于客户端配置的任一工作根目录；绝对路径直接按全部工作根目录校验，不要求位于当前项目内，也不依赖当前会话目录是否仍然存在；支持 Windows/Linux 路径、中文空格和行号。普通 HTTP/HTTPS 链接在新窗口打开，PWA 外部打开行为以浏览器/系统为准。

预览和下载先显示接收百分比及速度，完整接收后再打开预览或触发保存。文本以纯文本显示（UTF-8 或带 BOM 的 UTF-16，最多 2 MB），图片最多 20 MB，视频最多 128 MB，实际格式/编码支持取决于浏览器。HTML/SVG 仅预览源码。不支持的格式显示红字说明。下载优先流式写入浏览器私有临时存储；缺少该能力时内存回退上限为 128 MB，磁盘不足会中止并提示。

此能力需要上报 `files-v1` 的新版连接器。文件不在服务端落盘，不进入 PWA 离线缓存；文件引用绑定登录会话，每次分块读取复核业务权限、节点连接和本地文件版本。退出登录、撤销环境、删除会话、断线或文件修改会阻止后续读取。

维护者可复用 `FileTransfers` 与连接器 `EnvironmentFiles`：业务入口先生成包含工作目录和权限复核回调的授权，传输层处理短期引用、256 KB 分块、校验、背压及取消。浏览器 `receiveEnvironmentFile` 接收可替换的数据消费函数，不绑定 Markdown、预览或最终保存位置。新增上传场景必须提供自己的业务授权入口，不能直接向浏览器开放任意环境/路径 RPC。

## 看板交接产物

在看板「流程配置」中，为 Agent 阶段开启「允许提交产物」（默认关闭）。开启仅作用于新执行，已有执行需结束后重试；关闭会阻止尚未完成的产物上传，不删除历史产物。已有工作项的看板也允许单独修改此开关。环境连接器需升级至包含交接产物工具参数的版本。

环境 Agent 继续调用 `relay_handoff`（Claude 为 `mcp__relay__handoff`），可选传入 `artifacts: [{ "path": "reports/result.html", "name": "测试报告.html" }]`。相对路径基于该次执行的工作目录，绝对路径受环境工作根目录限制。最多 16 件，单件 128 MiB、总计 256 MiB；目录须先由 Agent 打包为普通文件。无需把文件正文放入工具参数。

产物通过现有分块通道上传服务端，全部成功后才保存交接并推进。失败保持原阶段，同参数重试复用已完成的上传；传输中修改文件会拒绝继续。上传中的短请求查询返回原操作状态，断线后重新调用相同交接即可恢复；未知结果不代表推进失败。未交接及删除看板后失去引用的文件在 24 小时后回收。

工作项历史交接列出产物，打开后可预览或下载，环境离线、原文件改变或关联会话删除不影响已交付快照。支持原有文本、图片、视频预览，并为交接产物提供 Markdown、静态隔离 HTML 和浏览器内置 PDF 预览；HTML 不执行脚本、不加载外部资源、不支持跳转，PDF 最多 20 MiB且依赖浏览器阅读器。其他格式可下载。文件访问需要登录，不进入 PWA 缓存。

## 会话中的 @ 引用

在 Codex 或 Claude 环境会话输入框的开头，或普通空格后输入 `@`，可搜索该环境中的 Skill、文件夹和文件。候选最多显示 10 项，继续输入名称或路径即可筛选；使用上下方向键选择，Tab / Enter 插入，也可点击选项。选中的引用在输入框内高亮；编辑引用文字会取消其结构化引用。菜单展开时 Enter 优先选择，不发送消息；Escape 关闭菜单，组合键 Enter 仍用于换行。

此能力需要支持 `mentions-v1` 的连接器。文件搜索优先当前项目，覆盖环境配置的工作根目录；不跟随目录链接，跳过 `.git`、`node_modules`、`.vibe`、`.cache`，大目录采用有界扫描，可输入路径前缀优先搜索指定目录。Skill 来自对应原生运行时的发现清单，环境端最多缓存 30 秒；发送时重新验证 Skill 与文件路径。引用目录不会递归上传全部正文，Agent 按需读取。Codex 使用原生 Skill 输入，Claude 使用原生 `/Skill` 名称；原生权限与审批继续生效。搜索结果和引用不进入服务端文件索引或 PWA 缓存。

## 新建工作项起点 / Work item start stage

创建 API 与工作台 `create_work_item` 支持可选 `startStageId`（当前看板真实阶段 UUID）和 `boardVersion`（读取的看板版本）。未指定时从首个非完成阶段开始；可直接选择人工、Agent 或已完成阶段，分别等待人工推进、按该阶段权限自动入队或直接完成。跳过的阶段没有执行、审批或交接历史，后续推进仍受原流程目标限制。工作台需先读取看板，目标重名或不明确时先询问；审批展示固定起点、权限与效果，配置变化后须重新核对。

`POST /api/items` 还接受 `operationId` UUID；同一次创建重试必须保留原参数和标识，服务端返回首次结果。参数改变返回 409；结果不明时不要换新标识盲目重试。工作台自动生成并保存操作标识。新页面须与支持这些字段的服务端一起部署。

The creation API and Workbench `create_work_item` accept optional `startStageId` (a real stage UUID on the board) and `boardVersion` (the version read from the board). Omitting the stage starts at the first non-done stage. Human stages wait for manual advancement; Agent stages queue work with that stage's permissions; done stages finish immediately. Skipped stages have no execution, approval, or handoff history. Subsequent handoffs still follow the configured targets. Read the board first and clarify ambiguous stage names. Approval freezes the start stage, permissions, and effect; changed configuration requires a new review.

`POST /api/items` also accepts an `operationId` UUID. Retry the same creation with unchanged parameters and ID to retrieve the original result. Changed parameters return HTTP 409. Do not generate a new ID when the previous outcome is unknown. Workbench generates and persists its own operation ID. Deploy updated clients together with a server that supports these fields.

## Claude 组件升级 / Claude support

If you used the bundled Claude SDK, this upgrade requires a one-time online installation. Save the Claude mode on the CLI tools tab of the local console, review the plan, and choose Install Claude support. On headless systems, run bugpaw-relay claude status and bugpaw-relay claude install. Environment mode uses the official CLI. Custom endpoint mode also installs the pinned SDK. SDK files and notices are kept under BUGPAW_HOME/components. Keep the same connector account and data directory when upgrading. Check the CLI version before signing in or testing model credentials.
