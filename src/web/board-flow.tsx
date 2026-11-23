import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Stage } from "../shared/contracts.js";
import { stageLabel } from "./stage-label.js";
import { t, useLocale } from "./locale.js";
import { Badge, FlowDiagram, SurfaceButton } from "./ui/index.js";

type NamedEntity = { id: string; name: string };

/** 同一段纵向区间的连线分轨，正向与回退使用不同线型。 */
function routeEdges(stages: Stage[]) {
  const positions = new Map(stages.map((stage, index) => [stage.id, index]));
  const edges = stages.flatMap((stage, from) =>
    Array.from(new Set(stage.targets)).flatMap((target) => {
      const to = positions.get(target);
      return to === undefined || to === from
        ? []
        : [{ from, to, start: Math.min(from, to), end: Math.max(from, to) }];
    }),
  );
  edges.sort((a, b) => a.start - b.start || a.end - b.end || a.from - b.from);
  const trackEnds: number[] = [];
  const routes = edges.map((edge) => {
    const free = trackEnds.findIndex((end) => end < edge.start);
    const track = free < 0 ? trackEnds.length : free;
    trackEnds[track] = edge.end;
    return { ...edge, track };
  });
  return { routes, tracks: trackEnds.length };
}

/** 从同一份流程草稿生成卡片、文字关系和桌面连线。 */
export function BoardFlow({
  stages,
  selected,
  environments,
  agents,
  onSelect,
}: {
  stages: Stage[];
  selected: string | null;
  environments: NamedEntity[];
  agents: NamedEntity[];
  onSelect: (id: string) => void;
}) {
  useLocale();
  const list = useRef<HTMLOListElement>(null);
  const [centers, setCenters] = useState<number[]>([]);
  const [height, setHeight] = useState(0);
  const marker = useId();
  const { routes, tracks } = useMemo(() => routeEdges(stages), [stages]);
  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const measure = () => {
      const top = element.getBoundingClientRect().top;
      setHeight(element.offsetHeight);
      setCenters(
        Array.from(element.children, (child) => {
          const rect = child.getBoundingClientRect();
          return rect.top - top + rect.height / 2;
        }),
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const card of element.children) observer.observe(card);
    measure();
    return () => observer.disconnect();
  }, [stages]);
  const label = (stage: Stage) => stageLabel(stage, !stage.shortId);
  const width = Math.max(64, Math.min(170, 26 + tracks * 12));
  return (
    <FlowDiagram
      width={width}
      height={height}
      lines={
        <svg width={width} height={height} aria-hidden="true">
          <defs>
            <marker
              id={marker}
              viewBox="0 0 8 8"
              refX="8"
              refY="4"
              markerWidth="7"
              markerHeight="7"
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              <path d="M 0 0 L 8 4 L 0 8 Z" fill="context-stroke" />
            </marker>
          </defs>
          {routes.map(({ from, to, track }) => {
            if (centers[from] === undefined || centers[to] === undefined)
              return null;
            const source = stages[from];
            const target = stages[to];
            const outgoing = selected === source.id;
            const incoming = selected === target.id;
            const x = 16 + track * ((width - 26) / Math.max(1, tracks - 1));
            const y1 = centers[from] - 7;
            const y2 = centers[to] + 7;
            return (
              <path
                key={`${source.id}-${target.id}`}
                data-from={source.id}
                data-to={target.id}
                data-relation={
                  outgoing
                    ? "outgoing"
                    : incoming
                      ? "incoming"
                      : selected
                        ? "muted"
                        : "normal"
                }
                d={`M 1 ${y1} H ${x} V ${y2} H 1`}
                fill="none"
                strokeDasharray={from > to ? "4 3" : undefined}
                markerEnd={`url(#${marker})`}
              >
                <title>
                  {label(source)} → {label(target)}
                </title>
              </path>
            );
          })}
        </svg>
      }
    >
      <ol ref={list} aria-label={t("web.stagesAndTransitions")}>
        {stages.map((stage) => {
          const targets = stages.filter((candidate) =>
            stage.targets.includes(candidate.id),
          );
          return (
            <li key={stage.id}>
              <SurfaceButton
                kind="flowStage"
                selected={selected === stage.id}
                aria-expanded={selected === stage.id}
                aria-labelledby={`${marker}-name-${stage.id}`}
                aria-describedby={`${marker}-targets-${stage.id}`}
                data-flow-stage={stage.id}
                onClick={() => onSelect(stage.id)}
              >
                <strong id={`${marker}-name-${stage.id}`}>
                  {label(stage)}
                </strong>
                <span>
                  <Badge>
                    {t(
                      stage.type === "agent"
                        ? "web.agentStage"
                        : stage.type === "done"
                          ? "web.flowCompleted"
                          : "web.humanStage",
                    )}
                  </Badge>
                  {stage.fixedRole === "start" && (
                    <Badge>{t("web.flowStart")}</Badge>
                  )}
                  {stage.type === "done" && <Badge>{t("web.flowEnd")}</Badge>}
                </span>
                {stage.type === "agent" && (
                  <small>
                    {environments.find(
                      (entry) => entry.id === stage.environmentId,
                    )?.name ?? t("web.flowNoEnvironment")}
                    {" · "}
                    {agents.find((entry) => entry.id === stage.agentId)?.name ??
                      t("web.noRoleConfiguration")}
                  </small>
                )}
                <small id={`${marker}-targets-${stage.id}`} data-flow-targets>
                  {targets.length
                    ? `${t("web.reachableStages")} · ${targets.map(label).join(" / ")}`
                    : t("web.flowNoTargets")}
                </small>
              </SurfaceButton>
            </li>
          );
        })}
      </ol>
    </FlowDiagram>
  );
}
