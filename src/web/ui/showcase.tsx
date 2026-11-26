import {
  Status,
  TrafficChart,
  Utilization,
  ConversationHeader,
  BoardHeader,
  BoardToolbar,
  FlowLayout,
  SearchInput,
  Tabs,
  NavigationButton,
  Row,
  FormGrid,
  InputLabel,
  Range,
  FileInput,
  SurfaceButton,
} from "./index.js";
import { useState } from "react";
import { WorkbenchMarkdown } from "../workbench-content.js";
import {
  Monitor,
  Plus,
  MoreHorizontal,
  SlidersHorizontal,
  Brain,
  ShieldCheck,
  ShieldAlert,
  ArrowUp,
  Paperclip,
} from "lucide-react";
import { t as tr, useLocale } from "../locale.js";
import {
  Button,
  IconButton,
  FormField,
  Input,
  Textarea,
  Select,
  Checkbox,
  Badge,
  CollectionLayout,
  CardGrid,
  EntityCard,
  Metadata,
  Panel,
  Actions,
  Sections,
  EmptyState,
  Alert,
  Dialog,
  Disclosure,
  ActionMenu,
  IconSelect,
} from "./index.js";

/** 展示页与真实页面直接引用同一组件，不另写静态替身；数据全部为本地样例。 */
export function UiShowcase() {
  useLocale();
  const [tab, setTab] = useState("components"),
    [stress, setStress] = useState(false),
    [narrow, setNarrow] = useState(false);
  const [value, setValue] = useState("example-default"),
    [permission, setPermission] = useState("ask"),
    [effort, setEffort] = useState("medium");
  const [versionExpanded, setVersionExpanded] = useState(false);
  const [flowStage, setFlowStage] = useState(false);
  const [query, setQuery] = useState("");
  const [checked, setChecked] = useState(true);
  const [name, setName] = useState(""),
    [error, setError] = useState(false),
    [saved, setSaved] = useState(false),
    [dialog, setDialog] = useState("");
  const title = stress ? tr("ui.longTitle") : tr("ui.sampleEnvironment");
  const model = stress
    ? "ExampleModelABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ExtendedContextCustomEndpoint20261118"
    : "Example model";
  const models = [
    { value: "example-default", label: model },
    { value: "example-other", label: "Example reasoning model" },
  ];
  return (
    <CollectionLayout
      title={tr("ui.title")}
      description={tr("ui.description")}
      actions={
        <Button
          onClick={() => {
            location.hash = "environments";
          }}
        >
          {tr("web.developmentEnvironment")}
        </Button>
      }
      toolbar={
        <>
          <Checkbox checked={stress} onChange={setStress}>
            {tr("ui.stress")}
          </Checkbox>
          <Checkbox checked={narrow} onChange={setNarrow}>
            {tr("ui.narrow")}
          </Checkbox>
        </>
      }
    >
      <Sections
        label={tr("ui.sections")}
        value={tab}
        onChange={setTab}
        items={[
          { value: "components", label: tr("ui.components") },
          { value: "layout", label: tr("ui.layout") },
          { value: "content", label: tr("ui.content") },
          { value: "flow", label: tr("web.flowConfiguration") },
          { value: "code", label: tr("web.copyCode") },
        ]}
      />
      <div className={narrow ? "ui-example-narrow" : "ui-example"}>
        {tab === "components" && (
          <>
            <Panel title={tr("ui.actions")}>
              <Actions>
                <Button variant="primary" onClick={() => setDialog("create")}>
                  <Plus aria-hidden="true" />
                  {tr("web.newSession")}
                </Button>
                <Button onClick={() => setSaved(true)}>
                  {tr("web.saveConfiguration")}
                </Button>
                <Button variant="danger" onClick={() => setDialog("delete")}>
                  {tr("web.delete")}
                </Button>
                <Button disabled>{tr("web.offline")}</Button>
                <IconButton
                  label={tr("ui.settings")}
                  icon={<SlidersHorizontal aria-hidden="true" />}
                  onClick={() => setDialog("settings")}
                />
                <ActionMenu
                  label={tr("ui.more")}
                  icon={<MoreHorizontal aria-hidden="true" />}
                  items={[
                    {
                      label: tr("web.archive"),
                      onSelect: () => setSaved(true),
                    },
                    {
                      label: tr("web.delete"),
                      danger: true,
                      onSelect: () => setDialog("delete"),
                    },
                  ]}
                />
              </Actions>
              {saved && <Alert title={tr("ui.saved")} />}
            </Panel>
            <Panel title={tr("ui.forms")}>
              <form
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  setError(!name.trim());
                  if (name.trim()) setSaved(true);
                }}
              >
                <FormField
                  label={tr("web.name")}
                  required
                  hint={tr("ui.nameHint")}
                  error={error ? tr("ui.nameRequired") : undefined}
                >
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </FormField>
                <FormField label={tr("ui.descriptionLabel")}>
                  <Textarea defaultValue={tr("ui.sampleDescription")} />
                </FormField>
                <Select
                  variant="ghost"
                  label={tr("ui.model")}
                  value={value}
                  options={models}
                  onChange={setValue}
                  searchable
                />
                <Checkbox checked={checked} onChange={setChecked}>
                  {tr("web.showArchived")}
                </Checkbox>
                <Actions>
                  <Button type="submit" variant="primary">
                    {tr("web.saveConfiguration")}
                  </Button>
                </Actions>
              </form>
            </Panel>
            <Panel title={tr("ui.agentControls")}>
              <Actions>
                <IconSelect
                  label={tr("ui.thinking")}
                  value={effort}
                  onChange={setEffort}
                  icon={<Brain aria-hidden="true" />}
                  mark={
                    effort === "medium"
                      ? undefined
                      : effort === "high"
                        ? "H"
                        : "L"
                  }
                  options={[
                    { value: "low", label: tr("ui.low") },
                    { value: "medium", label: tr("ui.medium") },
                    { value: "high", label: tr("ui.high") },
                  ]}
                />
                <IconSelect
                  label={tr("ui.permission")}
                  value={permission}
                  onChange={setPermission}
                  danger={permission === "full"}
                  mark={permission === "full" ? "!" : undefined}
                  icon={
                    permission === "full" ? (
                      <ShieldAlert aria-hidden="true" />
                    ) : (
                      <ShieldCheck aria-hidden="true" />
                    )
                  }
                  options={[
                    { value: "ask", label: tr("web.ask") },
                    { value: "full", label: tr("web.fullAccess") },
                  ]}
                />
                <IconButton
                  label={tr("attachments.add")}
                  icon={<Paperclip aria-hidden="true" />}
                  onClick={() => setDialog("files")}
                />
                <IconButton
                  label={tr("web.send")}
                  icon={<ArrowUp aria-hidden="true" />}
                  variant="primary"
                  onClick={() => setSaved(true)}
                />
              </Actions>
              <p>{tr("ui.demoOnly")}</p>
            </Panel>
            <Panel title={tr("ui.feedback")}>
              <Actions>
                <Badge tone="good">{tr("web.online")}</Badge>
                <Badge tone="warning">{tr("web.awaitingApproval")}</Badge>
                <Badge tone="danger">{tr("web.executionFailed")}</Badge>
              </Actions>
              <Alert title={tr("ui.readFailed")} error>
                {tr("ui.failureHint")}
              </Alert>
              <EmptyState
                title={tr("web.noMatchingEnvironments")}
                description={tr("ui.clearFilterHint")}
                action={
                  <Button onClick={() => setSaved(true)}>
                    {tr("ui.clearFilters")}
                  </Button>
                }
              />
            </Panel>
          </>
        )}
        {tab === "layout" && (
          <>
            <CardGrid>
              {[true, false].map((online, i) => (
                <EntityCard
                  key={i}
                  title={title}
                  subtitle={online ? "Ubuntu · x64" : "Windows · x64"}
                  icon={<Monitor aria-hidden="true" />}
                  status={
                    <Badge tone={online ? "good" : "neutral"}>
                      {online ? tr("web.online") : tr("web.offline")}
                    </Badge>
                  }
                  actions={
                    <Button onClick={() => setDialog("detail")}>
                      {tr("web.viewDetails")}
                    </Button>
                  }
                >
                  <Metadata
                    items={[
                      { label: tr("web.workspaceRoots"), value: 2 },
                      {
                        label: tr("web.codingTools"),
                        value: online ? "Codex" : "Claude Code",
                      },
                    ]}
                  />
                </EntityCard>
              ))}
            </CardGrid>
            <Panel title={tr("web.sessionDetails")}>
              <ConversationHeader
                title={stress ? tr("ui.longTitle") : tr("web.sessions")}
                navigation={null}
                actions={
                  <ActionMenu
                    label={tr("ui.more")}
                    icon={<MoreHorizontal />}
                    items={[
                      {
                        label: tr("ui.fullText"),
                        onSelect: () => setDialog("detail"),
                      },
                      {
                        label: tr("web.delete"),
                        disabled: true,
                        onSelect: () => setSaved(true),
                      },
                    ]}
                  />
                }
                summary={
                  stress
                    ? "/workspace/" + "LongDirectory/".repeat(15)
                    : "Example environment / workspace"
                }
                status={<Status value="completed" />}
              />
            </Panel>
            <Panel title={tr("ui.layout")}>
              <Tabs>
                <NavigationButton
                  kind="tab"
                  selected
                  onClick={() => setSaved(true)}
                >
                  {tr("web.overview")}
                </NavigationButton>
                <NavigationButton
                  kind="tab"
                  onClick={() => setDialog("settings")}
                >
                  {tr("ui.settings")}
                </NavigationButton>
              </Tabs>
              <BoardHeader>
                <div className="board-title-row">
                  <h2 className="board-title">{tr("web.boards")}</h2>
                </div>
                <IconButton
                  label={tr("web.newWorkItem")}
                  icon={<Plus aria-hidden="true" />}
                  onClick={() => setDialog("create")}
                />
              </BoardHeader>
              <BoardToolbar>
                <SearchInput
                  label={tr("web.searchWorkItemsAndTags")}
                  value={query}
                  onChange={setQuery}
                />
                <Checkbox checked={checked} onChange={setChecked}>
                  {tr("web.showArchived")}
                </Checkbox>
                <ActionMenu
                  label={tr("ui.more")}
                  icon={<MoreHorizontal aria-hidden="true" />}
                  items={[
                    {
                      label: tr("web.copyConfiguration"),
                      onSelect: () => setSaved(true),
                    },
                  ]}
                />
              </BoardToolbar>
              <FormGrid>
                <InputLabel>
                  <span>{tr("web.avatarZoom")}</span>
                  <Range min="1" max="4" step="0.1" defaultValue="1" />
                </InputLabel>
                <InputLabel>
                  <span>{tr("attachments.add")}</span>
                  <FileInput />
                </InputLabel>
              </FormGrid>
              <Row>
                <SurfaceButton
                  kind="suggestion"
                  onClick={() => setDialog("detail")}
                >
                  <strong>{title}</strong>
                  <small>{tr("ui.fullText")}</small>
                </SurfaceButton>
              </Row>
              <p>{tr("ui.demoOnly")}</p>
            </Panel>
          </>
        )}
        {tab === "flow" && (
          <Panel title={tr("web.flowConfiguration")}>
            <FlowLayout
              toolbar={<Badge>{tr("ui.demoOnly")}</Badge>}
              overview={
                <SurfaceButton
                  kind="flowStage"
                  selected={flowStage}
                  aria-expanded={flowStage}
                  onClick={() => setFlowStage(true)}
                >
                  <strong>S1 · {title}</strong>
                  <span>
                    <Badge>{tr("web.humanStage")}</Badge>
                  </span>
                  <small>{tr("web.flowNoTargets")}</small>
                </SurfaceButton>
              }
              title={flowStage ? `S1 · ${title}` : undefined}
              close={
                <Button onClick={() => setFlowStage(false)}>
                  {tr("web.close")}
                </Button>
              }
              detail={
                flowStage && (
                  <FormField label={tr("web.stageName")}>
                    <Input defaultValue={title} />
                  </FormField>
                )
              }
              footer={
                <Button variant="primary" onClick={() => setSaved(true)}>
                  {tr("web.flowSave")}
                </Button>
              }
            />
          </Panel>
        )}
        {tab === "code" && (
          <Panel title={tr("web.copyCode")}>
            <WorkbenchMarkdown
              text={[
                "```typescript",
                '  const path = "/workspace/example/' + "ABC012".repeat(24) + '";',
                "",
                "```",
                "",
                "```",
                title,
                "```",
              ].join("\n")}
            />
          </Panel>
        )}
        {tab === "content" && (
          <Panel title={tr("ui.content")}>
            <EntityCard
              title={title}
              icon={<Monitor aria-hidden="true" />}
              status={
                <Badge tone="warning">{tr("web.awaitingApproval")}</Badge>
              }
              actions={
                <Button onClick={() => setDialog("detail")}>
                  {tr("web.viewDetails")}
                </Button>
              }
            >
              <Disclosure label={tr("ui.fullText")}>{title}</Disclosure>
            </EntityCard>
            <Select
              variant="ghost"
              label={tr("ui.model")}
              value={value}
              onChange={setValue}
              options={models}
              searchable
            />
            <Disclosure label={tr("ui.fullPath")}>
              <code>
                /workspace/example/ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/components.tsx
              </code>
            </Disclosure>
            <Disclosure label={tr("ui.attachments")}>
              <Metadata
                items={Array.from({ length: 12 }, (_, i) => ({
                  label: String(i + 1),
                  value:
                    "ExampleAttachmentWithVeryLongFileName_ABCDEFGHIJKLMNOPQRSTUVWXYZ.md",
                }))}
              />
            </Disclosure>
            <Alert title={tr("ui.readFailed")} error>
              {tr("ui.failureHint")}{" "}
              {stress &&
                "EXAMPLE_ERROR_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234567890123456789"}
            </Alert>
          </Panel>
        )}
      </div>
      {dialog && (
        <Dialog
          title={
            dialog === "detail"
              ? title
              : dialog === "delete"
                ? tr("ui.confirmDelete")
                : tr("ui.exampleDialog")
          }
          onClose={() => setDialog("")}
        >
          <p>{dialog === "delete" ? tr("ui.deleteHint") : tr("ui.demoOnly")}</p>
          {dialog === "files" && (
            <Metadata
              items={[{ label: tr("ui.attachments"), value: "example.md" }]}
            />
          )}
          <Actions>
            <Button onClick={() => setDialog("")}>{tr("web.cancel")}</Button>
            <Button
              variant={dialog === "delete" ? "danger" : "primary"}
              onClick={() => {
                setDialog("");
                setSaved(true);
              }}
            >
              {dialog === "delete" ? tr("web.delete") : tr("ui.done")}
            </Button>
          </Actions>
        </Dialog>
      )}
      <Panel title={tr("monitor.connector")}>
        <Button variant="attention" size="small" aria-expanded={versionExpanded} onClick={() => setVersionExpanded(!versionExpanded)}>
          {tr("monitor.versionDetails")}
        </Button>
        {versionExpanded && <p>{tr("monitor.different")}</p>}
        <Utilization label={tr("monitor.disk")} value={25} reading={tr("monitor.capacity", { used: "25 GB", total: "100 GB" })} />
      </Panel>
      <Panel title={tr("monitor.traffic")}>
        <TrafficChart start={0} end={300000} intervals={[0,1,3,4].map(i => ({
          start:i*60000,end:(i+1)*60000,receivedBytes:600000,sentBytes:120000,
          receivedBytesPerSecond:10000,sentBytesPerSecond:2000
        }))}/>
      </Panel>
    </CollectionLayout>
  );
}
