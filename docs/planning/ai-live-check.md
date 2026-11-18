# AI assistant: live check (2026-11-18)

One run of the three built-in prompts against the real Gemini API, in the running app (`npm run reset:dev` seed, API on :8805, Vite on :1435, built-in browser).

## Gemini usage

| What | Count |
|---|---|
| `generateContent` calls (counted by `ai_rate_counters`) | **10** (prompt 1: 2, prompt 2: 3, prompt 3: 5) |
| Non-generation calls: `countTokens` to validate the tool declarations | 4 (one 404 for gemini-2.5-flash, one 404 for gemini-2.5-flash-lite, then 3.8-flash and flash-latest/flash-lite-latest) |
| Non-generation calls: `models.list` | 1 |
| 429s | 0 |

Turns ran one at a time, more than 15 s apart. The requests *inside* one turn (tool rounds) go back to back.

**Model:** `gemini-2.5-flash` and `gemini-2.5-flash-lite` answered 404 "no longer available to new users" for this key, so `wrangler.toml` now uses **`gemini-3.8-flash`** with **`gemini-3.5-flash-lite`** as the fallback (Google's suggested replacements). A 404 also falls through to the fallback model. The code defaults are still the 2.5 names.

**Size:** the 110 tool declarations plus the system prompt come to about **15.4k input tokens** per request (countTokens). A 5-request turn sends roughly 80–100k input tokens.

## Results

### 1. "What am I spending the most on this month?" (2 requests, 16 s)
- Good. Total so far $2,291.50 vs usual $2,956.55, and it noted that we're 18 days into a 30-day month.
- Top categories with amounts and usual: Rent and utilities, Food and drink, Transportation (already above a usual full month, driven by Uber and Shell), Entertainment.
- Named the merchants behind each one. Every amount carried a figure link or chart link.
- Clicking Uber's ↗ opened Transactions with "Uber · 2026-11-01 – 2026-11-18", **$78.01, 2 transactions**, the same as the answer.

### 2. "Where can I cut back?" (3 requests, 37 s)
- Good. It said nothing is labelled "not necessary" ($10,207 is "not set") and that labelling would sharpen the advice. It said the cutting-back list is empty.
- It used Worth a look: transportation is 2.2× its usual pace, Uber is rising, Chipotle rose three months in a row.
- Four concrete suggestions, each with the merchant, its amounts and a realistic monthly saving: Amazon (rising $137 → $234 → $335), Uniqlo, Uber, and The Good Place plus Chipotle.
- **Proposal:** "Cut back on AMAZON" (`spending.addCuttingBack`). **Approved:** it appeared in the action log as source `ai`. **Undone:** the log shows it undone and the cutting-back list is empty again.
- Weak spot: some monthly trend amounts were written without a figure tag.

### 3. "Where is money going to waste that could go elsewhere?" (5 requests, 78 s)
- Found two budget parts consistently under plan over 3 periods, using `budgets.history`: Groceries (about $418/month under) and Eating out (about $202/month under), with a figure for each month.
- It noticed that both goals (DGX Spark, Lisbon trip) are already 100% funded in the seed, so `goals.whatIf` couldn't show "N weeks sooner". It suggested redirecting the money as a contribution instead.
- It covered rising Amazon spending, Uber, and Netflix as the only discretionary recurring charge.
- **Two proposals:** lower Groceries from $600 to $200 (`budgets.editPart`), and raise DGX Spark's contribution from $300 to $700 per month (`goals.setContribution`). Each had its own before → after and its own Approve/Reject. They were left unapplied.
- It said plainly that actually moving money (an automatic transfer into Savings ••0202) is done at the bank.
- Weak spots:
  - Cutting Groceries to $200 is aggressive: November's partial month inflates "under".
  - The seed's goals are all complete, so the "finish N weeks sooner" path wasn't exercised live. It's covered by the prompt guidance and the `goals.whatIf` tool.

### Privacy, as seen in the drawer and answers
- Accounts appeared as "Savings ••0202" (kind + mask), not the bank's account name.
- "What was sent" showed the system prompt, the 110 tools (54 read, 56 propose), each request's model and messages, and every tool call and result.

### UI notes
- Rendering of bold around a citation, italics and `---` rules was fixed after this run (they first showed as literal `**`, `*` and `---`).
- The editPart preview lists unchanged rows (Name Groceries → Groceries). That comes from core's `budgets.editPart.describe`, not from the assistant.
