# Design: Visualizations, Budgets, Goals & UI

**Status:** Draft
**Last updated:** 2026-11-17
**Related:** [decisions.md](../../decisions.md), [success-criteria.md](./success-criteria.md) (what "done" looks like for each area), `ideas.md` (Bayan's notes; source of the UI style direction)

The app's core purpose is **observability of where your money goes**: answering "where is it going?", "am I on track?", and "when do I reach my goal?" at a glance, with every number traceable to the transactions behind it.

---

## 1. Principles

1. **Every visualization drills down.** Clicking any bar, segment, cell, or flow opens the list of transactions that make it up. This builds trust and is where users fix wrong categories.
2. **Pace over totals.** A number like "$300 spent" is shown against where you *should* be by today, plus a projection to the end of the period.
3. **Show what needs attention.** Unusual spending, budgets running hot, and goals falling behind are highlighted; the user shouldn't have to hunt for them.
4. **Small multiples over rainbow stacks.** Prefer one small chart per category over a single chart with a dozen colors.
5. **Consistent visual language.** The same color always means the same category or goal everywhere in the app.

---

## 2. Transaction rules

These rules decide what every chart and number counts. See [decisions.md](../../decisions.md) entry 005.

### Transfers
- **Detection, in order:**
  1. Plaid's transfer and credit-card-payment categories are a first signal.
  2. **Amount matching:** an outflow from one linked account and an equal inflow to another linked account within **~5 days** (bank transfers take 1–3 business days) are paired as one transfer.
  3. **Manual:** "Mark as transfer" on any transaction, with an optional "always treat transactions like this as transfers" rule (by merchant/description and account).
- Auto-matched pairs are labeled "Matched transfer" and can be **unmatched** (for coincidences like a $50 payment out and an unrelated $50 refund in).
- If only one side is visible (an account that isn't linked, e.g. Venmo or an outside brokerage), only the manual path applies.
- Transfers are **excluded from spending and income.** Credit card payments are transfers, so card purchases count as spending once and the payment isn't counted again.

### Categories
- Use **Plaid's categories:** broad ones for budgets and summaries, detailed ones for drill-down.
- **Corrections:** recategorize any transaction, with an option to create a **merchant rule** that applies to future (and optionally past) transactions.
- Rules apply in order: per-transaction override → user rule → Plaid category.

### Pending vs. cleared
- **Only cleared transactions count** toward budgets, totals, and charts.
- *Proposed:* budget bars show pending charges as a faded section after the cleared amount ("+$45 pending"), not included in the total or the pace calculation.

### Which date a transaction counts on
- *Proposed:* the **purchase date** (Plaid's `authorized_date`) when available, otherwise the posted date.
- Consequence: a closed period can change slightly when a late charge clears. This is acceptable because periods don't carry over.

### Refunds
- A refund **counts in the original purchase's period**, reducing that period's spending in the original category.
- **Linking a refund to its purchase:** auto-suggest a match by same merchant, refund amount ≤ purchase amount, within ~90 days. The user can confirm, change, or link manually.
- **Unlinked refunds** count in the period they arrive, in the category Plaid assigns, until they're linked.
- Linking a refund updates a closed period; the budget history grid reflects the corrected value.

### Splitting
- **Manual only.** Split one transaction into parts, each with its own category and amount (and optional note).
- The parts must add up to the original amount. All parts keep the original date and account.
- Each part behaves like a normal transaction for budgets, charts, and drill-down, which shows the parent transaction alongside it.

### Income
*Proposed:*
1. **Plaid's income categories** (wages, interest, dividends, etc.), after transfers are excluded.
2. **Payer rules:** "deposits from ACME PAYROLL are always income."
3. **Per-transaction override:** mark as income or not income.
4. **Fallback per account:** "count all deposits to this account as income."
- Later: a Venmo reimbursement from a friend for dinner should offset Dining spending, not count as income.

---

## 3. Spending observability ("where is my money going?")

| Visualization | Shows | Notes |
|---|---|---|
| **Flow diagram (Sankey)**: income → categories → top merchants per category | The whole period in one picture: what came in, where it went, what was left | Smaller merchants grouped into "Other". Leftover money flows to "Saved" (or "Overspent" if negative). Clicking a branch drills down. |
| **Monthly breakdown per category** | Each category's trend, month over month | One small bar chart per category on a shared scale, sorted by total. |
| **Top merchants with trend lines** | Who you pay the most, and whether that's going up | Ranked list: merchant, period total, number of transactions, small line chart of the last 6–12 months. |
| **Recurring charges across a month** | Subscriptions and bills plotted on the days of the month they hit | Header shows the total of fixed costs per month. Price increases and newly detected subscriptions are flagged. |
| **Spending heatmap** | Which days you spend the most and least | Calendar grid (days × weeks), plus a day-of-week summary. |
| **Unusual spending flags** | "Dining is 2.1× your typical pace for this point in the month" | Shown as callouts on the relevant chart and on the overview. |

---

## 4. Budgets

### Model
- A budget = **category (or set of categories) + limit + period**.
- **Periods are custom.** Supported: weekly, biweekly, monthly, yearly, and custom start/end dates. Recurring periods roll over automatically.
- **Overspending does not carry over.** Each new period starts fresh, with no rollover of overspend or underspend. *(Decision: 2026-11-17)*

### Visualizations
- **Budget bars with a pace marker** (primary view): spend vs. limit, with a tick showing the expected spend at today's point in the period. Color: on pace / ahead of pace / over limit.
  ```
  Groceries   ████████████░░░░░░░░  $312 / $500
                         ▲ pace ($275)   → on track for $567
  ```
- **Cumulative spending chart** (per budget, and overall): actual spend-to-date line, a straight "ideal" line from 0 to the limit, and a dotted projection to the period end. The projection is based on spend so far, adjusted for known recurring charges still to come.
- **End-of-period forecast:** "At this rate you'll finish Dining $85 over."
- **Budget history grid:** budgets × past periods, each cell colored by how far under or over. Shows budgets that are unrealistic, i.e. always over.
- **Safe-to-spend:** a single headline number: income − upcoming bills − planned goal contributions − spending so far in the period.

---

## 5. Savings goals

### Model
- A goal = **name + target amount + optional target date + priority**, tied to **exactly one account**. *(Decision: 2026-11-17)*
- Several goals can share one account (e.g. "Bike" and "MacBook" in one high-yield savings account).
- **Protected amount:** an account can set aside a protected amount (e.g. an emergency fund). It's filled **before** any goal and is never assigned to goals.
- **Money is assigned in priority order.** The account balance fills the protected amount first, then goal #1 up to its target, then goal #2, and so on. Whatever is left is "Unassigned". *(Decision: 2026-11-17)*
- If the balance drops below the protected amount, every goal shows $0 and the account shows a warning.
- **Withdrawals reduce the lowest-priority goals first**, since the assignment is simply recomputed from the current balance.
- Reordering priorities immediately reassigns the money.

### Visualizations
- **Account bar split by goal:** the account balance as one horizontal bar, divided into a protected segment (if set), a segment per goal, and "Unassigned", with each goal's target marked.
  ```
  HYSA $8,400  [▒▒▒▒ Protected $5,000][■■■ Bike $1,200 ✓][■■■■■ MacBook $2,200/$2,500][ ]
                emergency fund         1. Bike (done)    2. MacBook (88%)
  ```
- **Goal cards:** progress ring, saved / target, recent monthly contribution rate, and **projected completion date**. If there's a target date and the projection is later, show both ("Target Mar 1 · projected Apr 12").
- **Goals timeline:** projected completion of each goal on a calendar, showing how earlier goals finishing speeds up later ones.
- **What-if controls:** a contribution slider ("+$150/mo") and drag-to-reorder priorities; projections update live.
- **Withdrawal impact:** when a goal loses money, explain it: "MacBook goal lost $300 after the Nov 3 transfer."
- **Completion:** mark completed goals, offer to archive, and optionally link the purchase transaction.

### Priority reordering interaction
- A dedicated, stylistically consistent **drag-to-reorder list**: grab handle, raised card style matching the rest of the UI, a clear lifted state while dragging, a drop indicator, and smooth reflow.
- While dragging, the projected dates on each goal update as a live preview.
- Keyboard accessible (focus an item, then move it with arrow keys).

---

## 6. Trajectory

- **Net worth over time:** assets − liabilities, with a toggle to split by account. Built from the daily balance snapshots kept by the backend.
- **Monthly cash flow:** income bars above the axis, spending below, plus a savings-rate line.
- **Projection band:** future net worth shown as a widening range of possible outcomes, not a single line.

---

## 7. AI layer

### Features
- **On demand only:** the AI never generates anything without the user asking. Nothing runs automatically on sync or page load. Anomaly callouts (§3) are rule-based. See decisions.md entry 006.
- **Chart notes (on request):** short AI explanations of an anomaly, generated when the user clicks on it ("Travel +$640: flights + 2 hotel nights in Denver").
- **"Explain this":** available on every chart; the model answers using its data tools against the same query the chart uses.
- **Coaching:** connects budgets to goals ("Cutting dining to your 3-month average gets the MacBook 5 weeks sooner").
- Built on the harness approach from `ideas.md`: rich data-access tools plus well-defined prompts for common financial questions.

### Scope: parity with the UI
- **Anything the UI can do, the agent can do.** Both call the same backend API; the agent's tools are thin wrappers over it, so the UI and agent can't drift apart.
- Includes analysis (read) and actions (create or edit budgets and goals, reorder priorities, recategorize, split, mark transfers, link refunds, and so on).
- **Exception:** connecting or reconnecting a bank requires the user to complete Plaid Link. The agent can open it but can't finish it.
- *Proposed guardrails:*
  - **Confirm before any change:** the agent proposes a change, the UI shows exactly what will happen, and the user approves. This matters because merchant names and descriptions are untrusted text that reaches the model.
  - **Action log + undo** for every agent change.

### Privacy *(proposed, not yet decided)*
- The model sees **only what tools return.** No bulk data dumps; mostly aggregates, with individual transactions (merchant, amount, date, category) only when a question needs them.
- **Never sent:** account numbers, Plaid access tokens, names or addresses. Accounts are referred to by nickname and last 4 digits ("Chase Checking ••1234").
- **"What was sent" view** per conversation.
- AI provider is the Claude API (decisions.md entry 003, addendum of 2026-11-18; it was the Gemini API before). These rules stay the main protection: send only what a question needs, and never identifiers.

---

## 8. Accounts & connections

### Adding accounts
- **First run:** a setup flow lets the user connect as many accounts as they like, one Plaid Link session per institution, adding them one after another.
- **Afterwards:** an "Add account" button on the main overview.
- After connecting, show which accounts were found, let the user rename or hide them, and set the account type (checking, savings, credit, investment) if Plaid's classification is wrong.

### Connection health
- **Needs re-login** (Plaid reports the login is required or a connection error): show a clear "Reconnect" prompt on the account and in the Overview. Reconnecting uses Plaid Link **update mode**, which keeps all transaction history.
- **Expiring soon** (Plaid warns before a bank's access consent expires, which happens periodically with Chase): show an early "Reconnect before <date>" notice.
- **Last updated:** show Plaid's last successful transaction update for each connection; fall back to our own last-synced time where Plaid doesn't provide it (e.g. balances at some banks).

---

## 9. Visual style & shell

**Direction:** a desktop metaphor inspired by PostHog's website, which works like a desktop of draggable windows. The overall concept and feel are the inspiration; the visual identity (palette, type, icons) will be our own.

- **Desktop of "apps":** each area of the app is a window that can be dragged, resized, minimized, and closed.
  - **Default open app:** Overview, showing net worth, account balances, safe-to-spend, budget summary, goals summary, and alerts.
  - **Other apps:** Spending (flow diagram, categories, merchants), Budgets, Goals, Recurring, Calendar heatmap, Net Worth / Trajectory, Transactions, AI Assistant.
- **Raised controls:** every interactive surface (buttons, toggles, tabs, draggable cards) uses a raised look with a clear pressed state: a hard offset shadow that collapses as the element moves down on press. One shared component set so the style stays consistent.
- **Charts** follow one palette system with fixed colors per category and per goal, legible in light and dark mode.

---

## 10. Open questions

Move items into the relevant section, or into `decisions.md`, once settled.

### Proposals awaiting confirmation
1. Faded pending section on budget bars (§2).
2. Transactions count on the purchase date rather than the posted date (§2).
3. Layered income detection (§2).
4. Agent confirmation, action log, and undo (§7).
5. Privacy approach: tool results only, identifiers never sent (§7).

### Must define before building the AI layer
6. **Prompt library:** the concrete list of financial questions the harness prompts should cover.
7. **Memory:** does the AI remember your preferences and past conversations?

### Can wait
8. Investments views: holdings, allocation, performance vs. contributions.
9. Window manager details: does window layout persist, can an app open twice, a dock or taskbar, keyboard shortcuts, behavior on small screens.
10. Budget/goal alerts: in-app only, or macOS notifications?
11. Backfilling history: importing CSVs from before Plaid's lookback window.
12. Who uses it: single user only, or also a partner with shared budgets?
13. Empty states and Sandbox demo data for development.
14. Reimbursements (e.g. Venmo from friends) offsetting the original spending category.
