"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cloudFetch } from "@/lib/cloud/request";
import type { SkillId, SkillScope, SkillTask } from "@/lib/skills/types";
import { Card } from "@/app/components/ui/Card";
import { SKILL_REGISTRY, skillProviderAside } from "./registry";
import { SkillPanelView } from "./SkillPanelView";

type Props = {
  skillId: SkillId;
  scope: SkillScope;
  /** Resume polling an already-running task (e.g. reopening a saved report). */
  initialTaskId?: string;
  /** Fires once when the task reaches a terminal state (complete or failed). */
  onComplete?: (task: SkillTask) => void;
  labelAs?: "span" | "h2" | "h3";
};

/**
 * The generalized skill panel container — registry lookup, POST-to-start,
 * GET-to-poll. Mirrors TechnicalSeoPanel's ref/cleanup discipline (DATA-CONTRACT §8).
 */
export function SkillPanel({ skillId, scope, initialTaskId, onComplete, labelAs }: Props) {
  const entry = SKILL_REGISTRY[skillId];

  const [task, setTask] = useState<SkillTask | null>(null);
  const [ready, setReady] = useState(!initialTaskId);
  const [busy, setBusy] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const firedRef = useRef(false);

  const load = useCallback(
    async (id: string) => {
      try {
        const response = await cloudFetch(`/api/skills/${skillId}?id=${encodeURIComponent(id)}`, { method: "GET" });
        const body = (await response.json()) as { task?: SkillTask; error?: string };
        if (body.error === "provider_unavailable") setConfigured(false);
        if (!response.ok || !body.task) {
          setError("This check's status could not be refreshed.");
          return;
        }
        setConfigured(true);
        setTask(body.task);
        setError(null);
      } catch {
        setError("This check's status could not be refreshed.");
      } finally {
        setReady(true);
      }
    },
    [skillId],
  );

  useEffect(() => {
    if (!initialTaskId) return;
    let active = true;
    queueMicrotask(() => {
      if (active) void load(initialTaskId);
    });
    return () => {
      active = false;
    };
  }, [initialTaskId, load]);

  useEffect(() => {
    if (task?.status !== "creating" && task?.status !== "queued" && task?.status !== "running") return;
    const timeout = window.setTimeout(() => {
      void load(task.id);
    }, 5_000);
    return () => window.clearTimeout(timeout);
  }, [load, task?.status, task?.id, task?.updatedAt]);

  useEffect(() => {
    if (!task || firedRef.current) return;
    if (task.status !== "complete" && task.status !== "failed") return;
    firedRef.current = true;
    onComplete?.(task);
  }, [task, onComplete]);

  if (!entry || !entry.enabled) return null;

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await cloudFetch(`/api/skills/${skillId}`, {
        method: "POST",
        body: JSON.stringify({ scope }),
      });
      const body = (await response.json()) as { task?: SkillTask; error?: string };
      if (body.error === "provider_unavailable") setConfigured(false);
      if (!response.ok || !body.task) {
        setError("This check could not be started.");
        return;
      }
      setConfigured(true);
      setTask(body.task);
    } catch {
      setError("This check could not be started.");
    } finally {
      setBusy(false);
      setReady(true);
    }
  };

  return (
    <Card label={entry.label} labelAs={labelAs ?? "h3"} aside={skillProviderAside(entry)}>
      <div className="p-3.5">
        <SkillPanelView
          entry={entry}
          task={task}
          ready={ready}
          busy={busy}
          configured={configured}
          error={error}
          onStart={() => void start()}
        />
      </div>
    </Card>
  );
}
