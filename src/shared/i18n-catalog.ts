import { integrationMessages } from "./integration-messages.js";
import { consoleMessages } from "./console-messages.js";
import { webMessages } from "./web-messages.js";
/** 产品双语资源；键稳定后不随译文调整。 */
export const messages = {
  "board.upgrade": {"zh-CN":"请升级此环境的连接器以使用会话看板引用。","en":"Upgrade this environment connector to use board mentions in conversations."},
  "board.toolArguments": {"zh-CN":"看板工具参数无效，请核对标识、相对路径和字段。","en":"Invalid board tool arguments. Check the identifiers, relative paths and fields."},
  "board.referenceUnavailable": {"zh-CN":"当前会话无法使用此看板或工作项，请检查引用和访问权限。","en":"This board or item is unavailable in this conversation. Check the mention and access rights."},
  "board.toolDocs": {"zh-CN":"工具仅操作本会话已发送引用的看板。按 ID 选择，写入有歧义时询问用户。定义返回默认和可选起点、环境目录匹配。same_directory 表示同环境同目录；different_directory 表示同环境不同目录；different_environment 表示跨环境，即使路径文本相同也需交付；not_applicable 表示无执行目录；unknown 表示绑定或实际目录未能确认。目录匹配不能证明文件存在。不同目录或环境需交付完整材料；建项的 files 填本会话内的 PRD 相对路径，平台检查版本并在需要时下发附件。人工起点等待人工，Agent 起点入队。查询及发卡可直接执行；询问权限下写入需确认。创建回执自动发卡。","en":"Use boards mentioned in a sent message in this conversation. Select by ID and clarify ambiguous writes. The definition lists start options and execution directory matches. same_directory means the same environment and directory; different_directory means a different directory on that environment; different_environment means another environment even for identical paths; not_applicable means no execution directory; unknown means the binding could not be verified. Matching directories does not verify a file. Supply required PRDs as source-relative files; the platform checks versions and transfers attachments across directories or environments. Human starts wait; agent starts queue. Reads and sharing are direct. Writes in ask mode require confirmation. Creation sends its own card."},
  "project.directory.invalid": {"zh-CN": "环境 {environment}，路径“{path}”：请输入工作根目录内的有效相对路径。", "en": "Environment {environment}, path “{path}”: Enter a valid path relative to the workspace root."},
  "project.directory.outside": {"zh-CN": "环境 {environment}，路径“{path}”：路径指向工作根目录以外。", "en": "Environment {environment}, path “{path}”: The path leads outside the workspace root."},
  "project.directory.conflict": {"zh-CN": "环境 {environment}，路径“{path}”：路径中已有同名文件或无效链接。", "en": "Environment {environment}, path “{path}”: A file or broken link occupies the path."},
  "project.directory.permission": {"zh-CN": "环境 {environment}，路径“{path}”：连接器没有访问或创建目录的权限。", "en": "Environment {environment}, path “{path}”: The connector lacks permission to access or create the directory."},
  "project.directory.root": {"zh-CN": "环境 {environment}，路径“{path}”：工作根目录不存在或无法访问。", "en": "Environment {environment}, path “{path}”: The workspace root is missing or inaccessible."},
  "project.directory.offline": {"zh-CN": "环境 {environment}，路径“{path}”：环境未连接，请恢复连接后重试。", "en": "Environment {environment}, path “{path}”: The environment is disconnected. Reconnect and retry."},
  "project.directory.upgrade": {"zh-CN": "环境 {environment}，路径“{path}”：请更新该环境的连接器后重试。", "en": "Environment {environment}, path “{path}”: Update this environment’s connector and retry."},
  "project.directory.unknown": {"zh-CN": "环境 {environment}，路径“{path}”：无法确认目录可用，请检查环境连接和目录状态后重试。", "en": "Environment {environment}, path “{path}”: Directory availability could not be confirmed. Check the connection and directory, then retry."},
  "project.directory.storage": {"zh-CN": "环境 {environment}，路径“{path}”：目录所在磁盘空间或配额不足。", "en": "Environment {environment}, path “{path}”: The directory has insufficient disk space or quota."},
  "project.saveFailed": { "zh-CN": "保存项目记录失败，请重试。", "en": "Could not save the project record. Please retry." },
  "errors.LIGHT_QUOTA.storage": {"zh-CN":"该版本的存储空间已满。","en":"This version exceeds its storage quota."},
  "light.notificationPending": {"zh-CN":"尚未确认来源会话收到通知，请稍后重试。","en":"Delivery to the source conversation is unconfirmed. Retry later."},
  "light.feedbackMessage": {"zh-CN":"轻应用《{title}》第 {number} 版反馈：{kind}。","en":"Feedback on light app “{title}”, version {number}: {kind}."},
  "light.storageLoadFailed": {"zh-CN":"无法加载此版本的存档，请重试。","en":"Could not load the saved data for this version. Try again."},
  "light.storageCommitFailed": {"zh-CN":"部分存档更改保存失败。","en":"Some changes to saved data could not be saved."},
  "light.openHint": {"zh-CN":"用户可从会话卡片或轻应用页打开第 {number} 版。","en":"Open version {number} from its conversation card or the Light Apps page."},
  "light.checkPaths": {"zh-CN":"请按会话创建时的根目录修正 directory 和 entry。解析目录 {directoryPath}，入口 {entryPath}。","en":"Correct directory and entry relative to the original session root. Resolved directory {directoryPath}, entry {entryPath}."},
  "light.docs.overview": {"zh-CN":"使用单个 HTML 入口并显式列出允许的静态资源。建议遵循项目指令并使用独立子目录。外部网络资源、Worker 和表单提交受限。localStorage 每版独立，容量为 {quota} 个 UTF-16 单元，异步保存。用户在宿主查看器打开应用和反馈，请适配手机竖屏。","en":"Use one HTML entry and list allowed static assets explicitly. Follow project instructions and prefer a separate directory. External resources, workers and form submissions are blocked. Each version has {quota} UTF-16 units of asynchronously saved localStorage. The host provides viewing and feedback. Design for portrait phones."},
  "light.backend.overview": {"zh-CN": "带后端的版本请先读取 backend 主题。", "en": "Read the backend topic before publishing a version with a service."},
  "light.environment.overview": {"zh-CN": "用 relay_light_versions({}) 列出本环境全部应用，按 appId 选择，同名时询问用户。currentSessionOnly:true 仅列本会话发布版本。publish 使用所选 appId 和当前目录产物更新，下架应用更新后保持下架。relist 恢复全应用，unlist 保留版本与反馈；按权限在发起会话确认。delete 始终需要平台确认全部版本，新增版本后重新确认。", "en": "Call relay_light_versions({}) for all environment apps. Select by appId and ask about ambiguous names. currentSessionOnly:true filters by publishing session. Publish with the selected appId and local assets. Unlisted apps stay unlisted. Relist restores every version. Unlist preserves versions and feedback. Confirm listing changes in the initiating session when prompted. Delete always needs platform confirmation covering all versions, renewed if versions change."},
  "light.environment.backend": {"zh-CN": "首发前生成应用 UUID A 和实例 UUID S。启动专用进程并按上述协议在 registrationDirectory/A/S.port 登记。publish({newAppId:A,title,directory,backendServiceId:S})。在另一会话用 versions({}) 取得 A，使用本会话产物 publish({appId:A,directory,reuseBackend:true})，无需重启。仅静态发布省略两个后端字段。切换时为每次部署分配全新 S，在 A 下登记，publish({appId:A,directory,backendServiceId:S})。探测失败保持原绑定，核实候选未生效再停止。成功后核对 versions 的 currentBackend，按 replacedBackends 核实实例身份和其他应用引用，仅停止已替换且闲置的进程。不能确认或停止时报告生效目标及待清理实例。恢复旧服务先取得可访问旧产物并确认数据兼容，再以新实例 ID 启动登记切换，影响所有带后端版本。仅切后端用 relay_light_switch_backend({appId:A,backendServiceId:S})，无需前端产物或新版本。缺少产物或不兼容时保留当前服务。临时并行运行用独立应用 ID，核对数据库配置。", "en": "Generate an app UUID A and an instance UUID S before first publish. Start the dedicated process and register registrationDirectory/A/S.port as above. Call publish({newAppId:A,title,directory,backendServiceId:S}). In another session find A with versions({}), then publish({appId:A,directory,reuseBackend:true}) from local assets without restarting. Omit both backend fields for static output. To switch, start a fresh instance with a new S under A and publish({appId:A,directory,backendServiceId:S}). Failed probes preserve the current binding. Verify the candidate is unused before stopping it. After success check versions.currentBackend, verify identity and other app references for replacedBackends, and stop only unused replaced instances. Report the effective service and any pending cleanup. To restore, obtain an accessible old build and confirm data compatibility before starting and registering it under a fresh instance ID. Switching affects every backend-enabled version. Use relay_light_switch_backend({appId:A,backendServiceId:S}) to switch without frontend assets or a new version. Keep the current service if artifacts are missing or incompatible. For parallel use create a separate app and verify its database configuration."},
  "light.environment.runtime": {"zh-CN": "带后端的历史版本调用应用当前服务；旧应用首次显式切换前各版仍用其原绑定。静态版本没有后端能力。", "en": "Backend-enabled versions call the current app service. Before the first explicit switch legacy versions retain their individual targets. Static versions have no backend access."},
  "light.environment.debugging": {"zh-CN": "发布探测失败时检查候选登记和 HEAD 身份；运行调用失败时检查实际生效服务、环境连接及版本授权。旧实例停止失败时保留新版绑定，报告待清理实例。切换不会回滚数据库。", "en": "For failed publish probes inspect candidate registration and HEAD identity. For runtime failures check the effective target, environment connection and view grant. If stopping an old instance fails, keep the new binding and report pending cleanup. Switching never rolls back a database."},
  "light.backend.options": {"zh-CN": "请检查 appId、newAppId 和后端选项组合，参阅 backend 主题。", "en": "Check appId, newAppId and backend options against the backend topic."},
  "light.backend.noCurrent": {"zh-CN": "没有唯一可复用的后端，请显式登记并切换服务。", "en": "No unique backend is available for reuse. Register and switch to an explicit service."},
  "light.docs.backend": {"zh-CN": "在 {registrationPath} 下创建 <UUID>.port 文件，内容为专用 HTTP 服务的十进制端口（1024–65535）。监听 127.0.0.1，对 HEAD /.well-known/bugpaw-light-service 返回 204 和 X-BugPaw-Light-Service: <UUID>，支持连接复用。发布时传 backendServiceId（该 UUID），只选择无凭据的前端文件。保持服务运行。页面调用 await window.relayBackend({method:'GET',path:'/records'})，写入时用 body: JSON.stringify(data)。返回 {status,body}，body 为 JSON 文本或 null；检查业务状态，捕获平台错误并显示提示。路径以 / 开头，支持 GET、POST、PUT、PATCH、DELETE，无自定义头或跳转，JSON 请求和响应各限 64 KiB，8 秒、每环境最多 8 个并发。写入结果未确认时先读回核实。", "en": "Create <UUID>.port inside {registrationPath} with the dedicated HTTP service's decimal port (1024–65535). Listen on 127.0.0.1 and answer HEAD /.well-known/bugpaw-light-service with 204 and X-BugPaw-Light-Service: <UUID>; support keep-alive. Publish credential-free frontend files with backendServiceId set to this UUID and keep the service running. Call await window.relayBackend({method:'GET',path:'/records'}), adding body: JSON.stringify(data) for writes. Inspect {status,body} for business errors; body is JSON text or null. Catch and display platform errors. Paths start with /; GET, POST, PUT, PATCH and DELETE are supported, without custom headers or redirects. Limits: 64 KiB each way, 8 seconds and 8 concurrent calls per environment. Read back uncertain writes before retrying."},
  "light.backend.unavailable": {"zh-CN": "指定服务不可用，请核对服务登记、端口及身份，启动服务后重试。", "en": "The bound service is unavailable. Check registration, port and identity, start the service and retry."},
  "light.backend.offline": {"zh-CN": "环境离线，请在重新连接后重试。", "en": "Environment offline. Retry after reconnection."},
  "light.backend.busy": {"zh-CN": "服务调用繁忙，请稍后重试。", "en": "Service is busy. Retry later."},
  "light.backend.static": {"zh-CN": "此版本未绑定后端服务。", "en": "This version has no bound service."},
  "light.backend.unknown": {"zh-CN": "未取得有效响应，写入结果未确认。请先读回数据再决定是否重试。", "en": "No valid response. A write may have completed. Read back the data before retrying."},
  "light.docs.runtime": {"zh-CN":"文档在不透明来源中执行。CSP 仅允许当前视图资源前缀，允许内联脚本与样式，具体策略见 csp。不可依赖 sessionStorage、IndexedDB 或 Cookie，这些原生访问受沙箱限制。","en":"The document runs at an opaque origin. The csp field shows the actual policy template. Resource requests are scoped to the view prefix. Inline scripts and styles are allowed. Native sessionStorage, IndexedDB and cookie access are blocked by sandboxing."},
  "light.docs.storage": {"zh-CN":"每个版本从空存档开始，按键和值的 UTF-16 长度合计，上限 {quota}。超限的 setItem 抛出 QuotaExceededError。支持同步 getItem/setItem/removeItem/clear/key/length，写入异步批量提交，关闭时可能丢失最后一批。多窗口按键最后提交生效，无实时同步。下架保留，永久删除清除。","en":"Each version starts empty. Keys plus values may occupy {quota} UTF-16 units. setItem throws QuotaExceededError above quota. getItem/setItem/removeItem/clear/key/length are synchronous. Writes commit in batches and the final batch can be lost on close. Across windows the last commit per key wins without live sync. Unlisting retains storage. Permanent deletion clears it."},
  "light.docs.debugging": {"zh-CN":"将 storageScript 保存为 light-storage.js，在本地测试入口的应用脚本前内联其内容，调用 example。通过 HTTP 响应头设置 csp，将资源前缀和宿主来源替换为本地测试地址，用 sandbox=allow-scripts 的 iframe 加载。send 回调在本地父页模拟按键提交并在重开时传回 entries。发布后用 versions 的 runtimeErrorCount 和 feedback 的 runtimeErrors 查看报错。","en":"Save storageScript as light-storage.js and inline its contents before app scripts in a local test entry. Invoke example. Serve csp as an HTTP response header, substituting the local resource prefix and host origin. Load in an iframe with sandbox=allow-scripts. In the local parent, handle send messages by committing key changes and provide entries on reopen. After publication inspect runtimeErrorCount via versions and runtimeErrors via feedback."},
  "light.invalidUuid": {"zh-CN":"{field} 需要有效 UUID。","en":"Supply a valid UUID for {field}."},
  "light.invalidInput": {"zh-CN":"{field} 参数无效，请按工具字段的格式、长度和必填要求修正。","en":"Invalid {field}. Check the tool field format, length and required values."},
  "errors.LIGHT_DELETED.light": {"zh-CN":"应用已进入永久删除流程，无法打开或恢复。","en":"Permanent deletion has started. This app cannot be opened or restored."},
  "errors.LIGHT_SCOPE_CHANGED.light": {"zh-CN":"应用版本已变化，请重新查看并确认删除范围。","en":"The versions changed. Review and confirm the deletion scope again."},
  "light.titleRequired": {"zh-CN":"title 首发必填，请提供 1–120 字符的标题。","en":"For first publication, supply a title of 1–120 characters."},
  "light.directory": {"zh-CN":"directory 必须是会话工作目录内的相对路径，例如 . 或 dist。","en":"Set directory to a relative directory inside the session working directory, such as . or dist."},
  "light.entry": {"zh-CN":"entry 必须指向非空 HTML 文件，请检查 {path}。","en":"Set entry to a non-empty HTML file. Check {path}."},
  "light.extension": {"zh-CN":"files 中的 {path} 扩展名不受支持，请选择支持的静态文件并更新页面引用。","en":"Unsupported file extension in {path}. Select a supported static file and update page references."},
  "light.asset": {"zh-CN":"无法发布 {path}，请检查相对路径，使用可读取、无凭据的普通静态文件。","en":"Cannot publish {path}. Check the relative path and select a readable regular static file without credentials."},
  "light.pending": {"zh-CN":"发布结果待核实。请在连接恢复后使用版本查询工具核对本会话的版本。","en":"Publication outcome pending. Once connected, use the versions tool to check this conversation before publishing again."},
  "light.versionMissing": {"zh-CN": "轻应用版本或资源不存在。", "en": "This light app version or resource was not found."},
  "errors.LIGHT_SCOPE.light": {"zh-CN": "当前执行无权操作该轻应用，请核对环境、阶段权限和连接器版本。", "en": "Check the environment, current stage permissions and connector version."},
  "errors.LIGHT_FILE.light": {"zh-CN": "静态文件或入口校验失败。", "en": "The static files or entry are invalid."},
  "errors.LIGHT_LIMIT.light": {"zh-CN": "最多 128 个文件，单件 8 MiB，总计 32 MiB。", "en": "Use up to 128 files, 8 MiB per file and 32 MiB in total."},
  "errors.LIGHT_HOST.light": {"zh-CN": "轻应用托管服务不可用，请检查托管连接与配置后重试。", "en": "Light app hosting is unavailable. Check the hosting connection and configuration, then retry."},
  "errors.LIGHT_ACCESS.light": {"zh-CN": "查看授权已失效，请重新打开。", "en": "Viewing access expired. Reopen the version."},
  "errors.LIGHT_OFFLINE.light": {"zh-CN": "轻应用已下架。", "en": "This app is unlisted."},
  "errors.LIGHT_CONFLICT.light": {"zh-CN": "同一发布标识的参数不一致。", "en": "This publication ID already has different parameters."},
  "errors.LIGHT_UPGRADE.light": {"zh-CN": "请升级环境连接器并重新进入会话，或从「轻应用」管理页操作。", "en": "Upgrade the connector and reopen the conversation, or use the Light Apps page."},
  "errors.CLI_DISABLED.environment": {
    "zh-CN": "此环境已禁用该 CLI 工具，可在环境详情中重新启用。",
    en: "This CLI tool is disabled for this environment. Enable it in environment details.",
  },
  "board.edit.title": {"zh-CN":"编辑工作项",en:"Edit work item"},
  "board.edit.attachments": {"zh-CN":"后续投递的附件",en:"Attachments for future dispatches"},
  "board.edit.empty": {"zh-CN":"暂无待投递附件",en:"No attachments for future dispatches"},
  "board.edit.conflict": {"zh-CN":"工作项已变更，请取消编辑并重新打开详情，核对最新内容。",en:"The work item changed. Cancel editing and reopen its details to review the latest version."},
  "board.upload.choose": {"zh-CN":"选择附件保存目录",en:"Choose a directory for attachments"},
  "board.upload.unavailable": {"zh-CN":"没有可用的项目目录，可移除附件后提交。",en:"No project directory is available. Remove the attachments to continue."},
  "board.upload.copy": {"zh-CN":"复制附件路径",en:"Copy attachment path"},
  "board.upload.copyFailed": {"zh-CN":"无法复制，请选择路径文字手动复制。",en:"Select the path and copy it manually."},
  "uploads.limit": {
    "zh-CN": "上传数量或容量已达上限，请完成或取消其他上传。",
    en: "Upload capacity reached. Finish or cancel other uploads.",
  },
  "uploads.expired": {
    "zh-CN": "上传已失效或取消，请重新选择文件。",
    en: "Upload expired or was cancelled. Select the file again.",
  },
  "uploads.busy": {
    "zh-CN": "上传正在处理，请等待当前分块完成。",
    en: "Upload is busy. Wait for the current chunk.",
  },
  "uploads.corrupt": {
    "zh-CN": "上传分块的顺序、大小或摘要校验失败，请重新上传。",
    en: "Upload chunk order, size or checksum is invalid. Upload again.",
  },
  "uploads.incomplete": {
    "zh-CN": "文件尚未完整接收，不能作为附件发送。",
    en: "The file is incomplete and cannot be sent as an attachment.",
  },
  "uploads.path": {
    "zh-CN": "附件目录不可安全写入，请检查目录或链接。",
    en: "The attachment directory cannot be written safely. Check directories and links.",
  },
  "uploads.name": {
    "zh-CN": "文件名过长或不受支持，请重命名后上传。",
    en: "The filename is too long or unsupported. Rename it and upload again.",
  },
  "uploads.write": {
    "zh-CN": "附件写入失败，请检查环境磁盘和权限后重试。",
    en: "Attachment write failed. Check disk space and permissions and try again.",
  },
  "uploads.upgrade": {
    "zh-CN": "请升级环境连接器后再上传附件。",
    en: "Upgrade the environment connector to upload attachments.",
  },
  "uploads.blocked": {
    "zh-CN": "当前会话不允许上传或发送附件，请检查会话状态。",
    en: "This session cannot upload or send attachments in its current state.",
  },
  "uploads.empty": {
    "zh-CN": "请输入消息或添加已完成的附件。",
    en: "Enter a message or add a completed attachment.",
  },
  "console.cliCommandPath": {
    "zh-CN": "CLI 路径（留空使用 PATH）",
    en: "CLI path (leave blank to use PATH)",
  },
  "connector.cli.missing": {
    "zh-CN": "找不到 {runtime}。请在本机安装 CLI，并检查连接器的 PATH 或配置路径。",
    en: "Cannot find {runtime}. Install the CLI locally and check the connector PATH or configured path.",
  },
  "connector.cli.launchFailed": {
    "zh-CN": "{runtime} 版本检测失败。请检查执行权限，并在连接器账户下运行 --version。",
    en: "The {runtime} version check failed. Check execute permissions and run --version as the connector user.",
  },
  "connector.workerUnreachable": {
    "zh-CN": "无法确认连接器控制接口，请检查本机进程状态后再停止。",
    en: "The connector control endpoint cannot be verified. Check the local process before stopping.",
  },
  "errors.STORE_UPGRADE_REQUIRED": {
    "zh-CN": "旧数据须先完成一次性升级后再启动。",
    en: "Upgrade legacy data before starting.",
  },
  "tool.board.unsupportedFields": {
    "zh-CN": "包含不支持的字段",
    en: "Contains unsupported fields",
  },
  "questions.title": { "zh-CN": "需要你的回答", en: "Your answer is needed" },
  "questions.waiting": { "zh-CN": "等待回答", en: "Awaiting your answer" },
  "questions.submitting": {
    "zh-CN": "提交中，正在核对原工具接收结果。",
    en: "Submitting; checking receipt by the original tool.",
  },
  "questions.answered": {
    "zh-CN": "已回答，原工具已接收。",
    en: "Answered; received by the original tool.",
  },
  "questions.invalidated": {
    "zh-CN": "问题已失效或取消，不能再提交。",
    en: "This request expired or was cancelled and cannot be answered.",
  },
  "questions.reconciling": {
    "zh-CN": "连接中断或状态尚未核对，当前不可提交。草稿保留在本页。",
    en: "Disconnected or checking status. Submission is disabled; your draft stays on this page.",
  },
  "questions.multiple": {
    "zh-CN": "必答 · 可多选",
    en: "Required · Multiple choices",
  },
  "questions.required": { "zh-CN": "必答", en: "Required" },
  "questions.hidden": { "zh-CN": "密文答案已隐藏", en: "Secret answer hidden" },
  "questions.noAnswer": {
    "zh-CN": "没有已确认的答案",
    en: "No confirmed answer",
  },
  "questions.custom": { "zh-CN": "自定义回答", en: "Custom answer" },
  "questions.text": { "zh-CN": "输入回答", en: "Enter your answer" },
  "questions.submit": { "zh-CN": "提交回答", en: "Submit answers" },
  "questions.check": { "zh-CN": "核对结果", en: "Check result" },
  "questions.reference": { "zh-CN": "请求标识", en: "Request reference" },

  "questions.unsupported": {
    "zh-CN": "此原生提问格式不受支持，无法安全回传答案。",
    en: "This native question format is unsupported; answers cannot be mapped safely.",
  },
  "questions.invalid": {
    "zh-CN": "请检查第 {question} 题的必答项、选项和输入格式（0 表示整组）。",
    en: "Check required answers, options and input for question {question} (0 means the whole group).",
  },
  "questions.conflict": {
    "zh-CN": "此问题已提交其他答案，请重新读取结果。",
    en: "A different answer was already submitted. Refresh the result.",
  },
  "questions.unknown": {
    "zh-CN": "回答传递结果无法确认，不能重复提交；请核对原执行状态。",
    en: "Answer delivery is unconfirmed and cannot be replayed. Check the original execution.",
  },
  "questions.stale": {
    "zh-CN": "此提问已失效或执行已停止。",
    en: "This question has expired or its execution has stopped.",
  },
  "questions.upgrade": {
    "zh-CN": "请升级环境连接器以使用交互式问题卡片。",
    en: "Upgrade the environment connector to use interactive question cards.",
  },
  ...webMessages,
  ...consoleMessages,
  ...integrationMessages,
  "display.binary": {
    "zh-CN": "[二进制内容已省略，{count} 字符]",
    en: "[Binary content omitted, {count} characters]",
  },
  "display.embedded": {
    "zh-CN": "[内嵌二进制已省略]",
    en: "[Embedded binary omitted]",
  },
  "display.encoded": {
    "zh-CN": "[长编码数据已省略]",
    en: "[Long encoded data omitted]",
  },
  "display.truncated": {
    "zh-CN": "\n[展示内容已截断，原文 {count} 字符；完整记录保留在环境端]",
    en: "\n[Display truncated, {count} original characters; full records remain in the environment]",
  },
  "display.depth": {
    "zh-CN": "[嵌套过深，展示已省略]",
    en: "[Display omitted: nesting too deep]",
  },
  "display.entries": {
    "zh-CN": "[其余条目已省略]",
    en: "[Remaining entries omitted]",
  },
  "offline.title": {
    "zh-CN": "当前无法连接工作空间",
    en: "Cannot connect to your workspace",
  },
  "offline.note": {
    "zh-CN": "已启动的环境任务可能仍在执行。联网后查询任务状态，不要重复派发。",
    en: "Environment tasks may still be running. Check their status after reconnecting; do not dispatch them again.",
  },
  "offline.retry": { "zh-CN": "重新连接", en: "Reconnect" },
  "directory.valid": {
    "zh-CN": "目录有效：{path}",
    en: "Valid directory: {path}",
  },
  "language.server": { "zh-CN": "跟随服务端（{language}）", en: "Follow server ({language})" },
  "language.current": { "zh-CN": "语言：{language}", en: "Language: {language}" },
  "language.system": {
    "zh-CN": "跟随系统（{language}）",
    en: "System ({language})",
  },
  "language.choose": { "zh-CN": "语言", en: "Language" },
  "language.temporary": {
    "zh-CN": "语言仅在本次页面有效，无法保存本地偏好",
    en: "Language applies to this page only. Local preference could not be saved.",
  },
  "errors.DUPLICATE_ROOT.workspace.root.ids.must.be.unique": {
    "zh-CN": "工作根目录标识不能重复",
    en: "Workspace root IDs must be unique.",
  },
  "errors.DUPLICATE_PATH.workspace.root.paths.must.be.unique": {
    "zh-CN": "工作根目录路径不能重复",
    en: "Workspace root paths must be unique.",
  },
  "errors.AUTH_PROTOCOL.identity.protocol.mismatch.upgrade.the.server": {
    "zh-CN": "服务端身份协议不匹配，请升级服务端与连接器",
    en: "Identity protocol mismatch. Upgrade the server and connector.",
  },
  "errors.HTTPS_REQUIRED.remote.connections.require.https": {
    "zh-CN": "远程连接必须使用 HTTPS",
    en: "Remote connections require HTTPS.",
  },
  "errors.ROOT_UNKNOWN.workspace.root.not.found": {
    "zh-CN": "工作根目录不存在",
    en: "Workspace root not found.",
  },
  "errors.PATH_INVALID.enter.a.relative.path": {
    "zh-CN": "请输入相对路径",
    en: "Enter a relative path.",
  },
  "errors.NOT_DIRECTORY.the.target.is.not.a.directory": {
    "zh-CN": "目标不是文件夹",
    en: "The target is not a directory.",
  },
  "errors.PATH_ESCAPE.the.target.is.outside.the.allowed": {
    "zh-CN": "目标超出允许的工作根目录",
    en: "The target is outside the allowed workspace roots.",
  },
  "errors.UPDATE_IN_PROGRESS.the.connector.is.undergoing.update.maintenance": {
    "zh-CN": "连接器更新维护中",
    en: "The connector is undergoing update maintenance.",
  },
  "errors.PATH_INVALID.invalid.directory.name": {
    "zh-CN": "目录名无效",
    en: "Invalid directory name.",
  },
  "errors.INVALID_PARAMS.invalid.resume.parameters": {
    "zh-CN": "续执行参数无效",
    en: "Invalid resume parameters.",
  },
  "errors.IDEMPOTENCY_CONFLICT.the.operation.content.has.changed": {
    "zh-CN": "操作内容发生变化",
    en: "The operation content has changed.",
  },
  "errors.BUSY.this.session.already.has.a.queued": {
    "zh-CN": "会话已有排队消息",
    en: "This session already has a queued message.",
  },
  "errors.BUSY.this.session.is.running": {
    "zh-CN": "会话正在执行",
    en: "This session is running.",
  },
  "errors.MENTION_INVALID.references.do.not.match.the.message": {
    "zh-CN": "引用与消息不一致",
    en: "References do not match the message.",
  },
  "errors.STALE_EXECUTION.the.queued.execution.was.cancelled": {
    "zh-CN": "排队执行已取消",
    en: "The queued execution was cancelled.",
  },
  "errors.IDEMPOTENCY_CONFLICT.operation.parameters.conflict": {
    "zh-CN": "操作参数冲突",
    en: "Operation parameters conflict.",
  },
  "errors.BUSY.this.session.is.starting": {
    "zh-CN": "会话正在启动",
    en: "This session is starting.",
  },
  "errors.INVALID_PARAMS.invalid.title.synchronization.batch": {
    "zh-CN": "标题同步批次无效",
    en: "Invalid title synchronization batch.",
  },
  "errors.STALE_INTERACTION.the.native.interaction.has.expired": {
    "zh-CN": "原生交互已失效",
    en: "The native interaction has expired.",
  },
  "errors.STATUS_UNKNOWN.the.native.process.is.unavailable": {
    "zh-CN": "原生进程不可用",
    en: "The native process is unavailable.",
  },
  "errors.METHOD_NOT_FOUND.unsupported.method": {
    "zh-CN": "不支持的方法",
    en: "Unsupported method.",
  },
  "errors.INVALID_ANSWER.invalid.answer.format": {
    "zh-CN": "回答格式无效",
    en: "Invalid answer format.",
  },
  "errors.INVALID_ANSWER.invalid.approval.decision": {
    "zh-CN": "审批决定无效",
    en: "Invalid approval decision.",
  },
  "errors.INVALID_ANSWER.an.answer.is.missing": {
    "zh-CN": "缺少问题回答",
    en: "An answer is missing.",
  },
  "errors.INVALID_ANSWER.only.a.permission.response.for.this": {
    "zh-CN": "仅允许本轮权限回复",
    en: "Only a permission response for this turn is allowed.",
  },
  "errors.INVALID_ANSWER.invalid.interaction.decision": {
    "zh-CN": "交互决定无效",
    en: "Invalid interaction decision.",
  },
  "errors.INVALID_ANSWER.explicit.approval.or.rejection.is.required": {
    "zh-CN": "需要明确批准或拒绝",
    en: "Explicit approval or rejection is required.",
  },
  "errors.BUSY.this.session.already.has.an.execution": {
    "zh-CN": "此会话已有执行",
    en: "This session already has an execution.",
  },
  "errors.MODEL_CAPABILITY_UNKNOWN.model.capabilities.are.unknown.select.a": {
    "zh-CN":
      "无法确认当前模型能力，请显式选择模型或清除智能体/会话中的思考配置",
    en: "Model capabilities are unknown. Select a model explicitly or clear the agent/session thinking settings.",
  },
  "errors.UNSUPPORTED_EFFORT.the.model.does.not.support.or": {
    "zh-CN": "当前模型不支持或未声明所选思考深度，请重新选择",
    en: "The model does not support or declare the selected reasoning effort. Select another option.",
  },
  "errors.UNSUPPORTED_THINKING.the.model.does.not.support.or": {
    "zh-CN": "当前模型不支持或未声明所选思考方式",
    en: "The model does not support or declare the selected thinking mode.",
  },
  "errors.UNSUPPORTED_THINKING.thinking.cannot.be.disabled.with.xhigh": {
    "zh-CN": "关闭思考时不能同时选择 xhigh 或 max",
    en: "Thinking cannot be disabled with xhigh or max effort.",
  },
  "errors.MENTION_INVALID.references.do.not.match.the.message.detail2": {
    "zh-CN": "引用与消息文本不一致",
    en: "References do not match the message text.",
  },
  "errors.SESSION_RUNTIME.the.cli.cannot.be.changed.for": {
    "zh-CN": "已有会话不能切换 CLI",
    en: "The CLI cannot be changed for an existing session.",
  },
  "errors.NO_WORKFLOW.this.session.does.not.belong.to": {
    "zh-CN": "此会话不属于看板",
    en: "This session does not belong to a board.",
  },
  "errors.PATH_INVALID.invalid.file.path": {
    "zh-CN": "文件路径无效",
    en: "Invalid file path.",
  },
  "errors.PATH_INVALID.device.paths.and.alternate.data.streams": {
    "zh-CN": "不支持设备路径或文件数据流",
    en: "Device paths and alternate data streams are not supported.",
  },
  "errors.PATH_INVALID.use.a.full.drive.path.with": {
    "zh-CN": "请使用带分隔符的完整盘符路径",
    en: "Use a full drive path with a separator.",
  },
  "errors.PATH_INVALID.invalid.session.working.directory": {
    "zh-CN": "会话工作目录无效",
    en: "Invalid session working directory.",
  },
  "errors.PATH_ESCAPE.the.working.directory.is.outside.the": {
    "zh-CN": "工作目录超出允许范围",
    en: "The working directory is outside the allowed scope.",
  },
  "errors.PATH_ESCAPE.the.file.is.outside.the.environment": {
    "zh-CN": "文件超出环境允许的工作根目录",
    en: "The file is outside the environment's allowed workspace roots.",
  },
  "errors.NOT_FILE.only.regular.files.can.be.read": {
    "zh-CN": "仅支持普通文件，不能读取目录或设备",
    en: "Only regular files can be read, not directories or devices.",
  },
  "errors.FILE_CHANGED.the.file.has.changed.open.it": {
    "zh-CN": "文件已变化，请重新打开",
    en: "The file has changed. Open it again.",
  },
  "errors.RANGE_INVALID.invalid.read.range": {
    "zh-CN": "读取范围无效",
    en: "Invalid read range.",
  },
  "errors.FILE_CHANGED.the.file.changed.during.transfer.open": {
    "zh-CN": "文件在传输期间发生变化，请重新打开",
    en: "The file changed during transfer. Open it again.",
  },
  "errors.FILE_NOT_FOUND.the.file.does.not.exist.or": {
    "zh-CN": "文件不存在或已被删除",
    en: "The file does not exist or was deleted.",
  },
  "errors.FILE_DENIED.the.environment.process.does.not.have": {
    "zh-CN": "环境进程没有读取该文件的权限",
    en: "The environment process does not have permission to read this file.",
  },
  "errors.FILE_READ_FAILED.could.not.read.the.file.open": {
    "zh-CN": "文件读取失败，请重新打开或检查环境权限",
    en: "Could not read the file. Open it again or check environment permissions.",
  },
  "errors.HOST_DENIED.invalid.access.host": {
    "zh-CN": "访问来源错误",
    en: "Invalid access host.",
  },
  "errors.AUTH_REQUIRED.use.the.complete.link.displayed.at": {
    "zh-CN": "请使用启动时显示的完整链接",
    en: "Use the complete link displayed at startup.",
  },
  "errors.ORIGIN_DENIED.invalid.request.origin": {
    "zh-CN": "请求来源错误",
    en: "Invalid request origin.",
  },
  "errors.RUNNING.stop.the.connector.before.changing.its": {
    "zh-CN": "请先停止连接器再修改配置",
    en: "Stop the connector before changing its configuration.",
  },
  "errors.INVALID_PARAMS.the.data.directory.must.be.an": {
    "zh-CN": "数据目录必须是绝对路径",
    en: "The data directory must be an absolute path.",
  },

  "errors.LOGIN_FAILED.codex.login.did.not.complete": {
    "zh-CN": "Codex 登录未完成",
    en: "Codex login did not complete.",
  },
  "errors.UNMANAGED_INSTALL.configure.autostart.from.a.complete.installation": {
    "zh-CN": "请从完整安装包设置自启动",
    en: "Configure autostart from a complete installation package.",
  },
  "errors.SERVICE_FAILED.could.not.configure.autostart.check.the": {
    "zh-CN": "自启动设置失败，请检查用户 systemd",
    en: "Could not configure autostart. Check the user systemd service.",
  },
  "errors.SERVICE_FAILED.could.not.configure.the.scheduled.task": {
    "zh-CN": "计划任务设置失败",
    en: "Could not configure the scheduled task.",
  },
  "errors.MENTION_STALE.the.skill.is.no.longer.available": {
    "zh-CN": "Skill 已不可用，请重新选择引用",
    en: "The skill is no longer available. Select the reference again.",
  },
  "errors.PATH_ESCAPE.the.reference.is.outside.the.environment": {
    "zh-CN": "引用超出环境工作根目录",
    en: "The reference is outside the environment's workspace roots.",
  },
  "errors.MENTION_STALE.the.reference.type.has.changed.select": {
    "zh-CN": "引用类型已变化，请重新选择",
    en: "The reference type has changed. Select it again.",
  },
  "errors.INVALID_URL.the.api.url.must.use.http": {
    "zh-CN": "API 地址须为 HTTP(S)，且不能包含账号、查询参数或片段",
    en: "The API URL must use HTTP(S) and contain no credentials, query, or fragment.",
  },
  "errors.EMPTY_RESPONSE.the.api.returned.an.empty.response": {
    "zh-CN": "API 返回空响应",
    en: "The API returned an empty response.",
  },
  "errors.RESPONSE_TOO_LARGE.the.api.response.is.too.large": {
    "zh-CN": "API 响应过大，请手动填写模型",
    en: "The API response is too large. Enter the model manually.",
  },
  "errors.INVALID_CONFIG.check.the.provider.api.url.and": {
    "zh-CN": "请检查供应商、API 地址和配置字段",
    en: "Check the provider, API URL, and configuration fields.",
  },
  "environment.modelConfig.upgrade": {
    "zh-CN": "请升级目标环境连接器以配置模型 API",
    en: "Upgrade the target environment connector to configure model APIs.",
  },
  "environment.modelConfig.unconfirmed": {
    "zh-CN": "下发结果未确认，请在环境恢复后重新读取配置",
    en: "The save result is unconfirmed. Read the configuration again when the environment reconnects.",
  },
  "errors.KEY_REQUIRED.the.api.url.has.changed.re": {
    "zh-CN": "API 地址或认证方式已更改，请重新填写凭据",
    en: "The API URL or authentication method has changed. Re-enter the credential.",
  },
  "errors.KEY_REQUIRED.enter.an.api.key": {
    "zh-CN": "请填写 API Key",
    en: "Enter an API key.",
  },
  "errors.INVALID_MODELS.the.api.did.not.return.a": {
    "zh-CN": "API 未返回有效模型列表，可手动输入模型",
    en: "The API did not return a valid model list. Enter the model manually.",
  },
  "errors.TOO_MANY_MODELS.too.many.models.enter.the.model": {
    "zh-CN": "模型数量过多，请手动输入模型",
    en: "Too many models. Enter the model manually.",
  },
  "errors.MODEL_PAGINATION.model.pagination.is.invalid.or.excessive": {
    "zh-CN": "模型列表分页异常或过多，请手动输入模型",
    en: "Model pagination is invalid or excessive. Enter the model manually.",
  },
  "errors.MODEL_REQUIRED.enter.or.select.a.model.first": {
    "zh-CN": "请先填写或选择模型",
    en: "Enter or select a model first.",
  },
  "errors.INVALID_TEST_RESPONSE.unexpected.generation.response.check.the.protocol":
    {
      "zh-CN": "服务返回了非预期的生成结果，请检查协议和模型配置",
      en: "Unexpected generation response. Check the protocol and model configuration.",
    },
  "errors.NOT_REGISTERED.enter.an.access.code.and.register": {
    "zh-CN": "请先填写接入码并注册环境",
    en: "Enter an access code and register the environment first.",
  },
  "errors.START_FAILED.the.connector.failed.to.start": {
    "zh-CN": "连接器启动失败",
    en: "The connector failed to start.",
  },
  "errors.STOP_FAILED.the.stop.request.failed": {
    "zh-CN": "停止请求失败",
    en: "The stop request failed.",
  },
  "errors.CONFIG_REQUIRED.a.custom.codex.endpoint.requires.a": {
    "zh-CN": "Codex 自定义端点须配置模型和 API Key",
    en: "A custom Codex endpoint requires a model and API key.",
  },
  "errors.RUNTIME_EXIT.the.codex.process.has.exited": {
    "zh-CN": "Codex 进程已退出",
    en: "The Codex process has exited.",
  },
  "errors.NATIVE_TIMEOUT.the.native.request.timed.out.check": {
    "zh-CN": "原生请求超时，执行状态需查询",
    en: "The native request timed out. Check the execution status.",
  },
  "errors.UNSUPPORTED_INJECTION.exact.user.instruction.replacement.is.unverified":
    {
      "zh-CN": "此 Codex 版本的精确用户规范替换尚未验证；请选择继承或追加",
      en: "Exact user instruction replacement is unverified for this Codex version. Use inherit or append.",
    },
  "errors.MODEL_PAGINATION.invalid.model.pagination": {
    "zh-CN": "模型分页异常",
    en: "Invalid model pagination.",
  },
  "errors.CONFIG_REQUIRED.configure.the.custom.claude.endpoint.and": {
    "zh-CN": "请在环境本地配置 Claude 自定义端点与凭据",
    en: "Configure the custom Claude endpoint and credentials in the environment.",
  },
  "errors.UNSUPPORTED_INJECTION.exact.user.instruction.replacement.is.unverified.detail2":
    {
      "zh-CN": "精确替换用户规范尚未验证，请选择继承或追加",
      en: "Exact user instruction replacement is unverified. Use inherit or append.",
    },
  "errors.UNSAFE_ARCHIVE.unsafe.archive.structure.installation.was.refused": {
    "zh-CN": "归档结构不安全，已拒绝安装",
    en: "Unsafe archive structure. Installation was refused.",
  },
  "errors.INVALID_PARAMS.invalid.update.operation.id": {
    "zh-CN": "更新操作编号无效",
    en: "Invalid update operation ID.",
  },
  "errors.RECOVERY_REQUIRED.update.directories.must.not.be.symbolic": {
    "zh-CN": "更新目录不能使用链接",
    en: "Update directories must not be symbolic links.",
  },
  "errors.RECOVERY_REQUIRED.invalid.installation.pointer.check.the.local": {
    "zh-CN": "安装指针无效，请检查本机更新记录",
    en: "Invalid installation pointer. Check the local update record.",
  },
  "errors.RECOVERY_REQUIRED.the.installation.pointer.is.outside.the": {
    "zh-CN": "安装指针越界",
    en: "The installation pointer is outside the allowed scope.",
  },
  "errors.RECOVERY_REQUIRED.the.installation.directory.is.outside.the": {
    "zh-CN": "安装目录越界",
    en: "The installation directory is outside the allowed scope.",
  },
  "errors.UNMANAGED_INSTALL.this.installation.is.bound.to.another": {
    "zh-CN": "此安装已绑定其他数据目录或绑定损坏，请为当前环境单独解压完整包",
    en: "This installation is bound to another data directory or has a damaged binding. Extract a separate complete package for this environment.",
  },
  "errors.UNMANAGED_INSTALL.the.complete.runtime.is.missing": {
    "zh-CN": "缺少完整运行时",
    en: "The complete runtime is missing.",
  },
  "errors.UNMANAGED_INSTALL.a.bootstrap.version.is.required": {
    "zh-CN": "需要引导版本",
    en: "A bootstrap version is required.",
  },
  "errors.UNMANAGED_INSTALL.user.data.must.not.be.inside": {
    "zh-CN": "用户数据不能位于应用目录内",
    en: "User data must not be inside the application directory.",
  },
  "errors.UNMANAGED_INSTALL.the.working.directory.must.not.be": {
    "zh-CN": "工作目录不能位于应用目录内",
    en: "The working directory must not be inside the application directory.",
  },
  "errors.UPDATE_IN_PROGRESS.the.connector.is.updating.finish.verification": {
    "zh-CN": "连接器更新中，请完成核验后再修改配置",
    en: "The connector is updating. Finish verification before changing configuration.",
  },
  "errors.IDEMPOTENCY_CONFLICT.update.parameters.conflict": {
    "zh-CN": "更新参数冲突",
    en: "Update parameters conflict.",
  },
  "errors.UNMANAGED_INSTALL.this.installation.does.not.support.safe": {
    "zh-CN": "当前安装不支持安全更新",
    en: "This installation does not support safe updates.",
  },
  "errors.ENVIRONMENT_BUSY.the.environment.is.executing.or.transferring": {
    "zh-CN": "环境正在执行或传输",
    en: "The environment is executing or transferring data.",
  },
  "errors.TARGET_CHANGED.the.current.version.has.changed": {
    "zh-CN": "当前版本已变化",
    en: "The current version has changed.",
  },
  "errors.INCOMPATIBLE_PACKAGE.the.release.package.is.incompatible": {
    "zh-CN": "发行包不兼容",
    en: "The release package is incompatible.",
  },
  "errors.INSUFFICIENT_SPACE.insufficient.installation.space": {
    "zh-CN": "安装空间不足",
    en: "Insufficient installation space.",
  },
  "errors.INSTALL_PERMISSION_DENIED.the.installation.directory.is.not.writable":
    {
      "zh-CN": "安装目录不可写",
      en: "The installation directory is not writable.",
    },
  "errors.RECOVERY_REQUIRED.the.update.has.not.passed.local": {
    "zh-CN": "更新尚未通过本机核验",
    en: "The update has not passed local verification.",
  },
  "errors.NOT_FOUND.update.record.not.found": {
    "zh-CN": "更新记录不存在",
    en: "Update record not found.",
  },
  "errors.DOWNLOAD_UNAUTHORIZED.updates.require.a.trusted.https.server": {
    "zh-CN": "更新需要可信 HTTPS 服务端",
    en: "Updates require a trusted HTTPS server.",
  },
  "errors.DOWNLOAD_FAILED.could.not.download.the.update.package": {
    "zh-CN": "更新包下载失败",
    en: "Could not download the update package.",
  },
  "errors.CHECKSUM_MISMATCH.package.size.mismatch": {
    "zh-CN": "包大小不匹配",
    en: "Package size mismatch.",
  },
  "errors.CHECKSUM_MISMATCH.the.download.exceeds.the.declared.size": {
    "zh-CN": "下载超过声明大小",
    en: "The download exceeds the declared size.",
  },
  "errors.CHECKSUM_MISMATCH.update.package.checksum.mismatch": {
    "zh-CN": "更新包摘要不匹配",
    en: "Update package checksum mismatch.",
  },
  "errors.REVOKED.the.environment.identity.has.been.revoked": {
    "zh-CN": "环境身份已撤销",
    en: "The environment identity has been revoked.",
  },
  "errors.INCOMPATIBLE_PACKAGE.the.package.version.or.compatibility.declaration":
    {
      "zh-CN": "包内部版本或兼容声明不匹配",
      en: "The package version or compatibility declaration does not match.",
    },
  "errors.INCOMPATIBLE_PACKAGE.the.package.is.missing.required.files": {
    "zh-CN": "包缺少必需文件",
    en: "The package is missing required files.",
  },
  "errors.NOT_FOUND.update.log.not.found": {
    "zh-CN": "更新日志不存在",
    en: "Update log not found.",
  },
  "errors.UPDATE_IN_PROGRESS.the.supervisor.is.already.running": {
    "zh-CN": "监督进程已在运行",
    en: "The supervisor is already running.",
  },
  "errors.RECOVERY_REQUIRED.the.candidate.directory.is.missing": {
    "zh-CN": "缺少候选目录",
    en: "The candidate directory is missing.",
  },
  "errors.RESTART_FAILED.the.old.process.did.not.stop": {
    "zh-CN": "旧进程未停止",
    en: "The old process did not stop.",
  },
  "errors.RECOVERY_REQUIRED.the.new.process.did.not.stop": {
    "zh-CN": "新版进程未停止",
    en: "The new process did not stop.",
  },
  "errors.NOT_REGISTERED.run.web.or.configure.register.to": {
    "zh-CN": "请先运行 web 或 configure / register 完成接入",
    en: "Run web or configure / register to connect first.",
  },
  "errors.ALREADY_RUNNING.the.connector.is.already.running": {
    "zh-CN": "连接器已运行",
    en: "The connector is already running.",
  },
  "errors.STARTING.another.startup.is.in.progress.try": {
    "zh-CN": "已有启动进程，请稍后重试",
    en: "Another startup is in progress. Try again later.",
  },
  "errors.OFFLINE.the.server.is.offline.handoff.is": {
    "zh-CN": "服务端离线，暂不能提交交接",
    en: "The server is offline. Handoff is currently unavailable.",
  },
  "errors.OFFLINE.the.connection.was.interrupted.retry.the": {
    "zh-CN": "连接中断，请重试原交接操作",
    en: "The connection was interrupted. Retry the original handoff operation.",
  },
  "errors.DOWNLOAD_FAILED.online.server.confirmation.is.required.before": {
    "zh-CN": "切换前需要服务端在线确认",
    en: "Online server confirmation is required before switching versions.",
  },
  "errors.AUTH_PROTOCOL.duplicate.identity.challenges.are.not.accepted": {
    "zh-CN": "不接受重复身份挑战",
    en: "Duplicate identity challenges are not accepted.",
  },
  "errors.UNAUTHENTICATED.connection.authentication.has.not.completed": {
    "zh-CN": "连接身份认证尚未完成",
    en: "Connection authentication has not completed.",
  },
  "errors.RATE_LIMIT.too.many.requests.try.again.later": {
    "zh-CN": "请求过于频繁，请稍后重试",
    en: "Too many requests. Try again later.",
  },
  "errors.ORIGIN_DENIED.the.node.endpoint.does.not.accept": {
    "zh-CN": "节点入口不接受浏览器请求",
    en: "The node endpoint does not accept browser requests.",
  },
  "errors.ORIGIN_DENIED.the.request.origin.does.not.match": {
    "zh-CN": "请求来源不匹配",
    en: "The request origin does not match.",
  },
  "errors.UNAUTHENTICATED.sign.in.first": {
    "zh-CN": "请先登录",
    en: "Sign in first.",
  },
  "errors.ALREADY_SETUP.the.administrator.has.already.been.initialized": {
    "zh-CN": "管理员已初始化",
    en: "The administrator has already been initialized.",
  },
  "errors.SETUP_TOKEN.invalid.initialization.token": {
    "zh-CN": "初始化令牌不正确",
    en: "Invalid initialization token.",
  },
  "errors.LOGIN_EXPIRED.login.verification.expired.enter.your.account": {
    "zh-CN": "登录验证已失效，请返回重新输入账号密码",
    en: "Login verification expired. Enter your account and password again.",
  },
  "errors.LOGIN_FAILED.incorrect.account.or.credentials": {
    "zh-CN": "账号或凭据不正确",
    en: "Incorrect account or credentials.",
  },
  "errors.TOTP_INVALID.the.two.factor.code.is.invalid": {
    "zh-CN": "二要素验证码无效或已使用",
    en: "The two-factor code is invalid or has already been used.",
  },
  "errors.PASSWORD_INVALID.the.current.password.is.incorrect": {
    "zh-CN": "当前密码不正确",
    en: "The current password is incorrect.",
  },
  "errors.PASSWORD_INVALID.incorrect.password": {
    "zh-CN": "密码不正确",
    en: "Incorrect password.",
  },
  "errors.TOTP_ENABLED.disable.existing.two.factor.authentication.using": {
    "zh-CN": "请先使用当前验证码停用已有二要素",
    en: "Disable existing two-factor authentication using the current code first.",
  },
  "errors.TOTP_INVALID.invalid.verification.code": {
    "zh-CN": "验证码无效",
    en: "Invalid verification code.",
  },
  "errors.AUTH_INVALID.incorrect.password.or.verification.code": {
    "zh-CN": "密码或验证码不正确",
    en: "Incorrect password or verification code.",
  },
  "errors.PATH_INVALID.this.is.not.a.readable.environment": {
    "zh-CN": "不是可读取的环境文件链接",
    en: "This is not a readable environment file link.",
  },
  "errors.CONNECTOR_UPGRADE.upgrade.the.environment.connector.to.view": {
    "zh-CN": "请升级环境连接器后查看文件",
    en: "Upgrade the environment connector to view files.",
  },
  "errors.UNAUTHENTICATED.your.login.has.expired.sign.in": {
    "zh-CN": "登录已失效，请重新登录",
    en: "Your login has expired. Sign in again.",
  },
  "errors.FILE_SCOPE.file.access.authorization.has.changed": {
    "zh-CN": "文件访问授权已变化",
    en: "File access authorization has changed.",
  },
  "errors.OFFLINE.the.environment.connection.has.changed.open": {
    "zh-CN": "环境连接已变化，请重新打开文件",
    en: "The environment connection has changed. Open the file again.",
  },
  "errors.FORBIDDEN.the.environment.is.not.accessible": {
    "zh-CN": "环境不可访问",
    en: "The environment is not accessible.",
  },
  "errors.CONNECTOR_UPGRADE.upgrade.the.environment.connector.to.use": {
    "zh-CN": "请升级环境连接器后使用 @ 引用",
    en: "Upgrade the environment connector to use @ references.",
  },
  "errors.OFFLINE.the.environment.connection.has.changed.try": {
    "zh-CN": "环境连接已变化，请重试",
    en: "The environment connection has changed. Try again.",
  },
  "errors.CONNECTOR_UPGRADE.upgrade.the.environment.connector.to.retrieve": {
    "zh-CN": "请升级环境连接器后获取模型能力",
    en: "Upgrade the environment connector to retrieve model capabilities.",
  },
  "errors.OFFLINE.the.environment.connection.has.changed": {
    "zh-CN": "环境连接已变化",
    en: "The environment connection has changed.",
  },
  "errors.RANGE_INVALID.invalid.download.range": {
    "zh-CN": "下载范围无效",
    en: "Invalid download range.",
  },
  "errors.DOWNLOAD_NOT_FOUND.the.current.release.package.does.not": {
    "zh-CN": "当前发行包不存在",
    en: "The current release package does not exist.",
  },
  "errors.INVITATION_INVALID.the.access.code.is.invalid.or": {
    "zh-CN": "接入码无效或已使用",
    en: "The access code is invalid or has already been used.",
  },
  "errors.CHALLENGE_LIMIT.too.many.connection.requests.try.again": {
    "zh-CN": "接入请求过多，请稍后重试",
    en: "Too many connection requests. Try again later.",
  },
  "errors.CHALLENGE_INVALID.the.registration.challenge.is.invalid.or": {
    "zh-CN": "注册挑战无效或已使用",
    en: "The registration challenge is invalid or has already been used.",
  },
  "errors.SIGNATURE_INVALID.registration.signature.verification.failed": {
    "zh-CN": "注册签名校验失败",
    en: "Registration signature verification failed.",
  },
  "errors.OFFLINE.the.connection.has.closed": {
    "zh-CN": "连接已断开",
    en: "The connection has closed.",
  },
  "errors.UNAUTHENTICATED.authenticate.your.identity": {
    "zh-CN": "请认证身份",
    en: "Authenticate your identity.",
  },
  "errors.CHALLENGE_EXPIRED.connection.authentication.timed.out": {
    "zh-CN": "连接认证已超时",
    en: "Connection authentication timed out.",
  },
  "errors.AUTH_PROTOCOL.upgrade.the.connector.to.use.the": {
    "zh-CN": "请升级连接器以使用新版身份认证",
    en: "Upgrade the connector to use the new identity authentication protocol.",
  },
  "errors.REVOKED.the.identity.has.been.revoked": {
    "zh-CN": "身份已撤销",
    en: "The identity has been revoked.",
  },
  "errors.PENDING.waiting.for.the.user.to.approve": {
    "zh-CN": "等待用户批准环境接入",
    en: "Waiting for the user to approve environment access.",
  },
  "errors.SIGNATURE_INVALID.signature.verification.failed": {
    "zh-CN": "签名校验失败",
    en: "Signature verification failed.",
  },
  "errors.DUPLICATE_CONNECTION.this.identity.is.already.connected": {
    "zh-CN": "此身份已连接",
    en: "This identity is already connected.",
  },
  "errors.SCOPE.execution.ownership.does.not.match": {
    "zh-CN": "执行归属不匹配",
    en: "Execution ownership does not match.",
  },
  "errors.RELEASE_UNAVAILABLE.the.installation.package.is.currently.unavailable":
    {
      "zh-CN": "安装发行包暂不可用",
      en: "The installation package is currently unavailable.",
    },
  "errors.RELEASE_UNAVAILABLE.the.release.package.for.this.platform": {
    "zh-CN": "当前平台发行包暂不可用",
    en: "The release package for this platform is currently unavailable.",
  },
  "errors.IDEMPOTENCY_CONFLICT.repeated.operation.parameters.do.not.match": {
    "zh-CN": "重复操作参数不一致",
    en: "Repeated operation parameters do not match.",
  },
  "errors.ARTIFACT_BUSY.artifact.upload.is.busy.try.again": {
    "zh-CN": "产物上传繁忙，请稍后重试",
    en: "Artifact upload is busy. Try again later.",
  },
  "errors.SCOPE.handoff.operation.ownership.does.not.match": {
    "zh-CN": "交接操作归属不匹配",
    en: "Handoff operation ownership does not match.",
  },
  "errors.ARTIFACT_INTERRUPTED.upload.interrupted.submit.the.same.handoff": {
    "zh-CN": "上传已中断，请重新提交相同交接以恢复",
    en: "Upload interrupted. Submit the same handoff again to resume.",
  },
  "errors.OFFLINE.the.environment.connection.has.changed.retry": {
    "zh-CN": "环境连接已变化，请重试交接",
    en: "The environment connection has changed. Retry the handoff.",
  },
  "errors.CONNECTOR_UPGRADE.upgrade.the.connector.to.submit.artifacts": {
    "zh-CN": "请升级连接器后提交产物",
    en: "Upgrade the connector to submit artifacts.",
  },
  "errors.ARTIFACT_MISSING.an.uploaded.artifact.is.missing.or": {
    "zh-CN": "已上传的产物缺失或损坏",
    en: "An uploaded artifact is missing or damaged.",
  },
  "errors.ARTIFACT_LIMIT.each.artifact.may.be.up.to": {
    "zh-CN": "产物单件最多 128 MiB，每次交接总计最多 256 MiB",
    en: "Each artifact may be up to 128 MiB; each handoff may total up to 256 MiB.",
  },
  "errors.ARTIFACT_PENDING.the.artifact.handoff.is.not.complete": {
    "zh-CN": "产物尚未完成交接",
    en: "The artifact handoff is not complete.",
  },
  "errors.ARTIFACT_SCOPE.artifact.ownership.does.not.match": {
    "zh-CN": "产物归属不匹配",
    en: "Artifact ownership does not match.",
  },
  "errors.ARTIFACT_MISSING.the.artifact.file.is.damaged": {
    "zh-CN": "产物文件损坏",
    en: "The artifact file is damaged.",
  },
  "errors.ARTIFACT_CORRUPT.artifact.integrity.verification.failed": {
    "zh-CN": "产物完整性校验失败",
    en: "Artifact integrity verification failed.",
  },
  "errors.ARTIFACT_MISSING.the.artifact.file.is.incomplete": {
    "zh-CN": "产物文件不完整",
    en: "The artifact file is incomplete.",
  },
  "errors.ARTIFACT_CORRUPT.the.artifact.changed.while.being.read": {
    "zh-CN": "产物读取期间发生变化",
    en: "The artifact changed while being read.",
  },
  "errors.NOT_FOUND.update.operation.not.found": {
    "zh-CN": "更新操作不存在",
    en: "Update operation not found.",
  },
  "errors.IDEMPOTENCY_CONFLICT.the.operation.id.was.used.for": {
    "zh-CN": "操作标识已用于不同请求",
    en: "The operation ID was used for a different request.",
  },
  "errors.IDEMPOTENCY_CONFLICT.the.operation.id.has.already.been": {
    "zh-CN": "操作标识已被使用",
    en: "The operation ID has already been used.",
  },
  "errors.TRANSFER_LIMIT.too.many.open.files.close.other": {
    "zh-CN": "打开的文件过多，请先关闭其他文件",
    en: "Too many open files. Close other files first.",
  },
  "errors.TRANSFER_EXPIRED.the.file.reference.expired.open.it": {
    "zh-CN": "文件引用已失效，请重新打开",
    en: "The file reference expired. Open it again.",
  },
  "errors.TRANSFER_BUSY.the.file.is.being.transferred": {
    "zh-CN": "文件正在传输",
    en: "The file is being transferred.",
  },
  "errors.TRANSFER_CORRUPT.transfer.verification.failed.try.again": {
    "zh-CN": "传输校验失败，请重试",
    en: "Transfer verification failed. Try again.",
  },
  "errors.CONFLICT.download.configuration.has.changed.refresh.the": {
    "zh-CN": "下载配置已变化，请刷新",
    en: "Download configuration has changed. Refresh the page.",
  },
  "errors.UNAUTHENTICATED.sign.in.or.obtain.a.new": {
    "zh-CN": "请先登录或重新获取下载链接",
    en: "Sign in or obtain a new download link.",
  },
  "errors.DOWNLOAD_UNAUTHORIZED.sign.in.to.obtain.a.temporary": {
    "zh-CN": "请登录后获取临时下载链接",
    en: "Sign in to obtain a temporary download link.",
  },
  "errors.DOWNLOAD_EXPIRED.download.authorization.expired.or.the.file": {
    "zh-CN": "下载授权已失效或文件不匹配，请重新获取",
    en: "Download authorization expired or the file does not match. Obtain a new link.",
  },
  "errors.WEAK_PASSWORD.the.password.must.contain.at.least": {
    "zh-CN": "密码至少 12 位",
    en: "The password must contain at least 12 characters.",
  },
  "errors.KEY_INVALID.invalid.master.key.length": {
    "zh-CN": "主密钥长度不正确",
    en: "Invalid master key length.",
  },
  "errors.BUSY.selected.sessions.are.running.or.waiting": {
    "zh-CN": "所选会话仍在执行或等待交互，请先停止再操作",
    en: "Selected sessions are running or waiting for interaction. Stop them first.",
  },
  "errors.SCOPE.the.execution.environment.does.not.match": {
    "zh-CN": "执行环境不匹配",
    en: "The execution environment does not match.",
  },
  "errors.UNSUPPORTED_THINKING.codex.does.not.support.claude.thinking": {
    "zh-CN": "Codex 不支持 Claude 思考方式",
    en: "Codex does not support Claude thinking modes.",
  },
  "errors.DIRECTORY_MISMATCH.the.stage.directory.must.belong.to": {
    "zh-CN": "阶段目录必须属于看板项目",
    en: "The stage directory must belong to the board project.",
  },
  "errors.AGENT_REQUIRED.select": {
    "zh-CN": "请选择适用的智能体。如无可选项，请先创建智能体。",
    en: "Select a compatible agent. If none are available, create an agent first.",
  },
  "board.stageAgentInvalid": {
    "zh-CN": "阶段「{stage}」缺少适用的智能体。请在流程配置中选择与环境和 CLI 匹配的智能体，或先创建智能体。",
    en: "Stage “{stage}” needs a compatible agent. In the board flow, select an agent for this environment and CLI, or create one first.",
  },
  "errors.AGENT_SCOPE.the.agent.environment.does.not.match": {
    "zh-CN": "智能体环境不匹配",
    en: "The agent environment does not match.",
  },
  "errors.AGENT_RUNTIME.the.agent.does.not.support.this": {
    "zh-CN": "智能体不适用于当前 CLI，请重新选择",
    en: "The agent does not support this CLI. Select another agent.",
  },
  "errors.CONFLICT.the.board.has.changed.review.the": {
    "zh-CN": "看板已更新，请核对最新内容后重试",
    en: "The board has changed. Review the latest content and try again.",
  },
  "errors.CONFLICT.the.data.version.has.changed": {
    "zh-CN": "数据版本已变更",
    en: "The data version has changed.",
  },
  "errors.PROJECT_IMMUTABLE.flow.editing.cannot.move.the.board": {
    "zh-CN": "流程编辑不能迁移项目",
    en: "Flow editing cannot move the board to another project.",
  },
  "errors.DONE_IMMUTABLE.the.original.fixed.done.stage.must": {
    "zh-CN": "必须保留原固定完成终点",
    en: "The original fixed done stage must be retained.",
  },
  "errors.STAGE_DELETED.deleted.stage.ids.cannot.be.reused": {
    "zh-CN": "已删除阶段标识不能复用",
    en: "Deleted stage IDs cannot be reused.",
  },
  "errors.BUSY.stop.or.cancel.the.execution.first": {
    "zh-CN": "先停止或取消执行",
    en: "Stop or cancel the execution first.",
  },
  "errors.STAGE_DELETED.the.original.stage.was.deleted.this": {
    "zh-CN": "原阶段已删除，无法直接恢复此工作项",
    en: "The original stage was deleted. This work item cannot be restored directly.",
  },
  "errors.INVALID_KIND.unsupported.object.type": {
    "zh-CN": "不支持该对象",
    en: "Unsupported object type.",
  },
  "errors.FLOW_CONFIRMATION_REQUIRED.re.evaluate.the.deletion.impact.and": {
    "zh-CN": "请重新评估删除影响并明确确认后保存",
    en: "Re-evaluate the deletion impact and explicitly confirm before saving.",
  },
  "errors.SESSION_AGENT_DELETED.reselect": {
    "zh-CN": "原智能体已删除，请重新选择智能体后继续对话。",
    en: "The original agent was deleted. Select another agent to continue this conversation.",
  },
  "errors.REFERENCED.an.existing.session.s.project.directory": {
    "zh-CN": "已有会话的项目目录不可迁移",
    en: "An existing session's project directory cannot be moved.",
  },
  "errors.RESERVED_PARAMETER.custom.parameters.must.not.override.model": {
    "zh-CN": "自定义参数不能覆盖模型、消息、工具或权限字段",
    en: "Custom parameters must not override model, message, tool, or permission fields.",
  },
  "errors.REFERENCED.the.object.is.still.referenced.and": {
    "zh-CN": "对象仍被引用，不能删除",
    en: "The object is still referenced and cannot be deleted.",
  },
  "errors.REFERENCED.the.board.has.unfinished.unarchived.work": {
    "zh-CN": "存在未完成且未归档的工作项，不能删除看板",
    en: "The board has unfinished, unarchived work items and cannot be deleted.",
  },
  "errors.DIRECTORY_MISMATCH.the.directory.must.be.registered.in": {
    "zh-CN": "目录必须在项目中登记",
    en: "The directory must be registered in the project.",
  },
  "errors.OFFLINE.the.environment.is.offline.a.session": {
    "zh-CN": "环境离线，无法新建会话",
    en: "The environment is offline. A session cannot be created.",
  },
  "errors.ARCHIVED.unarchive.the.session.before.changing.its": {
    "zh-CN": "请先取消归档再修改配置",
    en: "Unarchive the session before changing its configuration.",
  },
  "errors.CONNECTOR_UPGRADE.upgrade.the.environment.connector.to.configure": {
    "zh-CN": "请升级环境连接器后使用模型和思考配置",
    en: "Upgrade the environment connector to configure models and thinking.",
  },
  "errors.NOT_FOUND.execution.not.found": {
    "zh-CN": "执行不存在",
    en: "Execution not found.",
  },
  "errors.OFFLINE.the.environment.is.offline.session.content": {
    "zh-CN": "环境离线，正文保存在环境本地",
    en: "The environment is offline. Session content is stored locally in the environment.",
  },
  "errors.ARCHIVED.unarchive.the.session.before.sending.messages": {
    "zh-CN": "请先取消归档再发送消息",
    en: "Unarchive the session before sending messages.",
  },
  "errors.UPDATE_IN_PROGRESS.the.environment.is.updating.its.connector": {
    "zh-CN": "环境正在更新连接器",
    en: "The environment is updating its connector.",
  },
  "errors.MENTION_INVALID.references.do.not.match.the.message.detail3": {
    "zh-CN": "引用与消息文本不一致，请重新选择",
    en: "References do not match the message text. Select them again.",
  },
  "errors.CONNECTOR_UPGRADE.upgrade.the.environment.connector.to.use.detail2": {
    "zh-CN": "请升级环境连接器后使用引用",
    en: "Upgrade the environment connector to use references.",
  },
  "errors.CONNECTOR_UPGRADE.upgrade.the.environment.connector.to.continue": {
    "zh-CN": "请升级环境连接器后继续看板会话",
    en: "Upgrade the environment connector to continue board sessions.",
  },
  "errors.INVALID_STATE.invalid.execution.state": {
    "zh-CN": "执行状态无效",
    en: "Invalid execution state.",
  },
  "errors.INVALID_STATE_VERSION.invalid.execution.state.version": {
    "zh-CN": "执行状态版本无效",
    en: "Invalid execution state version.",
  },
  "errors.HANDOFF_REQUIRED.the.handoff.record.must.not.be": {
    "zh-CN": "交接记录不能为空",
    en: "The handoff record must not be empty.",
  },
  "errors.STAGE_DELETED.the.original.stage.was.deleted.the": {
    "zh-CN": "原阶段已删除，不能推进",
    en: "The original stage was deleted. The work item cannot advance.",
  },
  "errors.INVALID_TRANSITION.this.transition.is.not.allowed.from": {
    "zh-CN": "当前阶段不允许此流转",
    en: "This transition is not allowed from the current stage.",
  },
  "errors.STALE_EXECUTION.the.execution.has.expired": {
    "zh-CN": "执行已过期",
    en: "The execution has expired.",
  },
  "errors.STALE_EXECUTION.finished.or.stopping.executions.cannot.advance": {
    "zh-CN": "已结束或停止中的执行不能推进流程",
    en: "Finished or stopping executions cannot advance the flow.",
  },
  "errors.BUSY.stop.the.current.execution.before.advancing": {
    "zh-CN": "先停止当前执行，再手动推进",
    en: "Stop the current execution before advancing manually.",
  },
  "errors.ARTIFACT_SCOPE.the.artifact.is.not.ready.or": {
    "zh-CN": "产物未就绪或归属不匹配",
    en: "The artifact is not ready or its ownership does not match.",
  },
  "errors.STALE_EXECUTION.the.execution.has.expired.or.stopped": {
    "zh-CN": "执行已过期或停止",
    en: "The execution has expired or stopped.",
  },
  "errors.STAGE_DELETED.the.stage.was.deleted": {
    "zh-CN": "阶段已删除",
    en: "The stage was deleted.",
  },
  "errors.ARTIFACT_DISABLED.artifact.submission.is.not.enabled.for": {
    "zh-CN": "此阶段执行未开启允许提交产物",
    en: "Artifact submission is not enabled for this stage execution.",
  },
  "errors.ARCHIVED.restore.the.work.item.before.retrying": {
    "zh-CN": "请先恢复工作项，再重试当前阶段",
    en: "Restore the work item before retrying its current stage.",
  },
  "errors.INVALID_STATE.only.finished.agent.executions.can.be": {
    "zh-CN": "只能重试已结束的 Agent 执行",
    en: "Only finished Agent executions can be retried.",
  },
  "errors.INVALID_STAGE.the.current.stage.is.not.an": {
    "zh-CN": "当前不是 Agent 阶段",
    en: "The current stage is not an Agent stage.",
  },
  "errors.INVALID_CURSOR.invalid.history.cursor.read.the.latest": {
    "zh-CN": "历史分页游标无效，请重新读取最近一页",
    en: "Invalid history cursor. Read the latest page again.",
  },
  "errors.INVALID_CURSOR.the.cursor.does.not.belong.to": {
    "zh-CN": "游标不属于当前会话或查询范围",
    en: "The cursor does not belong to this session or query scope.",
  },
  "errors.CURSOR_EXPIRED.history.has.changed.read.the.latest": {
    "zh-CN": "历史记录已变化，请重新读取最近一页",
    en: "History has changed. Read the latest page again.",
  },
  "errors.WAIT_CANCELLED.waiting.stopped.the.environment.task.continues": {
    "zh-CN": "已停止等待，环境任务继续执行",
    en: "Waiting stopped. The environment task continues to run.",
  },
  "errors.NOT_FOUND.record.not.found": {
    "zh-CN": "记录不存在",
    en: "Record not found.",
  },
  "errors.CONFLICT.the.data.has.changed.refresh.and": {
    "zh-CN": "数据已变更，请刷新后重试",
    en: "The data has changed. Refresh and try again.",
  },
  "errors.INVALID.sessions.must.not.be.duplicated": {
    "zh-CN": "会话不能重复",
    en: "Sessions must not be duplicated.",
  },
  "errors.CONFLICT.the.session.has.changed.refresh.and": {
    "zh-CN": "会话已变更，请刷新后重试",
    en: "The session has changed. Refresh and try again.",
  },
  "errors.BUSY.stop.the.current.run.or.resolve": {
    "zh-CN": "请先停止当前运行或处理审批，再管理会话",
    en: "Stop the current run or resolve approvals before managing sessions.",
  },
  "errors.ARCHIVED.restore.the.archived.session.first": {
    "zh-CN": "请先恢复已归档会话",
    en: "Restore the archived session first.",
  },
  "errors.BUSY.context.compression.is.in.progress.try": {
    "zh-CN": "上下文正在压缩，请稍后重试",
    en: "Context compression is in progress. Try again later.",
  },
  "errors.CONFLICT.the.prompt.has.changed.reload.it": {
    "zh-CN": "提示词已变更，请重新加载后再保存",
    en: "The prompt has changed. Reload it before saving.",
  },
  "errors.BUSY.wait.for.the.current.run.to": {
    "zh-CN": "当前运行结束后才能切换模型或权限",
    en: "Wait for the current run to finish before switching models or permissions.",
  },
  "errors.MODEL_KEY_REQUIRED.enter.model.credentials.in.settings.first": {
    "zh-CN": "请先在设置中填写模型凭据",
    en: "Enter model credentials in settings first.",
  },
  "errors.STATUS_UNKNOWN.the.tool.execution.status.is.unknown": {
    "zh-CN": "工具执行状态未知，请读取记录后确认",
    en: "The tool execution status is unknown. Read the record to confirm.",
  },
  "errors.TOOL_SCOPE.only.environment.level.agents.can.be": {
    "zh-CN": "只可管理环境级智能体",
    en: "Only environment-level agents can be managed.",
  },
  "errors.TOOL_SCOPE.an.environment.must.be.specified": {
    "zh-CN": "必须指定环境",
    en: "An environment must be specified.",
  },
  "errors.MESSAGE_REQUIRED.a.message.is.required": {
    "zh-CN": "缺少消息",
    en: "A message is required.",
  },
  "errors.THINKING_BUDGET.the.anthropic.output.budget.must.exceed": {
    "zh-CN": "Anthropic 输出预算必须大于思考预算",
    en: "The Anthropic output budget must exceed the thinking budget.",
  },
  "errors.IDEMPOTENCY_CONFLICT.the.same.operation.id.cannot.be": {
    "zh-CN": "相同操作标识不能用于不同消息或图片",
    en: "The same operation ID cannot be used for different messages or images.",
  },
  "errors.IDEMPOTENCY_CONFLICT.the.old.operation.has.no.content": {
    "zh-CN": "旧操作缺少内容摘要，请使用新的操作标识",
    en: "The old operation has no content digest. Use a new operation ID.",
  },
  "errors.BUSY.finish.the.current.run.or.approval": {
    "zh-CN": "请先完成当前运行或审批",
    en: "Finish the current run or approval first.",
  },
  "errors.INVALID_STATE.there.is.no.resumable.checkpoint": {
    "zh-CN": "没有可恢复的检查点",
    en: "There is no resumable checkpoint.",
  },
  "errors.STALE_APPROVAL.the.approval.was.already.handled.or": {
    "zh-CN": "审批已处理或过期",
    en: "The approval was already handled or has expired.",
  },
  "errors.STALE_APPROVAL.the.approval.was.already.handled.or.detail2": {
    "zh-CN": "审批项已处理或不存在",
    en: "The approval was already handled or does not exist.",
  },
  "errors.STALE_APPROVAL.checkpoint.approval.items.have.changed": {
    "zh-CN": "检查点审批项已变化",
    en: "Checkpoint approval items have changed.",
  },
  "errors.BUSY.compression.is.not.allowed.during.a": {
    "zh-CN": "运行或审批中不能压缩",
    en: "Compression is not allowed during a run or approval.",
  },
  "errors.STATUS_UNKNOWN.the.request.timed.out.check.the": {
    "zh-CN": "请求超时，请查询原操作状态",
    en: "The request timed out. Check the original operation status.",
  },
  "errors.OFFLINE.the.environment.has.disconnected": {
    "zh-CN": "环境已断开",
    en: "The environment has disconnected.",
  },
  "common.failure": {
    "zh-CN": "操作失败，请检查配置或重试",
    en: "Operation failed. Check the configuration or try again.",
  },
  "validation.invalid": {
    "zh-CN": "输入无效，请检查字段",
    en: "Invalid input. Check the fields.",
  },
  "validation.required": {
    "zh-CN": "字段缺失或类型不正确",
    en: "The field is missing or has an incorrect type.",
  },
  "validation.tooSmall": {
    "zh-CN": "值小于允许的下限",
    en: "The value is below the allowed minimum.",
  },
  "validation.tooBig": {
    "zh-CN": "值超出允许的上限",
    en: "The value exceeds the allowed maximum.",
  },
  "validation.format": {
    "zh-CN": "格式无效",
    en: "Invalid format.",
  },
  "validation.option": {
    "zh-CN": "请选择有效选项",
    en: "Select a valid option.",
  },
  "validation.unknownFields": {
    "zh-CN": "包含不支持的字段",
    en: "Unsupported fields are present.",
  },
  "validation.stageUnique": {
    "zh-CN": "阶段标识须唯一且必须有一个已完成阶段",
    en: "Stage IDs must be unique and exactly one done stage is required.",
  },
  "validation.stageTarget": {
    "zh-CN": "阶段流转目标无效",
    en: "Invalid stage transition target.",
  },
  "validation.stageEnvironment": {
    "zh-CN": "Agent 阶段须指定环境和工作目录",
    en: "Agent stages require an environment and working directory.",
  },
  "connector.roots.absoluteRequired": {
    "zh-CN": "工作根目录必须是绝对路径",
    en: "The workspace root must be an absolute path.",
  },
  "connector.roots.invalid": {
    "zh-CN": "工作根目录不存在或不是文件夹",
    en: "The workspace root does not exist or is not a directory.",
  },
  "connector.registration.challengeFailed": {
    "zh-CN": "申请注册挑战失败",
    en: "Could not request a registration challenge.",
  },
  "connector.registration.failed": {
    "zh-CN": "注册失败",
    en: "Registration failed.",
  },
  "connector.defaultName": {
    "zh-CN": "开发环境",
    en: "Development environment",
  },
  "connector.startTimeout": {
    "zh-CN": "连接器未能启动，请查看用户数据目录中的 connector.log",
    en: "The connector did not start. Check connector.log in the user data directory.",
  },
  "connector.model.invalidUrl": {
    "zh-CN": "请填写有效的 API 地址",
    en: "Enter a valid API URL.",
  },
  "connector.model.timeout": {
    "zh-CN": "连接超时，请检查 API 地址或稍后重试",
    en: "Connection timed out. Check the API URL or try again later.",
  },
  "connector.model.connectionFailed": {
    "zh-CN": "无法连接 API，请检查地址、网络或证书（不支持重定向）",
    en: "Cannot connect to the API. Check the URL, network, or certificate (redirects are not supported).",
  },
  "connector.model.authorization": {
    "zh-CN": "API 返回 HTTP {status}，请检查密钥、认证类型及模型权限",
    en: "API returned HTTP {status}. Check the API key, authentication type, and model permissions.",
  },
  "connector.model.notFound": {
    "zh-CN": "API 返回 HTTP {status}，请检查 API 路径及服务是否支持此接口",
    en: "API returned HTTP {status}. Check the API path and whether the service supports this endpoint.",
  },
  "connector.model.rateLimit": {
    "zh-CN": "API 返回 HTTP {status}，请求受限，请检查额度或稍后重试",
    en: "API returned HTTP {status}. Request limited. Check your quota or try again later.",
  },
  "connector.model.upstream": {
    "zh-CN": "API 返回 HTTP {status}，请检查服务状态及模型配置",
    en: "API returned HTTP {status}. Check the service status and model configuration.",
  },
  "connector.model.invalidJson": {
    "zh-CN": "API 未返回有效 JSON，请检查 API 地址",
    en: "The API did not return valid JSON. Check the API URL.",
  },
  "connector.model.tooMany": {
    "zh-CN": "模型列表过大",
    en: "The model list is too large.",
  },
  "errors.PERMISSION_UNAVAILABLE.claude.root.full": {
    "zh-CN": "Claude 以 root 运行，无法使用完全权限。请选择询问模式或自动审批。",
    en: "Claude runs as root, so full permission is unavailable. Choose ask mode or auto-approval.",
  },
  "errors.CONNECTOR_UPGRADE_REQUIRED.auto.approval": {
    "zh-CN": "目标环境的连接器版本不支持自动审批，请先升级连接器。",
    en: "The connector on the target environment does not support auto-approval. Upgrade the connector first.",
  },
  "connector.native.terminal": {
    "zh-CN": "请打开此会话的 Claude Code 原生终端。",
    en: "Open the Claude Code terminal for this session.",
  },
  "connector.native.unavailable": {
    "zh-CN": "原生终端不可用，请核对会话、项目目录和连接器状态。",
    en: "The native terminal is unavailable. Check the session, project directory and connector status.",
  },
  "connector.native.automation": {
    "zh-CN": "Claude 自动阶段需要配置自定义 API 端点和凭据。",
    en: "Automated Claude stages require a custom API endpoint and credentials.",
  },
  "connector.runtime.claudeConfig": {
    "zh-CN": "请在环境本地配置 Claude 端点与凭据",
    en: "Configure the Claude endpoint and credentials in the environment.",
  },
  "connector.runtime.terminateFailed": {
    "zh-CN": "运行时终止失败",
    en: "The runtime could not be terminated.",
  },
  "cli.language.invalid": {
    "zh-CN": "语言参数无效，合法值：auto、zh-CN、en",
    en: "Invalid language argument. Allowed values: auto, zh-CN, en.",
  },
  "cli.language.corrupt": {
    "zh-CN": "语言偏好文件损坏或不可读，本次跟随系统",
    en: "Language preferences are damaged or unreadable. Using the system language for this invocation.",
  },
  "cli.language.writeFailed": {
    "zh-CN": "无法保存语言偏好，原文件未替换",
    en: "Could not save language preferences. The original file was not replaced.",
  },
  "cli.language.saved": {
    "zh-CN": "语言偏好已保存：{preference}；当前语言：{locale}",
    en: "Language preference saved: {preference}; effective locale: {locale}.",
  },
  "cli.language.current": {
    "zh-CN":
      "偏好：{preference}；当前语言：{locale}；跟随系统：{auto}；来源：{source}",
    en: "Preference: {preference}; effective locale: {locale}; follows system: {auto}; source: {source}.",
  },
  "cli.source.override": {
    "zh-CN": "命令参数",
    en: "command option",
  },
  "cli.source.file": {
    "zh-CN": "本地偏好",
    en: "local preferences",
  },
  "cli.source.system": {
    "zh-CN": "系统",
    en: "system",
  },
  "cli.yes": {
    "zh-CN": "是",
    en: "yes",
  },
  "cli.no": {
    "zh-CN": "否",
    en: "no",
  },
  "cli.registration.code": {
    "zh-CN": "一次性接入码：",
    en: "One-time access code: ",
  },
  "cli.registration.success": {
    "zh-CN": "注册成功，请在平台批准环境。",
    en: "Registration succeeded. Approve the environment on the platform.",
  },
  "cli.configure.url": {
    "zh-CN": "服务端 HTTPS 地址：",
    en: "Server HTTPS URL: ",
  },
  "cli.configure.name": {
    "zh-CN": "环境名称：",
    en: "Environment name: ",
  },
  "cli.configure.root": {
    "zh-CN": "工作根目录绝对路径：",
    en: "Absolute workspace root path: ",
  },
  "cli.configure.saved": {
    "zh-CN": "已保存。运行 web 配置工具凭据，或 register 注册。",
    en: "Saved. Run web to configure tool credentials, or register to register.",
  },

  "cli.autostart.usage": {
    "zh-CN": "请使用 autostart enable 或 autostart disable。",
    en: "Use autostart enable or autostart disable.",
  },
  "cli.autostart.legacyBlocked": {
    "zh-CN": "无法确认旧计划任务 \\BugPawRelay 已清除。它可能仍会在登录时启动旧连接器。请让获授权的账户在任务计划程序中核实并删除旧任务，再用原账户重试。",
    en: "Could not confirm removal of the legacy scheduled task \\BugPawRelay. It may still launch the old connector at login. Have an authorized account verify and remove it in Task Scheduler, then retry as the original user.",
  },
  "cli.autostart.windowsFailed": {
    "zh-CN": "无法配置登录启动项。请检查当前用户的启动文件夹写权限、任务管理器的启动应用设置及 PowerShell 策略，确认使用完整安装包后重试。",
    en: "Could not configure login startup. Check write access to your Startup folder, Task Manager startup settings and PowerShell policy, verify the complete installation, then retry.",
  },
  "cli.autostart.unsupported": {
    "zh-CN": "当前平台未支持自启动",
    en: "Autostart is not supported on this platform.",
  },
  "cli.web.url": {
    "zh-CN": "本机 Web 控制台（仅本机访问）：{url}",
    en: "Local Web console (local access only): {url}",
  },
  "cli.web.open": {
    "zh-CN": "请在本机浏览器打开以上链接。",
    en: "Open the link above in a local browser.",
  },
  "cli.help": {
    "zh-CN":
      "BugPaw Relay\n默认打开 Web 控制台；--cli 前台运行\nweb [--no-open] | configure | register | run | start | stop | status | codex-login | claude status/install | autostart enable/disable\nlanguage [auto|zh-CN|en] | --lang auto|zh-CN|en <command>\n例如：bugpaw-relay --lang en status",
    en: "BugPaw Relay\nOpens the Web console by default; --cli runs in the foreground\nweb [--no-open] | configure | register | run | start | stop | status | codex-login | claude status/install | autostart enable/disable\nlanguage [auto|zh-CN|en] | --lang auto|zh-CN|en <command>\nExample: bugpaw-relay --lang en status",
  },
  "errors.invalidUrl": {
    "zh-CN": "路径编码无效",
    en: "Invalid URL encoding.",
  },
  "errors.notFound": {
    "zh-CN": "接口不存在",
    en: "Endpoint not found.",
  },
  "errors.downloadMissing": {
    "zh-CN": "下载文件不存在，请刷新接入页面获取当前版本",
    en: "Download not found. Refresh the connection page for the current version.",
  },
  "handoff.INVALID_HANDOFF_TARGET": {
    "zh-CN": "目标不在本次执行允许的短编号中",
    en: "Target is not an allowed short ID for this execution",
  },
  "handoff.HANDOFF_SNAPSHOT_INVALID": {
    "zh-CN": "阶段交接快照缺失或损坏，请人工处理",
    en: "Stage handoff snapshot is missing or invalid; manual action is required",
  },
  "handoff.HANDOFF_CONTRACT_UNSUPPORTED": {
    "zh-CN": "不支持此阶段交接契约版本",
    en: "Unsupported stage handoff contract version",
  },
  "handoff.STAGE_SHORT_ID_INVALID": {
    "zh-CN": "阶段短编号是只读字段或编号数据无效",
    en: "Stage short ID is read-only or numbering data is invalid",
  },
  "handoff.STAGE_SHORT_ID_EXHAUSTED": {
    "zh-CN": "阶段短编号已达到安全整数上限",
    en: "Stage short IDs have reached the safe integer limit",
  },
  "handoff.CONNECTOR_UPGRADE": {
    "zh-CN": "请升级连接器以执行短编号阶段交接",
    en: "Upgrade the connector to run short-ID stage handoffs",
  },
  "handoff.currentStage": { "zh-CN": "当前阶段", en: "Current stage" },
  "handoff.allowedTargets": { "zh-CN": "允许推进目标", en: "Allowed targets" },
  "handoff.history": { "zh-CN": "交接历史", en: "Handoff history" },
  "handoff.noHistory": { "zh-CN": "暂无交接历史", en: "No handoff history" },
  "handoff.emptyTargets": {
    "zh-CN": "无允许推进目标",
    en: "No allowed targets",
  },
  "handoff.unknownStage": { "zh-CN": "未知阶段", en: "Unknown stage" },
  "handoff.unknownTime": { "zh-CN": "时间未知", en: "Unknown time" },
  "handoff.from": { "zh-CN": "来源", en: "From" },
  "handoff.created": { "zh-CN": "创建工作项", en: "Work item created" },
  "handoff.edited": { "zh-CN": "编辑工作项", en: "Work item edited" },
  "handoff.attachments": {
    "zh-CN": "项目目录附件",
    en: "Project directory attachments",
  },
  "uploads.directory": {
    "zh-CN": "请选择目标阶段允许的项目目录。",
    en: "Select a project directory allowed for the target stage.",
  },
  "handoff.to": { "zh-CN": "目标", en: "To" },
  "handoff.record": { "zh-CN": "交接正文", en: "Handoff record" },
  "handoff.artifacts": { "zh-CN": "产物", en: "Artifacts" },
  "handoff.unnamed": { "zh-CN": "未命名产物", en: "Unnamed artifact" },
  "handoff.workItem": { "zh-CN": "工作项", en: "Work item" },
  "handoff.request": { "zh-CN": "需求", en: "Request" },
  "handoff.agent": { "zh-CN": "智能体（agent）", en: "Agent (agent)" },
  "handoff.human": { "zh-CN": "人工（human）", en: "Human (human)" },
  "handoff.done": { "zh-CN": "已完成（done）", en: "Done (done)" },
  "handoff.callCodex": {
    "zh-CN": "完成后调用 relay_handoff 工具提交记录并选择合法目标。",
    en: "Call relay_handoff to submit the record and select an allowed target.",
  },
  "handoff.callClaude": {
    "zh-CN": "完成后调用 mcp__relay__handoff 工具。",
    en: "Call mcp__relay__handoff to submit the record and select an allowed target.",
  },
  "handoff.stageContext": {
    "zh-CN": "阶段上下文",
    en: "Stage context",
  },
  "handoff.tool": {
    "zh-CN": "使用允许的目标阶段短编号提交交接记录并推进",
    en: "Submit a handoff using an allowed target stage short ID",
  },
  "handoff.noTargets": {
    "zh-CN": "当前阶段没有合法交接出口，不提供交接工具。",
    en: "This stage has no allowed targets; no handoff tool is available.",
  },
  "connector.blockers.title": {"zh-CN": "会话占用，暂时无法更新", "en": "Sessions are blocking this update"},
  "connector.blockers.details": {"zh-CN": "更新占用详情", "en": "Update blockers"},
  "connector.blockers.open": {"zh-CN": "打开会话", "en": "Open session"},
  "connector.blockers.stop": {"zh-CN": "强制终止", "en": "Force stop"},
  "connector.blockers.confirm": {"zh-CN": "确认终止本次执行", "en": "Confirm stop"},
  "connector.blockers.warning": {"zh-CN": "将中断本次执行并关闭待处理交互，已经产生的文件改动会保留。", "en": "This interrupts the selected execution and closes pending interactions. Existing file changes will be kept."},
  "connector.blockers.mismatch": {"zh-CN": "连接器仍在等待，本次执行在服务端已标记完成。", "en": "The connector is still waiting. The server has marked this execution as completed."},
  "connector.blockers.answer": {"zh-CN": "等待回答", "en": "Waiting for an answer"},
  "connector.blockers.approval": {"zh-CN": "等待审批", "en": "Waiting for approval"},
  "connector.blockers.interaction": {"zh-CN": "等待交互", "en": "Waiting for interaction"},
  "connector.blockers.transfer": {"zh-CN": "文件传输中", "en": "File transfer in progress"},
  "connector.blockers.terminal": {"zh-CN": "终端仍在运行", "en": "An active terminal is open"},
  "connector.blockers.activity": {"zh-CN": "其他操作正在进行", "en": "Another operation is in progress"},
  "connector.blockers.storage": {"zh-CN": "连接器存储故障", "en": "Connector storage error"},
  "connector.blockers.unidentified": {"zh-CN": "暂时无法获取占用详情", "en": "Occupancy details are temporarily unavailable"},
  "connector.blockers.unsupported": {"zh-CN": "此连接器无法列出全部本地占用，仅显示已知信息。", "en": "This connector cannot list all local blockers. Only known details are shown."},
  "connector.blockers.offline": {"zh-CN": "连接器已离线，暂时无法获取占用详情。", "en": "The connector is offline. Occupancy details are temporarily unavailable."},
  "connector.blockers.empty": {"zh-CN": "当前未发现占用。", "en": "No current blockers found."},
  "connector.blockers.loading": {"zh-CN": "正在检查占用…", "en": "Checking blockers…"},
  "connector.blockers.retry": {"zh-CN": "重试更新", "en": "Retry update"},
  "connector.blockers.refresh": {"zh-CN": "刷新", "en": "Refresh"},
  "connector.blockers.stopping": {"zh-CN": "正在终止", "en": "Stopping"},
  "connector.blockers.ended": {"zh-CN": "该执行已结束", "en": "This execution has ended"},
  "connector.blockers.unverified": {"zh-CN": "终止结果待核实，请刷新。", "en": "Stop result unconfirmed. Refresh to verify."},
  "connector.blockers.starting": {"zh-CN": "正在启动", "en": "Starting"},
  "connector.blockers.running": {"zh-CN": "运行中", "en": "Running"},
  "connector.blockers.dispatching": {"zh-CN": "正在派发", "en": "Dispatching"},
  "connector.blockers.unknown": {"zh-CN": "状态未知", "en": "Status unknown"},
  "connector.blockers.completed": {"zh-CN": "已完成", "en": "Completed"},
  "connector.blockers.failed": {"zh-CN": "已失败", "en": "Failed"},
  "connector.blockers.cancelled": {"zh-CN": "已取消", "en": "Cancelled"},
  "connector.blockers.execution": {"zh-CN": "执行编号", "en": "Execution ID"},
  "connector.update.dataFormat": { "zh-CN": "数据格式", en: "Data format" },
  "connector.update.updateProtocol": { "zh-CN": "更新协议", en: "Update protocol" },
  "connector.update.currentValue": { "zh-CN": "当前", en: "Current" },
  "connector.update.targetValue": { "zh-CN": "目标", en: "Target" },
  "connector.update.viewHistory": { "zh-CN": "查看更新记录", en: "View update record" },
  "connector.update.formatUnknown": { "zh-CN": "未知", en: "Unknown" },
  "connector.update.currentFormat": {
    "zh-CN": "实际数据格式",
    en: "Actual data format",
  },
  "connector.update.targetFormat": {
    "zh-CN": "目标数据格式",
    en: "Target data format",
  },
  "connector.update.currentProtocol": {
    "zh-CN": "当前更新协议",
    en: "Current update protocol",
  },
  "connector.update.targetProtocol": {
    "zh-CN": "目标更新协议",
    en: "Target update protocol",
  },
  "connector.update.compatible": {
    "zh-CN": "兼容检查通过；更新保留原数据，不自动备份或回滚。",
    en: "Compatibility checks passed. Updates preserve data without automatic backups or rollback.",
  },
  "connector.update.incompatible": {
    "zh-CN": "有目标发行包，但不能远程更新",
    en: "A target release is available, but remote update is blocked",
  },
  "connector.update.bootstrapHelp": {
    "zh-CN":
      "旧节点需一次完整引导升级；先结束任务并正常停止、备份，保留原身份与数据。后续兼容版本可在线更新。",
    en: "Older connectors need a one-time complete bootstrap upgrade. Finish tasks, stop normally and back up, preserving identity and data. Later compatible releases can update remotely.",
  },
  "connector.update.version": {
    "zh-CN": "连接器版本",
    en: "Connector version",
  },
  "connector.update.unreported": {
    "zh-CN": "未上报",
    en: "Not reported",
  },
  "connector.update.unknown": {
    "zh-CN": "连接器版本未知，建议升级",
    en: "Unknown connector version; update recommended",
  },
  "connector.update.different": {
    "zh-CN": "连接器非最新版本，建议升级",
    en: "Connector differs from latest; update recommended",
  },
  "connector.update.latest": {
    "zh-CN": "最新版本",
    en: "Latest version",
  },
  "connector.update.download": {
    "zh-CN": "下载新版连接器",
    en: "Download new connector",
  },
  "connector.update.noPackage": {
    "zh-CN": "当前平台暂无对应下载包",
    en: "No download available for this platform",
  },
  "connector.update.manual": {
    "zh-CN": "手动升级前停止连接器，完整解压新版并保留原数据目录、身份与配置。",
    en: "Before a manual update, stop the connector and fully extract the new package. Keep the original data directory, identity and configuration.",
  },
  "connector.update.send": {
    "zh-CN": "下发最新版",
    en: "Deploy latest connector",
  },
  "connector.update.confirm": {
    "zh-CN": "确认下发",
    en: "Confirm update",
  },
  "connector.update.cancel": {
    "zh-CN": "取消",
    en: "Cancel",
  },
  "connector.update.close": {
    "zh-CN": "关闭",
    en: "Close",
  },
  "connector.update.environment": {
    "zh-CN": "环境",
    en: "Environment",
  },
  "connector.update.current": {
    "zh-CN": "当前版本",
    en: "Current version",
  },
  "connector.update.target": {
    "zh-CN": "目标版本",
    en: "Target version",
  },
  "connector.update.size": {
    "zh-CN": "包大小",
    en: "Package size",
  },
  "connector.update.claudeOnDemand": {
    "zh-CN": "原先使用内置 Claude SDK 的环境，升级后需联网安装一次。请在该环境的本机控制台选择「安装 Claude 支持」，或运行 bugpaw-relay claude install。",
    en: "Environments that used the bundled Claude SDK need a one-time online installation after updating. Choose Install Claude support in the local connector console or run bugpaw-relay claude install.",
  },
  "connector.update.notice": {
    "zh-CN":
      "更新会短暂断连并保留原数据；不自动备份或回滚，启动失败需在环境端重新安装最新兼容完整包。切换期间请勿关闭环境或替换文件。",
    en: "The update briefly disconnects and preserves existing data. There is no automatic backup or rollback; startup failure requires reinstalling the latest compatible full package locally. Do not shut down or replace files during switching.",
  },
  "connector.update.continuing": {
    "zh-CN": "关闭页面不会取消更新；重新打开可继续查看。",
    en: "Closing this page does not cancel the update. Reopen it to view progress.",
  },
  "connector.update.offline": {
    "zh-CN": "浏览器离线，联网后请主动操作。",
    en: "Browser is offline. Reconnect and submit explicitly.",
  },
  "connector.update.unknownResult": {
    "zh-CN": "请求结果尚未确认，正在查询原操作。请勿重复创建更新。",
    en: "The request outcome is not confirmed. Checking the original operation; do not create another update.",
  },
  "connector.update.queryError": {
    "zh-CN": "暂时无法读取更新状态，保留最后确认结果并继续查询。",
    en: "Cannot read update status yet. Keeping the last confirmed result and continuing to check.",
  },
  "connector.update.recheck": {
    "zh-CN": "查询原操作",
    en: "Check original operation",
  },
  "connector.update.resend": {
    "zh-CN": "重发原请求",
    en: "Resend original request",
  },
  "connector.update.retry": {
    "zh-CN": "重新确认并重试",
    en: "Review and retry",
  },
  "connector.update.operation": {
    "zh-CN": "操作编号",
    en: "Operation ID",
  },
  "connector.update.actual": {
    "zh-CN": "实际版本",
    en: "Actual version",
  },
  "connector.update.last": {
    "zh-CN": "最后确认状态",
    en: "Last confirmed state",
  },
  "connector.update.updated": {
    "zh-CN": "最后确认时间",
    en: "Last confirmed time",
  },
  "connector.update.failedRequest": {
    "zh-CN": "请求未能完成，请刷新环境后重试。",
    en: "The request could not be completed. Refresh the environment and try again.",
  },
  "connector.update.changed": {
    "zh-CN": "发行目标或当前版本已变化，请关闭后重新确认。",
    en: "The release target or current version changed. Close and review again.",
  },
  "connector.update.accepted": {
    "zh-CN": "已受理",
    en: "Accepted",
  },
  "connector.update.prechecking": {
    "zh-CN": "预检查中",
    en: "Prechecking",
  },
  "connector.update.downloading": {
    "zh-CN": "下载中",
    en: "Downloading",
  },
  "connector.update.verifying": {
    "zh-CN": "校验中",
    en: "Verifying",
  },
  "connector.update.installing": {
    "zh-CN": "安装中",
    en: "Installing",
  },
  "connector.update.restarting": {
    "zh-CN": "重启中",
    en: "Restarting",
  },
  "connector.update.reconciling": {
    "zh-CN": "重连对账中",
    en: "Reconciling connection",
  },
  "connector.update.previousRootInvalid": {
    "zh-CN": "旧安装目录必须使用绝对路径。",
    en: "The previous installation directory must be an absolute path.",
  },
  "connector.update.recovered": {
    "zh-CN": "已由人工安装恢复",
    en: "Recovered by manual installation",
  },
  "connector.update.succeeded": {
    "zh-CN": "更新成功",
    en: "Update succeeded",
  },
  "connector.update.failed": {
    "zh-CN": "更新失败（未切换）",
    en: "Update failed (not switched)",
  },
  "connector.update.rolling_back": {
    "zh-CN": "正在回滚",
    en: "Rolling back",
  },
  "connector.update.rolled_back": {
    "zh-CN": "已回滚",
    en: "Rolled back",
  },
  "connector.update.recovery_required": {
    "zh-CN": "待恢复，请检查本机状态",
    en: "Recovery required; check the local environment",
  },
  "connector.update.IDEMPOTENCY_CONFLICT": {
    "zh-CN": "操作编号冲突，请刷新环境并核实原操作。",
    en: "Operation ID conflict. Refresh and check the original operation.",
  },
  "connector.update.ENVIRONMENT_OFFLINE": {
    "zh-CN": "环境离线，请连接后重试",
    en: "Environment is offline. Reconnect and retry.",
  },
  "connector.update.REVOKED": {
    "zh-CN": "环境身份已撤销",
    en: "Environment identity has been revoked.",
  },
  "connector.update.UPDATE_UNSUPPORTED": {
    "zh-CN": "请手动更新一次完整连接器以启用远程更新",
    en: "Manually install the full connector once to enable remote updates.",
  },
  "connector.update.UNMANAGED_INSTALL": {
    "zh-CN": "安装目录不支持安全更新，请检查数据目录与安装方式",
    en: "Installation cannot be updated safely. Check the data directory and installation method.",
  },
  "connector.update.ENVIRONMENT_BUSY": {
    "zh-CN": "环境正在执行或传输，请结束后重试",
    en: "Environment is executing or transferring data. Retry after it finishes.",
  },
  "connector.update.UPDATE_IN_PROGRESS": {
    "zh-CN": "已有更新正在处理",
    en: "An update is already in progress.",
  },
  "connector.update.TARGET_CHANGED": {
    "zh-CN": "发行目标或当前版本已变化，请刷新后重新确认",
    en: "The target or current version changed. Refresh and review again.",
  },
  "connector.update.ALREADY_CURRENT": {
    "zh-CN": "已是当前服务端发行版本",
    en: "Already running the current server release.",
  },
  "connector.update.PACKAGE_UNAVAILABLE": {
    "zh-CN": "当前完整发行包不可用",
    en: "The complete release package is unavailable.",
  },
  "connector.update.INCOMPATIBLE_PACKAGE": {
    "zh-CN": "发行包不兼容安全更新协议",
    en: "Package is incompatible with the safe update protocol.",
  },
  "connector.update.DOWNLOAD_UNAUTHORIZED": {
    "zh-CN": "更新下载授权无效",
    en: "Update download authorization is invalid.",
  },
  "connector.update.DOWNLOAD_EXPIRED": {
    "zh-CN": "更新下载授权已过期",
    en: "Update download authorization expired.",
  },
  "connector.update.CHECKSUM_MISMATCH": {
    "zh-CN": "发行包大小或摘要不匹配，原版本未改变",
    en: "Package size or digest mismatch. Original version unchanged.",
  },
  "connector.update.UNSAFE_ARCHIVE": {
    "zh-CN": "归档结构不安全，已拒绝安装",
    en: "Unsafe archive rejected.",
  },
  "connector.update.INSUFFICIENT_SPACE": {
    "zh-CN": "安装磁盘空间不足",
    en: "Insufficient installation disk space.",
  },
  "connector.update.INSTALL_PERMISSION_DENIED": {
    "zh-CN": "安装目录不可写",
    en: "Installation directory is not writable.",
  },
  "connector.update.RESTART_FAILED": {
    "zh-CN": "启动未确认，请检查环境端；必要时重装最新兼容完整包并保留原数据",
    en: "Startup is unconfirmed. Check the environment; if necessary, reinstall the latest compatible full package with the original data.",
  },
  "connector.update.DATA_FORMAT_INCOMPATIBLE": {
    "zh-CN": "当前与目标数据格式不同；请停机备份并按迁移指引处理。",
    en: "Current and target data formats differ. Stop, back up, and follow the migration guide.",
  },
  "connector.update.ROLLBACK_UNSAFE": {
    "zh-CN": "持久化读写契约不一致，无法保证无损回滚；请查看诊断并联系维护者。",
    en: "Persistence contracts differ; lossless rollback cannot be guaranteed. Check diagnostics and contact the maintainer.",
  },
  "connector.update.UPDATE_PROTOCOL_UNSUPPORTED": {
    "zh-CN": "目标更新协议不受支持；需要支持该协议的引导版本。",
    en: "The target update protocol is unsupported. Install a bootstrap supporting that protocol.",
  },
  "connector.update.COMPATIBILITY_UNKNOWN": {
    "zh-CN": "兼容声明缺失、损坏或无法识别；请查看诊断，不能安全远程更新。",
    en: "Compatibility metadata is missing, invalid, or unknown. Check diagnostics; remote update is unsafe.",
  },
  "connector.update.COMPATIBILITY_CONFLICT": {
    "zh-CN": "发行数据格式与兼容声明冲突；请联系发行维护者。",
    en: "The release data format conflicts with its compatibility declaration. Contact the release maintainer.",
  },
  "connector.update.BOOTSTRAP_REQUIRED": {
    "zh-CN":
      "当前节点或恢复引导器不支持本次更新；请正常停止、备份并手工安装完整引导包。",
    en: "The connector or recovery bootstrap cannot support this update. Stop normally, back up, and manually install the complete bootstrap package.",
  },
  "connector.update.PLATFORM_MISMATCH": {
    "zh-CN": "目标包不支持当前平台或架构；请检查发行包。",
    en: "The target package does not support this platform or architecture. Check the release package.",
  },
  "connector.update.ACTUAL_FORMAT_MISMATCH": {
    "zh-CN": "实际账本格式与当前程序声明不符；保留数据并检查本地诊断。",
    en: "The actual ledger format differs from the current release declaration. Preserve the data and check local diagnostics.",
  },
  "connector.update.rollback_reconciling": {
    "zh-CN": "旧版本已恢复健康，等待认证重连对账",
    en: "Previous version is healthy; awaiting authenticated reconciliation",
  },
  "connector.update.RECOVERY_REQUIRED": {
    "zh-CN":
      "尚未恢复连接，请检查环境端；必要时重新安装最新兼容完整包并保留原数据",
    en: "Connection has not recovered. Check the environment; if needed, reinstall the latest compatible full package and preserve the original data.",
  },
  "connector.update.DOWNLOAD_FAILED": {
    "zh-CN": "下载失败，原版本未改变",
    en: "Download failed. Original version unchanged.",
  },
  "connector.update.unavailable": {
    "zh-CN": "更新不可用",
    en: "Update unavailable.",
  },
  "artifacts.uploadFailed": {
    "zh-CN": "产物上传失败，请检查文件或服务端空间后重试",
    en: "Artifact upload failed. Check the file or server disk space and try again.",
  },
  "connector.worker.revokeFailed": {
    "zh-CN": "身份已撤销，部分运行时终止异常，请检查本机进程",
    en: "Identity revoked. Some runtimes could not be stopped. Check local processes.",
  },
  "connector.worker.authenticationFailed": {
    "zh-CN": "连接认证失败",
    en: "Connection authentication failed.",
  },
  "connector.worker.offline": {
    "zh-CN": "暂时无法连接服务端",
    en: "Cannot connect to the server at the moment.",
  },
  "board.flowArchived": {
    "zh-CN": "归档看板的流程只读。",
    en: "An archived board's flow is read-only.",
  },
  "board.flowOccupied": {
    "zh-CN": "{stage} 有在途工作项，须保留该阶段及其类型。",
    en: "{stage} has work in progress. Keep the stage and its type.",
  },
  "board.flowExit": {
    "zh-CN": "{stage} 有在途工作项，须保留出口 {stage} → {target}。",
    en: "{stage} has work in progress. Keep the transition {stage} → {target}.",
  },
  "board.flowPath": {
    "zh-CN": "此修改会切断 {stage} 中在途工作项的完成路径。",
    en: "This change would cut off the path to completion for work in {stage}.",
  },
  "board.flowBlocked": {
    "zh-CN":
      "存在 {count} 个未完成且未归档的工作项，或看板已归档，暂不可编辑流程",
    en: "The flow cannot be edited: {count} unfinished, unarchived work items remain, or the board is archived.",
  },
  "workbench.interrupted": {
    "zh-CN": "服务重启中断了模型请求；已执行工具记录保留，请检查后继续。",
    en: "The server restart interrupted the model request. Executed tool records are retained; review them before continuing.",
  },
  "workbench.cancelled": {
    "zh-CN": "运行已取消",
    en: "The run was cancelled.",
  },
  "workbench.modelFailed": {
    "zh-CN": "模型调用失败，请检查端点、模型及参数；已执行工具不会自动重放。",
    en: "The model request failed. Check the endpoint, model, and parameters. Executed tools will not be replayed automatically.",
  },
  "connector.execution.recoveryLimited": {
    "zh-CN":
      "已保留受损执行的可用记录，但无法确认原生执行结果或归属；不会自动重放。",
    en: "Available records of the damaged execution were retained, but its native outcome or ownership cannot be confirmed. It will not be replayed automatically.",
  },
  "connector.execution.interrupted": {
    "zh-CN": "连接器重启，原生执行状态不再可确认；不会自动重放。",
    en: "The connector restarted. Native execution status can no longer be confirmed; execution will not be replayed automatically.",
  },
  "connector.history.failed": {
    "zh-CN": "环境原生历史读取失败，仅显示事件缓冲。",
    en: "Could not read native environment history. Only buffered events are shown.",
  },
  "board.copyName": { "zh-CN": "{name} 副本", en: "{name} copy" },
  "connector.session.defaultTitle": { "zh-CN": "新会话", en: "New session" },
  "connector.runtime.capabilitiesUnavailable": {
    "zh-CN":
      "端点未提供模型能力信息；原生列表不保证当前端点可用，可手动输入模型 ID。",
    en: "The endpoint did not provide model capabilities. Native models may not work with this endpoint; you can enter a model ID manually.",
  },
  "connector.mentions.skillsUnavailable": {
    "zh-CN": "Skill 清单暂时不可用，请检查环境端运行时后重试",
    en: "The skill list is unavailable. Check the environment runtime and try again.",
  },
  "connector.mentions.environmentUnavailable": {
    "zh-CN": "暂时无法搜索环境中的 Skill、文件和文件夹。请稍后重试。",
    en: "Skills, files and folders could not be searched. Try again shortly.",
  },
  "connector.mentions.scanLimit": {
    "zh-CN": "当前连接器只搜索了部分文件和文件夹。请升级环境连接器以扩大搜索范围。",
    en: "This connector searched only some files and folders. Upgrade the environment connector to search more of your workspace.",
  },
  "connector.mentions.scanIncomplete": {
    "zh-CN": "文件和文件夹搜索未完成，结果可能不全。可输入 @docs/需求，将 docs/ 换成你的子目录，再加上文件名的一部分。",
    en: "File and folder search is incomplete. Try @docs/report, replacing docs/ with your subfolder and report with part of the name.",
  },
} as const;
