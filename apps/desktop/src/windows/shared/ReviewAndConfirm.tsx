/**
 * Every edit in these windows goes through a registry action, and shows its
 * preview (before → after) before it runs, the same way the AI's proposals do.
 */
import { useEffect, useState } from "react";
import type { ActionPreview } from "@ft/core";
import { useActions } from "../../data/hooks.ts";
import type { ActionResponse } from "../../api/client.ts";
import { Button } from "../../ui/components.tsx";
import { Icon } from "../../ui/Icon.tsx";
import "./shared.css";

export interface ReviewAndConfirmProps {
  action: string;
  /** null while the form is incomplete (Review is disabled). */
  input: unknown | null;
  reviewLabel?: string;
  confirmLabel?: string;
  onDone?: (res: ActionResponse) => void;
  onCancel?: () => void;
  /** Why Review is disabled, shown as a hint. */
  invalidReason?: string;
}

function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  try {
    const parsed = JSON.parse(msg) as { message?: string; error?: string };
    return parsed.message ?? parsed.error ?? msg;
  } catch {
    return msg;
  }
}

export function PreviewChanges({ preview }: { preview: ActionPreview }) {
  return (
    <div className="rti-preview" role="group" aria-label="What will change">
      <p className="rti-preview__summary">{preview.summary}</p>
      {preview.changes.length > 0 && (
        <table className="rti-preview__table">
          <thead>
            <tr>
              <th scope="col">What</th>
              <th scope="col">Before</th>
              <th scope="col">After</th>
            </tr>
          </thead>
          <tbody>
            {preview.changes.map((c, i) => (
              <tr key={i}>
                <th scope="row">{c.label}</th>
                <td>{c.before ?? "–"}</td>
                <td>{c.after ?? "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function ReviewAndConfirm({ action, input, reviewLabel = "Review", confirmLabel = "Confirm", onDone, onCancel, invalidReason }: ReviewAndConfirmProps) {
  const actions = useActions();
  const [preview, setPreview] = useState<ActionPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A preview belongs to the exact input it was made for: editing the form discards it.
  const inputKey = JSON.stringify(input);
  useEffect(() => {
    setPreview(null);
    setError(null);
  }, [inputKey, action]);

  const review = async () => {
    if (input === null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await actions.preview(action, input);
      setPreview(res.preview);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await actions.run(action, input);
      setPreview(null);
      onDone?.(res);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rti-review">
      {preview && <PreviewChanges preview={preview} />}
      {error && (
        <p className="rti-error" role="alert">
          <Icon name="warning" size={14} /> {error}
        </p>
      )}
      {!preview && input === null && invalidReason && <p className="rti-hint">{invalidReason}</p>}
      <div className="rti-review__buttons">
        {preview ? (
          <>
            <Button variant="primary" onClick={confirm} disabled={busy}>
              {confirmLabel}
            </Button>
            <Button variant="ghost" onClick={() => setPreview(null)} disabled={busy}>
              Back
            </Button>
          </>
        ) : (
          <>
            <Button variant="primary" onClick={review} disabled={busy || input === null}>
              {reviewLabel}
            </Button>
            {onCancel && (
              <Button variant="ghost" onClick={onCancel} disabled={busy}>
                Cancel
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
