/** 两套界面的产品文案使用稳定语义键；用户内容不进入资源表。 */
export const webMessages = {
  "web.boardCard.open": {"zh-CN": "打开工作项", "en": "Open work item"},
  "web.boardCard.acceptance": {"zh-CN": "验收条件", "en": "Acceptance criteria"},
  "web.boardCard.target": {"zh-CN": "材料目的地", "en": "Material destination"},
  "web.boardCard.queue": {"zh-CN": "进入 Agent 队列", "en": "Queue for agent execution"},
  "web.boardCard.manual": {"zh-CN": "等待人工处理", "en": "Wait for manual action"},
  "web.boardCard.pendingCard": {"zh-CN": "工作项已处理，卡片待补交。", "en": "Work item processed. Card delivery is pending."},
  "web.boardCard.unavailable": {"zh-CN": "此看板已不可用。", "en": "This board is unavailable."},
  "web.commands.title": {"zh-CN": "命令", "en": "Commands"},
  "web.commands.refresh": {"zh-CN": "刷新命令清单", "en": "Refresh commands"},
  "web.commands.noProject": {"zh-CN": "登记并选择项目目录后可获取原生命令。", "en": "Register and select a project directory to discover native commands."},
  "web.commands.rename": {"zh-CN": "重命名当前会话", "en": "Rename this session"},
  "web.commands.resume": {"zh-CN": "切换到历史会话", "en": "Switch to an existing session"},
  "web.commands.model": {"zh-CN": "选择下一轮使用的模型", "en": "Choose the model for the next turn"},
  "web.commands.new": {"zh-CN": "在当前目录新建会话", "en": "Start a session in this directory"},
  "web.commands.renameHint": {"zh-CN": "[新标题]", "en": "[new title]"},
  "web.commands.resumeHint": {"zh-CN": "[会话名称或 ID]", "en": "[session title or ID]"},
  "web.commands.managed": {"zh-CN": "Relay 接管", "en": "Managed by Relay"},
  "web.commands.project": {"zh-CN": "当前项目目录", "en": "Current project directory"},
  "web.commands.builtin": {"zh-CN": "环境内置命令", "en": "Environment built-in"},
  "web.commands.allow": {"zh-CN": "放行 /{name}", "en": "Allow /{name}"},
  "web.commands.unavailable": {"zh-CN": "当前接入方式不支持执行此命令。", "en": "Execution is unavailable through this integration."},
  "web.commands.literal": {"zh-CN": "作为普通文本发送", "en": "Send as plain text"},
  "web.commands.empty": {"zh-CN": "没有匹配的可用命令", "en": "No matching available commands"},
  "web.commands.keys": {"zh-CN": "↑ ↓ 选择 · Tab 补全", "en": "↑ ↓ to choose · Tab to complete"},
  "web.commands.failed": {"zh-CN":"命令执行失败，已保留草稿。请查看会话中的执行记录。", "en":"The command failed. Your draft is available. See the execution details in this session."},
  "web.commands.recover": {"zh-CN": "恢复失败命令的草稿", "en": "Restore failed command draft"},
  "web.avatarPreset.choose": { "zh-CN": "选择预设头像", en: "Choose a preset avatar" },
  "web.avatarPreset.unavailable": { "zh-CN": "暂不可选", en: "Unavailable" },
  "web.avatarPreset.loading": { "zh-CN": "加载中", en: "Loading" },
  "web.avatarPreset.bug": { "zh-CN": "BUG", en: "BUG" },
  "web.avatarPreset.deepseek-chibi-bowl": { "zh-CN": "铁盆 DS", en: "DeepSeek Basin Chibi" },
  "web.avatarPreset.deepseek": { "zh-CN": "DeepSeek 鲸鱼娘", en: "DeepSeek Whale Girl" },
  "web.avatarPreset.gpt": { "zh-CN": "GPT 白龙娘", en: "GPT White Dragon Girl" },
  "web.avatarPreset.claude": { "zh-CN": "Claude 大小姐", en: "Claude Lady" },
  "web.avatarPreset.gemini": { "zh-CN": "Gemini 娘", en: "Gemini Girl" },
  "web.avatarPreset.qwen": { "zh-CN": "通义千问娘", en: "Qwen Girl" },
  "web.avatarPreset.grok": { "zh-CN": "Grok 娘", en: "Grok Girl" },
  "web.avatarPreset.glm": { "zh-CN": "GLM 智谱娘", en: "GLM Girl" },
  "web.avatarPreset.kimi": { "zh-CN": "Kimi 娘", en: "Kimi Girl" },
  "web.avatarPreset.minimax": { "zh-CN": "MiniMax 娘", en: "MiniMax Girl" },
  "web.avatarPreset.doubao": { "zh-CN": "豆包／Seed 娘", en: "Doubao / Seed Girl" },
  "web.avatarPreset.hunyuan": { "zh-CN": "腾讯混元娘", en: "Hunyuan Girl" },
  "web.avatarPreset.mimo": { "zh-CN": "小米 MiMo 娘", en: "Xiaomi MiMo Girl" },
  "web.avatarPreset.product-manager": { "zh-CN": "产品经理", en: "Product Manager" },
  "web.avatarPreset.frontend": { "zh-CN": "前端开发", en: "Frontend Developer" },
  "web.avatarPreset.backend": { "zh-CN": "后端开发", en: "Backend Developer" },
  "web.avatarPreset.ui-designer": { "zh-CN": "UI 设计师", en: "UI Designer" },
  "web.avatarPreset.qa": { "zh-CN": "测试工程师", en: "QA Engineer" },
  "web.avatarPreset.devops": { "zh-CN": "运维工程师", en: "DevOps Engineer" },
  "web.avatarPreset.tech-lead": { "zh-CN": "技术负责人", en: "Technical Lead" },
  "web.agentOrder.handle": { "zh-CN": "拖动 {name} 排序，或使用方向键上移、下移", en: "Drag {name} to reorder, or use arrow keys to move up or down" },
  "web.agentOrder.filtered": { "zh-CN": "在「全部」中清空搜索即可调整顺序。", en: "Select All and clear the search to reorder agents." },
  "web.agentPicker.backToCli": { "zh-CN": "返回 CLI 列表", en: "Back to CLI list" },
  "web.agentPicker.back": { "zh-CN": "返回智能体列表", en: "Back to agents" },
  "web.agentPicker.empty": { "zh-CN": "暂无适用的智能体，请先创建智能体。", en: "No compatible agents. Create an agent to continue." },
  "web.agentPicker.directory": { "zh-CN": "请先为项目登记执行目录。", en: "Register a project directory first." },
  "web.sdk.install": {"zh-CN": "在线安装 SDK", "en": "Install SDK online"},
  "web.sdk.installed": {"zh-CN": "SDK 已安装", "en": "SDK installed"},
  "web.sdk.installing": {"zh-CN": "正在安装 Claude Agent SDK…", "en": "Installing Claude Agent SDK…"},
  "web.sdk.target": {"zh-CN": "在「{name}」安装 Claude Agent SDK {version}", "en": "Install Claude Agent SDK {version} on “{name}”"},
  "web.sdk.check": {"zh-CN": "重新检测 SDK", "en": "Check SDK again"},
  "web.sdk.offline": {"zh-CN": "环境离线，连接后可在线安装 SDK。", "en": "Environment offline. Reconnect to install the SDK online."},
  "web.claudeSdkMissing": {
    "zh-CN": "SDK 未安装",
    en: "SDK not installed",
  },
  "web.claudeSdkInstallHelp": {
    "zh-CN": "在该开发环境的连接器本机控制台选择「安装 Claude 支持」，或在该环境运行 bugpaw-relay claude install，完成后重试原操作。",
    en: "Choose “Install Claude support” in the connector’s local console, or run bugpaw-relay claude install on that development machine. Then retry the original operation.",
  },
  "web.native.screenReader": {
    "zh-CN": "屏幕阅读器",
    en: "Screen reader",
  },
  "web.native.title": {
    "zh-CN": "Claude Code 终端",
    en: "Claude Code terminal",
  },
  "web.native.open": {
    "zh-CN": "打开 Claude Code",
    en: "Open Claude Code",
  },
  "web.native.reconnect": {
    "zh-CN": "重新连接终端",
    en: "Reconnect terminal",
  },
  "web.native.end": {
    "zh-CN": "结束终端",
    en: "End terminal",
  },
  "web.native.confirmEnd": {
    "zh-CN": "结束会关闭环境中的 Claude Code，并中断正在执行的任务。",
    en: "Ending closes Claude Code in the environment and interrupts its current task.",
  },
  "web.native.permission": {
    "zh-CN": "Claude Code 原生审批",
    en: "Native Claude Code approvals",
  },
  "web.native.keys": {
    "zh-CN": "终端按键",
    en: "Terminal keys",
  },
  "web.native.up": {
    "zh-CN": "↑",
    en: "\u2191",
  },
  "web.native.down": {
    "zh-CN": "↓",
    en: "\u2193",
  },
  "web.native.tab": {
    "zh-CN": "Tab",
    en: "Tab",
  },
  "web.native.enter": {
    "zh-CN": "回车",
    en: "Enter",
  },
  "web.native.escape": {
    "zh-CN": "Esc",
    en: "Esc",
  },
  "web.native.interrupt": {
    "zh-CN": "中断 (Ctrl+C)",
    en: "Interrupt (Ctrl+C)",
  },
  "web.native.hint": {
    "zh-CN": "在终端内键入，按 F6 返回操作区。离开页面后，终端继续在环境中运行。如需登录，请在环境机器上操作。",
    en: "Type in the terminal and press F6 to return to the controls. The terminal keeps running when you leave the page. Sign in on the environment machine.",
  },
  "web.native.gap": {
    "zh-CN": "早期输出已滚出缓冲区，正在显示保留的输出。",
    en: "Earlier output has rolled out of the buffer. Showing the retained output.",
  },
  "web.native.inputUncertain": {
    "zh-CN": "输入回执未确认。重新连接后，请查看终端状态再继续。",
    en: "Input delivery is unconfirmed. Reconnect and check the terminal before continuing.",
  },
  "web.native.inputTooLarge": {
    "zh-CN": "待发送输入过长，请分段粘贴。",
    en: "The pending input is too long. Paste it in smaller chunks.",
  },
  "web.native.status.idle": {
    "zh-CN": "待打开",
    en: "Ready to open",
  },
  "web.native.status.opening": {
    "zh-CN": "正在打开终端…",
    en: "Opening terminal\u2026",
  },
  "web.native.status.attached": {
    "zh-CN": "终端已连接",
    en: "Terminal connected",
  },
  "web.native.status.detached": {
    "zh-CN": "终端连接已断开",
    en: "Terminal disconnected",
  },
  "web.native.status.closing": {
    "zh-CN": "正在结束终端…",
    en: "Ending terminal\u2026",
  },
  "web.native.status.closed": {
    "zh-CN": "终端已结束",
    en: "Terminal ended",
  },
  "web.native.status.offline": {
    "zh-CN": "环境离线。联网后可重新连接。",
    en: "The environment is offline. Reconnect when it returns.",
  },
  "web.native.status.disabled": {
    "zh-CN": "此会话的终端当前不可用。",
    en: "The terminal for this session is unavailable.",
  },
  "light.delete": { "zh-CN": "永久删除", en: "Delete permanently" },
  "light.deleted": { "zh-CN": "已删除", en: "Deleted" },
  "light.deleteScope": { "zh-CN": "将撤销托管访问并永久清除全部 {count} 个版本的文件及反馈。此操作无法通过产品恢复。", en: "Hosted access will be revoked. Files and feedback for all {count} versions will be permanently removed. This cannot be undone in the app." },
  "light.unlistScope": { "zh-CN": "将撤销全部 {count} 个版本的托管访问，保留历史和反馈。可从轻应用管理页恢复上架。", en: "Hosted access to all {count} versions will be revoked. History and feedback will be kept. Restore the listing from the Light apps page." },
  "light.confirmations": { "zh-CN": "轻应用操作确认", en: "Light app confirmations" },
  "light.reviewDelete": { "zh-CN": "查看永久删除范围", en: "Review permanent deletion" },
  "light.reviewUnlist": { "zh-CN": "查看下架范围", en: "Review unlisting" },
  "light.reloadScope": { "zh-CN": "重新读取范围", en: "Reload scope" },
  "light.cleanupPending": { "zh-CN": "待清理", en: "Cleanup pending" },
  "light.cleanupHelp": { "zh-CN": "托管访问已撤销，清理尚未完成。可重试清理，或之后从轻应用管理页的已下架列表继续。", en: "Hosted access has been revoked. Cleanup is incomplete. Retry cleanup here or continue later from the unlisted apps list." },
  "light.retryCleanup": { "zh-CN": "重试清理", en: "Retry cleanup" },
  "light.cancelled": { "zh-CN": "已取消", en: "Cancelled" },
  "light.submitting": { "zh-CN": "正在提交操作…", en: "Submitting…" },
  "light.title": { "zh-CN": "轻应用", en: "Light apps" },
  "light.listed": { "zh-CN": "已上架", en: "Listed" },
  "light.unlisted": { "zh-CN": "已下架", en: "Unlisted" },
  "light.emptyListed": { "zh-CN": "暂无已上架的轻应用", en: "No listed light apps" },
  "light.emptyUnlisted": { "zh-CN": "暂无已下架的轻应用", en: "No unlisted light apps" },
  "light.unlist": { "zh-CN": "下架", en: "Unlist" },
  "light.restore": { "zh-CN": "恢复上架", en: "Restore listing" },
  "light.versions": { "zh-CN": "历史版本", en: "Version history" },
  "light.publications": { "zh-CN": "已发布的轻应用", en: "Published light apps" },
  "light.publicationDetails": { "zh-CN": "发布详情", en: "Publication details" },
  "light.loadingPublications": { "zh-CN": "正在读取轻应用发布记录…", en: "Loading light app publications…" },
  "light.open": { "zh-CN": "打开", en: "Open" },
  "light.openVersion": { "zh-CN": "打开 {title} · 版本 {number}", en: "Open {title} \u00b7 Version {number}" },
  "light.version": { "zh-CN": "版本 {number}", en: "Version {number}" },
  "light.published": { "zh-CN": "发布时间", en: "Published" },
  "light.source": { "zh-CN": "来源", en: "Source" },
  "light.sourceMissing": { "zh-CN": "来源已不可用", en: "Source unavailable" },
  "light.sourceSession": { "zh-CN": "查看来源会话", en: "View source session" },
  "light.listError": { "zh-CN": "无法读取轻应用", en: "Could not load light apps" },
  "light.listingError": { "zh-CN": "未能更新上架状态，已重新查询当前状态。", en: "Could not update the listing. The current status has been requested again." },
  "light.viewerError": { "zh-CN": "无法打开轻应用", en: "Could not open the light app" },
  "light.confirm": { "zh-CN": "确认此版本", en: "Approve this version" },
  "light.change": { "zh-CN": "提出修改", en: "Request changes" },
  "light.changeNote": { "zh-CN": "修改意见", en: "Requested changes" },
  "light.submit": { "zh-CN": "提交反馈", en: "Submit feedback" },
  "light.saved": { "zh-CN": "反馈已提交", en: "Feedback submitted" },
  "light.selectionSaved": { "zh-CN": "选择已记录", en: "Selection recorded" },
  "light.feedback": { "zh-CN": "版本反馈", en: "Version feedback" },
  "light.confirmed": { "zh-CN": "已确认", en: "Approved" },
  "light.changeRecorded": { "zh-CN": "修改意见", en: "Changes requested" },
  "light.selection": { "zh-CN": "应用内选择", en: "In-app selection" },
  "web.plainTextCode": { "zh-CN": "纯文本", en: "Plain text" },
  "web.copyCode": { "zh-CN": "复制代码", en: "Copy code" },
  "web.codeCopied": { "zh-CN": "已复制代码", en: "Code copied" },
  "web.codeCopyFailed": {
    "zh-CN": "复制失败，请选中代码手动复制。",
    en: "Could not copy. Select the code to copy it manually.",
  },
  "web.flowStart": { "zh-CN": "固定起点", en: "Fixed start" },
  "web.flowEnd": { "zh-CN": "固定终点", en: "Fixed end" },
  "web.flowCompleted": { "zh-CN": "完成阶段", en: "Completed stage" },
  "web.flowNoTargets": { "zh-CN": "无可达阶段", en: "No reachable stages" },
  "web.flowNoEnvironment": {
    "zh-CN": "未选择环境",
    en: "No environment selected",
  },
  "web.flowSave": { "zh-CN": "保存流程", en: "Save flow" },
  "web.flowCloseStage": {
    "zh-CN": "返回流程总览",
    en: "Back to flow overview",
  },
  "web.flowDiscard": {
    "zh-CN": "放弃未保存的流程修改？",
    en: "Discard unsaved flow changes?",
  },
  "web.flowDiscardAction": { "zh-CN": "放弃修改", en: "Discard changes" },
  "web.flowChecking": {
    "zh-CN": "正在检查流程编辑条件…",
    en: "Checking whether the flow can be edited\u2026",
  },
  "web.flowAdmissionFailed": {
    "zh-CN": "无法检查流程编辑条件。",
    en: "Could not check whether the flow can be edited.",
  },
  "web.flowBoardNameError": {
    "zh-CN": "请输入有效的看板名称。",
    en: "Enter a valid board name.",
  },
  "web.flowStageNameError": {
    "zh-CN": "请输入 1 至 80 个字符的阶段名称。",
    en: "Enter a stage name of 1 to 80 characters.",
  },
  "web.flowConcurrencyError": {
    "zh-CN": "并发上限必须是 1 至 16 的整数。",
    en: "Enter a whole number from 1 to 16.",
  },
  "web.flowInstructionsError": {
    "zh-CN": "阶段指令不能超过 40,000 个字符。",
    en: "Stage instructions must be 40,000 characters or fewer.",
  },
  "web.flowRuntimeError": {
    "zh-CN": "请选择执行环境已启用的编码工具。",
    en: "Select a coding tool enabled in the execution environment.",
  },
  "web.flowFieldError": {
    "zh-CN": "请检查并修正此配置。",
    en: "Review and correct this setting.",
  },
  "web.cliPolicyHelp": {
    "zh-CN": "平台开关保存在服务端，环境离线时也可以修改。",
    en: "The platform saves these settings on the server. You can change them while the environment is offline.",
  },
  "web.cliEnableTool": { "zh-CN": "启用 {tool}", en: "Enable {tool}" },
  "web.cliDisableTool": { "zh-CN": "禁用 {tool}", en: "Disable {tool}" },
  "web.cliEnabled": { "zh-CN": "已启用", en: "Enabled" },
  "web.cliDisabled": { "zh-CN": "已禁用", en: "Disabled" },
  "web.cliSettingsLoading": {
    "zh-CN": "正在加载编码工具设置",
    en: "Loading coding tool settings",
  },
  "web.cliSettingsSaving": {
    "zh-CN": "正在保存编码工具设置",
    en: "Saving coding tool settings",
  },
  "web.cliSettingsLoadFailed": {
    "zh-CN": "无法加载编码工具设置",
    en: "Could not load coding tool settings",
  },
  "web.cliSettingsSaveFailed": {
    "zh-CN": "无法保存编码工具设置",
    en: "Could not save coding tool settings",
  },
  "web.cliRemoveUnavailableChoices": {
    "zh-CN": "移除不可用的选择",
    en: "Remove unavailable choices",
  },
  "web.cliManageTools": { "zh-CN": "管理编码工具", en: "Manage coding tools" },
  "web.cliNoneEnabled": {
    "zh-CN": "没有可选的编码工具。请在环境详情中启用工具。",
    en: "No coding tools are available. Enable a tool in environment details.",
  },
  "web.cliBindingUnavailable": {
    "zh-CN": "已绑定的编码工具已禁用。",
    en: "The assigned coding tool is disabled.",
  },
  "web.cliQueuedBlocked": {
    "zh-CN": "编码工具已禁用，执行等待派发",
    en: "Coding tool disabled; execution is waiting to be dispatched",
  },

  "web.sessionDetails": { "zh-CN": "会话详情", en: "Session details" },
  "ui.searchOptions": { "zh-CN": "搜索选项", en: "Search options" },
  "ui.noOptions": { "zh-CN": "没有匹配选项", en: "No matching options" },
  "ui.fullPath": { "zh-CN": "查看完整路径", en: "View full path" },
  "ui.environmentSummary": {
    "zh-CN": "共 {total} 个环境 · {online} 个在线 · {pending} 个待审批",
    en: "Environments: {total} · Online: {online} · Pending approval: {pending}",
  },
  "ui.clearFilterHint": {
    "zh-CN": "当前筛选条件下没有结果，请尝试其他条件或清除筛选。",
    en: "No results match these filters. Try different conditions or clear filters.",
  },
  "ui.clearFilters": { "zh-CN": "清除筛选", en: "Clear filters" },
  "ui.title": { "zh-CN": "组件库", en: "Component library" },
  "ui.description": {
    "zh-CN": "与应用共用同一实现。这里的交互使用示例数据，不执行真实业务操作。",
    en: "The same components used by the application. Examples do not execute real operations.",
  },
  "ui.sections": { "zh-CN": "组件分类", en: "Component categories" },
  "ui.components": { "zh-CN": "基础组件", en: "Components" },
  "ui.layout": { "zh-CN": "页面布局", en: "Layouts" },
  "ui.content": { "zh-CN": "内容契约", en: "Content contracts" },
  "ui.stress": { "zh-CN": "超长内容", en: "Long content" },
  "ui.narrow": { "zh-CN": "320px 窄容器", en: "320px container" },
  "ui.longTitle": {
    "zh-CN":
      "示例：跨环境多项目协作平台的超长环境名称与组件库内容适配验证，不应撑开页面或挤走关键操作",
    en: "ExampleCrossEnvironmentWorkspaceWithAVeryLongUnbrokenNameForContentContractVerificationABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  },
  "ui.sampleEnvironment": {
    "zh-CN": "示例开发环境",
    en: "Example environment",
  },
  "ui.actions": { "zh-CN": "操作层级", en: "Actions" },
  "ui.settings": { "zh-CN": "设置", en: "Settings" },
  "ui.more": { "zh-CN": "更多操作", en: "More actions" },
  "ui.saved": { "zh-CN": "示例操作已完成", en: "Example action completed" },
  "ui.forms": { "zh-CN": "表单与选择", en: "Forms and selection" },
  "ui.nameHint": {
    "zh-CN": "填写容易辨认的名称。",
    en: "Choose a recognizable name.",
  },
  "ui.nameRequired": { "zh-CN": "请填写名称。", en: "Enter a name." },
  "ui.descriptionLabel": { "zh-CN": "职责说明", en: "Role instructions" },
  "ui.sampleDescription": {
    "zh-CN": "优先复用组件库的布局与控件。",
    en: "Reuse the shared layouts and controls.",
  },
  "ui.model": { "zh-CN": "模型", en: "Model" },
  "ui.agentControls": { "zh-CN": "Agent 图标控件", en: "Agent icon controls" },
  "ui.thinking": { "zh-CN": "思考深度", en: "Thinking depth" },
  "ui.low": { "zh-CN": "快速思考", en: "Quick reasoning" },
  "ui.medium": { "zh-CN": "标准思考", en: "Standard reasoning" },
  "ui.high": { "zh-CN": "深度思考", en: "Deep reasoning" },
  "ui.permission": { "zh-CN": "权限", en: "Permission" },
  "ui.demoOnly": {
    "zh-CN": "仅演示布局和交互，不调用模型、不修改真实数据。",
    en: "Layout and interaction example only. No model calls or changes to real data.",
  },
  "ui.feedback": { "zh-CN": "状态与反馈", en: "Status and feedback" },
  "ui.readFailed": { "zh-CN": "读取失败", en: "Unable to load" },
  "ui.failureHint": {
    "zh-CN": "你的输入已保留。请检查环境连接后重试。",
    en: "Your input is preserved. Check the environment connection and retry.",
  },
  "ui.fullText": { "zh-CN": "查看完整内容", en: "View full content" },
  "ui.attachments": { "zh-CN": "附件列表", en: "Attachments" },
  "ui.confirmDelete": {
    "zh-CN": "删除示例对象？",
    en: "Delete the example item?",
  },
  "ui.deleteHint": {
    "zh-CN": "这是不可撤销操作的交互示例；不会删除真实数据。",
    en: "This demonstrates an irreversible action. No real data will be deleted.",
  },
  "ui.exampleDialog": { "zh-CN": "示例对话框", en: "Example dialog" },
  "ui.done": { "zh-CN": "完成", en: "Done" },
  "web.sessionConfiguration": {
    "zh-CN": "会话配置",
    en: "Session configuration",
  },
  "attachments.invalidFile": {
    "zh-CN":
      "无法添加 {name}：单文件最多 128 MB，文件名最多 240 字符且不可含路径或控制字符。",
    en: "Cannot add {name}: maximum 128 MB per file; names must be at most 240 characters without paths or control characters.",
  },
  "attachments.add": { "zh-CN": "添加附件", en: "Add attachments" },
  "attachments.list": {
    "zh-CN": "本条消息的附件",
    en: "Attachments for this message",
  },
  "attachments.queued": { "zh-CN": "等待上传", en: "Queued" },
  "attachments.uploading": { "zh-CN": "正在上传", en: "Uploading" },
  "attachments.ready": { "zh-CN": "已就绪", en: "Ready" },
  "attachments.failed": { "zh-CN": "上传失败", en: "Upload failed" },
  "attachments.retry": {
    "zh-CN": "重新上传 {name}",
    en: "Retry upload: {name}",
  },
  "attachments.remove": {
    "zh-CN": "取消或移除 {name}",
    en: "Cancel or remove: {name}",
  },
  "attachments.wait": {
    "zh-CN": "请等待附件完成，或重试／移除失败项后发送。",
    en: "Wait for uploads to finish, or retry / remove failed files before sending.",
  },
  "attachments.limits": {
    "zh-CN":
      "无法添加所选文件：每条消息最多 16 个，单文件不超过 128 MB，合计不超过 256 MB；文件名最长 240 字符且不可含路径或控制字符。",
    en: "Cannot add selected files: up to 16 per message, 128 MB each and 256 MB total. Names must be at most 240 characters without paths or control characters.",
  },
  "attachments.noDirectories": {
    "zh-CN": "不支持上传目录，请选择文件。",
    en: "Folder uploads are not supported. Select files instead.",
  },
  "web.backToAllBoards": {
    "zh-CN": "返回全部看板",
    en: "Back to all boards",
  },
  "web.youAreOfflineYourDraftIsKeptSendIt": {
    "zh-CN": "当前离线，草稿已保留，请联网后主动发送",
    en: "You are offline. Your draft is kept; send it when you reconnect.",
  },
  "web.yourLoginHasExpiredPleaseSignInAgain": {
    "zh-CN": "登录已失效，请重新登录",
    en: "Your login has expired. Please sign in again.",
  },
  "web.theServiceIsTemporarilyUnavailablePleaseTryAgainLater": {
    "zh-CN": "服务暂时不可用，请稍后重试",
    en: "The service is temporarily unavailable. Please try again later.",
  },
  "web.theServiceReturnedUnexpectedDataPleaseTryAgainLater": {
    "zh-CN": "服务返回了非预期数据，请稍后重试",
    en: "The service returned unexpected data. Please try again later.",
  },
  "web.requestFailedPleaseTryAgainLater": {
    "zh-CN": "请求失败，请稍后重试",
    en: "Request failed. Please try again later.",
  },
  "web.you": {
    "zh-CN": "你",
    en: "You",
  },
  "web.uploadAvatarPngJpegWebp": {
    "zh-CN": "上传头像（PNG / JPEG / WebP）",
    en: "Upload avatar (PNG / JPEG / WebP)",
  },
  "web.chooseAPngJpegOrWebpImage": {
    "zh-CN": "请选择 PNG、JPEG 或 WebP 图片",
    en: "Choose a PNG, JPEG or WebP image",
  },
  "web.adjustAvatar": {
    "zh-CN": "调整头像",
    en: "Adjust avatar",
  },
  "web.dragToCropUseTheSliderOrPinchTo": {
    "zh-CN":
      "拖动图片选择范围，使用滑杆或双指缩放；确认后裁切并自动压缩至约 100 KB。",
    en: "Drag to crop; use the slider or pinch to zoom. The saved image is compressed to about 100 KB.",
  },
  "web.avatarCropCanvas": {
    "zh-CN": "头像裁切画布",
    en: "Avatar crop canvas",
  },
  "web.cannotReadThisImageChooseAValidImage": {
    "zh-CN": "无法读取图片，请重新选择有效图片",
    en: "Cannot read this image. Choose a valid image.",
  },
  "web.avatarZoom": {
    "zh-CN": "头像缩放",
    en: "Avatar zoom",
  },
  "web.cancel": {
    "zh-CN": "取消",
    en: "Cancel",
  },
  "web.saving": {
    "zh-CN": "保存中…",
    en: "Saving…",
  },
  "web.cropAndSave": {
    "zh-CN": "裁切并保存",
    en: "Crop and save",
  },
  "web.thisBrowserCannotProcessImages": {
    "zh-CN": "当前浏览器无法处理图片",
    en: "This browser cannot process images",
  },
  "web.thisBrowserCannotEncodeImages": {
    "zh-CN": "当前浏览器无法编码图片",
    en: "This browser cannot encode images",
  },
  "web.thisBoardNoLongerExistsOrIsInaccessible": {
    "zh-CN": "看板不存在或已不可访问",
    en: "This board no longer exists or is inaccessible",
  },
  "web.theBoardHasChangedReviewTheLatestContentAnd": {
    "zh-CN": "看板已更新，请核对最新内容后重试",
    en: "The board has changed. Review the latest content and try again.",
  },
  "web.saveFailedPleaseTryAgain": {
    "zh-CN": "保存失败，请重试",
    en: "Save failed. Please try again.",
  },
  "web.latestTitleLoadedReviewItAlongsideYourDraftBefore": {
    "zh-CN": "已读取最新标题，请核对下方内容和当前草稿后再保存",
    en: "Latest title loaded. Review it alongside your draft before saving.",
  },
  "web.couldNotLoadTheTitleYourDraftIsKept": {
    "zh-CN": "读取失败，草稿已保留，请联网后重试",
    en: "Could not load the title. Your draft is kept; reconnect and try again.",
  },
  "web.networkUnavailableReconnectAndTryAgain": {
    "zh-CN": "当前网络不可用，请联网后重试",
    en: "Network unavailable. Reconnect and try again.",
  },
  "web.saveResultIsUnconfirmedLoadTheLatestTitleTo": {
    "zh-CN": "保存结果暂未确认，请读取最新标题确认结果",
    en: "Save result is unconfirmed. Load the latest title to check.",
  },
  "web.editBoardTitle": {
    "zh-CN": "编辑看板标题",
    en: "Edit board title",
  },
  "web.boardTitle": {
    "zh-CN": "看板标题",
    en: "Board title",
  },
  "web.processingPleaseWait": {
    "zh-CN": "正在处理，请稍候",
    en: "Processing, please wait",
  },
  "web.upTo100LengthUnitsDuplicateNamesAreAllowed": {
    "zh-CN": "最多 100 个长度单位，允许同名",
    en: "Up to 100 length units; duplicate names are allowed",
  },
  "web.latestTitle": {
    "zh-CN": "最新标题：",
    en: "Latest title:",
  },
  "web.loadLatestTitle": {
    "zh-CN": "读取最新标题",
    en: "Load latest title",
  },
  "web.processing": {
    "zh-CN": "处理中…",
    en: "Processing…",
  },
  "web.save": {
    "zh-CN": "保存",
    en: "Save",
  },
  "web.chooseAnOption": {
    "zh-CN": "请选择",
    en: "Choose an option",
  },
  "web.close": {
    "zh-CN": "关闭",
    en: "Close",
  },
  "web.ready": {
    "zh-CN": "就绪",
    en: "Ready",
  },
  "web.awaitingManualAdvancement": {
    "zh-CN": "等待人工推进",
    en: "Awaiting manual advancement",
  },
  "web.waitingForEnvironmentQueued": {
    "zh-CN": "等待环境／排队",
    en: "Waiting for environment / queued",
  },
  "web.dispatching": {
    "zh-CN": "派发中",
    en: "Dispatching",
  },
  "web.running": {
    "zh-CN": "执行中",
    en: "Running",
  },
  "web.awaitingNativeInteraction": {
    "zh-CN": "等待原生交互",
    en: "Awaiting native interaction",
  },
  "web.awaitingPlatformApproval": {
    "zh-CN": "待平台审批",
    en: "Awaiting platform approval",
  },
  "web.statusUnconfirmed": {
    "zh-CN": "状态待确认",
    en: "Status unconfirmed",
  },
  "web.stopping": {
    "zh-CN": "正在停止",
    en: "Stopping",
  },
  "web.executionFinished": {
    "zh-CN": "执行结束",
    en: "Execution finished",
  },
  "web.cancelled": {
    "zh-CN": "已取消",
    en: "Cancelled",
  },
  "web.executionFailed": {
    "zh-CN": "执行失败",
    en: "Execution failed",
  },
  "web.done": {
    "zh-CN": "已完成",
    en: "Done",
  },
  "web.interrupted": {
    "zh-CN": "运行中断",
    en: "Interrupted",
  },
  "web.resuming": {
    "zh-CN": "正在恢复",
    en: "Resuming",
  },
  "web.processingAlternative50": {
    "zh-CN": "正在处理",
    en: "Processing",
  },
  "web.ask": {
    "zh-CN": "询问模式",
    en: "Ask",
  },
  "web.autoApprove": {
    "zh-CN": "自动审批",
    en: "Auto-approve",
  },
  "web.autoApprove.desc": {
    "zh-CN": "工具权限请求自动批准；需要我选择或填写的问题仍会显示。",
    en: "Tool permission requests are approved automatically; questions that need my answer are still shown.",
  },
  "web.permission.fullUnavailableSaved": {
    "zh-CN": "已保存的完全权限在当前目标上不可用，请改选询问模式或自动审批。",
    en: "The saved full access is unavailable on this target. Choose Ask or Auto-approve.",
  },
  "web.approval.auto": {
    "zh-CN": "已自动批准",
    en: "Auto-approved",
  },
  "web.fullAccess": {
    "zh-CN": "完全权限",
    en: "Full access",
  },
  "web.closeSessionListOverlay": {
    "zh-CN": "关闭会话列表遮罩",
    en: "Close session list overlay",
  },
  "web.closeSessionList": {
    "zh-CN": "关闭会话列表",
    en: "Close session list",
  },
  "web.pending": {
    "zh-CN": "待处理",
    en: "Pending",
  },
  "web.saveResultIsUnconfirmedYourDraftIsKeptReconnect": {
    "zh-CN":
      "保存结果尚未确认，草稿已保留。请联网后点击“核实并重试原保存”；核实前请勿离开页面。",
    en: "Save result is unconfirmed. Your draft is kept. Reconnect and select “Verify and retry original save”. Stay on this page until verified.",
  },
  "web.theBoardVersionHasChangedYourDraftIsKept": {
    "zh-CN":
      "看板版本已变化，草稿已保留。请先复制需保留的内容，再重新进入流程配置核对新版本。",
    en: "The board version has changed. Your draft is kept. Copy any changes you need, then reopen flow configuration to review the latest version.",
  },
  "web.theDeletionImpactOrConfirmationValidityHasChangedYour": {
    "zh-CN": "删除影响或确认有效期已变化，草稿已保留，请重新保存以评估并确认。",
    en: "The deletion impact or confirmation validity has changed. Your draft is kept. Save again to review and confirm.",
  },
  "web.name": {
    "zh-CN": "名称",
    en: "Name",
  },
  "web.projectsCanReferenceMultipleEnvironmentDirectoriesAndAreShared": {
    "zh-CN":
      "项目可关联多个环境目录，会话与看板共同引用。已有会话时不允许迁移目录。",
    en: "Projects can reference multiple environment directories and are shared by sessions and boards. Directories cannot be moved once sessions exist.",
  },
  "web.createProjectDirectoryHint": {
    "zh-CN": "可添加多个环境目录。保存时会在所选工作根目录下创建缺失的目录。",
    en: "You can add multiple environment directories. Saving creates missing directories under each selected workspace root.",
  },
  "web.removeDirectory": {
    "zh-CN": "移除目录",
    en: "Remove directory",
  },
  "web.addEnvironmentDirectory": {
    "zh-CN": "添加环境目录",
    en: "Add environment directory",
  },
  "web.scope": {
    "zh-CN": "作用范围",
    en: "Scope",
  },
  "web.agentScope": {
    "zh-CN": "智能体范围",
    en: "Agent scope",
  },
  "web.systemAcrossEnvironments": {
    "zh-CN": "系统级（跨环境）",
    en: "System (across environments)",
  },
  "web.supportedCli": {
    "zh-CN": "适用 CLI",
    en: "Supported CLI",
  },
  "web.allClis": {
    "zh-CN": "全部 CLI",
    en: "All CLIs",
  },
  "web.specificClis": {
    "zh-CN": "指定 CLI",
    en: "Specific CLIs",
  },
  "web.chooseClisAtLeastOne": {
    "zh-CN": "选择 CLI（至少一项）",
    en: "Choose CLIs (at least one)",
  },
  "web.chooseAtLeastOneCli": {
    "zh-CN": "请至少选择一个 CLI。",
    en: "Choose at least one CLI.",
  },
  "web.agentsAreOnlyAvailableInSupportedClisEnvironmentScope": {
    "zh-CN": "智能体仅在适用的 CLI 中可选，作用范围仍按环境单独限制。",
    en: "Agents are only available in supported CLIs. Environment scope restrictions still apply.",
  },
  "web.defaultPermission": {
    "zh-CN": "默认权限",
    en: "Default permission",
  },
  "web.fullAccessAllowsTheAgentToExecuteOperationsDirectly": {
    "zh-CN": "完全权限将允许智能体直接执行操作，请仅用于可信任务。",
    en: "Full access allows the agent to execute operations directly. Use only for trusted tasks.",
  },
  "web.askModeKeepsNativeOperationApprovals": {
    "zh-CN": "询问模式保留原生操作审批。",
    en: "Ask mode keeps native operation approvals.",
  },
  "web.defaultsApplyOnlyToNewSessionsAndStagesExisting": {
    "zh-CN": "仅用于新会话与新阶段的默认值，不修改已有配置。",
    en: "Defaults apply only to new sessions and stages; existing settings are unchanged.",
  },
  "web.roleInstructions": {
    "zh-CN": "职责指令",
    en: "Role instructions",
  },
  "web.describeResponsibilitiesConstraintsAndDeliverables": {
    "zh-CN": "描述职责、约束和交付要求",
    en: "Describe responsibilities, constraints and deliverables",
  },
  "web.instructionInjection": {
    "zh-CN": "指令注入方式",
    en: "Instruction injection",
  },
  "web.inheritNativeInstructions": {
    "zh-CN": "继承原生规范",
    en: "Inherit native instructions",
  },
  "web.appendRoleInstructions": {
    "zh-CN": "追加职责",
    en: "Append role instructions",
  },
  "web.replaceUserInstructionsExactlyUnderValidation": {
    "zh-CN": "精确替换用户规范（验证中）",
    en: "Replace user instructions exactly (under validation)",
  },
  "web.existingProjectInstructionFilesArePreservedExactReplacementIs": {
    "zh-CN":
      "保留项目原有指令文件。精确替换未经验证，当前执行入口会明确拒绝，不静默降级。",
    en: "Existing project instruction files are preserved. Exact replacement is not verified and is explicitly rejected by the execution entry point without silent fallback.",
  },
  "web.avatarPreview": {
    "zh-CN": "头像预览",
    en: "Avatar preview",
  },
  "web.avatarInitials": {
    "zh-CN": "头像简称",
    en: "Avatar initials",
  },
  "web.protocol": {
    "zh-CN": "协议",
    en: "Protocol",
  },
  "web.modelProtocol": {
    "zh-CN": "模型协议",
    en: "Model protocol",
  },
  "web.modelIdentifier": {
    "zh-CN": "模型标识",
    en: "Model identifier",
  },
  "environment.modelConfig.open": {
    "zh-CN": "配置 {tool} API",
    en: "Configure {tool} API",
  },
  "environment.modelConfig.title": {
    "zh-CN": "环境模型 API 配置",
    en: "Environment model API configuration",
  },
  "environment.modelConfig.offline": {
    "zh-CN": "环境当前不可用，请连接后重试",
    en: "Environment unavailable. Reconnect and try again.",
  },
  "environment.modelConfig.codexSwitch": {
    "zh-CN": "保存后，后续新建的 Codex 会话将默认使用此自定义端点。",
    en: "After saving, new Codex sessions will use this custom endpoint by default.",
  },
  "environment.modelConfig.reuseCredential": {
    "zh-CN": "环境已配置凭据，留空沿用本机凭据。",
    en: "A credential is configured on the environment. Leave blank to reuse it.",
  },
  "environment.modelConfig.replaceCredential": {
    "zh-CN": "环境已有凭据。变更端点或认证方式时，请填写新凭据。",
    en: "A credential is configured. Enter a new credential when changing the endpoint or authentication type.",
  },
  "environment.modelConfig.noCredential": {
    "zh-CN": "环境尚未配置可复用的凭据。",
    en: "The environment has no reusable credential.",
  },
  "environment.modelConfig.chooseModel": {
    "zh-CN": "选择返回的模型",
    en: "Choose a returned model",
  },
  "environment.modelConfig.diagnostics": {
    "zh-CN":
      "目标环境发起获取和测试。测试会向所填模型发送一次最小生成请求，可能产生用量。",
    en: "The target environment runs both diagnostics. Testing sends a minimal generation request to the specified model and may incur usage.",
  },
  "environment.modelConfig.apply": {
    "zh-CN": "保存并下发",
    en: "Save and apply",
  },
  "environment.modelConfig.readAgain": {
    "zh-CN": "重新读取环境配置",
    en: "Read environment configuration again",
  },
  "environment.modelConfig.recovered": {
    "zh-CN": "已读取环境当前配置，编辑草稿仍可继续修改。",
    en: "Current environment configuration loaded. Your draft is still available for editing.",
  },
  "environment.modelConfig.saved": {
    "zh-CN": "目标环境已确认保存配置",
    en: "The target environment confirmed the save.",
  },
  "environment.modelConfig.emptyModels": {
    "zh-CN": "端点未返回可选模型，请手动填写模型标识。",
    en: "The endpoint returned no models. Enter the model identifier manually.",
  },
  "environment.modelConfig.testPassed": {
    "zh-CN": "目标环境的 {protocol} 请求成功，用时 {elapsedMs} 毫秒。",
    en: "The {protocol} request from the target environment succeeded in {elapsedMs} ms.",
  },
  "environment.modelConfig.pending.read": {
    "zh-CN": "正在读取环境配置…",
    en: "Reading environment configuration\u2026",
  },
  "environment.modelConfig.pending.models": {
    "zh-CN": "目标环境正在获取模型列表…",
    en: "The target environment is fetching models\u2026",
  },
  "environment.modelConfig.pending.test": {
    "zh-CN": "目标环境正在测试连接…",
    en: "The target environment is testing the connection\u2026",
  },
  "environment.modelConfig.pending.save": {
    "zh-CN": "正在等待目标环境确认保存…",
    en: "Waiting for the target environment to confirm the save\u2026",
  },
  "environment.modelConfig.invalidUrl": {
    "zh-CN":
      "请输入 HTTP 或 HTTPS 基础地址，地址中不能包含凭据、查询参数或片段。",
    en: "Enter an HTTP or HTTPS base URL without credentials, query parameters or a fragment.",
  },
  "web.apiBaseUrl": {
    "zh-CN": "API 基础地址",
    en: "API base URL",
  },
  "web.httpTransmitsInPlainTextMakeSureTheNetwork": {
    "zh-CN": "HTTP 为明文传输，请确认网络可信",
    en: "HTTP transmits in plain text. Make sure the network is trusted.",
  },
  "web.apiKeyLeaveBlankToKeep": {
    "zh-CN": "API Key（留空保留）",
    en: "API Key (leave blank to keep)",
  },
  "web.reasoningEffort": {
    "zh-CN": "思考强度",
    en: "Reasoning effort",
  },
  "web.maximumOutputTokens": {
    "zh-CN": "最大输出 Token",
    en: "Maximum output tokens",
  },
  "web.temperatureOptional": {
    "zh-CN": "Temperature（可留空）",
    en: "Temperature (optional)",
  },
  "web.contextTokenCapacity": {
    "zh-CN": "上下文 Token 容量",
    en: "Context token capacity",
  },
  "web.compactionModel": {
    "zh-CN": "压缩模型",
    en: "Compaction model",
  },
  "web.useCurrentModel": {
    "zh-CN": "使用当前模型",
    en: "Use current model",
  },
  "web.customParametersJson": {
    "zh-CN": "自定义参数 JSON",
    en: "Custom parameters JSON",
  },
  "web.parameterSupportDependsOnTheEndpointMessagesToolsAnd": {
    "zh-CN":
      "参数支持由端点决定；不能覆盖消息、工具和权限。凭据加密存储，不会返回明文。",
    en: "Parameter support depends on the endpoint. Messages, tools and permissions cannot be overridden. Credentials are encrypted and never returned in plain text.",
  },
  "web.flowEditingIsAvailableNoUnfinishedUnarchivedWorkItems": {
    "zh-CN": "当前可编辑流程：没有未完成且未归档的工作项。",
    en: "Flow editing is available: no unfinished, unarchived work items.",
  },
  "web.flowProtectedStages": {
    "zh-CN": "{count} 个在途工作项分布在 {stages}。这些阶段及其既有出口受保护。",
    en: "{count} work items are in progress in {stages}. These stages and their existing transitions are protected.",
  },
  "web.flowProtectedDetail": {
    "zh-CN": "{stage} 有在途工作项。须保留阶段、类型和已保存的出口。",
    en: "{stage} has work in progress. Keep the stage, its type and its saved transitions.",
  },
  "web.flowTypeReview": {
    "zh-CN": "确认阶段类型变更",
    en: "Review stage type changes",
  },
  "web.flowEnterHuman": {
    "zh-CN": "工作项下次进入 {stage} 后将等待人工推进。",
    en: "Work items entering {stage} will wait for manual advancement.",
  },
  "web.flowEnterAgent": {
    "zh-CN": "工作项下次进入 {stage} 后将创建 Agent 执行。",
    en: "Entering {stage} will queue a new agent execution.",
  },
  "web.boardArchived": {
    "zh-CN": "；看板已归档",
    en: "; board archived",
  },
  "web.checkingFlowEditingConditionsRetryIfLoadingFails": {
    "zh-CN": "正在检查流程编辑条件；读取失败时请重试。",
    en: "Checking flow editing conditions. Retry if loading fails.",
  },
  "web.checkEditingConditionsAgain": {
    "zh-CN": "重新检查编辑条件",
    en: "Check editing conditions again",
  },
  "web.project": {
    "zh-CN": "所属项目",
    en: "Project",
  },
  "web.concurrencyWithinAStageDoesNotIsolateCodeOnly": {
    "zh-CN":
      "同阶段并发不隔离代码。在途工作项须保留既有出口和完成路径。删除阶段须在保存前确认历史和产物访问影响。",
    en: "Concurrency within a stage does not isolate code. Keep existing exits from occupied stages and paths to completion for work in progress. Confirm the impact on history and artifacts before deleting stages.",
  },
  "web.newStage": {
    "zh-CN": "新阶段",
    en: "New stage",
  },
  "web.whatYouNeedToDoNNWhatYou": {
    "zh-CN":
      "## 你需要完成的内容\n\n## 你需要提交\n\n## 完成后如何推进\n完成后使用交接工具提交记录。",
    en: "## What you need to do\n\n## What you need to deliver\n\n## How to advance\nUse the handoff tool to submit a record when finished.",
  },
  "web.addStage": {
    "zh-CN": "添加阶段",
    en: "Add stage",
  },
  "web.createBoard": {
    "zh-CN": "创建看板",
    en: "Create board",
  },
  "web.saveConfiguration": {
    "zh-CN": "保存配置",
    en: "Save configuration",
  },
  "web.verifyAndRetryOriginalSave": {
    "zh-CN": "核实并重试原保存",
    en: "Verify and retry original save",
  },
  "web.confirmStageDeletionAndHistoryLoss": {
    "zh-CN": "确认删除阶段及历史损失",
    en: "Confirm stage deletion and history loss",
  },
  "web.stagesToDelete": {
    "zh-CN": "将删除以下",
    en: "Stages to delete:",
  },
  "web.stages": {
    "zh-CN": "个阶段：",
    en: "stages:",
  },
  "web.affects": {
    "zh-CN": "影响",
    en: "Affects",
  },
  "web.workItems": {
    "zh-CN": "个工作项、",
    en: "work items,",
  },
  "web.handoffRecords": {
    "zh-CN": "条交接记录、",
    en: "handoff records,",
  },
  "web.artifacts": {
    "zh-CN": "个产物。",
    en: "artifacts.",
  },
  "web.noHandoffRecordsAreAffected": {
    "zh-CN": "无交接记录受影响。",
    en: "No handoff records are affected.",
  },
  "web.relatedHandoffRecordsWillBeLostAndTheirArtifact": {
    "zh-CN":
      "相关交接记录将丢失，关联产物原下载入口将不可访问。工作项正文及完成、归档状态保留；原阶段被删除的归档项无法直接恢复。此操作无法在页面撤销。",
    en: "Related handoff records will be lost and their artifact download links will become inaccessible. Work item content and completion/archive states are kept. Archived items whose stage is deleted cannot be restored directly. This cannot be undone on this page.",
  },
  "web.cancelKeepEditing": {
    "zh-CN": "取消，继续编辑",
    en: "Cancel, keep editing",
  },
  "web.acceptLossAndSave": {
    "zh-CN": "接受损失并保存",
    en: "Accept loss and save",
  },
  "web.developmentEnvironment": {
    "zh-CN": "开发环境",
    en: "Development environment",
  },
  "web.workspaceRoots": {
    "zh-CN": "工作根目录",
    en: "Workspace roots",
  },
  "web.syncedRoots": {
    "zh-CN": "{p0} 个已同步根目录。",
    en: "{p0} synced roots.",
  },
  "web.chooseADevelopmentEnvironmentFirst": {
    "zh-CN": "先选择开发环境。",
    en: "Choose a development environment first.",
  },
  "web.afterAddingDirectoriesInTheClientSaveAndStart": {
    "zh-CN": "在客户端添加目录后，请保存并启动连接器；此列表会自动更新。",
    en: "After adding directories in the client, save and start the connector. This list updates automatically.",
  },
  "web.relativePath": {
    "zh-CN": "相对路径",
    en: "Relative path",
  },
  "web.validDirectory": {
    "zh-CN": "目录有效：",
    en: "Valid directory:",
  },
  "web.validateDirectory": {
    "zh-CN": "验证目录",
    en: "Validate directory",
  },
  "web.loading": {
    "zh-CN": "正在读取…",
    en: "Loading…",
  },
  "web.browseSubdirectories": {
    "zh-CN": "浏览子目录",
    en: "Browse subdirectories",
  },
  "web.backToRoot": {
    "zh-CN": "返回根目录",
    en: "Back to root",
  },
  "web.subdirectory": {
    "zh-CN": "子目录",
    en: "Subdirectory",
  },
  "web.noSubfoldersYouCanSelectTheCurrentDirectory": {
    "zh-CN": "此目录没有子文件夹，可直接选择当前目录。",
    en: "No subfolders. You can select the current directory.",
  },
  "web.theIncompatibleAgentWasClearedChooseAnotherAgent": {
    "zh-CN": "已清除不适用的智能体，请重新选择。",
    en: "The incompatible agent was cleared. Choose another agent.",
  },
  "web.adjustProjectOrder": {
    "zh-CN": "调整顺序",
    en: "Adjust order",
  },
  "web.moveProjectUp": {
    "zh-CN": "上移「{name}」",
    en: "Move “{name}” up",
  },
  "web.moveProjectDown": {
    "zh-CN": "下移「{name}」",
    en: "Move “{name}” down",
  },
  "web.moveUp": {
    "zh-CN": "上移",
    en: "Move up",
  },
  "web.moveDown": {
    "zh-CN": "下移",
    en: "Move down",
  },
  "web.remove": {
    "zh-CN": "移除",
    en: "Remove",
  },
  "web.stageName": {
    "zh-CN": "阶段名称",
    en: "Stage name",
  },
  "web.stageType": {
    "zh-CN": "阶段类型",
    en: "Stage type",
  },
  "web.humanStage": {
    "zh-CN": "人工阶段",
    en: "Human stage",
  },
  "web.agentStage": {
    "zh-CN": "Agent 阶段",
    en: "Agent stage",
  },
  "web.reachableStages": {
    "zh-CN": "允许到达的阶段",
    en: "Reachable stages",
  },
  "web.projectExecutionDirectory": {
    "zh-CN": "项目执行目录",
    en: "Project execution directory",
  },
  "web.environment": {
    "zh-CN": "环境",
    en: "Environment",
  },
  "web.nativeRuntime": {
    "zh-CN": "原生运行时",
    en: "Native runtime",
  },
  "web.stagePermission": {
    "zh-CN": "阶段权限",
    en: "Stage permission",
  },
  "web.agent": {
    "zh-CN": "智能体",
    en: "Agent",
  },
  "web.thisAgentIsNotApplicableChooseAnotherAgent": {
    "zh-CN": "当前智能体不适用，请重新选择。",
    en: "This agent is not applicable. Choose another agent.",
  },
  "web.stageAgent": {
    "zh-CN": "阶段智能体",
    en: "Stage agent",
  },
  "web.noRoleConfiguration": {
    "zh-CN": "无职责配置",
    en: "No role configuration",
  },
  "web.stageConcurrencyLimit1ForSequential": {
    "zh-CN": "同阶段并发上限（1 为串行）",
    en: "Stage concurrency limit (1 for sequential)",
  },
  "web.customStagePermissionApplied": {
    "zh-CN": "已使用阶段自定义权限",
    en: "Custom stage permission applied",
  },
  "web.defaultsToTheSelectedAgentSPermissionCanBe": {
    "zh-CN": "默认采用所选智能体的权限，可单独修改。",
    en: "Defaults to the selected agent's permission; can be changed independently.",
  },
  "web.allowArtifactSubmission": {
    "zh-CN": "允许提交产物",
    en: "Allow artifact submission",
  },
  "web.whenEnabledNewExecutionsCanUploadFilesWithHandoffs": {
    "zh-CN":
      "开启后，新执行可随交接上传文件供预览或下载。关闭会阻止尚未完成的上传。",
    en: "When enabled, new executions can upload files with handoffs for preview or download. Disabling blocks unfinished uploads.",
  },
  "web.stageMarkdownInstructions": {
    "zh-CN": "节点 Markdown 指令",
    en: "Stage Markdown instructions",
  },
  "web.unsupportedFormatDownloadToView": {
    "zh-CN": "格式不支持，请下载后查看",
    en: "Unsupported format. Download to view.",
  },
  "web.thisBrowserDoesNotSupportThisVideoFormatDownload": {
    "zh-CN": "当前浏览器不支持此视频格式，请下载后查看",
    en: "This browser does not support this video format. Download to view.",
  },
  "web.fileExceedsThePreviewLimitDownloadToView": {
    "zh-CN": "文件超过 {p0} 预览上限，请下载后查看",
    en: "File exceeds the {p0} preview limit. Download to view.",
  },
  "web.invalidPdfFormatDownloadToView": {
    "zh-CN": "PDF 文件格式无效，请下载后查看",
    en: "Invalid PDF format. Download to view.",
  },
  "web.unsupportedTextEncodingDownloadToView": {
    "zh-CN": "文本编码不支持，请下载后查看",
    en: "Unsupported text encoding. Download to view.",
  },
  "web.fileContainsBinaryContentDownloadToView": {
    "zh-CN": "文件包含二进制内容，请下载后查看",
    en: "File contains binary content. Download to view.",
  },
  "web.insufficientBrowserTemporaryStorageFreeUpSpaceAndRetry": {
    "zh-CN": "浏览器临时存储空间不足，请释放空间后重试",
    en: "Insufficient browser temporary storage. Free up space and retry.",
  },
  "web.fileTransferFailedPleaseTryAgain": {
    "zh-CN": "文件传输失败，请重试",
    en: "File transfer failed. Please try again.",
  },
  "web.transferCancelledYouCanTryAgain": {
    "zh-CN": "传输已取消，可以重新尝试",
    en: "Transfer cancelled. You can try again.",
  },
  "web.filePreview": {
    "zh-CN": "文件预览",
    en: "File preview",
  },
  "web.handoffArtifact": {
    "zh-CN": "交接产物",
    en: "Handoff artifact",
  },
  "web.environmentFile": {
    "zh-CN": "环境文件",
    en: "Environment file",
  },
  "web.loadingFileInformation": {
    "zh-CN": "正在获取文件信息…",
    en: "Loading file information…",
  },
  "web.retry": {
    "zh-CN": "重试",
    en: "Retry",
  },
  "web.size": {
    "zh-CN": "大小",
    en: "Size",
  },
  "web.type": {
    "zh-CN": "类型",
    en: "Type",
  },
  "web.storageLocation": {
    "zh-CN": "保存位置",
    en: "Storage location",
  },
  "web.modified": {
    "zh-CN": "修改时间",
    en: "Modified",
  },
  "web.preview": {
    "zh-CN": "预览",
    en: "Preview",
  },
  "web.download": {
    "zh-CN": "下载",
    en: "Download",
  },
  "web.cancelTransfer": {
    "zh-CN": "取消传输",
    en: "Cancel transfer",
  },
  "web.preparing": {
    "zh-CN": "正在准备…",
    en: "Preparing…",
  },
  "web.receivingPreviewFile": {
    "zh-CN": "正在接收预览文件",
    en: "Receiving preview file",
  },
  "web.receivingDownloadFile": {
    "zh-CN": "正在接收下载文件",
    en: "Receiving download file",
  },
  "web.fileTransferProgress": {
    "zh-CN": "文件传输进度",
    en: "File transfer progress",
  },
  "web.fileReadyIfItWasNotSavedAutomatically": {
    "zh-CN": "文件已准备好。若未自动保存，",
    en: "File ready. If it was not saved automatically,",
  },
  "web.clickToSaveTheFile": {
    "zh-CN": "点击保存文件",
    en: "click to save the file",
  },
  "web.tooManyLinesOnlyTheFirst10000Are": {
    "zh-CN": "文本行数过多，仅显示前 10000 行，请下载查看完整内容",
    en: "Too many lines. Only the first 10,000 are shown; download for the full content.",
  },
  "web.textPreview": {
    "zh-CN": "文本预览",
    en: "Text preview",
  },
  "web.htmlArtifactPreview": {
    "zh-CN": "HTML 产物预览",
    en: "HTML artifact preview",
  },
  "web.pdfArtifactPreview": {
    "zh-CN": "PDF 产物预览",
    en: "PDF artifact preview",
  },
  "web.cannotDecodeImageDownloadToView": {
    "zh-CN": "图片无法解码，请下载后查看",
    en: "Cannot decode image. Download to view.",
  },
  "web.thisBrowserDoesNotSupportThisVideoCodecDownload": {
    "zh-CN": "当前浏览器不支持此视频编码，请下载后查看",
    en: "This browser does not support this video codec. Download to view.",
  },
  "web.reloadFileInformation": {
    "zh-CN": "重新获取文件信息",
    en: "Reload file information",
  },
  "web.theServiceReturnedInvalidFileContent": {
    "zh-CN": "服务返回了无效文件内容",
    en: "The service returned invalid file content",
  },
  "web.incompleteFileTransferPleaseTryAgain": {
    "zh-CN": "文件传输不完整，请重试",
    en: "Incomplete file transfer. Please try again.",
  },
  "web.thisBrowserDoesNotSupportTemporaryStorageForLarge": {
    "zh-CN": "当前浏览器不支持大文件临时存储，请换用支持此能力的浏览器下载",
    en: "This browser does not support temporary storage for large files. Use a browser with this capability to download.",
  },
  "web.workbench": {
    "zh-CN": "工作台",
    en: "Workbench",
  },
  "web.sessions": {
    "zh-CN": "会话",
    en: "Sessions",
  },
  "web.boards": {
    "zh-CN": "看板",
    en: "Boards",
  },
  "web.settings": {
    "zh-CN": "设置",
    en: "Settings",
  },
  "web.light": {
    "zh-CN": "浅色",
    en: "Light",
  },
  "web.dark": {
    "zh-CN": "深色",
    en: "Dark",
  },
  "web.operationSucceeded": {
    "zh-CN": "操作成功",
    en: "Operation succeeded",
  },
  "web.saved": {
    "zh-CN": "已保存",
    en: "Saved",
  },
  "web.connectingToBugpawRelay": {
    "zh-CN": "正在连接 BugPaw Relay…",
    en: "Connecting to BugPaw Relay…",
  },
  "web.mainNavigation": {
    "zh-CN": "主导航",
    en: "Main navigation",
  },
  "web.expandNavigation": {
    "zh-CN": "展开导航",
    en: "Expand navigation",
  },
  "web.collapseNavigation": {
    "zh-CN": "收起导航",
    en: "Collapse navigation",
  },
  "web.theme": {
    "zh-CN": "主题",
    en: "theme",
  },
  "web.currentThemeSwitchTo": {
    "zh-CN": "当前{p0}主题，切换到{p1}主题",
    en: "Current theme: {p0}. Switch to {p1}.",
  },
  "web.editAvatar": {
    "zh-CN": "修改头像",
    en: "Edit avatar",
  },
  "web.personalWorkspace": {
    "zh-CN": "个人工作空间",
    en: "Personal workspace",
  },
  "web.signOut": {
    "zh-CN": "退出登录",
    en: "Sign out",
  },
  "web.signOutOfThisAccount": {
    "zh-CN": "退出当前账号？",
    en: "Sign out of this account?",
  },
  "web.openNavigation": {
    "zh-CN": "打开导航",
    en: "Open navigation",
  },
  "web.connected": {
    "zh-CN": "已连接",
    en: "Connected",
  },
  "web.offline": {
    "zh-CN": "离线",
    en: "Offline",
  },
  "web.dismissMessage": {
    "zh-CN": "关闭提示",
    en: "Dismiss message",
  },
  "web.manageWorkbenchModelsAndAccountSecurityEnvironmentToolCredentials": {
    "zh-CN": "管理工作台模型与账号安全。环境工具凭据仅在环境本地配置。",
    en: "Manage workbench models and account security. Environment tool credentials are configured locally.",
  },
  "web.workbenchModels": {
    "zh-CN": "工作台模型",
    en: "Workbench models",
  },
  "web.addModel": {
    "zh-CN": "添加模型",
    en: "Add model",
  },
  "web.keyConfigured": {
    "zh-CN": "已配置密钥",
    en: "Key configured",
  },
  "web.keyNotConfigured": {
    "zh-CN": "待配置密钥",
    en: "Key not configured",
  },
  "web.edit": {
    "zh-CN": "编辑",
    en: "Edit",
  },
  "web.deleteModelConfiguration": {
    "zh-CN": "删除模型配置？",
    en: "Delete model configuration?",
  },
  "web.delete": {
    "zh-CN": "删除",
    en: "Delete",
  },
  "web.noModelsConfiguredAddACompatibleEndpointToStart": {
    "zh-CN": "尚未配置模型。添加兼容端点后，可在工作台中选择并对话。",
    en: "No models configured. Add a compatible endpoint to start a workbench conversation.",
  },
  "web.editPersonalAvatar": {
    "zh-CN": "修改个人头像",
    en: "Edit personal avatar",
  },
  "web.new": {
    "zh-CN": "新建",
    en: "New",
  },
  "web.projectAlternative229": {
    "zh-CN": "项目",
    en: "Project",
  },
  "web.model": {
    "zh-CN": "模型",
    en: "Model",
  },
  "web.confirmOperation": {
    "zh-CN": "确认操作",
    en: "Confirm operation",
  },
  "web.confirm": {
    "zh-CN": "确认",
    en: "Confirm",
  },
  "web.projectManagement": {
    "zh-CN": "项目管理",
    en: "Project management",
  },
  "web.sessionsAndBoardsShareProjectsAProjectCanReference": {
    "zh-CN": "会话与看板共用项目，一个项目可关联多个环境目录。",
    en: "Sessions and boards share projects. A project can reference multiple environment directories.",
  },
  "web.directories": {
    "zh-CN": "个目录",
    en: "directories",
  },
  "web.deleteProject": {
    "zh-CN": "删除项目？",
    en: "Delete project?",
  },
  "web.newProject": {
    "zh-CN": "新建项目",
    en: "New project",
  },
  "web.connectDevelopmentEnvironment": {
    "zh-CN": "接入开发环境",
    en: "Connect development environment",
  },
  "web.newWorkItem": {
    "zh-CN": "新建工作项",
    en: "New work item",
  },
  "web.workItemDetails": {
    "zh-CN": "工作项详情",
    en: "Work item details",
  },
  "web.bugpawMascot": {
    "zh-CN": "BugPaw 猫咪",
    en: "BugPaw mascot",
  },
  "web.yourFamiliarEnvironmentWhereverYouWork": {
    "zh-CN": "熟悉的环境，随处协作。",
    en: "Your familiar environment, wherever you work.",
  },
  "web.connectDevelopmentEnvironmentsAndBringCodingAgentsAndTask": {
    "zh-CN": "连接开发环境，让编码 Agent 和任务流程在同一个入口相遇。",
    en: "Connect development environments and bring coding agents and task workflows together.",
  },
  "web.twoFactorAuthentication": {
    "zh-CN": "二要素验证",
    en: "Two-factor authentication",
  },
  "web.welcomeBack": {
    "zh-CN": "欢迎回来",
    en: "Welcome back",
  },
  "web.initializeYourWorkspace": {
    "zh-CN": "初始化你的工作空间",
    en: "Initialize your workspace",
  },
  "web.accountAndPasswordVerifiedEnterThe6DigitCode": {
    "zh-CN": "账号密码已验证，请输入验证器中的 6 位验证码。",
    en: "Account and password verified. Enter the 6-digit code from your authenticator.",
  },
  "web.signInToAccessYourDevelopmentEnvironments": {
    "zh-CN": "登录以访问你的开发环境。",
    en: "Sign in to access your development environments.",
  },
  "web.useTheOneTimeSetupTokenInTheServer": {
    "zh-CN": "使用服务器数据目录中的一次性初始化令牌创建管理员。",
    en: "Use the one-time setup token in the server data directory to create an administrator.",
  },
  "web.setupToken": {
    "zh-CN": "初始化令牌",
    en: "Setup token",
  },
  "web.account": {
    "zh-CN": "账号",
    en: "Account",
  },
  "web.password": {
    "zh-CN": "密码",
    en: "Password",
  },
  "web.passwordAtLeast12Characters": {
    "zh-CN": "密码（至少 12 位）",
    en: "Password (at least 12 characters)",
  },
  "web.twoFactorCode": {
    "zh-CN": "二要素验证码",
    en: "Two-factor code",
  },
  "web.processingAlternative255": {
    "zh-CN": "正在处理…",
    en: "Processing…",
  },
  "web.verifyAndSignIn": {
    "zh-CN": "验证并登录",
    en: "Verify and sign in",
  },
  "web.signIn": {
    "zh-CN": "登录",
    en: "Sign in",
  },
  "web.createAdministrator": {
    "zh-CN": "创建管理员",
    en: "Create administrator",
  },
  "web.backToPasswordSignIn": {
    "zh-CN": "返回账号密码登录",
    en: "Back to password sign-in",
  },
  "web.loadingDownloadInformation": {
    "zh-CN": "正在获取下载信息…",
    en: "Loading download information…",
  },
  "web.noReleasePackageIsAvailableForThisPlatformTry": {
    "zh-CN": "当前平台暂无可用发布包，请稍后重试",
    en: "No release package is available for this platform. Try again later.",
  },
  "web.downloadTheCompletePackageForYourPlatformAndExtract": {
    "zh-CN":
      "下载对应平台的完整发布包，解压后即可运行，无需安装 Node.js 或 npm。",
    en: "Download the complete package for your platform and extract it to run. Node.js and npm are not required.",
  },
  "web.downloadWindowsPackageZip": {
    "zh-CN": "下载 Windows 发布包（ZIP）",
    en: "Download Windows package (ZIP)",
  },
  "web.extractAllFilesAndDoubleClickBugpawRelayExe": {
    "zh-CN": "解压全部文件，双击 bugpaw-relay.exe 打开本机 Web 配置页。",
    en: "Extract all files and double-click bugpaw-relay.exe to open the local Web configuration page.",
  },
  "web.downloadLinuxPackageTarGz": {
    "zh-CN": "下载 Linux 发布包（tar.gz）",
    en: "Download Linux package (tar.gz)",
  },
  "web.extractAndRunBugpawRelayWithoutADesktopUse": {
    "zh-CN":
      "解压后运行 ./bugpaw-relay；无桌面环境使用 ./bugpaw-relay configure、register 和 --cli。",
    en: "Extract and run ./bugpaw-relay. Without a desktop, use ./bugpaw-relay configure, register and --cli.",
  },
  "web.viewVersionFileSizeAndSha256": {
    "zh-CN": "查看版本、文件大小与 SHA-256",
    en: "View version, file size and SHA-256",
  },
  "web.webModeIsTheDefaultCliRunsInThe": {
    "zh-CN":
      "默认 Web 模式，--cli 为命令行前台模式。配置服务端、工作根目录和工具凭据，使用下方接入码注册，再回到环境页批准。关闭网页不会停止后台任务；需要停止时点击本机控制台的停止按钮。",
    en: "Web mode is the default; --cli runs in the foreground. Configure the server, workspace roots and tool credentials, register with the code below, then approve the environment. Closing the page does not stop background tasks; use Stop in the local console.",
  },
  "web.generateOneTimeCodeValidFor10Minutes": {
    "zh-CN": "生成 10 分钟一次性接入码",
    en: "Generate one-time code valid for 10 minutes",
  },
  "web.server": {
    "zh-CN": "服务端：",
    en: "Server:",
  },
  "web.settingsUpdated": {
    "zh-CN": "设置已更新",
    en: "Settings updated",
  },
  "web.accountAndSecurity": {
    "zh-CN": "账号与安全",
    en: "Account and security",
  },
  "web.currentPassword": {
    "zh-CN": "当前密码",
    en: "Current password",
  },
  "web.newPasswordAtLeast12Characters": {
    "zh-CN": "新密码（至少 12 位）",
    en: "New password (at least 12 characters)",
  },
  "web.changePasswordAndSignOutAllSessions": {
    "zh-CN": "修改密码并退出所有会话",
    en: "Change password and sign out all sessions",
  },
  "web.useATotpAuthenticatorKeepTheSecretSafeBefore": {
    "zh-CN":
      "使用 TOTP 验证器。启用前妥善保存密钥；丢失时需由服务器管理员执行本地恢复。",
    en: "Use a TOTP authenticator. Keep the secret safe before enabling. If lost, a server administrator must perform local recovery.",
  },
  "web.generateTwoFactorSecret": {
    "zh-CN": "生成二要素密钥",
    en: "Generate two-factor secret",
  },
  "web.addToAuthenticator": {
    "zh-CN": "添加到验证器：",
    en: "Add to authenticator:",
  },
  "web.scanTheQrCodeOrEnterTheSecretAbove": {
    "zh-CN":
      "使用验证器扫描二维码，或手动输入上方密钥。请在 10 分钟内输入验证码确认启用。",
    en: "Scan the QR code or enter the secret above. Enter a verification code within 10 minutes to enable.",
  },
  "web.authenticatorSetupQrCode": {
    "zh-CN": "二要素验证器绑定二维码",
    en: "Authenticator setup QR code",
  },
  "web.verificationCode": {
    "zh-CN": "验证码",
    en: "Verification code",
  },
  "web.confirmAndEnable": {
    "zh-CN": "确认启用",
    en: "Confirm and enable",
  },
  "web.disableTwoFactorAuthentication": {
    "zh-CN": "停用二要素",
    en: "Disable two-factor authentication",
  },
  "web.verifyPasswordAndGenerateSecret": {
    "zh-CN": "验证密码并生成密钥",
    en: "Verify password and generate secret",
  },
  "web.verifyPasswordAndDisableTwoFactorAuthentication": {
    "zh-CN": "验证密码并停用二要素",
    en: "Verify password and disable two-factor authentication",
  },
  "web.secretGeneratedScanTheCodeThenEnterAVerification": {
    "zh-CN": "密钥已生成，扫码后输入验证码确认启用",
    en: "Secret generated. Scan the code, then enter a verification code to enable.",
  },
  "web.twoFactorAuthenticationDisabled": {
    "zh-CN": "二要素已停用",
    en: "Two-factor authentication disabled",
  },
  "web.enterYourAccountPasswordToConfirmThisOperation": {
    "zh-CN": "请输入当前账号的登录密码以确认本次操作。",
    en: "Enter your account password to confirm this operation.",
  },
  "web.loginPassword": {
    "zh-CN": "登录密码",
    en: "Login password",
  },
  "web.verifyAndGenerateSecret": {
    "zh-CN": "验证并生成密钥",
    en: "Verify and generate secret",
  },
  "web.confirmAndDisable": {
    "zh-CN": "确认停用",
    en: "Confirm and disable",
  },
  "web.awaitingReplyOrApproval": {
    "zh-CN": "等待回复或审批",
    en: "Awaiting reply or approval",
  },
  "web.executionEndedWithoutAdvancement": {
    "zh-CN": "执行结束未推进",
    en: "Execution ended without advancement",
  },
  "web.pendingAlternative294": {
    "zh-CN": "待处理：",
    en: "Pending:",
  },
  "web.syncPendingShowingLastKnownState": {
    "zh-CN": "状态待同步 · 当前显示最后已知状态",
    en: "Sync pending · showing last known state",
  },
  "web.eachBoardManagesItsOwnFlowAndWorkItems": {
    "zh-CN": "每个看板独立管理流程与工作项。",
    en: "Each board manages its own flow and work items.",
  },
  "web.newBoard": {
    "zh-CN": "新建看板",
    en: "New board",
  },
  "web.stagesAlternative298": {
    "zh-CN": "个阶段",
    en: "stages",
  },
  "web.workItemsAlternative299": {
    "zh-CN": "个工作项",
    en: "work items",
  },
  "web.pendingAlternative300": {
    "zh-CN": " 个待处理",
    en: " pending",
  },
  "web.nothingPending": {
    "zh-CN": "暂无待处理",
    en: "Nothing pending",
  },
  "web.syncPending": {
    "zh-CN": "状态待同步",
    en: "Sync pending",
  },
  "web.moveRequirementsToCompletionWithClearStagesAndHandoff": {
    "zh-CN": "用明确的阶段和交接记录，将需求推进到完成。",
    en: "Move requirements to completion with clear stages and handoff records.",
  },
  "web.boardTitleUpdated": {
    "zh-CN": "看板标题已更新",
    en: "Board title updated",
  },
  "web.createYourFirstBoard": {
    "zh-CN": "创建第一个看板",
    en: "Create your first board",
  },
  "web.registerAProjectOnTheSessionsPageThenConfigure": {
    "zh-CN": "先在会话页登记项目，再配置人工和 Agent 阶段。",
    en: "Register a project on the Sessions page, then configure human and agent stages.",
  },
  "web.allBoards": {
    "zh-CN": "← 全部看板",
    en: "← All boards",
  },
  "web.pendingAlternative308": {
    "zh-CN": "个待处理",
    en: "pending",
  },
  "web.workItemsAlternative309": {
    "zh-CN": "工作项",
    en: "Work items",
  },
  "web.flowConfiguration": {
    "zh-CN": "流程配置",
    en: "Flow configuration",
  },
  "web.stagesAndTransitions": {
    "zh-CN": "阶段与流转",
    en: "Stages and transitions",
  },
  "web.completeOrArchiveAllActiveWorkItemsBeforeEditing": {
    "zh-CN": "完成或归档所有在途工作项后可调整流程；删除阶段前会提示具体影响。",
    en: "Complete or archive all active work items before editing the flow. Specific impacts are shown before stage deletion.",
  },
  "web.flowUpdated": {
    "zh-CN": "流程已更新",
    en: "Flow updated",
  },
  "web.searchWorkItemsAndTags": {
    "zh-CN": "搜索工作项、标签",
    en: "Search work items and tags",
  },
  "web.showArchived": {
    "zh-CN": "显示归档",
    en: "Show archived",
  },
  "web.copyConfiguration": {
    "zh-CN": "配置副本",
    en: "Copy configuration",
  },
  "web.deleteBoard": {
    "zh-CN": "删除看板",
    en: "Delete board",
  },
  "web.deleteThisBoardOnlyUnfinishedUnarchivedWorkItemsPrevent": {
    "zh-CN":
      "删除看板？仅存在未完成且未归档的工作项时不可删除。删除后将清理该看板的工作项和交接记录，已有会话保留。",
    en: "Delete this board? Only unfinished, unarchived work items prevent deletion. Board work items and handoff records will be removed; existing sessions are kept.",
  },
  "web.originalStageDeleted": {
    "zh-CN": "原阶段已删除",
    en: "Original stage deleted",
  },
  "web.concurrency": {
    "zh-CN": "{p0} · {p1} · 并发 {p2}",
    en: "{p0} · {p1} · concurrency {p2}",
  },
  "web.fixedEndpoint": {
    "zh-CN": "固定终点",
    en: "Fixed endpoint",
  },
  "web.historyOnlyCannotRestoreDirectly": {
    "zh-CN": "仅供查看历史，无法直接恢复",
    en: "History only; cannot restore directly",
  },
  "web.advanceManually": {
    "zh-CN": "人工主动推进",
    en: "Advance manually",
  },
  "web.noMatchingWorkItems": {
    "zh-CN": "没有匹配的工作项",
    en: "No matching work items",
  },
  "web.noWorkItemsYet": {
    "zh-CN": "暂无工作项",
    en: "No work items yet",
  },
  "web.archive": {
    "zh-CN": "归档",
    en: "Archive",
  },
  "web.highPriority": {
    "zh-CN": "高优先级",
    en: "High priority",
  },
  "web.lowPriority": {
    "zh-CN": "低优先级",
    en: "Low priority",
  },
  "web.normalPriority": {
    "zh-CN": "普通优先级",
    en: "Normal priority",
  },
  "web.title": {
    "zh-CN": "标题",
    en: "Title",
  },
  "web.requirements": {
    "zh-CN": "需求内容",
    en: "Requirements",
  },
  "web.priority": {
    "zh-CN": "优先级",
    en: "Priority",
  },
  "web.low": {
    "zh-CN": "低",
    en: "Low",
  },
  "web.normal": {
    "zh-CN": "普通",
    en: "Normal",
  },
  "web.high": {
    "zh-CN": "高",
    en: "High",
  },
  "web.tagsCommaSeparated": {
    "zh-CN": "标签（逗号分隔）",
    en: "Tags (comma-separated)",
  },
  "web.createWorkItem": {
    "zh-CN": "创建工作项",
    en: "Create work item",
  },
  "web.serverHandoffArtifacts": {
    "zh-CN": "服务端交接产物",
    en: "Server handoff artifacts",
  },
  "web.workItemDetailsAlternative339": {
    "zh-CN": "/ 工作项详情",
    en: "/ Work item details",
  },
  "web.archived": {
    "zh-CN": "已归档",
    en: "Archived",
  },
  "web.noAdditionalDescription": {
    "zh-CN": "无补充说明",
    en: "No additional description",
  },
  "web.currentStageActions": {
    "zh-CN": "当前阶段操作",
    en: "Current stage actions",
  },
  "web.currentStage": {
    "zh-CN": "当前阶段",
    en: "Current stage",
  },
  "web.theOriginalStageWasDeletedContentIsKeptFor": {
    "zh-CN": "原阶段已删除，保留工作项内容供查看；无法直接恢复、重试或推进。",
    en: "The original stage was deleted. Content is kept for viewing; it cannot be restored, retried or advanced directly.",
  },
  "web.theLinkedSessionWasDeletedExecutionAndHandoffRecords": {
    "zh-CN": "关联会话已删除，执行与交接记录仍保留。",
    en: "The linked session was deleted. Execution and handoff records are kept.",
  },
  "web.viewCurrentExecutionSession": {
    "zh-CN": "查看当前执行会话",
    en: "View current execution session",
  },
  "web.stopCancelPendingDispatch": {
    "zh-CN": "停止／取消待派发",
    en: "Stop / cancel pending dispatch",
  },
  "web.retryCurrentStage": {
    "zh-CN": "重试当前阶段",
    en: "Retry current stage",
  },
  "web.restore": {
    "zh-CN": "恢复",
    en: "Restore",
  },
  "web.handoffAndAdvance": {
    "zh-CN": "交接与推进",
    en: "Handoff and advance",
  },
  "web.enterHandoffNotesThenSubmitToEnterTheSelected": {
    "zh-CN": "填写交接说明，提交后进入所选阶段。",
    en: "Enter handoff notes, then submit to enter the selected stage.",
  },
  "web.targetStage": {
    "zh-CN": "目标阶段",
    en: "Target stage",
  },
  "web.handoffRecord": {
    "zh-CN": "交接记录",
    en: "Handoff record",
  },
  "web.submitHandoffAndAdvance": {
    "zh-CN": "提交交接并推进",
    en: "Submit handoff and advance",
  },
  "web.handoffHistory": {
    "zh-CN": "历史交接",
    en: "Handoff history",
  },
  "web.newestFirst": {
    "zh-CN": "最新在前",
    en: "Newest first",
  },
  "web.someHandoffRecordsWereLostWhenFlowStagesWere": {
    "zh-CN":
      "部分交接记录因流程阶段删除而丢失，历史记录不完整，关联产物原下载入口不可访问。",
    en: "Some handoff records were lost when flow stages were deleted. History is incomplete and original artifact links are inaccessible.",
  },
  "web.noHandoffRecordsYet": {
    "zh-CN": "暂无交接记录",
    en: "No handoff records yet",
  },
  "web.viewArtifact": {
    "zh-CN": "查看产物 {p0}",
    en: "View artifact {p0}",
  },
  "web.previewDownload": {
    "zh-CN": "预览 / 下载",
    en: "Preview / download",
  },
  "web.viewStageSession": {
    "zh-CN": "查看阶段会话",
    en: "View stage session",
  },
  "web.stageSessionDeleted": {
    "zh-CN": "阶段会话已删除",
    en: "Stage session deleted",
  },
  "web.deleteWorkbenchSessions": {
    "zh-CN": "删除工作台会话",
    en: "Delete workbench sessions",
  },
  "web.sessionActions": {
    "zh-CN": "会话操作",
    en: "Session actions",
  },
  "web.will": {
    "zh-CN": "将",
    en: "Will",
  },
  "web.unarchive": {
    "zh-CN": "取消归档",
    en: "Unarchive",
  },
  "web.sessionsAlternative367": {
    "zh-CN": "个会话。",
    en: "sessions.",
  },
  "web.sessionMessagesToolActivityAndCompactionHistoryWillBe": {
    "zh-CN": "会话消息、工具活动和压缩历史将永久删除，无法恢复。",
    en: "Session messages, tool activity and compaction history will be permanently deleted and cannot be recovered.",
  },
  "web.workbenchSessions": {
    "zh-CN": "工作台会话",
    en: "Workbench sessions",
  },
  "web.searchWorkbenchSessions": {
    "zh-CN": "搜索工作台会话",
    en: "Search workbench sessions",
  },
  "web.searchSessionNames": {
    "zh-CN": "搜索会话名称",
    en: "Search session names",
  },
  "web.newWorkbenchConversation": {
    "zh-CN": "新建工作台对话",
    en: "New workbench conversation",
  },
  "web.archivedSessions": {
    "zh-CN": "已归档会话",
    en: "Archived sessions",
  },
  "web.recentSessions": {
    "zh-CN": "最近会话",
    en: "Recent sessions",
  },
  "web.backToRecentSessions": {
    "zh-CN": "返回最近会话",
    en: "Back to recent sessions",
  },
  "web.viewArchive": {
    "zh-CN": "查看归档",
    en: "View archive",
  },
  "web.noArchivedSessions": {
    "zh-CN": "没有已归档会话",
    en: "No archived sessions",
  },
  "web.noMatchingSessions": {
    "zh-CN": "没有匹配的会话",
    en: "No matching sessions",
  },
  "web.newSession": {
    "zh-CN": "新会话",
    en: "New session",
  },
  "web.platformAssistant": {
    "zh-CN": "平台助手",
    en: "Platform assistant",
  },
  "web.environmentSessions": {
    "zh-CN": "环境会话",
    en: "Environment sessions",
  },
  "web.modelSettings": {
    "zh-CN": "模型设置",
    en: "Model settings",
  },
  "web.workbenchSessionList": {
    "zh-CN": "工作台会话列表",
    en: "Workbench session list",
  },
  "web.currentSessionActions": {
    "zh-CN": "当前会话操作",
    en: "Current session actions",
  },
  "web.selectMultiple": {
    "zh-CN": "多选",
    en: "Select multiple",
  },
  "web.compactContext": {
    "zh-CN": "压缩上下文",
    en: "Compact context",
  },
  "web.replying": {
    "zh-CN": "正在回答",
    en: "Replying",
  },
  "web.resumeUsesThePermissionFromTheStartOfThis": {
    "zh-CN": "恢复沿用本次执行启动时的权限；权限修改仅影响下一次发送。",
    en: "Resume uses the permission from the start of this execution. Permission changes apply to the next message only.",
  },
  "web.resumeFromCheckpoint": {
    "zh-CN": "从检查点恢复",
    en: "Resume from checkpoint",
  },
  "web.platformOperationsAwaitingApproval": {
    "zh-CN": "平台操作待批准",
    en: "Platform operations awaiting approval",
  },
  "web.reviewEachOperationAndItsParametersExecutionContinuesAfter": {
    "zh-CN": "请逐项核对操作及参数；全部处理后继续执行。",
    en: "Review each operation and its parameters. Execution continues after all are handled.",
  },
  "web.rejectThisOperation": {
    "zh-CN": "拒绝此项",
    en: "Reject this operation",
  },
  "web.approveThisOperation": {
    "zh-CN": "批准此项",
    en: "Approve this operation",
  },
  "web.approved": {
    "zh-CN": "已批准",
    en: "Approved",
  },
  "web.rejected": {
    "zh-CN": "已拒绝",
    en: "Rejected",
  },
  "web.rejectAll": {
    "zh-CN": "全部拒绝（",
    en: "Reject all (",
  },
  "web.items": {
    "zh-CN": "项）",
    en: "items)",
  },
  "web.approveAll": {
    "zh-CN": "全部批准（",
    en: "Approve all (",
  },
  "web.whatShallWeMoveForwardToday": {
    "zh-CN": "今天，一起推进什么？",
    en: "What shall we move forward today?",
  },
  "web.exploreEnvironmentsPlanTasksOrLetAnAgentContinue": {
    "zh-CN": "了解环境、编排任务，或让 Agent 接着做。",
    en: "Explore environments, plan tasks, or let an agent continue.",
  },
  "web.showDevelopmentEnvironmentStatus": {
    "zh-CN": "查看当前开发环境状态",
    en: "Show development environment status",
  },
  "web.explainHowToCreateABoardWorkflow": {
    "zh-CN": "介绍如何创建看板工作流",
    en: "Explain how to create a board workflow",
  },
  "web.showAvailableProjectsAndSessions": {
    "zh-CN": "查看有哪些项目和会话",
    en: "Show available projects and sessions",
  },
  "web.getRealInformationThroughPlatformTools": {
    "zh-CN": "通过平台工具获取真实信息",
    en: "Get real information through platform tools",
  },
  "web.recentWork": {
    "zh-CN": "最近的工作",
    en: "Recent work",
  },
  "web.projectSession": {
    "zh-CN": "项目会话 →",
    en: "Project session →",
  },
  "web.board": {
    "zh-CN": "看板 →",
    en: "Board →",
  },
  "web.writeOperationsFollowTheSelectedPermissionModeMissingKey": {
    "zh-CN": "写操作会按照所选权限模式审批，关键明细不足时先询问。",
    en: "Write operations follow the selected permission mode. Missing key details are clarified first.",
  },
  "web.addAWorkbenchModelAndApiKeyInSettings": {
    "zh-CN": "请先在设置中添加工作台模型和 API Key。",
    en: "Add a workbench model and API Key in Settings first.",
  },
  "web.workbenchMessage": {
    "zh-CN": "工作台消息",
    en: "Workbench message",
  },
  "web.describeYourGoalToTheWorkbench": {
    "zh-CN": "向工作台描述你的目标…",
    en: "Describe your goal to the workbench…",
  },
  "web.attached": {
    "zh-CN": "已附加",
    en: "Attached",
  },
  "web.images": {
    "zh-CN": "张图片",
    en: "images",
  },
  "web.removeImages": {
    "zh-CN": "移除图片",
    en: "Remove images",
  },
  "web.chooseModel": {
    "zh-CN": "选择模型",
    en: "Choose model",
  },
  "web.workbenchPermission": {
    "zh-CN": "工作台权限",
    en: "Workbench permission",
  },
  "web.addImage": {
    "zh-CN": "添加图片",
    en: "Add image",
  },
  "web.imagesMustBeSmallerThan2Mb": {
    "zh-CN": "图片应小于 2 MB",
    en: "Images must be smaller than 2 MB",
  },
  "web.stopReply": {
    "zh-CN": "停止回答",
    en: "Stop reply",
  },
  "web.send": {
    "zh-CN": "发送",
    en: "Send",
  },
  "web.sendEnter": {
    "zh-CN": "发送（Enter）",
    en: "Send (Enter)",
  },
  "web.enterToSendShiftCtrlEnterForANew": {
    "zh-CN": "Enter 发送 · Shift / Ctrl / ⌘ + Enter 换行",
    en: "Enter to send · Shift / Ctrl / ⌘ + Enter for a new line",
  },
  "web.referenceEnvironmentContent": {
    "zh-CN": "引用环境内容",
    en: "Reference environment content",
  },
  "web.toChooseTabEnterToInsert": {
    "zh-CN": "↑ ↓ 选择 · Tab / Enter 插入",
    en: "↑ ↓ to choose · Tab / Enter to insert",
  },
  "web.availableReferences": {
    "zh-CN": "可引用清单",
    en: "Available references",
  },
  "web.folder": {
    "zh-CN": "文件夹",
    en: "Folder",
  },
  "web.file": {
    "zh-CN": "文件",
    en: "File",
  },
  "web.environmentOfflineReconnectToSearchReferences": {
    "zh-CN": "环境离线，联网后可搜索引用",
    en: "Environment offline. Reconnect to search references.",
  },
  "web.searchingEnvironmentContent": {
    "zh-CN": "正在搜索环境内容…",
    en: "Searching environment content…",
  },
  "web.noMatchesTryAFilenamePathOrSkillName": {
    "zh-CN": "没有匹配项，试试文件名、路径或 Skill 名称",
    en: "No matches. Try a filename, path or skill name.",
  },
  "web.sendToEnvironmentAgent": {
    "zh-CN": "发送给环境 Agent",
    en: "Send to environment agent",
  },
  "web.describeATaskOrContinueTheConversationTypeTo": {
    "zh-CN": "描述任务或继续对话，输入 @ 引用…",
    en: "Describe a task or continue the conversation; type @ to reference…",
  },
  "web.environmentOfflineEditYourDraftAndSendItWhen": {
    "zh-CN": "环境离线，可编辑草稿，联网后主动发送",
    en: "Environment offline. Edit your draft and send it when reconnected.",
  },
  "web.discardUnsavedAgentChanges": {
    "zh-CN": "放弃智能体尚未保存的更改？",
    en: "Discard unsaved agent changes?",
  },
  "web.defineCollaborationThroughRoleInstructionsWhileKeepingProjectConventions":
    {
      "zh-CN": "以职责配置统一协作方式，保留环境中的项目规范。",
      en: "Define collaboration through role instructions while keeping project conventions.",
    },
  "web.newAgent": {
    "zh-CN": "新建智能体",
    en: "New agent",
  },
  "web.agentScopeAlternative437": {
    "zh-CN": "智能体作用域",
    en: "Agent scope",
  },
  "web.all": {
    "zh-CN": "全部",
    en: "All",
  },
  "web.system": {
    "zh-CN": "系统级",
    en: "System",
  },
  "web.environmentAlternative440": {
    "zh-CN": "环境级",
    en: "Environment",
  },
  "web.searchAgents": {
    "zh-CN": "搜索智能体",
    en: "Search agents",
  },
  "web.systemAcrossEnvironmentsAlternative442": {
    "zh-CN": "系统级 · 跨环境",
    en: "System · across environments",
  },
  "web.systemAgentsCanBeReusedAcrossEnvironmentsEnvironmentAgents": {
    "zh-CN": "系统级智能体可跨环境复用。环境级智能体仅用于所属开发环境。",
    en: "System agents can be reused across environments. Environment agents are limited to their own development environment.",
  },
  "web.inheritInstructions": {
    "zh-CN": "继承规范",
    en: "Inherit instructions",
  },
  "web.replaceInstructions": {
    "zh-CN": "替换规范",
    en: "Replace instructions",
  },
  "web.theConfigurationVersionIsCheckedOnSaveToPrevent": {
    "zh-CN": "保存时检查配置版本，避免覆盖其他修改。",
    en: "The configuration version is checked on save to prevent overwriting other changes.",
  },
  "web.deleteAgent": {
    "zh-CN": "删除智能体",
    en: "Delete agent",
  },
  "web.deleteAgentAlternative448": {
    "zh-CN": "删除智能体 ",
    en: "Delete agent ",
  },
  "web.noMatchingAgents": {
    "zh-CN": "没有匹配的智能体",
    en: "No matching agents",
  },
  "web.defineYourFirstAgent": {
    "zh-CN": "定义第一个智能体",
    en: "Define your first agent",
  },
  "web.configureDedicatedResponsibilitiesForCodingReviewOrValidation": {
    "zh-CN": "为编码、审阅或验证工作配置专属职责。",
    en: "Configure dedicated responsibilities for coding, review or validation.",
  },
  "web.identityRevoked": {
    "zh-CN": "身份已撤销",
    en: "Identity revoked",
  },
  "web.awaitingApproval": {
    "zh-CN": "等待批准",
    en: "Awaiting approval",
  },
  "web.online": {
    "zh-CN": "在线",
    en: "Online",
  },
  "web.available": {
    "zh-CN": "可用",
    en: "Available",
  },
  "web.notConfigured": {
    "zh-CN": "未配置",
    en: "Not configured",
  },
  "web.approveAccess": {
    "zh-CN": "批准接入",
    en: "Approve access",
  },
  "web.revokeThisEnvironmentIdentityTasksAlreadyRunningLocallyWill": {
    "zh-CN": "撤销此环境身份？本地已运行任务不会被自动停止。",
    en: "Revoke this environment identity? Tasks already running locally will not be stopped automatically.",
  },
  "web.revokeIdentity": {
    "zh-CN": "撤销身份",
    en: "Revoke identity",
  },
  "web.backToEnvironments": {
    "zh-CN": "返回环境列表",
    en: "Back to environments",
  },
  "web.waitingForConnectorPlatformInformation": {
    "zh-CN": "等待连接器上报平台信息",
    en: "Waiting for connector platform information",
  },
  "web.workspaceRootsAndToolStatusSyncWhenTheConnector": {
    "zh-CN":
      "连接器上线后同步工作根目录与工具状态。请在本机保存配置并启动连接器。",
    en: "Workspace roots and tool status sync when the connector comes online. Save configuration locally and start the connector.",
  },
  "web.overview": {
    "zh-CN": "概览",
    en: "Overview",
  },
  "web.directoriesAlternative464": {
    "zh-CN": "工作目录",
    en: "Directories",
  },
  "web.codingTools": {
    "zh-CN": "编码工具",
    en: "Coding tools",
  },
  "web.connectionInformation": {
    "zh-CN": "连接信息",
    en: "Connection information",
  },
  "web.connectionStatus": {
    "zh-CN": "连接状态",
    en: "Connection status",
  },
  "web.lastConnected": {
    "zh-CN": "最近连接",
    en: "Last connected",
  },
  "web.notConnectedYet": {
    "zh-CN": "尚未连接",
    en: "Not connected yet",
  },
  "web.itemsAlternative470": {
    "zh-CN": "个",
    en: "items",
  },
  "web.linkedProjects": {
    "zh-CN": "关联项目",
    en: "Linked projects",
  },
  "web.directoryReferences": {
    "zh-CN": "个目录引用",
    en: "directory references",
  },
  "web.viewSessions": {
    "zh-CN": "查看会话",
    en: "View sessions",
  },
  "web.noLinkedProjectsAddOneInProjectManagementOn": {
    "zh-CN": "尚未关联项目，可在会话页的项目管理中添加。",
    en: "No linked projects. Add one in Project management on the Sessions page.",
  },
  "web.savedAndReportedByTheClientTheServerDoes": {
    "zh-CN": "由客户端保存并上报，服务端不会自动限制为程序所在目录。",
    en: "Saved and reported by the client. The server does not automatically restrict directories to the program folder.",
  },
  "web.waitingForTheClientToConnectAndSyncWorkspace": {
    "zh-CN": "等待客户端连接并同步工作根目录。",
    en: "Waiting for the client to connect and sync workspace roots.",
  },
  "web.endpointsAndCredentialsAreConfiguredLocallyInTheEnvironment": {
    "zh-CN": "端点与凭据仅在环境本地配置。",
    en: "Endpoints and credentials are configured locally in the environment.",
  },
  "web.versionNotReported": {
    "zh-CN": "未上报版本",
    en: "Version not reported",
  },
  "web.waitingForConnectorToolStatus": {
    "zh-CN": "等待连接器上报工具状态。",
    en: "Waiting for connector tool status.",
  },
  "web.connectYourDevelopmentMachinesAndRunTasksInFamiliar": {
    "zh-CN": "连接你的开发机器，让任务在熟悉的项目目录中执行。",
    en: "Connect your development machines and run tasks in familiar project directories.",
  },
  "web.connectEnvironment": {
    "zh-CN": "接入环境",
    en: "Connect environment",
  },
  "web.environments": {
    "zh-CN": "个环境",
    en: "environments",
  },
  "web.pendingApproval": {
    "zh-CN": "待批准",
    en: "Pending approval",
  },
  "web.searchEnvironments": {
    "zh-CN": "搜索环境",
    en: "Search environments",
  },
  "web.allStatuses": {
    "zh-CN": "全部状态",
    en: "All statuses",
  },
  "web.waitingForFirstConnection": {
    "zh-CN": "等待首次连接",
    en: "Waiting for first connection",
  },
  "web.roots": {
    "zh-CN": "个根目录",
    en: "roots",
  },
  "web.viewDetails": {
    "zh-CN": "查看详情",
    en: "View details",
  },
  "web.noMatchingEnvironments": {
    "zh-CN": "没有匹配的环境",
    en: "No matching environments",
  },
  "web.noDevelopmentEnvironmentsYet": {
    "zh-CN": "还没有开发环境",
    en: "No development environments yet",
  },
  "web.createAOneTimeAccessCodeThenInstallAnd": {
    "zh-CN": "创建一次性接入码，在目标机器上安装并注册连接器。",
    en: "Create a one-time access code, then install and register the connector on the target machine.",
  },
  "web.settingsCategories": {
    "zh-CN": "设置分类",
    en: "Settings categories",
  },
  "web.workbenchInstructions": {
    "zh-CN": "工作台提示词",
    en: "Workbench instructions",
  },
  "web.downloadPackages": {
    "zh-CN": "安装包下载",
    en: "Download packages",
  },
  "web.appearanceAndApp": {
    "zh-CN": "外观与应用",
    en: "Appearance and app",
  },
  "web.keepAFamiliarWorkingExperienceOnDesktopAndMobile": {
    "zh-CN": "在电脑与手机上，保持熟悉的工作体验。",
    en: "Keep a familiar working experience on desktop and mobile.",
  },
  "web.bugpawLightDarkAndBugThemes": {
    "zh-CN": "沿用 BugPaw 的浅色、深色与 BUG 主题",
    en: "BugPaw light, dark and BUG themes",
  },
  "web.appTheme": {
    "zh-CN": "应用主题",
    en: "App theme",
  },
  "web.installOnDevice": {
    "zh-CN": "安装到设备",
    en: "Install on device",
  },
  "web.chooseInstallAppOrAddToHomeScreenIn": {
    "zh-CN": "在支持的浏览器菜单中选择“安装应用”或“添加到主屏幕”。",
    en: "Choose “Install app” or “Add to Home Screen” in a supported browser menu.",
  },
  "web.connectionStatusIsAvailableOfflineNewTasksMustBe": {
    "zh-CN": "离线时可查看连接提示；新任务需联网后主动发送。",
    en: "Connection status is available offline. New tasks must be sent manually after reconnecting.",
  },
  "web.savedChangesApplyToTheNextWorkbenchTurn": {
    "zh-CN": "已保存，将从下一轮工作台对话生效。",
    en: "Saved. Changes apply to the next workbench turn.",
  },
  "web.workbenchAgentSystemInstructions": {
    "zh-CN": "工作台 Agent 系统提示词",
    en: "Workbench agent system instructions",
  },
  "web.configureGeneralBehaviorForAllWorkbenchSessionsLeaveBlank": {
    "zh-CN":
      "配置工作台 Agent 的通用行为规范，适用于所有工作台会话。允许留空，留空后不注入这部分规范。",
    en: "Configure general behavior for all workbench sessions. Leave blank to omit these instructions.",
  },
  "web.productInformationAndToolSchemasAreMaintainedByThe": {
    "zh-CN":
      "产品功能介绍和 tool schema 由系统维护，不可编辑。权限与工具审批仍由系统执行。",
    en: "Product information and tool schemas are maintained by the system and cannot be edited. Permissions and tool approvals remain enforced by the system.",
  },
  "web.loadingAlternative506": {
    "zh-CN": "正在加载…",
    en: "Loading…",
  },
  "web.reload": {
    "zh-CN": "重新加载",
    en: "Reload",
  },
  "web.systemInstructionsBehavior": {
    "zh-CN": "系统提示词（行为规范）",
    en: "System instructions (behavior)",
  },
  "web.40000Characters": {
    "zh-CN": "/ 40000 字符 ·",
    en: "/ 40000 characters ·",
  },
  "web.unsavedChanges": {
    "zh-CN": "有未保存的更改",
    en: "Unsaved changes",
  },
  "web.inSyncWithSavedContent": {
    "zh-CN": "已与保存内容同步",
    en: "In sync with saved content",
  },
  "web.changesApplyToTheNextTurnRunningTurnsAnd": {
    "zh-CN": "。保存后下一轮生效，正在运行或等待审批的轮次沿用原规范。",
    en: ". Changes apply to the next turn. Running turns and turns awaiting approval keep the previous instructions.",
  },
  "web.saveInstructions": {
    "zh-CN": "保存提示词",
    en: "Save instructions",
  },
  "web.defaultInstructionsLoadedSaveToApply": {
    "zh-CN": "已填入默认提示词，保存后生效。",
    en: "Default instructions loaded. Save to apply.",
  },
  "web.restoreDefaults": {
    "zh-CN": "恢复默认",
    en: "Restore defaults",
  },
  "web.reloadSavedContent": {
    "zh-CN": "重新加载已保存内容",
    en: "Reload saved content",
  },
  "web.signInToObtainTemporaryAuthorizedLinksValidityChanges": {
    "zh-CN": "登录后获取临时授权链接。有效期修改仅影响新获取的链接。",
    en: "Sign in to obtain temporary authorized links. Validity changes apply only to new links.",
  },
  "web.downloadLinkValidityMinutes": {
    "zh-CN": "下载链接有效期（分钟）",
    en: "Download link validity (minutes)",
  },
  "web.saveDownloadSettings": {
    "zh-CN": "保存下载配置",
    en: "Save download settings",
  },
  "web.temporaryDownloadLink": {
    "zh-CN": "临时下载链接",
    en: "Temporary download link",
  },
  "web.validUntil": {
    "zh-CN": "· 有效至",
    en: "· Valid until",
  },
  "web.copyFailedUseTheTemporaryDownloadLink": {
    "zh-CN": "复制失败，请使用临时下载链接",
    en: "Copy failed. Use the temporary download link.",
  },
  "web.installationAuthorizationCopied": {
    "zh-CN": "已复制安装授权",
    en: "Installation authorization copied",
  },
  "web.copyInstallationAuthorization": {
    "zh-CN": "复制安装授权",
    en: "Copy installation authorization",
  },
  "web.cliModel": {
    "zh-CN": "CLI 模型",
    en: "CLI model",
  },
  "web.useConfiguredValue": {
    "zh-CN": "跟随配置",
    en: "Use configured value",
  },
  "web.enterModelId": {
    "zh-CN": "手动输入模型 ID…",
    en: "Enter model ID…",
  },
  "web.reasoningDepth": {
    "zh-CN": "思考深度",
    en: "Reasoning depth",
  },
  "web.cliReasoningDepth": {
    "zh-CN": "CLI 思考深度",
    en: "CLI reasoning depth",
  },
  "web.refreshModelCapabilities": {
    "zh-CN": "刷新模型能力",
    en: "Refresh model capabilities",
  },
  "web.loadingCapabilities": {
    "zh-CN": "读取能力中…",
    en: "Loading capabilities…",
  },
  "web.customModel": {
    "zh-CN": "自定义模型",
    en: "Custom model",
  },
  "web.customModelId": {
    "zh-CN": "自定义模型 ID",
    en: "Custom model ID",
  },
  "web.modelId": {
    "zh-CN": "模型 ID",
    en: "Model ID",
  },
  "web.applyModel": {
    "zh-CN": "应用模型",
    en: "Apply model",
  },
  "web.reasoningMode": {
    "zh-CN": "思考方式",
    en: "Reasoning mode",
  },
  "web.claudeReasoningMode": {
    "zh-CN": "Claude 思考方式",
    en: "Claude reasoning mode",
  },
  "web.adaptive": {
    "zh-CN": "自适应",
    en: "Adaptive",
  },
  "web.fixedBudget": {
    "zh-CN": "固定预算",
    en: "Fixed budget",
  },
  "web.disableReasoning": {
    "zh-CN": "关闭思考",
    en: "Disable reasoning",
  },
  "web.reasoningTokenBudget": {
    "zh-CN": "思考 token 预算",
    en: "Reasoning token budget",
  },
  "web.configurationDetails": {
    "zh-CN": "配置详情",
    en: "Configuration details",
  },
  "web.loadingCapabilitiesAlternative543": {
    "zh-CN": " · 读取能力中…",
    en: " · Loading capabilities…",
  },
  "web.requestedConfiguration": {
    "zh-CN": "请求配置：",
    en: "Requested configuration:",
  },
  "web.cliNativeDefault": {
    "zh-CN": "CLI 原生默认",
    en: "CLI native default",
  },
  "web.cliNativeDefaultDepth": {
    "zh-CN": "CLI 原生默认深度",
    en: "CLI native default depth",
  },
  "web.modelAlternative547": {
    "zh-CN": "（模型：",
    en: "(model:",
  },
  "web.depth": {
    "zh-CN": "；深度：",
    en: "; depth:",
  },
  "web.chooseAnEnvironmentToLoadAvailableModelsAndReasoning": {
    "zh-CN": "选择环境后可读取可用模型与思考档位，也可手动输入模型。",
    en: "Choose an environment to load available models and reasoning levels, or enter a model manually.",
  },
  "web.chooseASpecificModelToViewKnownReasoningLevels": {
    "zh-CN": "选择具体模型后显示已知思考档位。",
    en: "Choose a specific model to view known reasoning levels.",
  },
  "web.theCurrentModelDoesNotSupportTheSelectedDepth": {
    "zh-CN": "当前模型不支持已选深度，请重新选择或跟随配置。",
    en: "The current model does not support the selected depth. Choose another or use the configured value.",
  },
  "web.cliRuntimeConfiguration": {
    "zh-CN": "CLI 运行配置",
    en: "CLI runtime configuration",
  },
  "web.environmentForCapabilityLookup": {
    "zh-CN": "读取能力的环境",
    en: "Environment for capability lookup",
  },
  "web.chooseEnvironment": {
    "zh-CN": "请选择环境",
    en: "Choose environment",
  },
  "web.select": {
    "zh-CN": "选择",
    en: "Select",
  },
  "web.sessionActionsAlternative556": {
    "zh-CN": "会话操作：",
    en: "Session actions:",
  },
  "web.selectAllInCurrentList": {
    "zh-CN": "全选当前列表",
    en: "Select all in current list",
  },
  "web.exitSelection": {
    "zh-CN": "退出多选",
    en: "Exit selection",
  },
  "web.selected": {
    "zh-CN": "已选",
    en: "Selected",
  },
  "web.itemsTheActionsBelowApplyOnlyToSelectedSessions": {
    "zh-CN": "项，以下操作仅作用于所选会话",
    en: "items; the actions below apply only to selected sessions",
  },
  "web.deleteAll": {
    "zh-CN": "全部删除",
    en: "Delete all",
  },
  "web.unarchiveAll": {
    "zh-CN": "全部取消归档",
    en: "Unarchive all",
  },
  "web.archiveAll": {
    "zh-CN": "全部归档",
    en: "Archive all",
  },
  "web.thisSessionWasDeletedNativeEnvironmentRecordsAreKept": {
    "zh-CN": "此会话已删除，环境端原生记录仍保留。",
    en: "This session was deleted. Native environment records are kept.",
  },
  "web.sending": {
    "zh-CN": "发送中",
    en: "Sending",
  },
  "web.sent": {
    "zh-CN": "已发送",
    en: "Sent",
  },
  "web.sendResultUnconfirmedCheckExecutionStatusBeforeRetrying": {
    "zh-CN": "发送未确认，请检查执行状态后再重试",
    en: "Send result unconfirmed. Check execution status before retrying.",
  },
  "web.filterProjects": {
    "zh-CN": "筛选项目",
    en: "Filter projects",
  },
  "web.allProjects": {
    "zh-CN": "全部项目",
    en: "All projects",
  },
  "web.searchSessions": {
    "zh-CN": "搜索会话",
    en: "Search sessions",
  },
  "web.newSessionAlternative571": {
    "zh-CN": "新建会话：",
    en: "New session:",
  },
  "web.sessionTarget": {
    "zh-CN": "选择 CLI、环境和目录",
    en: "Choose CLI, environment, and directory",
  },
  "web.defaultRole": {
    "zh-CN": "默认职责",
    en: "Default role",
  },
  "web.unknownEnvironment": {
    "zh-CN": "未知环境",
    en: "Unknown environment",
  },
  "web.noArchivedSessionsInThisProject": {
    "zh-CN": "此项目没有已归档会话",
    en: "No archived sessions in this project",
  },
  "web.noSessionsInThisProjectYet": {
    "zh-CN": "此项目还没有会话",
    en: "No sessions in this project yet",
  },
  "web.addAProjectInProjectManagementThenCreateA": {
    "zh-CN": "先在项目管理中添加项目，再创建会话。",
    en: "Add a project in Project management, then create a session.",
  },
  "web.pinSession": { "zh-CN": "置顶", en: "Pin" },
  "web.unpinSession": { "zh-CN": "取消置顶", en: "Unpin" },
  "web.pinnedSessions": { "zh-CN": "置顶", en: "Pinned" },
  "web.sessionList": {
    "zh-CN": "会话列表",
    en: "Session list",
  },
  "web.selectASessionToCollaborate": {
    "zh-CN": "选择会话，开始协作",
    en: "Select a session to collaborate",
  },
  "web.sessionsRunInYourDevelopmentEnvironmentClosingThePage": {
    "zh-CN": "会话在你的开发环境运行，关闭网页不会中断执行。",
    en: "Sessions run in your development environment. Closing the page does not interrupt execution.",
  },
  "web.theContentBelowWasLoadedEarlierOnThisPage": {
    "zh-CN": "以下是当前页面先前加载的内容，可能不是最新状态。",
    en: "The content below was loaded earlier on this page and may be out of date.",
  },
  "web.loadingSessionHistoryFromTheEnvironment": {
    "zh-CN": "正在从环境端加载会话记录…",
    en: "Loading session history from the environment…",
  },
  "web.liveEventsExceededTheBufferReferToNativeEnvironment": {
    "zh-CN": "实时事件超出缓冲窗口，完整记录以环境原生历史为准。",
    en: "Live events exceeded the buffer. Refer to native environment history for the full record.",
  },
  "web.sendYourFirstMessageToolOperationsRunInThe": {
    "zh-CN": "发送第一条消息。工具操作将在所选项目目录中执行。",
    en: "Send your first message. Tool operations run in the selected project directory.",
  },
  "web.viewAndRespond": {
    "zh-CN": "查看并回答",
    en: "View and respond",
  },
  "web.thisSessionIsArchivedUnarchiveToSendMessages": {
    "zh-CN": "此会话已归档，取消归档后可继续发送。",
    en: "This session is archived. Unarchive to send messages.",
  },
  "web.restoringLiveConnectionSyncingPeriodically": {
    "zh-CN": "实时连接恢复中，正在定期同步",
    en: "Restoring live connection; syncing periodically",
  },
  "web.theCurrentAgentNoLongerAppliesToThisSession": {
    "zh-CN": "当前智能体已不适用于此会话，请重新选择智能体或默认 Agent。",
    en: "The current agent no longer applies to this session. Choose another agent or the default agent.",
  },
  "web.sessionAgent": {
    "zh-CN": "会话 Agent",
    en: "Session agent",
  },
  "web.defaultAgent": {
    "zh-CN": "默认 Agent",
    en: "Default agent",
  },
  "web.sessionPermission": {
    "zh-CN": "会话权限",
    en: "Session permission",
  },
  "web.stop": {
    "zh-CN": "停止",
    en: "Stop",
  },
  "web.deleteSessions": {
    "zh-CN": "删除会话",
    en: "Delete sessions",
  },
  "web.archiveSessions": {
    "zh-CN": "归档会话",
    en: "Archive sessions",
  },
  "web.serverSessionIndexesWillBePermanentlyDeletedNativeEnvironment": {
    "zh-CN":
      "服务端会话索引将永久删除，环境端原生记录仍保留。看板交接记录不会删除。",
    en: "Server session indexes will be permanently deleted. Native environment records and board handoff records are kept.",
  },
  "web.nativeApprovalsAndUserInput": {
    "zh-CN": "原生审批与用户输入",
    en: "Native approvals and user input",
  },
  "web.toolOperation": {
    "zh-CN": "工具操作",
    en: "Tool operation",
  },
  "web.finished": {
    "zh-CN": "已结束",
    en: "Finished",
  },
  "web.theNativeRuntimeReportedAFailureCheckLocalConfiguration": {
    "zh-CN": "原生运行时返回执行失败，请检查本地配置或会话。",
    en: "The native runtime reported a failure. Check local configuration or the session.",
  },
  "web.nativeRuntimeError": {
    "zh-CN": "原生运行时错误",
    en: "Native runtime error",
  },
  "web.modelConnectionRestoredTheTaskHasResumed": {
    "zh-CN": "模型连接已恢复，任务已继续。",
    en: "Model connection restored. The task has resumed.",
  },
  "web.automaticReconnectionEndedCheckThisExecutionSResult": {
    "zh-CN": "自动重连已结束，请查看本轮执行结果。",
    en: "Automatic reconnection ended. Check this execution's result.",
  },
  "web.modelConnectionInterruptedReconnectingAutomatically": {
    "zh-CN": "模型连接暂时中断，正在自动重连：{p0}",
    en: "Model connection interrupted. Reconnecting automatically: {p0}",
  },
  "web.nativeResponseJsonFillAccordingToTheRequest": {
    "zh-CN": "原生响应 JSON（按请求内容填写）",
    en: "Native response JSON (fill according to the request)",
  },
  "web.reject": {
    "zh-CN": "拒绝",
    en: "Reject",
  },
  "web.approveThisTime": {
    "zh-CN": "批准本次",
    en: "Approve this time",
  },
  "web.submitAnswer": {
    "zh-CN": "提交回答",
    en: "Submit answer",
  },
  "web.invalidJsonFormat": {
    "zh-CN": "JSON 格式不正确",
    en: "Invalid JSON format",
  },
  "web.submitResponse": {
    "zh-CN": "提交响应",
    en: "Submit response",
  },
  "web.numberAssignedAfterSaving": {
    "zh-CN": "保存后分配编号",
    en: "Number assigned after saving",
  },
  "web.invalidStageNumberReloadIfThisPersistsContactYour": {
    "zh-CN": "阶段编号异常，请重新加载；仍异常时请联系管理员",
    en: "Invalid stage number. Reload; if this persists, contact your administrator.",
  },
  "web.waitingForConnectorUpgradeDispatchResumesAutomaticallyAfterUpgrade": {
    "zh-CN": "等待连接器升级，升级后自动继续派发，无需重试任务。",
    en: "Waiting for connector upgrade. Dispatch resumes automatically after upgrade; no task retry is needed.",
  },
  "web.newExecutionHandoffToolsUseStageShortNumbersUuids": {
    "zh-CN":
      "新执行交接工具使用阶段短编号；历史指令中写死的 UUID 不会自动改写，请核对。",
    en: "New execution handoff tools use stage short numbers. UUIDs hardcoded in historical instructions are not rewritten automatically; review them.",
  },
  "web.viewImage": {
    "zh-CN": "查看图片",
    en: "View image",
  },
  "web.workbenchMessageHistory": {
    "zh-CN": "工作台消息记录",
    en: "Workbench message history",
  },
  "web.jumpToLatestMessage": {
    "zh-CN": "回到最新消息",
    en: "Jump to latest message",
  },
  "web.failed": {
    "zh-CN": "失败",
    en: "Failed",
  },
  "web.interruptedAlternative617": {
    "zh-CN": "已中断",
    en: "Interrupted",
  },
  "web.readPlatformInformation": {
    "zh-CN": "读取平台信息",
    en: "Read platform information",
  },
  "web.readWorkbenchInstructions": {
    "zh-CN": "查询工作台提示词",
    en: "Read workbench instructions",
  },
  "web.updateWorkbenchInstructions": {
    "zh-CN": "修改工作台提示词",
    en: "Update workbench instructions",
  },
  "web.readEnvironmentExecutionResult": {
    "zh-CN": "查询环境执行结果",
    en: "Read environment execution result",
  },
  "web.sendEnvironmentSession": {
    "zh-CN": "发送环境会话",
    en: "Send environment session",
  },
  "web.manageBoards": {
    "zh-CN": "管理看板",
    en: "Manage boards",
  },
  "web.manageEnvironmentAgents": {
    "zh-CN": "管理环境智能体",
    en: "Manage environment agents",
  },
  "web.activities": {
    "zh-CN": "{p0} 项活动{p1}",
    en: "Activities: {p0}{p1}",
  },
  "web.failedAlternative626": {
    "zh-CN": " · {p0} 项失败",
    en: " · {p0} failed",
  },
  "web.processingAlternative627": {
    "zh-CN": " · 处理中",
    en: " · Processing",
  },
  "web.callArguments": {
    "zh-CN": "调用参数",
    en: "Call arguments",
  },
  "web.rawData": {
    "zh-CN": "原始数据",
    en: "Raw data",
  },
  "web.executionResult": {
    "zh-CN": "执行结果",
    en: "Execution result",
  },
  "web.stageDeletionCount": {
    "zh-CN": "将删除以下 {count} 个阶段：",
    en: "Stages to delete: {count}",
  },
  "web.deletionImpactCounts": {
    "zh-CN":
      "影响 {items} 个工作项、{handoffs} 条交接记录、{artifacts} 个产物。",
    en: "Affected work items: {items}; handoff records: {handoffs}; artifacts: {artifacts}.",
  },
  "web.sessionActionCount": {
    "zh-CN": "将{action} {count} 个会话。",
    en: "{action} sessions: {count}.",
  },
  "web.selectionCount": {
    "zh-CN": "已选 {count} 项，以下操作仅作用于所选会话",
    en: "Selected sessions: {count}. The actions below apply only to these sessions.",
  },
  "web.approveCount": {
    "zh-CN": "全部批准（{count} 项）",
    en: "Approve all ({count})",
  },
  "web.rejectCount": {
    "zh-CN": "全部拒绝（{count} 项）",
    en: "Reject all ({count})",
  },
  "web.runtimeSummary": {
    "zh-CN":
      "请求配置：{model} · {effort}（模型：{modelSource}；深度：{effortSource}）",
    en: "Requested configuration: {model} · {effort} (model: {modelSource}; depth: {effortSource})",
  },
  "web.selectedSessionLabel": { "zh-CN": "选择 {title}", en: "Select {title}" },
  "web.attachedImages": {
    "zh-CN": "已附加 {count} 张图片",
    en: "Attached images: {count}",
  },
} as const;
