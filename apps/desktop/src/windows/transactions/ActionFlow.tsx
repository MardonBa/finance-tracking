/**
 * Every fix goes through a registry action with a before → after preview
 * (§1, §7): propose → see the changes → Apply → "Done · Undo".
 * `useOneClick` runs at once (Needs a look, labels) and still shows the
 * before → after with Undo.
 */
import { useState } from "react";
import type { ActionPreview } from "@ft/core";
import { useActions } from "../../data/hooks.ts";
import { Button } from "../../ui/components.tsx";

export interface Proposal {
  name: string;
  input: unknown;
}

type Phase =
  | { kind: "idle" }
  | { kind: "loading"; proposal: Proposal }
  | { kind: "ready"; proposal: Proposal; preview: ActionPreview }
  | { kind: "running"; proposal: Proposal; preview: ActionPreview }
  | { kind: "done"; preview: ActionPreview; logId: string; undone: boolean }
  | { kind: "error"; message: string };

function errorText(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  try {
    const j = JSON.parse(raw) as { message?: string; error?: string };
    return j.message ?? j.error ?? raw;
  } catch {
    return raw;
  }
}

export function useActionFlow() {
  const actions = useActions();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  return {
    phase,
    async propose(p: Proposal) {
      setPhase({ kind: "loading", proposal: p });
      try {
        const { preview } = await actions.preview(p.name, p.input);
        setPhase({ kind: "ready", proposal: p, preview });
      } catch (e) {
        setPhase({ kind: "error", message: errorText(e) });
      }
    },
    async apply() {
      if (phase.kind !== "ready") return;
      setPhase({ ...phase, kind: "running" });
      try {
        const res = await actions.run(phase.proposal.name, phase.proposal.input);
        setPhase({ kind: "done", preview: res.preview ?? phase.preview, logId: res.logId, undone: false });
      } catch (e) {
        setPhase({ kind: "error", message: errorText(e) });
      }
    },
    async undo() {
      if (phase.kind !== "done") return;
      try {
        await actions.undo(phase.logId);
        setPhase({ ...phase, undone: true });
      } catch (e) {
        setPhase({ kind: "error", message: errorText(e) });
      }
    },
    cancel() {
      setPhase({ kind: "idle" });
    },
  };
}

export type ActionFlow = ReturnType<typeof useActionFlow>;

export function Changes({ preview }: { preview: ActionPreview }) {
  return (
    <div className="tx-changes">
      <p className="tx-changes__summary">{preview.summary}</p>
      <ul className="tx-changes__list">
        {preview.changes.map((c, i) => (
          <li key={i}>
            <span className="tx-changes__label">{c.label}</span>
            <span className="tx-changes__before">{c.before ?? "None"}</span>
            <span aria-hidden="true">→</span>
            <span className="tx-changes__after">{c.after ?? "None"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The preview / apply / undo panel under an editor. */
export function ActionFlowPanel({ flow }: { flow: ActionFlow }) {
  const p = flow.phase;
  if (p.kind === "idle") return null;
  if (p.kind === "loading") return <p className="tx-flow tx-muted">Working out the change…</p>;
  if (p.kind === "error")
    return (
      <div className="tx-flow tx-flow--error" role="alert">
        <span>{p.message}</span>
        <Button size="sm" variant="ghost" onClick={flow.cancel}>
          Dismiss
        </Button>
      </div>
    );
  if (p.kind === "done")
    return (
      <div className="tx-flow tx-flow--done" role="status">
        <Changes preview={p.preview} />
        <div className="tx-flow__buttons">
          <span className="tx-muted">{p.undone ? "Undone" : "Done"}</span>
          {!p.undone && (
            <Button size="sm" onClick={() => void flow.undo()}>
              Undo
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={flow.cancel}>
            Close
          </Button>
        </div>
      </div>
    );
  return (
    <div className="tx-flow" role="region" aria-label="Preview of the change">
      <Changes preview={p.preview} />
      <div className="tx-flow__buttons">
        <Button size="sm" variant="primary" disabled={p.kind === "running"} onClick={() => void flow.apply()}>
          Apply
        </Button>
        <Button size="sm" variant="ghost" onClick={flow.cancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Run at once (no separate preview step) and show the before → after with Undo. */
export function useOneClick() {
  const actions = useActions();
  const [result, setResult] = useState<{ preview: ActionPreview; logId: string; undone: boolean } | { error: string } | null>(null);
  return {
    result,
    async run(name: string, input: unknown) {
      try {
        const res = await actions.run(name, input);
        setResult({ preview: res.preview, logId: res.logId, undone: false });
      } catch (e) {
        setResult({ error: errorText(e) });
      }
    },
    async undo() {
      if (!result || "error" in result) return;
      await actions.undo(result.logId);
      setResult({ ...result, undone: true });
    },
    clear() {
      setResult(null);
    },
  };
}

export function OneClickResult({ oc }: { oc: ReturnType<typeof useOneClick> }) {
  const r = oc.result;
  if (!r) return null;
  if ("error" in r)
    return (
      <div className="tx-flow tx-flow--error" role="alert">
        <span>{r.error}</span>
        <Button size="sm" variant="ghost" onClick={oc.clear}>
          Dismiss
        </Button>
      </div>
    );
  return (
    <div className="tx-flow tx-flow--done" role="status">
      <Changes preview={r.preview} />
      <div className="tx-flow__buttons">
        <span className="tx-muted">{r.undone ? "Undone" : "Done"}</span>
        {!r.undone && (
          <Button size="sm" onClick={() => void oc.undo()}>
            Undo
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={oc.clear}>
          Close
        </Button>
      </div>
    </div>
  );
}
