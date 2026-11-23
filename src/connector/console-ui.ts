import { consoleStyles } from "../shared/ui-styles.js";
import {
  messages,
  normalizeLocale,
  preference,
  resolveLocale,
  translate,
  isMessageKey,
} from "../shared/i18n.js";
import { createBrowserLocale } from "../shared/browser-locale.js";
import { insecureModelEndpoint } from "../shared/model-endpoint.js";
/** 本机控制台沿用已确认的品牌、页签和表单；注册/启动前保存草稿，避免目录未同步。 */
export const consoleHtml = String.raw`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BugPaw Relay</title><style>${consoleStyles}</style>
<header class="localtop"><div class="brand"><img src="/assets/brand.png" alt=""><span><b>BugPaw Relay</b><small>YOUR ENVIRONMENTS</small></span></div><span class="tag"><span data-i18n="console.localConsole127001"></span></span><div class="theme-switch" data-i18n-aria-label="console.theme" aria-label=""><button type="button" data-theme="light" data-i18n-aria-label="console.lightTheme" aria-label="" data-i18n-title="console.lightTheme" title="" class="btn ui-button ui-button-secondary ui-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg></button><button type="button" data-theme="dark" data-i18n-aria-label="console.darkTheme" aria-label="" data-i18n-title="console.darkTheme" title="" class="btn ui-button ui-button-secondary ui-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 13A8.5 8.5 0 0 1 11 3.5 8.5 8.5 0 1 0 20.5 13Z"/></svg></button><button type="button" data-theme="bug" data-i18n-aria-label="console.bugTheme" aria-label="" data-i18n-title="console.bugTheme" title="" class="btn ui-button ui-button-secondary ui-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="14" rx="5"/><path d="M9 3l1 4m5-4-1 4M3 9h4m10 0h4M3 15h4m10 0h4M5 21l3-3m8 0 3 3M12 8v12"/></svg></button></div><div class="language-control"><button type="button" id="language-toggle" aria-haspopup="listbox" aria-expanded="false" aria-controls="language-options" class="btn ui-button ui-button-ghost"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h12M9 3v2M5 5c0 6 5 10 9 11M13 5c0 6-5 10-10 12M14 21l4-10 4 10M15.5 17h5"/></svg><span id="language-label"></span></button><div id="language-options" role="listbox" hidden><button id="language-auto" role="option" data-locale="auto" class="btn ui-button ui-button-secondary"></button><button role="option" data-locale="zh-CN" class="btn ui-button ui-button-secondary">简体中文</button><button role="option" data-locale="en" class="btn ui-button ui-button-secondary">English</button></div><small id="language-warning" role="status"></small></div></header>
<main class="localmain"><div class="pagehead"><div><div class="eyebrow">ENVIRONMENT CONNECTOR</div><h1><span data-i18n="console.manageThisDevelopmentEnvironment"></span></h1><p><span data-i18n="console.configureConnectionsWorkspaceRootsAndCodingToolsLocally"></span></p></div></div>
<section class="status-card"><div><span class="status-dot" id="dot"></span><span id="status" role="status"><span data-i18n="console.loadingStatus"></span></span><p id="connection-note"><span data-i18n="console.configurationAndToolCredentialsAreStoredOnlyOnThis"></span></p></div><div class="actions"><button id="start" class="primary btn ui-button ui-button-primary"><span data-i18n="console.startConnector"></span></button><button id="stop" class="btn ui-button ui-button-secondary"><span data-i18n="console.stopConnector"></span></button></div></section>
<nav class="tabs" role="tablist" data-i18n-aria-label="console.localSettings" aria-label=""><button role="tab" data-tab="overview" aria-selected="true" class="btn ui-button ui-button-secondary"><span data-i18n="console.overview"></span></button><button role="tab" data-tab="directories" aria-selected="false" class="btn ui-button ui-button-secondary"><span data-i18n="console.directories"></span></button><button role="tab" data-tab="tools" aria-selected="false" class="btn ui-button ui-button-secondary"><span data-i18n="console.cliTools"></span></button><button role="tab" data-tab="startup" aria-selected="false" class="btn ui-button ui-button-secondary"><span data-i18n="console.startup"></span></button></nav>
<form id="form"><div id="overview" class="panel" role="tabpanel"><section><h2><span data-i18n="console.environmentConfiguration"></span></h2><p><span data-i18n="console.connectToYourBugpawRelayServer"></span></p><div class="grid"><label><span data-i18n="console.serverUrl"></span><input id="serverUrl" type="url" required class="ui-input"></label><label><span data-i18n="console.environmentName"></span><input id="name" required class="ui-input"></label></div><p><span data-i18n="console.registerAgainAfterChangingTheServerStopARunning"></span></p></section>
<section><h2><span data-i18n="console.connectToPlatform"></span></h2><p><span data-i18n="console.generateAOneTimeAccessCodeOnThePlatform"></span></p><label><span data-i18n="console.oneTimeAccessCode"></span><input id="code" type="password" autocomplete="off" class="ui-input"></label><button id="register" type="button" class="btn ui-button ui-button-secondary"><span data-i18n="console.registerAndConnect"></span></button></section></div>
<div id="directories" class="panel" role="tabpanel" hidden><section><h2><span data-i18n="console.workspaceRoots"></span></h2><p><span data-i18n="console.configureMultipleWorkspaceRootsSaveAndStartTheConnector"></span></p><label><span data-i18n="console.workspaceRootsOneAbsolutePathPerLine"></span><textarea id="roots" rows="6" required spellcheck="false" class="ui-input"></textarea></label><p><span data-i18n="console.enterFullPathsToExistingFoldersTheRelativeProject"></span></p><small id="root-summary"></small></section></div>
<div id="tools" class="panel" role="tabpanel" hidden><section><h2>Codex</h2><p><span data-i18n="console.forOfficialAccountsRunBugpawRelayCodexLoginIn"></span></p><div class="grid"><label><span data-i18n="console.cliCommandPath"></span><input id="codexCommand" spellcheck="false" autocomplete="off" class="ui-input"></label><label><span data-i18n="console.apiUrl"></span><input id="codexUrl" type="url" aria-describedby="codexHttpHint" class="ui-input"><small id="codexHttpHint" hidden><span data-i18n="console.httpTransmitsInPlainTextMakeSureTheNetwork"></span></small></label><div class="model-picker"><label for="codexModel"><span data-i18n="console.model"></span></label><div class="model-input"><input id="codexModel" autocomplete="off" class="ui-input"><button type="button" id="codexChoose" data-i18n-aria-label="console.chooseCodexModel" aria-label="" aria-haspopup="listbox" aria-expanded="false" aria-controls="codexModels" disabled class="btn ui-button ui-button-secondary ui-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button></div><div id="codexModels" class="model-list" role="listbox" data-i18n-aria-label="console.codexModelList" aria-label="" hidden></div></div><label>API Key<input id="codexKey" type="password" autocomplete="new-password" data-i18n-placeholder="console.leaveBlankToKeepTheExistingKey" placeholder="" class="ui-input"></label></div><div class="actions"><button type="button" id="codexFetch" class="btn ui-button ui-button-secondary"><span data-i18n="console.fetchModels"></span></button><button type="button" id="codexTest" class="btn ui-button ui-button-secondary"><span data-i18n="console.testConnection"></span></button></div><p><span data-i18n="console.youCanEnterAModelManuallyTestingCallsThe"></span></p><p id="codexFeedback" class="model-feedback" role="status" aria-live="polite"></p></section>
<section><h2>Claude Code</h2>
<fieldset class="claude-mode"><legend data-i18n="console.claudeMode"></legend><div class="radio-row">
<label><input type="radio" name="claudeMode" value="custom" checked class="ui-input"><span data-i18n="console.claudeCustom"></span></label>
<label><input type="radio" name="claudeMode" value="environment" class="ui-input"><span data-i18n="console.claudeEnvironment"></span></label>
</div></fieldset>
<label><span data-i18n="console.cliCommandPath"></span><input id="claudeCommand" spellcheck="false" autocomplete="off" aria-describedby="claudePathError" class="ui-input"></label>
<div id="claudeNative" hidden>
<div class="actions"><button type="button" id="claudeCheck" class="btn ui-button ui-button-secondary"><span data-i18n="console.claudeCheck"></span></button></div>
<p id="claudeCheckFeedback" class="model-feedback" role="status" aria-live="polite"></p>
</div>
<div class="claude-support" role="region" aria-labelledby="claudeSupportTitle">
<h3 id="claudeSupportTitle" data-i18n="console.claudeSupport"></h3>
<p id="claudeSupportDraft" data-i18n="console.claudeSupportDraft" hidden></p>
<div id="claudeSupportDetails" hidden>
<dl class="claude-details">
<div><dt data-i18n="console.claudeMode"></dt><dd id="claudeSupportMode"></dd></div>
<div><dt data-i18n="console.claudeAccount"></dt><dd id="claudeAccount"></dd></div>
<div><dt>CLI</dt><dd id="claudeCliStatus"></dd></div>
<div id="claudeCliPathRow" hidden><dt data-i18n="console.cliCommandPath"></dt><dd><code id="claudeCliPath"></code></dd></div>
<div><dt>SDK</dt><dd id="claudeSdkStatus"></dd></div>
</dl>
<p id="claudePathError" class="model-feedback" data-error="true" data-i18n="connector.support.path" hidden></p>
<ul id="claudeInstallPlan" class="claude-install-plan" data-i18n-aria-label="console.claudeInstallPlan" hidden></ul>
</div>
<div class="actions">
<button type="button" id="claudeModeSave" class="btn ui-button ui-button-primary" hidden><span data-i18n="console.claudeModeSave"></span></button>
<button type="button" id="claudeInstall" class="btn ui-button ui-button-primary" hidden><span data-i18n="console.claudeInstall"></span></button>
<button type="button" id="claudeRecheck" class="btn ui-button ui-button-secondary"><span id="claudeRecheckLabel"></span></button>
</div>
<p id="claudeSupportProgress" class="model-feedback" role="status"></p>
<p id="claudeSupportError" class="model-feedback" role="alert" data-error="true"></p>
<p id="claudeSupportNext" role="status"></p>
</div>
<div id="claudeApi"><p><span data-i18n="console.useACustomEndpointAndApiKeyLeaveThe"></span></p><div class="grid">
<label><span data-i18n="console.apiUrl"></span><input id="claudeUrl" type="url" aria-describedby="claudeHttpHint" class="ui-input"><small id="claudeHttpHint" hidden><span data-i18n="console.httpTransmitsInPlainTextMakeSureTheNetwork"></span></small></label><div class="model-picker"><label for="claudeModel"><span data-i18n="console.model"></span></label><div class="model-input"><input id="claudeModel" autocomplete="off" class="ui-input"><button type="button" id="claudeChoose" data-i18n-aria-label="console.chooseClaudeModel" aria-label="" aria-haspopup="listbox" aria-expanded="false" aria-controls="claudeModels" disabled class="btn ui-button ui-button-secondary ui-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button></div><div id="claudeModels" class="model-list" role="listbox" data-i18n-aria-label="console.claudeModelList" aria-label="" hidden></div></div><label>API Key<input id="claudeKey" type="password" autocomplete="new-password" class="ui-input"></label><div><label><span data-i18n="console.authenticationType"></span></label><div class="radio-row"><label><input type="radio" name="authType" value="key" checked class="ui-input">API Key</label><label><input type="radio" name="authType" value="bearer" class="ui-input">Bearer</label></div></div></div><div class="actions"><button type="button" id="claudeFetch" class="btn ui-button ui-button-secondary"><span data-i18n="console.fetchModels"></span></button><button type="button" id="claudeTest" class="btn ui-button ui-button-secondary"><span data-i18n="console.testConnection"></span></button></div><p><span data-i18n="console.youCanEnterAModelManuallyTestingCallsThe"></span></p><p id="claudeFeedback" class="model-feedback" role="status" aria-live="polite"></p>
</div></section></div>
<div id="startup" class="panel" role="tabpanel" hidden><section><h2><span data-i18n="console.startOnDemand"></span></h2><p><span data-i18n="console.closingThisPageDoesNotStopTheBackgroundConnector"></span></p><p><span data-i18n="console.manageSystemAutostartWithTheLocalCli"></span><code>bugpaw-relay autostart enable</code><span data-i18n="console.toEnable"></span><code>bugpaw-relay autostart disable</code><span data-i18n="console.toDisable"></span></p><p><span data-i18n="console.afterSavingStartTheConnectorToSyncDirectoriesAnd"></span></p></section></div>
<div class="savebar"><div><span id="message" role="status" aria-live="polite"><span data-i18n="console.loadingConfiguration"></span></span><small id="dirty" style="display:block"></small></div><button class="primary btn ui-button ui-button-primary" id="save" type="submit"><span data-i18n="console.saveConfiguration"></span></button></div></form></main>
<dialog id="stop-dialog" aria-labelledby="stop-title"><h2 id="stop-title"><span data-i18n="console.stopConnectorAlternative72"></span></h2><p><span data-i18n="console.tasksRunningLocallyWillBeInterruptedAndTheServer"></span></p><div class="actions"><button id="cancel-stop" class="btn ui-button ui-button-secondary"><span data-i18n="console.cancel"></span></button><button id="confirm-stop" class="primary btn ui-button ui-button-primary"><span data-i18n="console.confirmStop"></span></button></div></dialog>
<script>
const messages = ${JSON.stringify(messages).replaceAll("<", "\\u003c")};
const normalizeLocale = ${normalizeLocale.toString()};
const preference = ${preference.toString()};
const resolveLocale = ${resolveLocale.toString()};
const isMessageKey = ${isMessageKey.toString()};
const translate = ${translate.toString()};
const createBrowserLocale = ${createBrowserLocale.toString()};
const localeState=createBrowserLocale(window,{preference,resolveLocale,translate,storageKey:'relay-locale-preference'});
const ct=(key,params)=>localeState.t(key,params);

const bindings=new Map();
function bindText(node,property,render){let fields=bindings.get(node);if(!fields){fields=new Map();bindings.set(node,fields)}fields.set(property,render);node[property]=render()}
function errorText(error){return error?.messageKey?ct(error.messageKey,error.messageParams):ct('common.failure')}

const insecureModelEndpoint = ${insecureModelEndpoint.toString()};
function endpointHints(){for(const k of ["codex","claude"])el(k+"HttpHint").hidden=!insecureModelEndpoint(el(k+"Url").value)}

let secret=location.hash.slice(1);try{if(secret)sessionStorage.setItem('relay-console-token',secret);else secret=sessionStorage.getItem('relay-console-token')||''}catch{}history.replaceState(null,'',location.pathname);const el=id=>document.getElementById(id);let config,dirty=false,busy=false,running=false,checkingClaude=false;
let claudeSupport=null, installingClaude=false;
document.addEventListener('input',endpointHints);
// 复用端口后，新启动链接可能只触发 fragment 导航；更新凭据并重载新控制台。
window.addEventListener('hashchange',()=>{if(location.hash.length>1){try{sessionStorage.setItem('relay-console-token',location.hash.slice(1))}catch{}location.reload()}});
async function api(path,data,signal){const r=await fetch('/api/'+path,{signal,method:data?'POST':'GET',headers:{'Content-Type':'application/json','Accept-Language':localeState.locale,Authorization:'Bearer '+secret},body:data?JSON.stringify(data):undefined});const result=await r.json();if(!r.ok)throw result;return result}
function message(text,error=false){bindText(el('message'),'textContent',typeof text==='function'?text:()=>text);el('message').className=error?'error':'';el('message').setAttribute('role',error?'alert':'status')}
function controls(){for(const input of el('form').querySelectorAll('input:not(#claudeCommand):not([name=claudeMode]),textarea'))input.disabled=running||!config;claudeControls();el('save').disabled=busy||checkingClaude||installingClaude||running||!config;el('register').disabled=el('save').disabled;el('start').disabled=el('save').disabled;el('stop').disabled=busy||installingClaude||!running;modelControls();bindText(el('dirty'), "textContent", ()=>(running&&claudeChanged()?ct('console.claudeModeUnsaved'):dirty?ct("console.unsavedChangesSavedBeforeStartingOrRegistering"):running?ct("console.runningStopTheConnectorBeforeChangingConfiguration"):ct("console.configurationSavedLocally")))}
const claudeMode=()=>document.querySelector('input[name=claudeMode]:checked').value;
const claudeCommand=()=>el('claudeCommand').value.trim()||'claude';
const claudeChanged=()=>config&&(claudeMode()!==(config.claude.mode||'custom')||claudeCommand()!==(config.claude.command||'claude'));
function claudeControls(){
 const native=claudeMode()==='environment';
 el('claudeNative').hidden=!native||!claudeChanged();
 el('claudeApi').hidden=native;
 const changed=claudeChanged();
 const locked=busy||checkingClaude||installingClaude||!config;
 const showDetails=claudeSupport&&!changed;
 el('claudeSupportDraft').hidden=!changed;
 el('claudeSupportProgress').hidden=!!changed;
 el('claudeSupportDetails').hidden=!showDetails;
 el('claudeModeSave').hidden=!changed;
 el('claudeModeSave').disabled=locked;
 el('claudeInstall').hidden=!showDetails||!claudeSupport.plan.length||claudeSupport.cli.explicitInvalid;
 el('claudeInstall').disabled=locked||!!claudeSupport?.step;
 el('claudeRecheck').hidden=!!changed;
 el('claudeRecheck').disabled=locked;
 el('claudeSupportNext').hidden=!showDetails||!claudeSupport.ready||installingClaude;
 el('claudeCommand').setAttribute('aria-invalid',String(!!showDetails&&claudeSupport.cli.explicitInvalid));
 el('claudeCheck').disabled=locked;
 for(const control of el('claudeApi').querySelectorAll('input'))control.disabled=native||running||!config;
 el('claudeCommand').disabled=locked;
 for(const control of document.querySelectorAll('input[name=claudeMode]'))control.disabled=locked;
 if(native)closeModels('claude');
}
function clearClaudeCheck(){
 const panel=el('claudeCheckFeedback');
 panel.dataset.error='false';
 bindText(panel,'textContent',()=> '');
 showClaudeSupportError();
}
el('claudeCommand').addEventListener('input',clearClaudeCheck);
for(const control of document.querySelectorAll('input[name=claudeMode]'))control.addEventListener('change',clearClaudeCheck);
el('claudeCheck').onclick=async()=>{
 if(busy||checkingClaude||installingClaude)return;
 checkingClaude=true;
 controls();
 const panel=el('claudeCheckFeedback');
 panel.dataset.error='false';
 bindText(panel,'textContent',()=>ct('console.claudeChecking'));
 try{
  const result=await api('claude/check',{command:claudeCommand()});
  panel.dataset.error=String(!result.available);
  bindText(panel,'textContent',()=>result.available?ct('console.claudeReady',{version:result.version||''}):errorText(result));
 }catch(error){
  panel.dataset.error='true';
  bindText(panel,'textContent',()=>errorText(error));
 }finally{
  checkingClaude=false;
  controls();
 }
};
// 模式和路径可单独保存，保留页面上尚未提交的其他字段。
el('claudeModeSave').onclick=async()=>{
 await action(async()=>{
  await api('claude/mode',{mode:claudeMode(),command:claudeCommand()});
  config.claude.mode=claudeMode();
  config.claude.command=claudeCommand();
  claudeSupport=null;
 });
 if(!claudeChanged())await checkClaudeSupport();
};

function showClaudeSupportError(error){
 bindText(el('claudeSupportError'),'textContent',()=>error?errorText(error):'');
}

function showClaudeProgress(step){
 const progress=el('claudeSupportProgress');
 if(progress.dataset.step===String(step))return;
 progress.dataset.step=String(step);
 bindText(progress,'textContent',()=>step?ct(step):'');
}

function renderClaudeSupport(status){
 if(status.mode!==claudeMode()||status.command!==claudeCommand()){
  throw {messageKey:'console.claudeSupportChanged'};
 }
 claudeSupport=status;
 const {cli,sdk}=status;
 bindText(el('claudeSupportMode'),'textContent',()=>ct(status.mode==='environment'?'console.claudeEnvironment':'console.claudeCustom'));
 el('claudeAccount').textContent=status.account;
 bindText(el('claudeCliStatus'),'textContent',()=>cli.available?ct('console.claudeReady',{version:cli.version||''}):ct('console.claudeMissing'));
 el('claudeCliPath').textContent=cli.path||'';
 el('claudeCliPathRow').hidden=!cli.path;
 el('claudePathError').hidden=!cli.explicitInvalid;
 bindText(el('claudeSdkStatus'),'textContent',()=>ct(sdk.available?'console.claudeSdkReady':sdk.required?'console.claudeSdkMissing':'console.claudeSdkOptional',{version:sdk.version}));
 bindText(el('claudeSupportNext'),'textContent',()=>ct(status.mode==='environment'?'console.claudeLoginGuide':'connector.support.endpoint'));

 const plan=el('claudeInstallPlan');
 // 安装计划来源和路径始终以纯文本显示，长路径可换行。
 for(const node of plan.querySelectorAll('strong, small'))bindings.delete(node);
 plan.replaceChildren(...status.plan.map(item=>{
  const row=document.createElement('li');
  const label=document.createElement('strong');
  const source=document.createElement('small');
  const destination=document.createElement('small');
  label.textContent=item.component==='cli'?'Claude Code CLI':'Claude Agent SDK';
  bindText(source,'textContent',()=>ct('console.claudeInstallSource',{value:item.source}));
  bindText(destination,'textContent',()=>ct('console.claudeInstallDestination',{value:item.destination}));
  row.append(label,source,destination);
  return row;
 }));
 plan.hidden=!status.plan.length||cli.explicitInvalid;
}

bindText(el('claudeRecheckLabel'),'textContent',()=>ct('console.claudeRecheck'));
async function checkClaudeSupport(){
 if(busy||checkingClaude||installingClaude||!config||claudeChanged())return;
 checkingClaude=true;
 controls();
 showClaudeSupportError();
 showClaudeProgress('connector.support.check');
 try{
  const status=await api('claude/support');
  renderClaudeSupport(status);
  showClaudeProgress(status.step);
 }catch(error){
  claudeSupport=null;
  showClaudeProgress(null);
  showClaudeSupportError(error);
 }finally{
  checkingClaude=false;
  controls();
 }
}
el('claudeRecheck').onclick=checkClaudeSupport;
el('claudeInstall').onclick=async()=>{
 if(el('claudeInstall').disabled||el('claudeInstall').hidden)return;
 installingClaude=true;
 controls();
 showClaudeSupportError();
 showClaudeProgress('connector.support.check');
 const polling=new AbortController();
 let timer;
 // 进度读取独立于长请求，结束后中止轮询，避免旧进度覆盖完成状态。
 const poll=async()=>{
  try{
   const {step}=await api('claude/support/progress',undefined,polling.signal);
   if(step&&!polling.signal.aborted)showClaudeProgress(step);
  }catch{}
  if(!polling.signal.aborted)timer=setTimeout(poll,500);
 };
 let failure;
 try{
  timer=setTimeout(poll,250);
  const status=await api('claude/support/install',{
   expected:{mode:claudeMode(),command:claudeCommand(),components:claudeSupport.plan.map(item=>item.component)}
  });
  renderClaudeSupport(status);
  if(!status.ready)failure={messageKey:'console.claudeSupportIncomplete'};
 }catch(error){
  failure=error;
 }finally{
  polling.abort();
  clearTimeout(timer);
  installingClaude=false;
  showClaudeProgress(null);
  controls();
 }
 // 部分成功后重取计划，重试时只展示仍缺少的组件。
 if(failure){
  await checkClaudeSupport();
  showClaudeSupportError(failure);
 }
 if(el('tools').hidden===false&&document.activeElement===document.body){
  const next=el('claudeInstall').hidden?el('claudeRecheck'):el('claudeInstall');
  if(!next.disabled)next.focus();
 }
};
async function action(fn){if(busy||checkingClaude||installingClaude)return;busy=true;controls();message(()=>ct("console.processing"));try{await fn();message(()=>ct("console.operationSucceeded"));await refresh()}catch(e){message(()=>errorText(e),true)}finally{busy=false;controls()}}
// 无法确认控制通道时明确显示未知，不能把仍可能运行的进程显示成已停止。
async function refresh(){const s=await api('status');running=s.running;const names={unknown:ct("console.unknown"),stopped:ct("console.stopped"),connecting:ct("console.connecting"),online:ct("console.connected"),offline:ct("console.temporarilyOfflineRetryingAutomatically"),pending:ct("console.awaitingPlatformApproval"),revoked:ct("console.accessRevoked")};bindText(el('status'), "textContent", ()=>((names[s.status]||s.status)+' · '+(s.registered?ct("console.registered"):ct("console.notRegistered"))));el('dot').className='status-dot '+(s.status==='online'?'online':'');bindText(el('connection-note'), "textContent", ()=>((s.lastErrorDetails ? errorText(s.lastErrorDetails) : s.lastError ? ct("common.failure") : "")|| (s.status==='online'?ct("console.synced")+config?.roots.length+ct("console.workspaceRootsToTheServer"):ct("console.configurationAndToolCredentialsAreStoredOnlyOnThis"))));controls()}
function tab(id){document.querySelectorAll('[data-tab]').forEach(b=>{const active=b.dataset.tab===id;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;el(b.dataset.tab).hidden=!active});if(id==='tools'&&!claudeSupport)void checkClaudeSupport()}
for(const b of document.querySelectorAll('[data-tab]')){b.onclick=()=>tab(b.dataset.tab);b.onkeydown=e=>{const tabs=[...document.querySelectorAll('[data-tab]')];if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const i=e.key==='Home'?0:e.key==='End'?tabs.length-1:(tabs.indexOf(b)+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tab(tabs[i].dataset.tab);tabs[i].focus()}}}
function theme(value){value=['light','dark','bug'].includes(value)?value:'light';document.documentElement.dataset.theme=value;try{localStorage.setItem('relay-theme',value)}catch{};document.querySelectorAll('[data-theme]').forEach(b=>{if(b.tagName==='BUTTON')b.setAttribute('aria-pressed',String(b.dataset.theme===value))})}document.querySelectorAll('button[data-theme]').forEach(b=>b.onclick=()=>theme(b.dataset.theme));let storedTheme='light';try{storedTheme=localStorage.getItem('relay-theme')||'light'}catch{}theme(storedTheme);tab('overview');
// 模型列表使用统一自定义弹层；失效请求不能覆盖已编辑的新端点。
const modelState={codex:{models:[],pending:false,revision:0},claude:{models:[],pending:false,revision:0}};
function modelControls(){for(const k of ['codex','claude']){const state=modelState[k];for(const suffix of ['Fetch','Test'])el(k+suffix).disabled=!config||busy||state.pending;el(k+'Choose').disabled=!config||running||state.pending||!state.models.length;if(running)closeModels(k)}}
function closeModels(k,focus=false){el(k+'Models').hidden=true;el(k+'Choose').setAttribute('aria-expanded','false');if(focus)el(k+'Choose').focus()}
function renderModels(k){const list=el(k+'Models');list.replaceChildren();for(const model of modelState[k].models){const option=document.createElement('button');option.type='button';option.className='model-option btn ui-button ui-button-ghost';option.setAttribute('role','option');option.setAttribute('aria-selected',String(model===el(k+'Model').value));option.textContent=model;option.onclick=()=>{el(k+'Model').value=model;el(k+'Model').dispatchEvent(new Event('input',{bubbles:true}));closeModels(k,true)};option.onkeydown=e=>{const options=[...list.children];let index=options.indexOf(option);if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();index=e.key==='Home'?0:e.key==='End'?options.length-1:(index+(e.key==='ArrowDown'?1:-1)+options.length)%options.length;options[index].focus()}};list.append(option)}}
function openModels(k){const list=el(k+'Models');if(!list.hidden){closeModels(k);return}for(const other of ['codex','claude'])closeModels(other);renderModels(k);list.hidden=false;el(k+'Choose').setAttribute('aria-expanded','true');(list.querySelector('[aria-selected=true]')||list.firstElementChild)?.focus()}
async function diagnose(k,operation){const state=modelState[k];if(state.pending)return;const revision=state.revision;state.pending=true;modelControls();const feedback=el(k+'Feedback');feedback.dataset.error='false';bindText(feedback, "textContent", ()=>(operation==='models'?ct("console.loadingModelList"):ct("console.testingConnection")));const draft={provider:k,baseUrl:el(k+'Url').value.trim(),model:el(k+'Model').value.trim(),apiKey:el(k+'Key').value,authType:document.querySelector('input[name=authType]:checked').value};try{const result=await api(operation==='models'?'models':'test-connection',draft);if(revision!==state.revision)return;if(operation==='models'){state.models=result.models;renderModels(k);bindText(feedback, "textContent", ()=>(result.models.length?ct("console.loaded")+result.models.length+ct("console.modelsChooseUsingTheMenuBesideTheModelField"):ct("console.theServiceReturnedAnEmptyModelListYouCan")))}else bindText(feedback, "textContent", ()=>(ct("console.connectedAlternative22")+result.protocol+' · '+result.elapsedMs+ct("console.msApiGenerationTestOnlyNotFullAgentValidation")))}catch(e){if(revision===state.revision){if(operation==='models'){state.models=[];closeModels(k)}feedback.dataset.error='true';bindText(feedback, "textContent", ()=>(errorText(e)))}}finally{state.pending=false;modelControls()}}
for(const k of ['codex','claude']){el(k+'Fetch').onclick=()=>diagnose(k,'models');el(k+'Test').onclick=()=>diagnose(k,'test');el(k+'Choose').onclick=()=>openModels(k);el(k+'Choose').onkeydown=e=>{if(e.key==='ArrowDown'){e.preventDefault();openModels(k)}};el(k+'Models').addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();closeModels(k,true)}});for(const suffix of ['Url','Key','Model'])el(k+suffix).addEventListener('input',()=>invalidateModels(k,suffix!=='Model'))}
function invalidateModels(k,clear=true){const state=modelState[k];state.revision++;el(k+'Feedback').textContent='';if(clear){state.models=[];closeModels(k)}modelControls()}
for(const input of document.querySelectorAll('input[name=authType]'))input.addEventListener('change',()=>invalidateModels('claude'));
document.addEventListener('click',e=>{for(const k of ['codex','claude'])if(!el(k+'Choose').closest('.model-picker').contains(e.target))closeModels(k)});
document.addEventListener('focusin',e=>{for(const k of ['codex','claude'])if(!el(k+'Choose').closest('.model-picker').contains(e.target))closeModels(k)});
function fill(c){if(!config||config.claude.mode!==c.claude.mode||config.claude.command!==c.claude.command)claudeSupport=null;config=c;document.querySelector('input[name=claudeMode][value="'+(c.claude.mode||'custom')+'"]').checked=true;el('serverUrl').value=c.serverUrl;el('name').value=c.name;el('roots').value=c.roots.map(r=>r.path).join('\n');for(const k of ['codex','claude']){el(k+'Command').value=c[k].command===k?'':(c[k].command||'');el(k+'Url').value=c[k].baseUrl;el(k+'Model').value=c[k].model;el(k+'Key').value='';bindText(el(k+'Key'), "placeholder", ()=>(c[k].hasKey?ct("console.configuredLeaveBlankToKeep"):ct("console.notConfigured")));}document.querySelector('input[name=authType][value="'+c.claude.authType+'"]').checked=true;bindText(el('root-summary'), "textContent", ()=>(ct("console.saved")+c.roots.length+ct("console.roots")));dirty=false;endpointHints();controls()}
// 对隐藏页签的无效输入先切页，避免浏览器无法聚焦并静默阻止保存。
el('form').addEventListener('invalid',e=>{const panel=e.target.closest('.panel');if(panel)tab(panel.id)},true);
el('form').addEventListener('input',e=>{if(e.target.id!=='code'){if(!running)dirty=true;controls()}});
// 环境模式保存时保留已配置的自定义端点；隐藏字段不参与校验或提交。
async function save(){
 if(!el('form').reportValidity())throw {messageKey:"console.checkTheHighlightedSettings"};
 const roots=el('roots').value.split('\n').map(p=>p.trim()).filter(Boolean).map(path=>({id:config.roots.find(r=>r.path===path)?.id||'root-'+crypto.randomUUID(),path}));
 const mode=claudeMode();
 const custom=mode==='custom'?{
  baseUrl:el('claudeUrl').value.trim(),model:el('claudeModel').value.trim(),apiKey:el('claudeKey').value,
  authType:document.querySelector('input[name=authType]:checked').value
 }:{};
 await api('config',{
  ...config,serverUrl:el('serverUrl').value.trim(),name:el('name').value.trim(),roots,
  codex:{...config.codex,command:el('codexCommand').value.trim(),baseUrl:el('codexUrl').value.trim(),model:el('codexModel').value.trim(),apiKey:el('codexKey').value},
  claude:{...config.claude,...custom,mode,command:claudeCommand()}
 });
 fill(await api('config'));
}

el('form').onsubmit=async e=>{e.preventDefault();await action(save);if(!el('tools').hidden&&!claudeSupport)await checkClaudeSupport()};
el('start').onclick=()=>action(async()=>{if(dirty||claudeChanged())await save();await api('start',{})});el('stop').onclick=()=>el('stop-dialog').showModal();el('cancel-stop').onclick=()=>el('stop-dialog').close();el('confirm-stop').onclick=()=>{el('stop-dialog').close();action(()=>api('stop',{}))};el('register').onclick=()=>action(async()=>{if(!el('code').value.trim())throw {messageKey:"console.enterAOneTimeAccessCode"};await save();await api('register',{code:el('code').value});el('code').value=''});
api('config').then(c=>{fill(c);message(()=>ct("console.configurationLoaded"));if(!el('tools').hidden)void checkClaudeSupport();return refresh()}).catch(e=>message(()=>errorText(e),true));setInterval(()=>refresh().catch(()=>message(()=>ct("console.cannotReachTheLocalConsoleReopenTheClient"),true)),3000);
window.addEventListener('beforeunload',e=>{if(dirty||claudeChanged()){e.preventDefault();e.returnValue=''}});
function updateLanguage(){
 document.title=ct('console.bugpawRelayLocalEnvironment');
 document.querySelectorAll('[data-i18n]').forEach(node=>node.textContent=ct(node.dataset.i18n));
 for(const attr of ['aria-label','title','placeholder'])document.querySelectorAll('[data-i18n-'+attr+']').forEach(node=>node.setAttribute(attr,ct(node.getAttribute('data-i18n-'+attr))));
 for(const [node,fields] of bindings){if(!node.isConnected){bindings.delete(node);continue}for(const [property,render] of fields)node[property]=render()}
 const current=localeState.preference==='auto'?ct('language.system',{language:localeState.systemLocale==='en'?'English':'简体中文'}):localeState.preference==='en'?'English':'简体中文';
 el('language-label').textContent=current;el('language-toggle').setAttribute('aria-label',ct('language.choose')+': '+current);el('language-toggle').title=current;
 el('language-auto').textContent=ct('language.system',{language:localeState.systemLocale==='en'?'English':'简体中文'});
 document.querySelectorAll('[data-locale]').forEach(node=>node.setAttribute('aria-selected',String(node.dataset.locale===localeState.preference)));
 el('language-warning').textContent=localeState.temporary?ct('language.temporary'):'';
}
function closeLanguage(focus=false){el('language-options').hidden=true;el('language-toggle').setAttribute('aria-expanded','false');if(focus)el('language-toggle').focus()}
function placeLanguage(){const list=el('language-options');if(list.hidden)return;const rect=el('language-toggle').getBoundingClientRect(),v=visualViewport,top=v?.offsetTop||0,height=v?.height||innerHeight;list.style.maxHeight=Math.max(80,height-16)+'px';list.style.overflow='auto';list.style.top=Math.max(top+8,Math.min(rect.bottom+5,top+height-list.offsetHeight-8))+'px';list.style.right=Math.max(8,innerWidth-rect.right)+'px'}
function openLanguage(){const list=el('language-options');list.hidden=false;placeLanguage();el('language-toggle').setAttribute('aria-expanded','true');(list.querySelector('[aria-selected=true]')||list.firstElementChild).focus()}
el('language-toggle').onclick=()=>el('language-options').hidden?openLanguage():closeLanguage();
el('language-toggle').onkeydown=event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();openLanguage()}};
for(const node of document.querySelectorAll('[data-locale]'))node.onclick=()=>{localeState.set(node.dataset.locale);closeLanguage(true)};
el('language-options').onkeydown=event=>{const nodes=[...el('language-options').children],index=nodes.indexOf(document.activeElement);if(event.key==='Escape'){event.preventDefault();closeLanguage(true)}else if(event.key==='Tab'){closeLanguage(true)}else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();nodes[event.key==='Home'?0:event.key==='End'?nodes.length-1:(index+(event.key==='ArrowUp'?-1:1)+nodes.length)%nodes.length].focus()}};
document.addEventListener('pointerdown',event=>{if(!event.target.closest('.language-control'))closeLanguage()});
addEventListener('resize',placeLanguage);visualViewport?.addEventListener('resize',placeLanguage);visualViewport?.addEventListener('scroll',placeLanguage);
localeState.subscribe(updateLanguage);updateLanguage();

</script></html>`;
