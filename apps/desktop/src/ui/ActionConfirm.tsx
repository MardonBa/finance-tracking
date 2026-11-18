/**
 * Before → after confirmation for registry actions (§1, §2): previews one or
 * more actions with `useActions().preview`, shows every change, and runs them
 * in order on Confirm. The same card the AI approval flow shows, so edits
 * made by hand and by the assistant look alike.
 */
import { useEffect, useState } from "react";
import type { ActionPreview } from "@ft/core";
import { useActions } from "../data/hooks.ts";
import { Button } from "./components.tsx";
import { Icon } from "./Icon.tsx";
import "./actionConfirm.css";

export interface ActionStep {
  name: string;
  input: unknown;
}

export interface ActionConfirmProps {
  title: string;
  steps: ActionStep[];
  onDone: (logIds: string[]) => void;
  onCancel: () => void;
  confirmLabel?: string;
  /** Red confirm button (deletes). */
  destructive?: boolean;
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) {
    try {
      const body = JSON.parse(e.message) as { message?: string; error?: string };
      return body.message ?? body.error ?? e.message;
    } catch {
      return e.message;
    }
  }
  return "Something went wrong.";
}

export function ActionConfirm({ title, steps, onDone, onCancel, confirmLabel = "Confirm", destructive }: ActionConfirmProps) {
  const actions = useActions();
  const [previews, setPreviews] = useState<ActionPreview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const key = JSON.stringify(steps);

  useEffect(() => {
    let live = true;
    setPreviews(null);
    setError(null);
    Promise.all(steps.map((s) => actions.preview(s.name, s.input))).then(
      (rs) => live && setPreviews(rs.map((r) => r.preview)),
      (e: unknown) => live && setError(errorMessage(e)),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const confirm = async () => {
    setRunning(true);
    setError(null);
    const ids: string[] = [];
    try {
      for (const s of steps) ids.push((await actions.run(s.name, s.input)).logId);
      onDone(ids);
    } catch (e) {
      setError(errorMessage(e));
      setRunning(false);
    }
  };

  const changes = previews?.flatMap((p) => p.changes) ?? [];
  return (
    <div className="ui-confirm" role="dialog" aria-modal="true" aria-label={title}>
      <div className="ui-confirm__card">
        <h3 className="ui-confirm__title">{title}</h3>
        {previews === null && !error && <p className="ui-confirm__muted">Working out what changes…</p>}
        {previews && (
          <>
            {previews.map((p, i) => (
              <p key={i} className="ui-confirm__summary">
                {p.summary}
              </p>
            ))}
            {changes.length > 0 ? (
              <table className="ui-confirm__changes">
                <thead>
                  <tr>
                    <th scope="col">What</th>
                    <th scope="col">Before</th>
                    <th scope="col" aria-label="becomes" />
                    <th scope="col">After</th>
                  </tr>
                </thead>
                <tbody>
                  {changes.map((c, i) => (
                    <tr key={i}>
                      <th scope="row">{c.label}</th>
                      <td className="ui-confirm__before">{c.before ?? "—"}</td>
                      <td aria-hidden="true" className="ui-confirm__arrow">
                        →
                      </td>
                      <td className="ui-confirm__after">{c.after ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="ui-confirm__muted">Nothing changes.</p>
            )}
          </>
        )}
        {error && (
          <p className="ui-confirm__error" role="alert">
            <Icon name="warning" size={16} /> {error}
          </p>
        )}
        <div className="ui-confirm__buttons">
          <Button onClick={onCancel} disabled={running}>
            Cancel
          </Button>
          <Button variant={destructive ? "danger" : "primary"} onClick={confirm} disabled={!previews || running}>
            {running ? "Saving…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
