/** 本机控制台资源与服务端资源一起校验和发行。 */
export const consoleMessages = {
  "console.claudeMode": {
    "zh-CN": "运行方式",
    en: "Runtime mode",
  },
  "console.claudeCustom": {
    "zh-CN": "自定义 API 端点",
    en: "Custom API endpoint",
  },
  "console.claudeEnvironment": {
    "zh-CN": "使用环境 Claude Code",
    en: "Use environment Claude Code",
  },
  "console.claudeLoginGuide": {
    "zh-CN": "CLI 已就绪。请使用运行连接器的同一系统账号，在官方客户端执行 /login，并用 /status 确认认证方式。模型和额度以客户端显示为准。",
    en: "The CLI is ready. As the OS user running the connector, run /login in the official client and use /status to verify authentication. Check the client for models and usage limits.",
  },
  "console.claudeCheck": {
    "zh-CN": "检查环境",
    en: "Check environment",
  },
  "console.claudeChecking": {
    "zh-CN": "正在检查 CLI…",
    en: "Checking the CLI\u2026",
  },
  "console.claudeReady": {
    "zh-CN": "CLI 可运行 · {version}",
    en: "CLI is executable \u00b7 {version}",
  },
  "console.claudeModeSave": {
    "zh-CN": "保存 Claude Code 模式",
    en: "Save Claude Code mode",
  },
  "console.claudeModeUnsaved": {
    "zh-CN": "Claude Code 模式或路径尚未保存",
    en: "Claude Code mode or path has unsaved changes",
  },
  "console.claudeSupport": {
    "zh-CN": "Claude 支持",
    en: "Claude support",
  },
  "console.claudeAccount": {
    "zh-CN": "连接器运行账户",
    en: "Connector account",
  },
  "console.claudeSupportDraft": {
    "zh-CN": "保存 Claude 模式和路径后查看安装计划。路径留空时查找 PATH 和官方安装位置。",
    en: "Save the Claude mode and path to see the installation plan. Leave the path blank to search PATH and the official install location.",
  },
  "console.claudeMissing": {
    "zh-CN": "未检测到可运行的 CLI",
    en: "No executable CLI detected",
  },
  "console.claudeSdkReady": {
    "zh-CN": "{version} 可加载",
    en: "{version} loadable",
  },
  "console.claudeSdkMissing": {
    "zh-CN": "缺少所需版本 {version}",
    en: "Required version {version} is missing",
  },
  "console.claudeSdkOptional": {
    "zh-CN": "此模式无需安装 {version}",
    en: "Version {version} is optional in this mode",
  },
  "console.claudeInstallPlan": {
    "zh-CN": "将下载的组件",
    en: "Components to download",
  },
  "console.claudeInstallSource": {
    "zh-CN": "来源 {value}",
    en: "Source {value}",
  },
  "console.claudeInstallDestination": {
    "zh-CN": "安装至 {value}",
    en: "Install to {value}",
  },
  "console.claudeInstall": {
    "zh-CN": "安装 Claude 支持",
    en: "Install Claude support",
  },
  "console.claudeRecheck": {
    "zh-CN": "重新检测",
    en: "Check again",
  },
  "console.claudeSupportChanged": {
    "zh-CN": "其他窗口已更改 Claude 设置。请重新打开控制台以载入最新设置。",
    en: "Claude settings changed in another window. Reopen the console to load the latest settings.",
  },
  "console.claudePlanChanged": {
    "zh-CN": "缺少的组件已变化。请核对更新后的安装计划再重试。",
    en: "The missing components have changed. Review the updated installation plan before retrying.",
  },
  "console.claudeSupportIncomplete": {
    "zh-CN": "组件检查尚未通过。请查看检测结果后重试。",
    en: "Some components are still unavailable. Review the check results before retrying.",
  },
  "console.operationFailed": {
    "zh-CN": "操作失败",
    en: "Operation failed",
  },
  "console.unsavedChangesSavedBeforeStartingOrRegistering": {
    "zh-CN": "有未保存的更改 · 启动或注册时会先保存",
    en: "Unsaved changes · saved before starting or registering",
  },
  "console.runningStopTheConnectorBeforeChangingConfiguration": {
    "zh-CN": "运行中 · 修改配置前请先停止连接器",
    en: "Running · stop the connector before changing configuration",
  },
  "console.configurationSavedLocally": {
    "zh-CN": "配置已保存到本机",
    en: "Configuration saved locally",
  },
  "console.processing": {
    "zh-CN": "正在处理…",
    en: "Processing…",
  },
  "console.operationSucceeded": {
    "zh-CN": "操作成功",
    en: "Operation succeeded",
  },
  "console.unknown": {
    "zh-CN": "状态未知，请检查本机控制接口",
    en: "Status unknown; check the local control interface",
  },
  "console.stopped": {
    "zh-CN": "已停止",
    en: "Stopped",
  },
  "console.connecting": {
    "zh-CN": "正在连接",
    en: "Connecting",
  },
  "console.connected": {
    "zh-CN": "已连接",
    en: "Connected",
  },
  "console.temporarilyOfflineRetryingAutomatically": {
    "zh-CN": "暂时离线，自动重试",
    en: "Temporarily offline; retrying automatically",
  },
  "console.awaitingPlatformApproval": {
    "zh-CN": "等待平台批准",
    en: "Awaiting platform approval",
  },
  "console.accessRevoked": {
    "zh-CN": "接入已撤销",
    en: "Access revoked",
  },
  "console.registered": {
    "zh-CN": "已注册",
    en: "Registered",
  },
  "console.notRegistered": {
    "zh-CN": "未注册",
    en: "Not registered",
  },
  "console.synced": {
    "zh-CN": "已向服务端同步 ",
    en: "Synced ",
  },
  "console.workspaceRootsToTheServer": {
    "zh-CN": " 个工作根目录",
    en: " workspace roots to the server",
  },
  "console.configurationAndToolCredentialsAreStoredOnlyOnThis": {
    "zh-CN": "配置和工具凭据只保存到当前电脑。",
    en: "Configuration and tool credentials are stored only on this computer.",
  },
  "console.loadingModelList": {
    "zh-CN": "正在获取模型列表…",
    en: "Loading model list…",
  },
  "console.testingConnection": {
    "zh-CN": "正在测试连接…",
    en: "Testing connection…",
  },
  "console.loaded": {
    "zh-CN": "已获取 ",
    en: "Loaded ",
  },
  "console.modelsChooseUsingTheMenuBesideTheModelField": {
    "zh-CN": " 个模型，请使用模型框右侧下拉按钮选择",
    en: " models. Choose using the menu beside the model field.",
  },
  "console.theServiceReturnedAnEmptyModelListYouCan": {
    "zh-CN": "服务返回空模型列表，可手动填写模型",
    en: "The service returned an empty model list. You can enter a model manually.",
  },
  "console.connectedAlternative22": {
    "zh-CN": "连接成功 · ",
    en: "Connected · ",
  },
  "console.msApiGenerationTestOnlyNotFullAgentValidation": {
    "zh-CN": " ms（仅验证 API 生成，非完整 Agent 验收）",
    en: " ms (API generation test only; not full agent validation)",
  },
  "console.configuredLeaveBlankToKeep": {
    "zh-CN": "已配置，留空保留",
    en: "Configured; leave blank to keep",
  },
  "console.notConfigured": {
    "zh-CN": "尚未配置",
    en: "Not configured",
  },
  "console.saved": {
    "zh-CN": "已保存 ",
    en: "Saved ",
  },
  "console.roots": {
    "zh-CN": " 个根目录",
    en: " roots",
  },
  "console.checkTheHighlightedSettings": {
    "zh-CN": "请检查标记的配置项",
    en: "Check the highlighted settings",
  },
  "console.enterAOneTimeAccessCode": {
    "zh-CN": "请填写一次性接入码",
    en: "Enter a one-time access code",
  },
  "console.configurationLoaded": {
    "zh-CN": "配置已读取",
    en: "Configuration loaded",
  },
  "console.cannotReachTheLocalConsoleReopenTheClient": {
    "zh-CN": "无法连接本机控制台，请重新打开客户端",
    en: "Cannot reach the local console. Reopen the client.",
  },
  "console.localConsole127001": {
    "zh-CN": "本地控制台 · 127.0.0.1",
    en: "Local console · 127.0.0.1",
  },
  "console.manageThisDevelopmentEnvironment": {
    "zh-CN": "管理这台开发环境",
    en: "Manage this development environment",
  },
  "console.configureConnectionsWorkspaceRootsAndCodingToolsLocally": {
    "zh-CN": "在本机配置连接、工作目录与编码工具。",
    en: "Configure connections, workspace roots and coding tools locally.",
  },
  "console.loadingStatus": {
    "zh-CN": "正在读取状态…",
    en: "Loading status…",
  },
  "console.startConnector": {
    "zh-CN": "启动连接器",
    en: "Start connector",
  },
  "console.stopConnector": {
    "zh-CN": "停止连接器",
    en: "Stop connector",
  },
  "console.overview": {
    "zh-CN": "概览",
    en: "Overview",
  },
  "console.directories": {
    "zh-CN": "工作目录",
    en: "Directories",
  },
  "console.cliTools": {
    "zh-CN": "CLI 工具",
    en: "CLI tools",
  },
  "console.startup": {
    "zh-CN": "启动设置",
    en: "Startup",
  },
  "console.environmentConfiguration": {
    "zh-CN": "环境配置",
    en: "Environment configuration",
  },
  "console.connectToYourBugpawRelayServer": {
    "zh-CN": "连接到你的 BugPaw Relay 服务端。",
    en: "Connect to your BugPaw Relay server.",
  },
  "console.serverUrl": {
    "zh-CN": "服务端地址",
    en: "Server URL",
  },
  "console.environmentName": {
    "zh-CN": "环境名称",
    en: "Environment name",
  },
  "console.registerAgainAfterChangingTheServerStopARunning": {
    "zh-CN": "更换服务端后需要重新注册。连接器运行时先停止，再修改配置。",
    en: "Register again after changing the server. Stop a running connector before changing configuration.",
  },
  "console.connectToPlatform": {
    "zh-CN": "接入平台",
    en: "Connect to platform",
  },
  "console.generateAOneTimeAccessCodeOnThePlatform": {
    "zh-CN":
      "在平台环境页生成一次性接入码，填写后注册，再回平台批准此环境。注册前自动保存本页和工作目录配置。",
    en: "Generate a one-time access code on the platform Environments page, enter it to register, then approve this environment on the platform. This page and directory settings are saved before registration.",
  },
  "console.oneTimeAccessCode": {
    "zh-CN": "一次性接入码",
    en: "One-time access code",
  },
  "console.registerAndConnect": {
    "zh-CN": "注册并连接",
    en: "Register and connect",
  },
  "console.workspaceRoots": {
    "zh-CN": "工作根目录",
    en: "Workspace roots",
  },
  "console.configureMultipleWorkspaceRootsSaveAndStartTheConnector": {
    "zh-CN":
      "可以配置多个工作根目录。保存并启动连接器后，服务端项目目录选择器会显示这些目录。",
    en: "Configure multiple workspace roots. Save and start the connector to make them available in the server project directory picker.",
  },
  "console.workspaceRootsOneAbsolutePathPerLine": {
    "zh-CN": "工作根目录（每行一个绝对路径）",
    en: "Workspace roots (one absolute path per line)",
  },
  "console.enterFullPathsToExistingFoldersTheRelativeProject": {
    "zh-CN":
      "填写已有文件夹的完整路径；项目的相对路径 “.” 表示根目录本身。启动程序所在文件夹仅为首次配置的默认值。",
    en: "Enter full paths to existing folders. The relative project path “.” means the root itself. The program folder is only the default for initial configuration.",
  },
  "console.forOfficialAccountsRunBugpawRelayCodexLoginIn": {
    "zh-CN":
      "使用官方账号时，在命令行运行 bugpaw-relay codex-login。自定义模型服务填写以下配置。",
    en: "For official accounts, run bugpaw-relay codex-login in a terminal. For custom model services, enter the settings below.",
  },
  "console.apiUrl": {
    "zh-CN": "API 地址",
    en: "API URL",
  },
  "console.httpTransmitsInPlainTextMakeSureTheNetwork": {
    "zh-CN": "HTTP 为明文传输，请确认网络可信",
    en: "HTTP transmits in plain text. Make sure the network is trusted.",
  },
  "console.model": {
    "zh-CN": "模型",
    en: "Model",
  },
  "console.fetchModels": {
    "zh-CN": "获取模型列表",
    en: "Fetch models",
  },
  "console.testConnection": {
    "zh-CN": "测试连接",
    en: "Test connection",
  },
  "console.youCanEnterAModelManuallyTestingCallsThe": {
    "zh-CN": "支持手动填写模型；测试连接会调用所选模型，可能产生少量用量。",
    en: "You can enter a model manually. Testing calls the selected model and may incur a small usage charge.",
  },
  "console.useACustomEndpointAndApiKeyLeaveThe": {
    "zh-CN": "使用自定义端点与 API Key，密钥留空保留已有值。",
    en: "Use a custom endpoint and API Key. Leave the key blank to keep the current value.",
  },
  "console.authenticationType": {
    "zh-CN": "认证类型",
    en: "Authentication type",
  },
  "console.startOnDemand": {
    "zh-CN": "按需启动",
    en: "Start on demand",
  },
  "console.closingThisPageDoesNotStopTheBackgroundConnector": {
    "zh-CN":
      "关闭此网页不会停止后台连接器。停止连接器会中止本机正在执行的任务。",
    en: "Closing this page does not stop the background connector. Stopping the connector interrupts tasks running locally.",
  },
  "console.manageSystemAutostartWithTheLocalCli": {
    "zh-CN": "系统自启动由本机 CLI 管理：",
    en: "Manage system autostart with the local CLI:",
  },
  "console.toEnable": {
    "zh-CN": " 开启，",
    en: " to enable,",
  },
  "console.toDisable": {
    "zh-CN": " 关闭。",
    en: " to disable.",
  },
  "console.afterSavingStartTheConnectorToSyncDirectoriesAnd": {
    "zh-CN": "配置保存后，主动启动连接器以同步目录与工具状态。",
    en: "After saving, start the connector to sync directories and tool status.",
  },
  "console.loadingConfiguration": {
    "zh-CN": "正在读取配置…",
    en: "Loading configuration…",
  },
  "console.saveConfiguration": {
    "zh-CN": "保存配置",
    en: "Save configuration",
  },
  "console.stopConnectorAlternative72": {
    "zh-CN": "停止连接器？",
    en: "Stop connector?",
  },
  "console.tasksRunningLocallyWillBeInterruptedAndTheServer": {
    "zh-CN": "本机正在执行的任务将中止，服务端会显示此环境离线。",
    en: "Tasks running locally will be interrupted and the server will show this environment as offline.",
  },
  "console.cancel": {
    "zh-CN": "取消",
    en: "Cancel",
  },
  "console.confirmStop": {
    "zh-CN": "确认停止",
    en: "Confirm stop",
  },
  "console.theme": {
    "zh-CN": "主题",
    en: "Theme",
  },
  "console.lightTheme": {
    "zh-CN": "浅色主题",
    en: "Light theme",
  },
  "console.darkTheme": {
    "zh-CN": "深色主题",
    en: "Dark theme",
  },
  "console.bugTheme": {
    "zh-CN": "BUG主题",
    en: "BUG theme",
  },
  "console.localSettings": {
    "zh-CN": "本机设置",
    en: "Local settings",
  },
  "console.chooseCodexModel": {
    "zh-CN": "选择 Codex 模型",
    en: "Choose Codex model",
  },
  "console.codexModelList": {
    "zh-CN": "Codex 模型列表",
    en: "Codex model list",
  },
  "console.leaveBlankToKeepTheExistingKey": {
    "zh-CN": "留空保留已有密钥",
    en: "Leave blank to keep the existing key",
  },
  "console.chooseClaudeModel": {
    "zh-CN": "选择 Claude 模型",
    en: "Choose Claude model",
  },
  "console.claudeModelList": {
    "zh-CN": "Claude 模型列表",
    en: "Claude model list",
  },
  "console.bugpawRelayLocalEnvironment": {
    "zh-CN": "BugPaw Relay · 本机环境",
    en: "BugPaw Relay · Local environment",
  },
} as const;
