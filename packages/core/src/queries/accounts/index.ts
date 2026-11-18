import { z } from "zod";
import { defineQuery, type AnyQuery } from "../../registry.ts";
import { accountKind, displayName, groupOfKind, isDebtKind } from "../../balances/accountKinds.ts";
import { historyStartFor } from "../../balances/chart.ts";
import { derivedBalance } from "../../actions/accounts/accountActions.ts";

export const listAccounts = defineQuery({
  name: "accounts.list",
  description: "Every account with its display name, kind, group, balance (debts negative), hidden/manual flags, protected amount and where its history starts.",
  params: z.object({ includeHidden: z.boolean().default(true) }),
  needs: ["accounts", "balanceSnapshots", "transactions"],
  examples: [{ includeHidden: true }, { includeHidden: false }],
  run(data, params) {
    const rows = data.accounts
      .filter((a) => params.includeHidden || !a.hidden)
      .map((a) => {
        const kind = accountKind(a);
        return {
          id: a.id,
          /** The bank connection it belongs to (null for manual accounts): ties an account to its connection health (§4). */
          itemId: a.itemId,
          name: displayName(a),
          bankName: a.name,
          nickname: a.nickname,
          mask: a.mask,
          kind,
          group: groupOfKind(kind),
          isDebt: isDebtKind(kind),
          isManual: a.isManual,
          hidden: a.hidden,
          kindOverridden: a.kindOverride !== null,
          balanceCents: a.isManual ? derivedBalance(data.transactions, a.id) : a.currentBalanceCents,
          balanceUpdatedAt: a.balanceUpdatedAt,
          protectedAmountCents: a.protectedAmountCents,
          connectedOn: a.connectedOn,
          historyStart: historyStartFor(a, data.balanceSnapshots),
        };
      });
    // A manual account's balance is the sum of its transactions: clickable down to them.
    const figures = Object.fromEntries(
      data.accounts
        .filter((a) => a.isManual && (params.includeHidden || !a.hidden))
        .map((a) => {
          const contributions = data.transactions
            .filter((t) => t.accountId === a.id && !t.pending && !t.removed)
            .map((t) => ({ transactionId: t.id, cents: t.amountCents }));
          return [`balance.${a.id}`, { cents: derivedBalance(data.transactions, a.id), contributions, label: `${displayName(a)} transactions` }];
        }),
    );
    return { value: { accounts: rows }, figures };
  },
});

/** Queries of the "accounts" module. Every name must start with "accounts.". Add files in this folder and list them here. */
export const queries: AnyQuery[] = [listAccounts];
