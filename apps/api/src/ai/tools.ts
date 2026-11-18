/**
 * The assistant's tools, generated from the registries (§2, §16, decision 006).
 *
 * - READ tools: one per registry QUERY, the same queries the charts use. There
 *   is no AI-only data access and no bulk/raw export tool.
 * - WRITE tools: one per registry ACTION, minus AI_EXCLUDED. A write tool never
 *   applies anything: it returns a PROPOSAL (the action's before → after) that
 *   the user approves in the app, which then calls /a/:name.
 */
import { actionRegistry, queryRegistry, type AnyAction, type AnyQuery } from "@ft/core";
import type Anthropic from "@anthropic-ai/sdk";
import { toInputSchema } from "./schema.ts";

export const READ_PREFIX = "q__";
export const WRITE_PREFIX = "propose__";

/**
 * Everything the UI can do that the assistant must NOT get, with the reason
 * (§16 "Excluded"). Registry actions can also opt out with `aiExcluded`.
 * Keys are registry action names, or `ui:<what>` for UI operations that are
 * not registry actions (bank connections and sign-in live in their own routes).
 */
export const AI_EXCLUDED: Readonly<Record<string, string>> = {
  // Registry actions
  "example.setTransactionNote": "Scaffolding example that duplicates transactions.setNote, which the assistant has.",
  "goals.markMilestonesSeen": "UI bookkeeping that records a celebration animation played; not a change to my money or plans.",
  // Bank connections (§16: connecting, reconnecting or removing banks)
  "ui:connections.link": "Connecting a bank (Plaid Hosted Link) needs me in the browser.",
  "ui:connections.finalize": "Finishing a bank connection is part of Plaid Link.",
  "ui:connections.duplicate": "Resolving a duplicate bank connection changes connections.",
  "ui:connections.reconnect": "Reconnecting a bank (Plaid update mode) needs me in the browser.",
  "ui:connections.remove": "Removing a bank connection.",
  "ui:refresh": "Refreshing banks calls Plaid for my connections; it stays a button I press.",
  // Sign-in and security (§16)
  "ui:auth.signIn": "Google sign-in.",
  "ui:auth.revoke": "Revoking app credentials (sign-out, lost laptop).",
  "ui:auth.touchId": "Touch ID and Keychain settings.",
  // Moving money (§16): the app has no such action (Plaid is read-only, decision 003 addendum).
  "ui:moneyMovement": "Anything that moves money. None exists: the Plaid client only has read-only products.",
};

/** Action names (after the module) that would mean moving money. No registry action may match (asserted in tests). */
export const MONEY_MOVING = /\.(pay|send|withdraw|deposit|wire|trade|buy|sell|initiate|moveMoney|transferFunds|transferMoney)/i;

export function excludedReason(action: AnyAction): string | undefined {
  return action.aiExcluded ?? AI_EXCLUDED[action.name];
}

export function readToolName(queryName: string): string {
  return READ_PREFIX + queryName.replace(".", "__");
}
export function writeToolName(actionName: string): string {
  return WRITE_PREFIX + actionName.replace(".", "__");
}

export type Tool =
  | { kind: "read"; name: string; query: AnyQuery; declaration: Anthropic.Tool }
  | { kind: "write"; name: string; action: AnyAction; declaration: Anthropic.Tool };

function build(): Tool[] {
  const reads: Tool[] = queryRegistry.all.map((q) => ({
    kind: "read",
    name: readToolName(q.name),
    query: q,
    declaration: {
      name: readToolName(q.name),
      description: `Read (same data as the "${q.name}" chart): ${q.description}`,
      input_schema: toInputSchema(q.params),
    },
  }));
  const writes: Tool[] = actionRegistry.all
    .filter((a) => !excludedReason(a))
    .map((a) => ({
      kind: "write",
      name: writeToolName(a.name),
      action: a,
      declaration: {
        name: writeToolName(a.name),
        description: `PROPOSE a change (nothing is applied until the user approves it in the app): ${a.description}`,
        input_schema: toInputSchema(a.input),
      },
    }));
  return [...reads, ...writes];
}

let cache: { tools: Tool[]; byName: Map<string, Tool> } | null = null;

/** All tools (built once per isolate; schema conversion is not free on a 10 ms CPU budget). */
export function tools(): { tools: Tool[]; byName: Map<string, Tool> } {
  if (!cache) {
    const list = build();
    cache = { tools: list, byName: new Map(list.map((t) => [t.name, t])) };
  }
  return cache;
}

/** The tool definitions sent to Claude (same order every time, so the prompt cache hits). */
export function declarations(): Anthropic.Tool[] {
  return tools().tools.map((t) => t.declaration);
}
