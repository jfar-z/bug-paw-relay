import { useState } from "react";
import {
  api,
  Button,
  Check,
  ErrorBox,
  Field,
  Input,
  Row,
  Select,
} from "./ui/index.js";
import { t } from "./locale.js";

type Choice = { const: string; title: string };
type FieldSchema = {
  type: "string" | "number" | "integer" | "boolean" | "array";
  title?: string;
  description?: string;
  default?: string | number | boolean | string[];
  enum?: string[];
  enumNames?: string[];
  oneOf?: Choice[];
  items?: { enum?: string[]; anyOf?: Choice[] };
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  format?: string;
};
type Value = string | boolean | number | string[];
type Interaction = {
  id: string;
  method: string;
  executionId: string;
  delivery?: string;
  params?: Record<string, unknown>;
  approval?: { kind: string; decline?: unknown };
  formSchema?: { properties: Record<string, FieldSchema>; required?: string[] };
};

function choices(schema: FieldSchema) {
  const titled = schema.oneOf ?? schema.items?.anyOf;
  return (
    titled?.map((item) => ({ value: item.const, label: item.title })) ??
    (schema.enum ?? schema.items?.enum)?.map((value, i) => ({
      value,
      label: schema.enumNames?.[i] ?? value,
    }))
  );
}

/** 选择值保留原生类型，未填写的可选字段不进入答复。 */
function FormControl({
  name,
  schema,
  required,
  value,
  change,
}: {
  name: string;
  schema: FieldSchema;
  required: boolean;
  value?: Value;
  change: (value?: Value) => void;
}) {
  const label = (schema.title || name) + (required ? " *" : "");
  const options = choices(schema);
  if (schema.type === "array") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <fieldset>
        <legend>{label}</legend>
        {schema.description && <p>{schema.description}</p>}
        {(schema.minItems !== undefined || schema.maxItems !== undefined) && (
          <small>
            {t("web.native.choiceCount", {
              min: schema.minItems ?? 0,
              max: schema.maxItems ?? options?.length ?? 0,
            })}
          </small>
        )}
        {options?.map((option) => (
          <Check
            key={option.value}
            checked={selected.includes(option.value)}
            onChange={(checked) =>
              change(
                checked
                  ? [...selected, option.value]
                  : selected.filter((v) => v !== option.value),
              )
            }
          >
            {option.label}
          </Check>
        ))}
      </fieldset>
    );
  }
  if (options || schema.type === "boolean") {
    const items = options ?? [
      { label: t("web.native.yes"), value: true },
      { label: t("web.native.no"), value: false },
    ];
    // 用选项位置区分空字符串枚举值与未作选择。
    return (
      <Field label={label}>
        <Select
          label={label}
          value={String(items.findIndex((item) => item.value === value))}
          options={[
            { label: t("web.chooseAnOption"), value: "-1" },
            ...items.map((item, i) => ({
              label: item.label,
              value: String(i),
            })),
          ]}
          onChange={(i) => change(items[Number(i)]?.value)}
        />
        {schema.description && <small>{schema.description}</small>}
      </Field>
    );
  }
  const numeric = schema.type === "integer" || schema.type === "number";
  return (
    <Field label={label}>
      <Input
        required={required}
        type={
          numeric
            ? "number"
            : schema.format === "email"
              ? "email"
              : schema.format === "uri"
                ? "url"
                : schema.format === "date"
                  ? "date"
                  : "text"
        }
        min={schema.minimum}
        max={schema.maximum}
        step={schema.type === "integer" ? 1 : "any"}
        minLength={schema.minLength}
        maxLength={schema.maxLength}
        defaultValue={String(value ?? "")}
        onChange={(e) =>
          change(
            e.target.value === ""
              ? undefined
              : numeric
                ? e.target.valueAsNumber
                : e.target.value,
          )
        }
      />
      {schema.description && <small>{schema.description}</small>}
    </Field>
  );
}

const scopeLabels: Record<string, string> = {
  command: "command",
  cwd: "directory",
  reason: "reason",
  grantRoot: "directory",
  changes: "files",
  fileChanges: "files",
  permissions: "permissions",
  additionalPermissions: "permissions",
  networkApprovalContext: "network",
  serverName: "server",
  tool_name: "tool",
  tool_params: "arguments",
  message: "message",
  input: "arguments",
};

