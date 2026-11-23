import { test, expect } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { createApp } from "../src/server/app.js";
import { digest } from "../src/server/security.js";
import {
  type QuestionRecord,
  validateQuestionAnswer,
} from "../src/shared/user-questions.js";

/** 真 HTTP/SSE 与产品页面连接可控环境 RPC；不将协议桩冒充供应商模型验收。 */
for (const locale of ["zh-CN", "en"] as const)
  test(`问题卡片完整交互与恢复 ${locale}`, async ({ page, context }) => {
    const dir = mkdtempSync(join(tmpdir(), "relay-question-browser-"));
    const probe = createServer();
    await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
    const port = (probe.address() as any).port;
    await new Promise<void>((r) => probe.close(() => r()));
    const base = `http://127.0.0.1:${port}`;
    const { app, store, service } = await createApp({
      dataDir: dir,
      publicUrl: base,
      webDir: resolve("dist/web"),
      secureCookie: false,
    });
    const cookie = randomUUID();
    store.put("users", { username: "fixture" }, "owner");
    store.db
      .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
      .run(digest(cookie), "owner", Date.now() + 600000);
    const env = store.put("environments", {
      name: "fixture",
      approved: true,
      roots: [],
      capabilities: ["user-questions-v1", "runtime-options-v1"],
    });
    const project = service.save("projects", {
      name: "fixture",
      directories: [
        { environmentId: env.id, rootId: "root", relativePath: "." },
      ],
    });
    service.peers.set(env.id, {
      call: async () => ({}),
      close: () => {},
    } as any);
    const session = service.createSession({
      agentId: service.save("agents", { name: "Fixture agent" }).id,
      title: "fixture",
      projectId: project.id,
      environmentId: env.id,
      rootId: "root",
      runtime: "codex",
    });
    const executionId = randomUUID();
    store.db
      .prepare("INSERT INTO executions VALUES(?,?,?,?,?,?,?)")
      .run(
        executionId,
        null,
        session.id,
        env.id,
        "waiting",
        "{}",
        new Date().toISOString(),
      );
    store.put("sessions", { status: "waiting", executionId }, session.id);
    const records: QuestionRecord[] = ["codex", "claude"].map(
      (provider, i) => ({
        id: randomUUID(),
        nativeId: String(i),
        ...(i === 1 ? { afterSequence: 1 } : {}),
        executionId,
        sessionId: session.id,
        status: "waiting",
        form: {
          version: 1,
          supported: true,
          provider: provider as any,
          questions: [
            {
              id: "choice",
              header: "方案",
              question:
                "选择方案 <script>window.questionInjected=true</script>",
              options: [
                {
                  id: "0",
                  label: "Alpha",
                  description: "第一种方案的完整说明",
                },
                {
                  id: "1",
                  label: i === 0 ? "读一会儿书" : "Beta",
                  description: "第二种方案的完整说明",
                },
              ],
              multiSelect: i === 1,
              allowText: true,
              secret: false,
            },
            {
              id: "text",
              header: "说明",
              question: "补充中文与 English 多行说明",
              options: [],
              multiSelect: false,
              allowText: true,
              secret: false,
            },
          ],
        },
      }),
    );
    let calls = 0;
    let historyReads = 0;
    let release: (() => void) | undefined;
    let delay = true;
    service.peers.set(env.id, {
      call: async (method: string, p: any) => {
        if (method === "runtime.catalog")
          return { runtime: "codex", models: [], defaults: {} };
        if (method === "session.history") {
          historyReads++;
          const first = records[0];
          const text = JSON.stringify({
            requestId: first.nativeId,
            answers: [
              {
                question: first.form.questions[0].question,
                answers: ["读一会儿书"],
              },
              {
                question: first.form.questions[1].question,
                answers: ["中文\nEnglish"],
              },
            ],
          });
          const user = (id: string) => ({
            type: "userMessage",
            id,
            content: [{ type: "text", text }],
          });
          return {
            status: "waiting",
            nativeHistory: {
              thread: {
                turns: [
                  {
                    id: "ask",
                    items: [
                      {
                        type: "agentMessage",
                        id: first.nativeId,
                        delivery: "async",
                        questions: [
                          { title: first.form.questions[0].question },
                        ],
                      },
                    ],
                  },
                  {
                    id: "receipt",
                    items: [
                      ...(first.status === "answered"
                        ? [user("receipt-input")]
                        : []),
                      {
                        id: "reply",
                        type: "agentMessage",
                        text: "fixture-following-reply",
                      },
                    ],
                  },
                  ...(first.status === "answered"
                    ? [{ id: "manual", items: [user("manual-input")] }]
                    : []),
                ],
              },
            },
            events: [
              {
                executionId,
                sequence: 1,
                type: "item/completed",
                data: {
                  item: {
                    id: "reply",
                    type: "agentMessage",
                    text: "fixture-following-reply",
                  },
                },
              },
              {
                executionId,
                sequence: 2,
                type: "item/completed",
                data: {
                  item: {
                    id: "later",
                    type: "agentMessage",
                    text: "fixture-second-reply",
                  },
                },
              },
            ],
            interactions: records
              .filter((r) => r.status === "waiting")
              .map((r) => ({
                id: r.id,
                method:
                  r.form.provider === "codex"
                    ? "item/tool/requestUserInput"
                    : "AskUserQuestion",
                question: r.form,
              })),
            questionProtocol: 1,
            questionRecords: structuredClone(records),
          };
        }
        const record = records.find((r) => r.id === p.interactionId)!;
        if (method === "interaction.status")
          return { record: structuredClone(record) };
        if (method === "interaction.answer") {
          calls++;
          expect(p.executionId).toBe(executionId);
          record.answer = validateQuestionAnswer(record.form, p.answer);
          record.status = "submitting";
          if (delay)
            await new Promise<void>((r) => {
              release = r;
            });
          record.status = "answered";
          if (record === records[0]) record.answerTurnId = "receipt";
          service.sessionEvents.emit(session.id, {
            type: "update",
            executionId,
            questionRecords: structuredClone(records),
          });
          return { ok: true, record: structuredClone(record) };
        }
        return {};
      },
      close: () => {},
    } as any);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await context.addCookies([
      { name: "relay_session", value: cookie, url: base },
    ]);
    service.saveLanguage({ preference: locale });
    await app.listen({ host: "127.0.0.1", port });
    const submit = locale === "en" ? "Submit answers" : "提交回答";
    const custom = locale === "en" ? "Custom answer" : "自定义回答";
    try {
      await page.goto(base + "/#chat/" + session.id);
      const cards = page.locator(".question-card");
      await expect(cards).toHaveCount(2);
      const first = cards.nth(0),
        second = cards.nth(1);
      await expect(first.getByRole("button", { name: submit })).toBeEnabled();
      await expect(cards.getByRole("checkbox", { checked: true })).toHaveCount(
        0,
      );
      await expect(
        page.getByRole("button", { name: /查看并回答|View and respond/i }),
      ).toHaveCount(0);
      await first.getByRole("button", { name: submit }).click();
      await expect(first.locator('[aria-invalid="true"]')).toHaveCount(1);
      await first.getByRole("checkbox", { name: /Alpha/ }).check();
      await first.getByRole("checkbox", { name: custom, exact: true }).check();
      await first.locator("textarea").nth(0).fill("discarded");
      await first.getByRole("checkbox", { name: /读一会儿书/ }).check();
      await expect(first.locator("textarea")).toHaveCount(1);
      await first.locator("textarea").fill("中文\nEnglish");
      await second.getByRole("checkbox", { name: /Alpha/ }).check();
      await second.getByRole("checkbox", { name: /Beta/ }).check();
      await second.getByRole("checkbox", { name: custom, exact: true }).check();
      await second.locator("textarea").nth(0).fill("Other");
      await second.locator("textarea").nth(1).fill("independent draft");
      await second.locator("textarea").nth(1).focus();
      const reads = historyReads;
      await expect
        .poll(() => historyReads, { timeout: 10000 })
        .toBeGreaterThan(reads);
      await expect(second.locator("textarea").nth(1)).toBeFocused();
      await page.screenshot({ path: `.vibe/question-${locale}-waiting.png` });
      await first.getByRole("button", { name: submit }).click();
      await expect.poll(() => calls).toBe(1);
      await expect(first.getByRole("checkbox").first()).toBeDisabled();
      await expect(second.locator("textarea").nth(1)).toHaveValue(
        "independent draft",
      );
      release!();
      delay = false;
      await expect(first.locator(".question-answer").first()).toHaveText(
        "读一会儿书",
      );
      expect(records[0].answer?.answers[0].text).toBeUndefined();
      await expect(first.locator(".question-answer").nth(1)).toHaveText(
        "中文\nEnglish",
      );
      // 服务端已接收但 HTTP 回执丢失，前端只读查询，不补发答案。
      await page.route(
        `**/api/executions/${executionId}/answer`,
        async (route) => {
          await route.fetch();
          await route.abort();
        },
      );
      await second.getByRole("button", { name: submit }).click();
      await expect(second.locator(".question-answer").first()).toHaveText(
        "Alpha\nBeta\nOther",
      );
      expect(calls).toBe(2);
      await page.reload();
      await expect(cards.locator(".question-answer")).toHaveCount(4);
      const reply = page.getByText("fixture-following-reply", { exact: true });
      await expect(reply).toBeVisible();
      expect(
        await second.evaluate(
          (card, following) =>
            Boolean(
              card.compareDocumentPosition(following!) &
              Node.DOCUMENT_POSITION_FOLLOWING,
            ),
          await page
            .getByText("fixture-second-reply", { exact: true })
            .elementHandle(),
        ),
      ).toBe(true);
      expect(
        await reply.evaluate(
          (message, card) =>
            Boolean(
              message.compareDocumentPosition(card!) &
              Node.DOCUMENT_POSITION_FOLLOWING,
            ),
          await second.elementHandle(),
        ),
      ).toBe(true);
      expect(
        await first.evaluate(
          (card, following) =>
            Boolean(
              card.compareDocumentPosition(following!) &
              Node.DOCUMENT_POSITION_FOLLOWING,
            ),
          await reply.elementHandle(),
        ),
      ).toBe(true);
      await expect(
        page.locator(".user-message").filter({ hasText: '"requestId"' }),
      ).toHaveCount(1);
      expect(
        await page.evaluate(() => (window as any).questionInjected),
      ).toBeUndefined();
      for (const width of [1440, 390])
        for (const theme of ["light", "dark", "bug"]) {
          await page.setViewportSize({ width, height: 900 });
          await page.evaluate(
            (theme) => (document.documentElement.dataset.theme = theme),
            theme,
          );
          await expect(first).toBeVisible();
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
          await page.screenshot({
            path: `.vibe/question-${locale}-${width}-${theme}.png`,
          });
        }
      // 新请求同题文保持独立；断线不排队，恢复后必须重新核对。
      const next = structuredClone(records[0]);
      next.id = randomUUID();
      next.nativeId = next.id;
      next.status = "waiting";
      delete next.answer;
      records.push(next);
      service.sessionEvents.emit(session.id, {
        type: "update",
        executionId,
        questionRecords: structuredClone(records),
      });
      const third = cards.nth(2);
      await expect(third.getByRole("button", { name: submit })).toBeEnabled();
      await context.setOffline(true);
      await expect(third.getByRole("button", { name: submit })).toBeDisabled();
      await context.setOffline(false);
      await expect(third.getByRole("button", { name: submit })).toBeEnabled({
        timeout: 20000,
      });
      await third.getByRole("checkbox", { name: /Alpha/ }).focus();
      await page.keyboard.press("Space");
      await expect(
        third.getByRole("checkbox", { name: /Alpha/ }),
      ).toBeChecked();
      await third.locator("textarea").fill("line");
      await third.locator("textarea").press("Enter");
      await expect(third.locator("textarea")).toHaveValue("line\n");
      expect(calls).toBe(2);
      next.status = "invalidated";
      service.sessionEvents.emit(session.id, {
        type: "update",
        executionId,
        questionRecords: structuredClone(records),
      });
      await expect(third.getByRole("button", { name: submit })).toHaveCount(0);
      const unsupported = structuredClone(next);
      unsupported.id = randomUUID();
      unsupported.status = "waiting";
      unsupported.form.supported = false;
      const unknown = structuredClone(records[0]);
      unknown.id = randomUUID();
      unknown.nativeId = unknown.id;
      unknown.status = "unknown";
      const secret = structuredClone(records[0]);
      secret.id = randomUUID();
      secret.nativeId = secret.id;
      secret.form.questions[1].secret = true;
      secret.answer!.answers[1].text = "fixture-private-answer";
      records.push(unsupported, unknown, secret);
      service.sessionEvents.emit(session.id, {
        type: "update",
        executionId,
        questionRecords: structuredClone(records),
      });
      await expect(cards).toHaveCount(6);
      await expect(
        cards.nth(3).getByRole("button", { name: submit }),
      ).toHaveCount(0);
      await expect(
        cards.nth(4).getByRole("button", { name: submit }),
      ).toHaveCount(0);
      await expect(cards.nth(5)).not.toContainText("fixture-private-answer");
      await expect(cards.nth(5)).toContainText(
        locale === "en" ? "Secret answer hidden" : "密文答案已隐藏",
      );
      store.put("environments", { capabilities: [] }, env.id);
      await page.reload();
      await expect(cards.nth(0)).toContainText(
        locale === "en" ? "Upgrade" : "升级",
      );
      expect(calls).toBe(2);
      expect(errors).toEqual([]);
    } finally {
      release?.();
      await context.close();
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
