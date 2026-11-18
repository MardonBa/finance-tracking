/**
 * AI assistant window (§16, design.md §7).
 *
 * - Runs only when the user asks: a typed question, a built-in prompt chip or
 *   "Explain" on a figure (decision 006).
 * - The conversation lives in this component's memory only: closing the
 *   window or quitting the app forgets it. Nothing goes to localStorage or
 *   the backend (which receives the whole conversation each turn and keeps none).
 * - Figures in answers link to their drill-down; proposals show before → after
 *   and are approved or rejected one by one (approve = POST /a/:name, logged).
 * - "What was sent" shows exactly what went to Claude; "Action log" lists
 *   applied changes with Undo.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { notifyDataChanged } from "../../data/hooks.ts";
import { useWindow } from "../../shell/context.ts";
import { Button } from "../../ui/components.tsx";
import { Icon } from "../../ui/Icon.tsx";
import "../../ui/actionConfirm.css";
import "./assistant.css";
import {
  RateLimitedError,
  actionLog,
  approveProposal,
  builtInPrompts,
  chat,
  undoLogged,
  type ActionLogEntry,
  type BuiltInPrompt,
  type ChatMessage,
  type Citation,
  type ExplainRequest,
  type Proposal,
  type SentMessage,
  type SentRecord,
} from "./api.ts";
import { Answer } from "./Answer.tsx";
import { EXPLAIN_EVENT, takePendingExplain } from "./explain.ts";

type ProposalStatus = "pending" | "applying" | "applied" | "rejected" | "undone";

interface ProposalState {
  proposal: Proposal;
  status: ProposalStatus;
  logId?: string;
  error?: string;
}

interface Turn {
  id: number;
  question: string;
  answer?: { text: string; citations: Record<string, Citation>; model: string };
  proposals: ProposalState[];
  sent?: SentRecord;
  error?: string;
}

function errorText(e: unknown): string {
  if (e instanceof Error) {
    try {
      const body = JSON.parse(e.message) as { message?: string; error?: string };
      return body.message ?? body.error ?? e.message;
    } catch {
      return e.message || "Something went wrong.";
    }
  }
  return "Something went wrong.";
}

/** "3:42 PM", or "Tue 12:00 AM" when it's not today. */
export function whenAvailable(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === now.toDateString() ? time : `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

function ProposalCard({ state, onApprove, onReject, onUndo }: { state: ProposalState; onApprove(): void; onReject(): void; onUndo(): void }) {
  const { proposal: p, status } = state;
  return (
    <div className={`as-proposal as-proposal--${status}`} role="group" aria-label={`Proposed change: ${p.preview.summary}`}>
      <p className="as-proposal__summary">{p.preview.summary}</p>
      {p.preview.changes.length > 0 && (
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
            {p.preview.changes.map((c, i) => (
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
      )}
      {state.error && (
        <p className="as-error" role="alert">
          <Icon name="warning" size={14} /> {state.error}
        </p>
      )}
      <div className="as-proposal__buttons">
        {(status === "pending" || status === "applying") && (
          <>
            <Button size="sm" onClick={onReject} disabled={status === "applying"}>
              Reject
            </Button>
            <Button size="sm" variant="primary" onClick={onApprove} disabled={status === "applying"}>
              {status === "applying" ? "Applying…" : "Approve"}
            </Button>
          </>
        )}
        {status === "applied" && (
          <>
            <span className="as-proposal__status">
              <Icon name="check" size={14} /> Applied
            </span>
            <Button size="sm" variant="ghost" onClick={onUndo}>
              Undo
            </Button>
          </>
        )}
        {status === "rejected" && <span className="as-proposal__status">Rejected: nothing changed</span>}
        {status === "undone" && <span className="as-proposal__status">Undone</span>}
      </div>
    </div>
  );
}

/**
 * One message as readable parts: your text, the model's text and tool calls, and tool results
 * (named after the call they answer). Thinking isn't shown (it is empty). `names` maps tool-call
 * ids to tool names across the conversation, since a result arrives in the message after its call.
 */
function sentParts(m: SentMessage, names: Map<string, string>): { role: string; text: string }[] {
  if (typeof m.content === "string") return [{ role: m.role === "user" ? "you" : "model", text: m.content }];
  const out: { role: string; text: string }[] = [];
  for (const b of m.content) {
    if (b.type === "text") out.push({ role: m.role === "user" ? "you" : "model", text: String(b.text) });
    else if (b.type === "tool_use") {
      names.set(String(b.id), String(b.name));
      out.push({ role: "model called", text: `${String(b.name)}(${JSON.stringify(b.input ?? {}, null, 1)})` });
    } else if (b.type === "tool_result") {
      const raw = typeof b.content === "string" ? b.content : JSON.stringify(b.content);
      let pretty = raw;
      try {
        pretty = JSON.stringify(JSON.parse(raw), null, 1);
      } catch {
        /* not JSON */
      }
      const name = names.get(String(b.tool_use_id));
      out.push({ role: b.is_error ? "tool error" : "tool result", text: name ? `${name} → ${pretty}` : pretty });
    }
  }
  return out;
}

function SentDrawer({ turns }: { turns: Turn[] }) {
  const withSent = turns.filter((t) => t.sent);
  // Tool-call ids are unique, so one map serves every turn (filled in render order: calls before results).
  const names = new Map<string, string>();
  return (
    <section className="as-panel" aria-label="What was sent">
      <h3 className="as-panel__title">What was sent to Claude</h3>
      <p className="as-muted">
        Exactly what this conversation sent: the instructions, your messages and every tool result. Each request also re-sends the earlier
        messages. Nothing here is saved.
      </p>
      {withSent.length === 0 && <p className="as-muted">Nothing yet: nothing is sent until you ask something.</p>}
      {withSent.map((t, ti) => (
        <details key={t.id} className="as-sent" open={ti === withSent.length - 1}>
          <summary>
            Turn {ti + 1}: “{t.question.slice(0, 60)}” · {t.sent!.requests.length} request{t.sent!.requests.length === 1 ? "" : "s"}
          </summary>
          <details>
            <summary>System instructions</summary>
            <pre className="as-pre">{t.sent!.systemPrompt}</pre>
          </details>
          <details>
            <summary>
              Tools offered ({t.sent!.tools.count}: {t.sent!.tools.read.length} read, {t.sent!.tools.write.length} propose)
            </summary>
            <pre className="as-pre">{[...t.sent!.tools.read, ...t.sent!.tools.write].join("\n")}</pre>
          </details>
          {t.sent!.requests.map((r, ri) => (
            <div key={ri} className="as-sent__request">
              <h4>
                Request {ri + 1} → {r.model}
              </h4>
              {r.newMessages.map((m, mi) =>
                sentParts(m, names).map((p, pi) => (
                  <div key={`${mi}-${pi}`} className="as-sent__part">
                    <span className="as-sent__role">{p.role}</span>
                    <pre className="as-pre">{p.text}</pre>
                  </div>
                )),
              )}
            </div>
          ))}
        </details>
      ))}
    </section>
  );
}

function ActionLogPanel({ token, refreshKey, onUndone }: { token: string; refreshKey: number; onUndone(logId: string): void }) {
  const [entries, setEntries] = useState<ActionLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    actionLog(token).then(
      (e) => live && setEntries(e),
      (e: unknown) => live && setError(errorText(e)),
    );
    return () => {
      live = false;
    };
  }, [token, refreshKey, tick]);

  const undo = async (id: string) => {
    try {
      const res = await undoLogged(token, id);
      notifyDataChanged(res.changed);
      onUndone(id);
      setTick((t) => t + 1);
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <section className="as-panel" aria-label="Action log">
      <h3 className="as-panel__title">Action log</h3>
      <p className="as-muted">Every applied change, by you or approved from the assistant. Undo puts it back.</p>
      {error && (
        <p className="as-error" role="alert">
          {error}
        </p>
      )}
      {entries === null && !error && <p className="as-muted">Loading…</p>}
      {entries?.length === 0 && <p className="as-muted">No changes yet.</p>}
      <ul className="as-log">
        {entries?.map((e) => (
          <li key={e.id} className={e.undoneAt ? "is-undone" : undefined}>
            <span className={`as-badge as-badge--${e.source}`}>{e.source === "ai" ? "Assistant" : "You"}</span>
            <span className="as-log__summary">{e.summary}</span>
            <span className="as-muted">{new Date(e.appliedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
            {e.undoneAt ? (
              <span className="as-muted">Undone</span>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => undo(e.id)} aria-label={`Undo: ${e.summary}`}>
                Undo
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AssistantWindow() {
  const { token, open } = useWindow();
  const [prompts, setPrompts] = useState<BuiltInPrompt[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [limited, setLimited] = useState<{ retryAt: string; scope: "minute" | "day" } | null>(null);
  const [panel, setPanel] = useState<"none" | "sent" | "log">("none");
  const [logKey, setLogKey] = useState(0);
  const nextTag = useRef(1);
  const allCitations = useRef<Record<string, Citation>>({});
  const turnsRef = useRef<Turn[]>([]);
  turnsRef.current = turns;
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    builtInPrompts(token).then(
      (p) => live && setPrompts(p),
      () => undefined, // chips are a convenience; typing still works
    );
    return () => {
      live = false;
    };
  }, [token]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [turns]);

  const updateTurn = (id: number, fn: (t: Turn) => Turn) => setTurns((ts) => ts.map((t) => (t.id === id ? fn(t) : t)));

  const ask = useCallback(
    async (question: string, opts: { promptId?: string; explain?: ExplainRequest } = {}) => {
      const q = question.trim();
      if (!q) return;
      const history: ChatMessage[] = turnsRef.current.flatMap((t) =>
        t.answer ? [{ role: "user" as const, text: t.question }, { role: "assistant" as const, text: t.answer.text }] : [],
      );
      const id = Date.now() + Math.random();
      setTurns((ts) => [...ts, { id, question: q, proposals: [] }]);
      setBusy(true);
      setLimited(null);
      try {
        const res = await chat(token, { messages: [...history, { role: "user", text: q }], firstTag: nextTag.current, ...opts });
        nextTag.current = Math.max(nextTag.current, res.nextTag);
        Object.assign(allCitations.current, res.citations);
        updateTurn(id, (t) => ({
          ...t,
          answer: { text: res.text, citations: { ...allCitations.current }, model: res.model },
          proposals: res.proposals.map((proposal) => ({ proposal, status: "pending" })),
          sent: res.sent,
        }));
      } catch (e) {
        if (e instanceof RateLimitedError) {
          setLimited({ retryAt: e.retryAt, scope: e.scope });
          setTurns((ts) => ts.filter((t) => t.id !== id));
          setDraft(q);
        } else {
          updateTurn(id, (t) => ({ ...t, error: errorText(e) }));
        }
      } finally {
        setBusy(false);
      }
    },
    [token],
  );

  // "Explain this" from another window: on mount (the click opened us) or while open.
  useEffect(() => {
    const run = () => {
      const req = takePendingExplain();
      if (req) void ask(`Explain this: ${req.label}`, { explain: { query: req.query, params: req.params, figureId: req.figureId, label: req.label } });
    };
    run();
    window.addEventListener(EXPLAIN_EVENT, run);
    return () => window.removeEventListener(EXPLAIN_EVENT, run);
  }, [ask]);

  const setProposal = (turnId: number, proposalId: string, patch: Partial<ProposalState>) =>
    updateTurn(turnId, (t) => ({ ...t, proposals: t.proposals.map((p) => (p.proposal.id === proposalId ? { ...p, ...patch } : p)) }));

  const approve = async (turnId: number, s: ProposalState) => {
    setProposal(turnId, s.proposal.id, { status: "applying", error: undefined });
    try {
      const res = await approveProposal(token, s.proposal);
      notifyDataChanged(res.changed);
      setProposal(turnId, s.proposal.id, { status: "applied", logId: res.logId });
      setLogKey((k) => k + 1);
    } catch (e) {
      setProposal(turnId, s.proposal.id, { status: "pending", error: errorText(e) });
    }
  };

  const undo = async (turnId: number, s: ProposalState) => {
    if (!s.logId) return;
    try {
      const res = await undoLogged(token, s.logId);
      notifyDataChanged(res.changed);
      setProposal(turnId, s.proposal.id, { status: "undone" });
      setLogKey((k) => k + 1);
    } catch (e) {
      setProposal(turnId, s.proposal.id, { error: errorText(e) });
    }
  };

  const onUndoneFromLog = (logId: string) =>
    setTurns((ts) => ts.map((t) => ({ ...t, proposals: t.proposals.map((p) => (p.logId === logId ? { ...p, status: "undone" } : p)) })));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = draft;
    setDraft("");
    void ask(q);
  };

  const reset = () => {
    setTurns([]);
    nextTag.current = 1;
    allCitations.current = {};
    setLimited(null);
  };

  return (
    <div className="as-window">
      <header className="as-top">
        <p className="as-notice">
          <Icon name="info" size={14} /> Runs only when you ask. Answers come from the same data as your charts, and every change waits for your approval.
        </p>
        <div className="as-toolbar">
          <Button size="sm" pressed={panel === "sent"} onClick={() => setPanel(panel === "sent" ? "none" : "sent")}>
            What was sent
          </Button>
          <Button size="sm" pressed={panel === "log"} onClick={() => setPanel(panel === "log" ? "none" : "log")}>
            Action log
          </Button>
          <span className="as-toolbar__spacer" />
          <Button size="sm" variant="ghost" onClick={reset} disabled={busy || turns.length === 0}>
            New conversation
          </Button>
        </div>
      </header>

      {panel === "sent" && <SentDrawer turns={turns} />}
      {panel === "log" && <ActionLogPanel token={token} refreshKey={logKey} onUndone={onUndoneFromLog} />}

      <div className="as-scroll" aria-live="polite">
        {turns.length === 0 && (
          <div className="as-empty">
            <p className="as-empty__title">Ask about your money</p>
            <p className="as-muted">Pick a question below or type your own. The conversation is forgotten when you close this window.</p>
          </div>
        )}
        {turns.map((t) => (
          <div key={t.id} className="as-turn">
            <p className="as-user">{t.question}</p>
            {!t.answer && !t.error && <p className="as-muted as-thinking">Looking at your data…</p>}
            {t.error && (
              <p className="as-error" role="alert">
                <Icon name="warning" size={14} /> {t.error}
              </p>
            )}
            {t.answer && <Answer text={t.answer.text} citations={t.answer.citations} openArea={open} />}
            {t.proposals.length > 0 && (
              <div className="as-proposals" aria-label="Proposed changes">
                {t.proposals.length > 1 && <p className="as-muted">{t.proposals.length} proposed changes. Approve or reject each one.</p>}
                {t.proposals.map((s) => (
                  <ProposalCard
                    key={s.proposal.id}
                    state={s}
                    onApprove={() => approve(t.id, s)}
                    onReject={() => setProposal(t.id, s.proposal.id, { status: "rejected", error: undefined })}
                    onUndo={() => undo(t.id, s)}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {limited && (
        <p className="as-limit" role="status">
          <Icon name="info" size={14} /> The assistant has reached its request limit for this {limited.scope}. You can ask again at{" "}
          <strong>{whenAvailable(limited.retryAt)}</strong>. Everything else in the app keeps working.
        </p>
      )}

      <div className="as-bottom">
        <div className="as-chips" role="group" aria-label="Built-in questions">
          {prompts.map((p) => (
            <button key={p.id} type="button" className="as-chip" disabled={busy} onClick={() => void ask(p.label, { promptId: p.id })}>
              {p.label}
            </button>
          ))}
        </div>
        <form className="as-form" onSubmit={submit}>
          <textarea
            className="as-input"
            aria-label="Ask the assistant"
            placeholder="Ask about your spending, budgets or goals…"
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
              }
            }}
          />
          <Button type="submit" variant="primary" disabled={busy || !draft.trim()}>
            {busy ? "Thinking…" : "Ask"}
          </Button>
        </form>
      </div>
    </div>
  );
}