/** 展示工具、路径与参数；MCP 的持久化选项不属于本次授权范围。 */
function PermissionScope({ item, fileChanges }: { item: Interaction; fileChanges?: unknown }) {
  const params = item.params ?? {};
  const details = Object.entries(params).filter(
    ([key, value]) =>
      value != null &&
      ![
        "threadId",
        "turnId",
        "itemId",
        "approvalId",
        "availableDecisions",
        "requestedSchema",
        "mode",
        "_meta",
      ].includes(key),
  );
  // 文件审批可能只携带 itemId，此时从同一执行的原生工具记录补全变更清单。
  if (item.method === "item/fileChange/requestApproval" && !params.changes && !params.fileChanges)
    details.push(["changes", fileChanges ?? t("web.native.filesUnavailable")]);
  if (params._meta && typeof params._meta === "object")
    details.push(
      ...Object.entries(params._meta).filter(([key]) =>
        [
          "tool_name",
          "tool_params",
          "tool_title",
          "connector_name",
          "tool_params_display",
        ].includes(key),
      ),
    );
  return (
    <dl>
      {details.map(([key, value]) => (
        <div key={key}>
          <dt>
            {Object.hasOwn(scopeLabels, key)
              ? t("web.scope." + scopeLabels[key])
              : key}
          </dt>
          <dd>
            <pre className="native-request">
              {typeof value === "string"
                ? value
                : JSON.stringify(value, null, 2)}
            </pre>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** 只有连接器明确识别的交互可以提交。权限决定由连接器使用原始参数编码。 */
export function NativeInteraction({
  item,
  disabled,
  refresh,
  fileChanges,
}: {
  item: Interaction;
  disabled: boolean;
  refresh: () => void;
  fileChanges?: unknown;
}) {
  const schema = item.formSchema;
  const fields = Object.entries(schema?.properties ?? {});
  const [content, setContent] = useState<Record<string, Value>>(() =>
    Object.fromEntries(
      fields
        .map(([name, field]) => [
          name,
          field.default ??
            (field.type === "array" && schema?.required?.includes(name)
              ? []
              : undefined),
        ])
        .filter(([, value]) => value !== undefined),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>();
  const locked = busy || sent || disabled;
  async function respond(answer: unknown) {
    setBusy(true);
    setError(undefined);
    try {
      await api("/executions/" + item.executionId + "/answer", {
        interactionId: item.id,
        answer,
      });
      setSent(true);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
      refresh();
    }
  }
  const uncertain = item.delivery === "unconfirmed";
  const permission = item.approval?.kind === "permission";
  const supported = permission ? !!item.approval?.decline : !!schema;
  const missing = schema?.required?.some((key) => !Object.hasOwn(content, key));
  const invalidCount = fields.some(([name, field]) => {
    const value = content[name];
    return (
      Array.isArray(value) &&
      (value.length < (field.minItems ?? 0) ||
        value.length > (field.maxItems ?? Infinity))
    );
  });
  return (
    <section className="approval">
      <h3>
        {t(
          uncertain
            ? "web.native.unconfirmed"
            : permission
              ? "web.scope"
              : "web.awaitingNativeInteraction",
        )}
      </h3>
      <p>{item.method}</p>
      {uncertain || !supported ? (
        <p>
          {t(
            uncertain
              ? "web.native.deliveryHelp"
              : permission
                ? "web.native.upgrade"
                : "web.native.unsupported",
          )}
        </p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!locked && !missing && !invalidCount)
              void respond(
                permission ? { allow: true } : { action: "accept", content },
              );
          }}
        >
          {permission ? (
            <PermissionScope item={item} fileChanges={fileChanges} />
          ) : (
            <>
              <p>{String(item.params?.message ?? "")}</p>
              {fields.map(([name, field]) => (
                <FormControl
                  key={name}
                  name={name}
                  schema={field}
                  required={!!schema?.required?.includes(name)}
                  value={
                    Object.hasOwn(content, name) ? content[name] : undefined
                  }
                  change={(value) =>
                    setContent((previous) => {
                      const next = { ...previous, [name]: value };
                      if (value === undefined) delete next[name];
                      return next as Record<string, Value>;
                    })
                  }
                />
              ))}
            </>
          )}
          <ErrorBox error={error} />
          <Row>
            <Button
              disabled={locked}
              onClick={() =>
                void respond(
                  permission ? { allow: false } : { action: "decline" },
                )
              }
            >
              {t("web.reject")}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={locked || missing || invalidCount}
            >
              {t(permission ? "web.approveThisTime" : "web.submitAnswer")}
            </Button>
          </Row>
        </form>
      )}
    </section>
  );
}
