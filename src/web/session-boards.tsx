import { useState } from "react";
import { api } from "./api.js";
import {
  Badge,
  Button,
  Dialog,
  ErrorBox,
  LinkButton,
  Metadata,
  Panel,
  Row,
} from "./ui/index.js";
import {
  caughtFeedback,
  displayError,
  feedback,
  t,
  type UiFeedback,
} from "./locale.js";
import { useRows } from "./use-rows.js";

type StageSnapshot = { stageName?: string; stageNameKey?: string };
export type BoardCard = StageSnapshot & {
  id: string;
  createdAt: string;
  executionId: string;
  sessionId: string;
  itemId: string;
  boardId: string;
  boardName: string;
  title: string;
  archived: boolean;
};
type Confirmation = {
  id: string;
  method: "create" | "archive";
  boardName: string;
  itemTitle?: string;
  data: {
    title?: string;
    itemId?: string;
    summary?: string;
    acceptance?: string;
  };
  plan?: StageSnapshot & {
    schedulesAgent: boolean;
    files: { path: string }[];
    destination?: {
      environmentName?: string;
      environmentId: string;
      cwd?: string;
    };
  };
};

function stageText(stage: StageSnapshot) {
  return stage.stageNameKey
    ? t(stage.stageNameKey)
    : stage.stageName || t("web.originalStageDeleted");
}

/** 卡片展示生成时的快照，链接按两个对象标识读取当前详情。 */
export function SessionBoardCard({ card }: { card: BoardCard }) {
  return (
    <article className="session-publication" aria-label={card.title}>
      <strong>{card.title}</strong>
      <Row>
        <span>{card.boardName}</span>
        <Badge>{stageText(card)}</Badge>
        {card.archived && <Badge>{t("web.archived")}</Badge>}
        <LinkButton href={`#board/${card.boardId}/items/${card.itemId}`}>
          {t("web.boardCard.open")}
        </LinkButton>
      </Row>
    </article>
  );
}

export function useBoardConfirmations(sessionId?: string) {
  return useRows<Confirmation>(
    sessionId ? "/sessions/" + sessionId + "/board-confirmations" : "",
    15000,
  );
}

/** 审批保留服务端计划中的目标、材料和入队效果，决定只作用于该请求。 */
export function BoardConfirmations({
  collection,
  sessionId,
}: {
  collection: ReturnType<typeof useBoardConfirmations>;
  sessionId: string;
}) {
  const [selectedId, setSelectedId] = useState("");
  const selected = collection.rows?.find((row) => row.id === selectedId);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<UiFeedback>("");
  const [error, setError] = useState<UiFeedback>("");
  async function decide(row: Confirmation, approve: boolean) {
    setBusy(row.id);
    setNotice("");
    setError("");
    try {
      const result = await api(
        `/sessions/${sessionId}/board-confirmations/${row.id}`,
        { approve },
      );
      setNotice(
        feedback(
          result.status === "denied"
            ? "web.rejected"
            : result.outcome === "card_pending"
              ? "web.boardCard.pendingCard"
              : "web.approved",
        ),
      );
    } catch (err) {
      setError(caughtFeedback(err));
    } finally {
      setSelectedId("");
      await collection.refresh();
      setBusy("");
    }
  }
  return (
    <>
      <ErrorBox error={error || collection.error} />
      {notice && <p role="status">{displayError(notice)}</p>}
      {!!collection.rows?.length && (
        <Panel title={t("web.platformOperationsAwaitingApproval")}>
          {collection.rows.map((row) => (
            <Row key={row.id}>
              <strong className="wrap">
                {row.data.title || row.itemTitle}
              </strong>
              <Button onClick={() => setSelectedId(row.id)}>
                {t("web.viewDetails")}
              </Button>
            </Row>
          ))}
        </Panel>
      )}
      {selected && (
        <Dialog
          title={t(
            selected.method === "archive"
              ? "web.archive"
              : "web.createWorkItem",
          )}
          onClose={() => setSelectedId("")}
        >
          <strong className="wrap">
            {selected.boardName} · {selected.data.title || selected.itemTitle}
          </strong>
          {selected.method === "archive" && <p>{selected.data.itemId}</p>}
          {selected.plan && (
            <Metadata
              items={[
                { label: t("web.requirements"), value: selected.data.summary },
                {
                  label: t("web.boardCard.acceptance"),
                  value: selected.data.acceptance,
                },
                {
                  label: t("web.targetStage"),
                  value:
                    stageText(selected.plan) +
                    " · " +
                    t(
                      selected.plan.schedulesAgent
                        ? "web.boardCard.queue"
                        : "web.boardCard.manual",
                    ),
                },
                ...(selected.plan.files.length
                  ? [
                      {
                        label: t("ui.attachments"),
                        value: selected.plan.files.map((f) => (
                          <div key={f.path}>{f.path}</div>
                        )),
                      },
                      {
                        label: t("web.boardCard.target"),
                        value: [
                          selected.plan.destination?.environmentName ||
                            selected.plan.destination?.environmentId,
                          selected.plan.destination?.cwd,
                        ].join(" · "),
                      },
                    ]
                  : []),
              ]}
            />
          )}
          <Row>
            <Button
              disabled={!!busy}
              onClick={() => void decide(selected, false)}
            >
              {t("web.rejectThisOperation")}
            </Button>
            <Button
              variant="primary"
              disabled={!!busy}
              onClick={() => void decide(selected, true)}
            >
              {t("web.approveThisOperation")}
            </Button>
          </Row>
        </Dialog>
      )}
    </>
  );
}
