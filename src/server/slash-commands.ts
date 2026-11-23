import { z } from "zod";
import { ensure, sendSchema } from "../shared/contracts.js";
import { message } from "../shared/i18n.js";
import {
  commandCapability,
  commandEntry,
  commandScope,
  fixedCommands,
  slashInput,
  type CommandScope,
} from "../shared/slash-commands.js";
import type { Service } from "./service.js";

export const manualSendSchema = sendSchema.extend({
  literal: z.boolean().default(false),
});

/** 目录与 CLI 只从已登记项目或会话绑定取值，命令行与模板正文不入服务端索引。 */
export function commandPeer(service: Service, scope: CommandScope) {
  const env = service.store.get("environments", scope.environmentId);
  ensure(
    env.approved && !env.revoked,
    "FORBIDDEN",
    message("errors.FORBIDDEN.the.environment.is.not.accessible"),
    403,
  );
  service.requireEnabledRuntime(env, scope.runtime);
  const project = service.store.get("projects", scope.projectId);
  ensure(
    project.directories.some(
      (d: any) =>
        d.environmentId === scope.environmentId &&
        d.rootId === scope.rootId &&
        d.relativePath === scope.relativePath,
    ),
    "DIRECTORY_MISMATCH",
    message("errors.DIRECTORY_MISMATCH.the.directory.must.be.registered.in"),
    403,
  );
  const peer = service.peer(scope.environmentId);
  ensure(
    env.capabilities?.includes(commandCapability),
    "CONNECTOR_UPGRADE",
    message("slash.upgrade"),
    409,
  );
  return peer;
}

export async function manualSend(
  service: Service,
  id: string,
  data: z.infer<typeof manualSendSchema>,
) {
  const { operationId, message: text, mentions, attachments } = data;
  const input = slashInput(text);
  const session = service.store.get("sessions", id);
  if (!input || data.literal) {
    // SDK 会识别开头的斜杠。只有 Codex 的字面发送已经过原生接口验证。
    ensure(
      session.runtime !== "claude" || !slashInput(text.trimStart()),
      "COMMAND_LITERAL",
      message("slash.literal"),
      409,
    );
    return service.send(id, operationId, text, mentions, attachments);
  }
  ensure(
    !session.archived,
    "ARCHIVED",
    message("errors.ARCHIVED.unarchive.the.session.before.sending.messages"),
    409,
  );
  ensure(
    session.claudeMode !== "environment",
    "NATIVE_TERMINAL",
    message("connector.native.terminal"),
    409,
  );
  const scope = commandScope.parse(session);
  const peer = commandPeer(service, scope);
  const fixed = fixedCommands.some((n) => n === input.name);
  const native = fixed
    ? undefined
    : commandEntry.parse(
        await peer.call("commands.resolve", { ...scope, name: input.name }),
      );
  if (!fixed) {
    ensure(
      native?.enabled &&
        native.name === input.name &&
        native.identity &&
        native.execution,
      "COMMAND_UNSUPPORTED",
      message("slash.unsupported"),
      409,
    );
    ensure(
      commandPeer(service, scope) === peer,
      "OFFLINE",
      message("slash.stale"),
      409,
    );
  }
  if (native && native.execution !== "rename")
    return service.send(
      id,
      operationId,
      text,
      mentions,
      attachments,
      native.identity,
    );
  ensure(
    !attachments.length,
    "COMMAND_ATTACHMENTS",
    message("slash.attachments"),
    409,
  );
  if (input.name === "resume") {
    const sessions = service.store
      .list("sessions")
      .filter(
        (s) =>
          !s.archived &&
          s.ownerId === session.ownerId &&
          s.environmentId === scope.environmentId &&
          s.projectId === scope.projectId &&
          s.runtime === scope.runtime &&
          (!input.args || s.id === input.args || s.title === input.args),
      )
      .map(({ id, title }) => ({ id, title }));
    ensure(
      !input.args || sessions.length,
      "COMMAND_NOT_FOUND",
      message("slash.notFound"),
      404,
    );
    return {
      action:
        input.args && sessions.length === 1 ? "navigate" : "chooseSession",
      sessions,
    };
  }
  if (input.name === "model" || input.name === "new")
    ensure(!input.args, "COMMAND_ARGUMENT", message("slash.noArguments"));
  if (input.name === "new") return { action: "newSession", scope };
  ensure(
    !service.active(id) &&
      ![
        "queued",
        "dispatching",
        "running",
        "waiting",
        "unknown",
        "stopping",
      ].includes(session.status),
    "BUSY",
    message("errors.BUSY.this.session.is.running"),
    409,
  );
  if (input.name === "model") return { action: "chooseModel", sessionId: id };
  if (!input.args) return { action: "rename", sessionId: id };
  ensure(input.args.length <= 200, "COMMAND_ARGUMENT", message("slash.titleLength"));
  const result = await peer.call("commands.rename", {
    operationId,
    ...scope,
    sessionId: id,
    title: input.args,
    name: input.name,
  });
  service.syncSessionTitle(id, result.title);
  return { action: "renamed", title: result.title, sessionId: id };
}
