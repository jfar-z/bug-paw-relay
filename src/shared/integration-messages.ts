/** 同期集成功能统一接入双语资源，不改变原有导出契约。 */
export const integrationMessages = {
  "slash.noArguments": {"zh-CN":"此命令不接受参数，请单独发送命令名称。", en:"This command takes no arguments. Send only the command name."},
  "slash.noCache": {"zh-CN":"当前目录尚无成功获取的命令清单。", en:"No command list has been loaded for this directory."},
  "slash.stale": {"zh-CN":"命令或环境连接已变化，请刷新清单后重试。", en:"The command or environment connection changed. Refresh the list and retry."},
  "slash.unsupported": {"zh-CN":"当前接入方式不支持此命令。", en:"This command is unavailable through the current integration."},
  "slash.disabled": {"zh-CN":"当前范围未启用此命令。", en:"This command is disabled in the current scope."},
  "slash.noThread": {"zh-CN":"当前会话尚无可改名的原生记录。", en:"This session has no native conversation to rename yet."},
  "slash.renameFailed": {"zh-CN":"原生标题写入或回读失败，请刷新后重试。", en:"Could not write or verify the native title. Refresh and retry."},
  "slash.upgrade": {"zh-CN":"请升级环境连接器以使用斜杠命令。", en:"Upgrade the environment connector to use slash commands."},
  "slash.literal": {"zh-CN":"Claude 可能将此输入解释为命令，请在开头补充说明文字后发送。", en:"Claude may interpret this as a command. Add explanatory text at the beginning and resend."},
  "slash.attachments": {"zh-CN":"请先移除附件，或将附件另行发送。", en:"Remove the attachments first or send them separately."},
  "slash.notFound": {"zh-CN":"当前环境、项目和 CLI 下找不到匹配的会话。", en:"No matching session in this environment, project and CLI."},
  "slash.titleLength": {"zh-CN":"会话标题最多 200 个字符。", en:"Use at most 200 characters for a session title."},
  "connector.support.notRequired": {"zh-CN": "当前 Claude 模式无需 SDK。", "en": "The current Claude mode does not require the SDK."},
  "connector.support.unknown": {"zh-CN": "无法确认 SDK 状态，请在环境端检查后重新检测。", "en": "SDK status is unknown. Check the connector locally and refresh."},
  "connector.support.unconfirmed": {"zh-CN": "安装结果待确认。请在环境在线时重新检测。", "en": "Installation result is unconfirmed. Check again when the environment is online."},
  "connector.support.upgrade": {"zh-CN": "请升级连接器以在线安装 SDK，或在环境端手动安装。", "en": "Upgrade the connector for remote SDK installation or install it locally."},
  "connector.support.required": {"zh-CN": "请在该开发环境的连接器运行 bugpaw-relay claude install，完成后重试。", "en": "Run bugpaw-relay claude install on this development machine, then retry."},
  "connector.support.storage": {"zh-CN": "请检查连接器用户数据目录的写权限和可用空间。", "en": "Check write permissions and free space in the connector data directory."},
  "connector.support.path": {"zh-CN": "请修正配置的 Claude CLI 路径或清除该路径后重新检测。", "en": "Correct or clear the configured Claude CLI path and check again."},
  "connector.support.cliDownload": {"zh-CN": "从官方来源下载 CLI 安装器。若失败，请检查网络后重试。", "en": "Downloading the official CLI installer. If this fails, check the network and retry."},
  "connector.support.sdkDownload": {"zh-CN": "从 npm 下载锁定版本的 SDK。若失败，请检查网络后重试。", "en": "Downloading the pinned SDK from npm. If this fails, check the network and retry."},
  "connector.support.cliInstall": {"zh-CN": "运行官方安装器并检测 CLI 版本。若失败，请检查官方安装前提并重试。", "en": "Running the official installer and checking the CLI version. On failure, check the official prerequisites and retry."},
  "connector.support.integrity": {"zh-CN": "校验 SDK 的 SHA-512 摘要。校验失败时请重新下载。", "en": "Verifying SDK SHA-512 integrity. Download again if verification fails."},
  "connector.support.unpack": {"zh-CN": "解压并加载 SDK。若失败，请检查 tar、磁盘空间和写权限后重试。", "en": "Extracting and loading the SDK. On failure, check tar, free space and permissions, then retry."},
  "connector.support.busy": {"zh-CN": "另一个安装正在运行，请等待完成后重新检测。", "en": "Another installation is running. Wait for it to finish, then check again."},
  "connector.support.check": {"zh-CN": "正在检查组件。", "en": "Checking components."},
  "connector.support.usage": {"zh-CN": "使用 bugpaw-relay claude status 或 bugpaw-relay claude install。", "en": "Use bugpaw-relay claude status or bugpaw-relay claude install."},
  "connector.support.login": {"zh-CN": "CLI 已就绪。请在官方 Claude 客户端登录。", "en": "CLI ready. Sign in using the official Claude client."},
  "connector.support.endpoint": {"zh-CN": "组件已就绪。请在连接器配置并测试自定义端点和凭据。", "en": "Components ready. Configure and test your endpoint and credentials in the connector."},
  "board.stage.notStarted": { "zh-CN": "未开始", en: "Not started" },
  "board.stage.done": { "zh-CN": "已完成", en: "Done" },
  "board.stage.fixedStart": {
    "zh-CN": "固定人工起点",
    en: "Fixed human start",
  },
  "board.stage.fixedDone": {
    "zh-CN": "固定完成终点",
    en: "Fixed completion stage",
  },
  "validation.fixedStart": {
    "zh-CN": "必须保留唯一首位固定人工起点。",
    en: "Keep exactly one fixed human start stage in first position.",
  },
  "validation.stageNameKey": {
    "zh-CN": "默认名称标记与阶段角色或名称不一致；自定义名称请移除默认标记。",
    en: "The default name key does not match the stage role or name. Remove it for a custom name.",
  },
  "errors.START_IMMUTABLE": {
    "zh-CN": "必须保留原固定人工起点及其首位位置，不能删除、替换或改变类型。",
    en: "Keep the original fixed human start in first position. It cannot be deleted, replaced or changed to another type.",
  },
  "workItemCreation.ui.title": {
    "zh-CN": "新建工作项",
    en: "New work item",
  },
  "workItemCreation.ui.name": {
    "zh-CN": "标题",
    en: "Title",
  },
  "workItemCreation.ui.content": {
    "zh-CN": "需求内容",
    en: "Requirements",
  },
  "workItemCreation.ui.start": {
    "zh-CN": "起始阶段",
    en: "Start stage",
  },
  "workItemCreation.ui.priority": {
    "zh-CN": "优先级",
    en: "Priority",
  },
  "workItemCreation.ui.tags": {
    "zh-CN": "标签（逗号分隔）",
    en: "Tags (comma-separated)",
  },
  "workItemCreation.ui.low": {
    "zh-CN": "低",
    en: "Low",
  },
  "workItemCreation.ui.normal": {
    "zh-CN": "普通",
    en: "Normal",
  },
  "workItemCreation.ui.high": {
    "zh-CN": "高",
    en: "High",
  },
  "workItemCreation.ui.human": {
    "zh-CN": "人工",
    en: "Human",
  },
  "workItemCreation.ui.agent": {
    "zh-CN": "Agent",
    en: "Agent",
  },
  "workItemCreation.ui.done": {
    "zh-CN": "已完成",
    en: "Done",
  },
  "workItemCreation.ui.ask": {
    "zh-CN": "询问模式",
    en: "Ask mode",
  },
  "workItemCreation.ui.full": {
    "zh-CN": "完全权限",
    en: "Full access",
  },
  "workItemCreation.ui.default": {
    "zh-CN": "默认起点",
    en: "Default start",
  },
  "workItemCreation.ui.choose": {
    "zh-CN": "请选择起始阶段",
    en: "Select a start stage",
  },
  "workItemCreation.ui.loading": {
    "zh-CN": "正在读取流程…",
    en: "Loading workflow…",
  },
  "workItemCreation.ui.readFailed": {
    "zh-CN": "流程读取失败，草稿已保留，请重试",
    en: "Could not load the workflow. Your draft is retained; retry.",
  },
  "workItemCreation.ui.refresh": {
    "zh-CN": "读取最新流程",
    en: "Load latest workflow",
  },
  "workItemCreation.ui.review": {
    "zh-CN": "已读取最新流程，请核对阶段与权限后提交",
    en: "Latest workflow loaded. Review the stage and permissions before submitting.",
  },
  "workItemCreation.ui.missing": {
    "zh-CN": "看板不存在或已不可访问，请保留草稿并重新选择看板",
    en: "This board is missing or inaccessible. Keep your draft and choose another board.",
  },
  "workItemCreation.ui.uncertain": {
    "zh-CN":
      "创建结果尚未确认。草稿与原请求已保留，请联网后核实原创建，避免重复执行。",
    en: "Creation is not yet confirmed. The draft and original request are retained. Reconnect and check the original creation to avoid duplicate execution.",
  },
  "workItemCreation.ui.retry": {
    "zh-CN": "核实并重试原创建",
    en: "Check and retry original creation",
  },
  "workItemCreation.ui.submit": {
    "zh-CN": "创建工作项",
    en: "Create work item",
  },
  "workItemCreation.ui.busy": {
    "zh-CN": "正在创建…",
    en: "Creating…",
  },
  "workItemCreation.ui.close": {
    "zh-CN": "关闭",
    en: "Close",
  },
  "workItemCreation.ui.offline": {
    "zh-CN": "当前离线，草稿已保留，请联网后主动提交",
    en: "You are offline. Your draft is retained; submit after reconnecting.",
  },
  "workItemCreation.ui.failed": {
    "zh-CN": "创建被拒绝，草稿已保留。请检查输入和阶段配置后重试。",
    en: "Creation was rejected. Your draft is retained. Check the inputs and stage configuration before retrying.",
  },
  "workItemCreation.ui.created": {
    "zh-CN": "已创建工作项，起始阶段：{stage}",
    en: "Work item created. Start stage: {stage}",
  },
  "board.drag.hint": {
    "zh-CN": "鼠标拖动或触屏长按卡片推进；也可打开详情选择阶段。",
    en: "Drag with a mouse or hold a card on touch to advance. You can also choose a stage in details.",
  },
  "board.drag.drop": {
    "zh-CN": "松手推进到此阶段",
    en: "Release to advance here",
  },
  "board.drag.moving": {
    "zh-CN": "正在拖动",
    en: "Dragging",
  },
  "board.drag.pending": {
    "zh-CN": "正在推进…",
    en: "Advancing…",
  },
  "board.drag.blocked": {
    "zh-CN": "此工作项无法推进：已归档、阶段无效、已完成或当前执行尚未停止。",
    en: "Cannot advance: archived, invalid or completed stage, or an execution must be stopped first.",
  },
  "board.drag.optional": {
    "zh-CN": "交接记录（选填）",
    en: "Handoff record (optional)",
  },
  "board.drag.required": {
    "zh-CN": "交接记录（必填）",
    en: "Handoff record (required)",
  },
  "board.drag.empty": {
    "zh-CN": "未填写交接记录",
    en: "No handoff record provided",
  },
  "board.drag.changed": {
    "zh-CN": "工作项状态已变化，请刷新后重新操作。",
    en: "The work item changed. Refresh and try again.",
  },
  "board.drag.unknown": {
    "zh-CN": "推进结果尚未确认，请联网后重试；将核实状态并复用原操作。",
    en: "Advance result is unconfirmed. Reconnect and retry to check state and reuse the original operation.",
  },
  "board.drag.submit": {
    "zh-CN": "提交交接并推进",
    en: "Submit handoff and advance",
  },
  "board.drag.instruction": {
    "zh-CN": "选择目标后提交；人工阶段可不填写交接记录。",
    en: "Choose a target and submit. Handoff records are optional for human stages.",
  },
  "workItemCreation.INVALID_START_STAGE": {
    "zh-CN": "起始阶段已失效，请刷新流程并重新选择",
    en: "The start stage is invalid. Refresh the workflow and select a stage again.",
  },
  "workItemCreation.BOARD_VERSION_CONFLICT": {
    "zh-CN": "看板配置已变更，请核对最新流程后重新提交",
    en: "The board configuration changed. Review the latest workflow before submitting again.",
  },
  "workItemCreation.NO_START_STAGE": {
    "zh-CN": "流程没有有效默认起点，请检查流程配置",
    en: "The workflow has no valid default start stage. Check its configuration.",
  },
  "workItemCreation.IDEMPOTENCY_CONFLICT": {
    "zh-CN": "操作标识已用于其他创建参数，请核实原操作结果",
    en: "The operation ID was used with different parameters. Check the original result.",
  },
  "workItemCreation.human": {
    "zh-CN": "创建后等待人工推进",
    en: "Wait for manual advancement after creation",
  },
  "workItemCreation.agent": {
    "zh-CN": "创建后将按此阶段配置自动执行",
    en: "Automatically execute using this stage's configuration after creation",
  },
  "workItemCreation.done": {
    "zh-CN": "创建后直接标记为已完成，不启动 Agent",
    en: "Mark as done immediately without starting an Agent",
  },
  "connector.storage.STORAGE_UNAVAILABLE": {
    "zh-CN": "环境存储不可用，执行已停止；请检查连接器诊断日志。",
    en: "Environment storage is unavailable. Execution has stopped; check connector diagnostics.",
  },
  "connector.storage.ENGINE_UNAVAILABLE": {
    "zh-CN": "执行引擎不可用，请检查连接器并查询原操作状态。",
    en: "The execution engine is unavailable. Check the connector and query the original operation.",
  },
  "connector.storage.ENGINE_TIMEOUT": {
    "zh-CN": "执行引擎响应超时，请查询原操作状态，勿重复提交。",
    en: "The execution engine timed out. Query the original operation; do not submit it again.",
  },
  "connector.storage.ENGINE_FAILURE": {
    "zh-CN": "执行引擎处理失败，请检查连接器诊断日志。",
    en: "The execution engine failed. Check connector diagnostics.",
  },
  "connector.storage.ENGINE_BUSY": {
    "zh-CN": "执行引擎请求过多，请稍后查询原操作状态。",
    en: "The execution engine has too many requests. Query the original operation later.",
  },
  "connector.storage.SHUTDOWN_FAILED": {
    "zh-CN": "关闭刷新失败，请检查连接器诊断日志。",
    en: "Shutdown could not flush storage. Check connector diagnostics.",
  },
  "handoff.ITEM_ADVANCE_CONFLICT": {
    "zh-CN": "工作项状态已变化，请刷新后重新选择目标阶段",
    en: "Work item state has changed; refresh and select the target stage again",
  },
} as const;
