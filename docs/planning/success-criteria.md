# Success Criteria

**Status:** Complete (all 17 areas defined; each lists what's still open)
**Last updated:** 2026-11-18
**Related:** [decisions.md](../../decisions.md), [design.md](./design.md)
**Build status (2026-11-18):** 194 of 238 boxes ticked with automated evidence or your own checks ([criteria-verification.md](./criteria-verification.md)). The other 44 need a hands-on check on the [manual checklist](./manual-checklist.md) (real Touch ID, browser sign-in, real banks, production) and get ticked once you've confirmed them.

What "done" and "working well" look like for every part of the app that needs building. [design.md](./design.md) describes *what* each part is; this doc defines how we'll know it's finished. Each section is written from an interview answer, then turned into checkable outcomes.

Each area has:
- **Success looks like:** the outcome, in plain words
- **Done when:** observable outcomes that can be checked in the app or with a test
- **Not yet / later:** out of scope for the first version
- **Open:** still undecided
- **Related:** the relevant decision and design sections

---

## 0. The app as a whole

**Success looks like:** "I can see where all of my money goes, where it comes from (including interest payments), set goals, and get some insights into how I can better manage my money."

**Done when:**
- [x] **Where it goes:** every dollar of spending across linked accounts falls into a category and can be traced down to its merchants and individual transactions (§6–9).
- [x] **Where it comes from:** every dollar of income is visible by source, including wages, **interest**, and dividends, with transfers between my own accounts excluded (§6, §8).
- [x] **Goals:** I can set savings goals and see how funded each one is and when it will be reached (§11).
- [x] **Insights:** I can ask how to manage my money better and get answers based on my real data. The AI only runs when I ask (§16).

Every area below should serve at least one of these four outcomes.

---

## 1. Project foundation

**Success looks like:** Changes show up immediately while building, and a change goes from idea to the real app within a day. The money math is 100% correct, deterministic, and verifiable. Development runs on fake data and only production touches real data, with confidence that the fake data has exactly the same format as the real data.

**Done when:**

*Fast feedback*
- [x] Editing frontend code updates the running app instantly (hot reload); editing backend code reloads the local backend without a manual restart.
- [x] The app and backend can run locally against the dev environment with one command.
- [x] Shipping is a short, documented routine: deploy the backend and build a new `.app` in a few commands, so a finished change can be in daily use the same day.

*Correct, deterministic money math*
- [x] All amounts are stored and calculated as **whole cents (integers)**, never floating point. Plaid's decimal amounts are converted once, when data comes in, and the conversion is tested.
- [x] Money calculations (totals, transfers, refunds, splits, budgets, goal allocation, projections) are **pure functions**: same input, same output. They never read the clock, the network, or the database themselves; "today" and the data are passed in.
- [x] There is exactly **one implementation** of each calculation, shared by the UI, the API, and the AI tools, so numbers can't disagree between screens.
- [x] Every calculation has unit tests covering normal cases, edge cases (zero, negative, month boundaries, leap days, time zones), and known tricky cases (a refund in a later month, a split transaction, a coincidental transfer match).
- [x] Invariant checks run in tests: splits add up to the original, goal allocations never exceed the account balance, transfers net to zero, and category totals add up to total spending.
- [x] Any number in the app can be traced to the exact transactions that produced it, so it can be checked by hand.
- [x] Tests run with one command and must pass before a change ships.

*Fake data in dev, real data in production*
- [ ] **Separate environments:** dev uses Plaid **Sandbox** and its own D1 database; production uses Plaid with real accounts and a separate D1 database. Dev can never reach production data or secrets.
- [ ] **Format matches real data:**
  - Plaid responses are typed with Plaid's official SDK types, and the same code path handles Sandbox and production.
  - Every Plaid response is validated against a schema at runtime **in both environments**, so a mismatch fails loudly instead of corrupting data.
  - A few real production responses (with identifying details removed) are saved as test fixtures and checked against the same schemas as Sandbox data.
- [x] Sandbox test data covers the situations the math has to handle: transfers between accounts, credit card payments, refunds, **interest payments**, paychecks, pending→posted transactions, and investment holdings.
- [x] The dev environment can be reset to a known starting state with one command.

**Not yet / later:** automated deploys (CI/CD); a manual deploy routine is fine to start.

**Open:**
- Repo layout: one repo with app / backend / shared folders (recommended), still to confirm.
- Test tooling choice (Vitest is the likely default).

**Related:** [decisions.md](../../decisions.md) 001, 002, 003 · [design.md](./design.md) §2

## 2. Backend & app login

**Success looks like:** Only I can reach my data. The app asks for Touch ID when it opens and again after it has been open for a few days. Nobody, including me, can move money through the app. Cloudflare holds only the minimum data needed to draw the visualizations, and the AI never gets more than the visualizations use.

**Done when:**

*Only I can get in*
- [x] My identity is my **Google account**: signing in with Google (§3) is how the app gets its credential, and the backend accepts **only my Google account**. Any other Google account is refused and nothing is created for it.
- [x] Opening the app requires **Touch ID**, with the macOS password as fallback. No data loads before that succeeds. (Touch ID is built with a small amount of custom Rust using Apple's LocalAuthentication framework.)
- [ ] After the app has been open for **72 hours** it locks and requires Touch ID again (default; adjustable later).
- [x] The app's credential for the backend is stored in the macOS **Keychain** and can only be read after Touch ID succeeds. If it's revoked or expires, the app asks me to sign in with Google again.
- [x] Every backend request without a valid credential is rejected, with no data in the error. Tested for every endpoint.
- [x] I can revoke the app's credential, e.g. if the laptop is lost, and a revoked credential stops working immediately.
- [ ] Plaid webhooks are verified (Plaid's signed webhook check) before the backend acts on them.

*No money can move*
- [x] The app only uses read-only Plaid products: Transactions, Balance, Investments, Liabilities. It never enables Auth, Transfer, Payment Initiation, or any product that exposes account/routing numbers or moves money.
- [x] The backend's Plaid client can only call an allowlist of read-only Plaid endpoints; a test fails if any other endpoint is added.
- [x] No feature in the UI, API, or AI tools initiates a payment or transfer.

*Store only what the visualizations need*
- [x] The database schema stores only fields used by a visualization, a calculation, or a rule. Each stored field has a reason written next to it in the schema.
- [x] Never stored: full account or routing numbers, account-owner identity (names, addresses, emails, phone numbers), transaction location data.
- [x] Stored: the raw bank description of each transaction (needed for transfer matching and merchant rules).
- [x] Data from Plaid is trimmed to the allowed fields **before** it is saved; a test feeds in a full Plaid response and checks that nothing extra is stored.
- [ ] Plaid access tokens are the one secret stored in the database; they're encrypted with a key kept in a Workers secret, never in plain text in D1.

*The AI sees no more than the charts*
- [x] The AI's data tools are the same queries that power the visualizations. There is no AI-only data access and no bulk or raw export tool.
- [x] A test checks that every AI read tool maps to an existing visualization query.

*Nothing is lost*
- [x] Data that can't be re-fetched from Plaid is backed up: my edits (categories, rules, splits, transfer and refund links), budgets, goals, and daily snapshots.
- [x] A scheduled backend job exports that data on a regular schedule (e.g. weekly), encrypted, to free storage (likely Cloudflare R2's free tier), in addition to D1's built-in point-in-time restore.
- [ ] Restoring from a backup into a fresh database has been tested at least once and is documented.

**Not yet / later:** more than one device signed in; sharing access with anyone else.

**Open:**
- Backup schedule, how many to keep, and whether I also want a copy kept outside Cloudflare (e.g. downloaded to my Mac).
- How far back D1's point-in-time restore goes on the free plan (to check).

**Related:** [decisions.md](../../decisions.md) 002, 003, 006 · [design.md](./design.md) §7 Privacy, §8

## 3. Connecting accounts

**Success looks like:** On first launch I sign in with Google, set up Touch ID, and am then prompted to add my banks. I search for a bank, go through Plaid's flow for it (whatever that bank needs), and repeat for as many banks as I want. That level of friction is fine.

**Done when:**

*First run*
- [x] **Step 1: sign in with Google.** It opens in the system browser (standard OAuth with PKCE) and returns to the app. Only my Google account is accepted (§2).
- [x] **Step 2: set up Touch ID.** From then on, opening the app uses Touch ID instead of Google (§2).
- [ ] **Step 3: add banks.** The app prompts me to add a bank and opens Plaid Link, where I search for my bank and sign in.
- [ ] Banks that sign in through their own website (e.g. **Chase OAuth**) work: I go to the bank's site and land back in the app with the connection finished.
- [ ] **How Chase gets back to the app:** Plaid Link runs in my **system browser**, not inside the app window, using Plaid's Hosted Link. The backend creates the Link session; the browser handles the bank's sign-in and redirects; at the end, Plaid redirects to the app's own link (`financetracker://…`, registered with Tauri's deep-link plugin), which brings the app forward. The backend collects the result from Plaid directly (Link's completion webhook or a session lookup) and exchanges it for the access token, so nothing sensitive passes through the redirect. This is the same browser-and-return pattern as Google sign-in.
- [x] If Plaid won't redirect straight to the app's own link, the redirect goes to a small page on the backend that hands off to `financetracker://…` instead.
- [ ] Proven with a Sandbox spike (including Sandbox's OAuth test bank) before the rest of the connection flow is built.
- [x] Each connection asks Plaid for the **maximum transaction history (up to 24 months)**. This has to be set when connecting; Plaid's default is only 90 days and can't be extended afterwards (§5 depends on it).
- [ ] After each bank, I see the accounts that were found and can **add another bank** or **finish**. There's no limit beyond Plaid's.
- [x] I can finish with zero banks and add them later; the app still opens normally.

*After connecting*
- [x] For each new account I can rename it, hide it, and fix its type (checking, savings, credit, investment) if Plaid got it wrong.
- [x] While history downloads, each bank shows its status ("Importing transactions…" → "Up to date"), and data appears as soon as it's ready.

*Adding banks later*
- [x] An **"Add account"** button on the Overview opens the same bank flow.

*Manual accounts (cash)*
- [x] "Add account" also offers a **manual account**, e.g. Cash, with a starting balance.
- [x] I can add, edit, and delete transactions on a manual account (amount, date, description, category, note), and its balance updates from them.
- [x] Manual accounts count in net worth and get daily snapshots like any other account (§5), and are clearly labelled as manual.

*Things that can go wrong*
- [x] Cancelling or failing partway through Plaid Link leaves nothing half-saved, and I can try again straight away.
- [x] Connecting a bank that's already connected is detected and warned about, so accounts are never counted twice.
- [x] If Plaid's Trial limit (10 bank connections) is close or reached, the app says so before I start.

**Not yet / later:** connecting banks Plaid doesn't support (SimpleFIN or CSV fallbacks, decision 002).

**Open:**
- Whether Google sign-in is needed again after first run, or only when the app's credential is revoked or expires (current assumption: only then).

**Related:** [decisions.md](../../decisions.md) 002 · [design.md](./design.md) §8

## 4. Sync & connection health

**Success looks like:** Data refreshes on its own every day, and I can refresh manually whenever I want. If a bank connection breaks, I'm prompted to fix it immediately the next time I open the app.

**Done when:**

*Daily refresh*
- [x] A daily scheduled job on the backend syncs every connected bank: new, changed, and removed transactions, plus balances. It runs whether or not the app or my laptop is on.
- [x] Plaid's "new transactions available" webhooks are also handled, so data can arrive sooner than the daily job.
- [x] Syncing is safe to repeat: running it twice, or a webhook and the daily job overlapping, never creates duplicate transactions or double-counts anything.
- [x] Pending transactions that post are replaced by their posted version (Plaid's `pending_transaction_id`), and my edits carry over to the posted version.
- [x] Transactions Plaid removes are removed here too, along with anything derived from them (splits, transfer and refund links are flagged for me to review rather than silently lost).

*Manual refresh*
- [ ] A **Refresh** button asks Plaid to check every bank right now (Transactions Refresh, Investments Refresh, and live balances, all included in the Trial plan), shows progress, then "Up to date" or the specific error.
- [x] Each account shows **when it was last updated** (Plaid's last successful update, or our own last sync time where Plaid doesn't provide one).

*Broken connections*
- [ ] When a bank needs me to sign in again (or Plaid reports an error), the next time I open the app, right after Touch ID, I'm **immediately prompted** to reconnect, naming the bank and what's wrong.
- [ ] Reconnecting uses Plaid's update mode and keeps all transaction history.
- [x] If I dismiss the prompt, the affected accounts stay visibly marked as out of date (with "last updated" dates) until fixed, and totals that depend on them say so.
- [x] When Plaid warns that a bank's access is **about to expire** (e.g. Chase consent), I'm prompted the same way before it does.
- [x] A failed daily sync for one bank doesn't stop the others from syncing.

**Not yet / later:** notifications outside the app (macOS notifications or email) for broken connections.

**Open:**
- What time of day the daily sync runs.
- Whether Plaid's Trial plan limits how often Refresh can be used (to check; if so, the button says when it's next available).

**Related:** [decisions.md](../../decisions.md) 002, 003, 006 · [design.md](./design.md) §8 Connection health

## 5. Daily snapshots

**Success looks like:** Every day I can see each account's balance as a part of my net worth: what each account contributes. Looking back, I can roughly see balances per account over time; weekly or monthly detail is enough for older history. History goes back as far as possible, ideally at least 6 months from the day I connect. If that isn't possible for some accounts at first, that's acceptable.

**Done when:**

*Going forward*
- [x] The daily sync (§4) saves a snapshot of every account's balance, including credit cards and loans as negative contributions.
- [x] Investment accounts are snapshotted at total value. (Individual holdings are covered in §17.)
- [x] Net worth for any day = the sum of that day's account snapshots. There's no separately stored net worth that could disagree.
- [x] Snapshots older than 90 days are reduced to one per week (end of week); recent ones stay daily.
- [x] A missed day (e.g. a failed sync) shows as a gap or carries forward the last known balance, marked as such, never as a fake zero.

*Looking back before I connected*
- [x] For checking, savings, and credit card accounts, past balances are **rebuilt** by starting from today's balance and undoing transactions backwards day by day, as far back as transaction history goes (up to 24 months, §3).
- [x] Rebuilt history is marked as **estimated** in charts, separate from real snapshots.
- [x] A test checks the rebuilding: replaying the rebuilt history forward through the same transactions lands exactly on today's balance, to the cent.
- [x] Accounts that can't be rebuilt accurately (investments, where value changes with the market, or accounts with missing transactions) start their history on the day they were connected, and the chart says so.

*Seeing it*
- [ ] A net worth chart shows each account's contribution over time (stacked by account), with assets above zero and debts below.
- [x] Hovering over any point shows the date, each account's balance, and the total.
- [x] I can switch between showing all accounts and grouping them by type (cash, credit, investments, loans).

**Not yet / later:** rebuilding past investment values from holdings and market prices; importing older history from CSV (decision 002 fallbacks).

**Open:**
- Whether a 90-day cutoff for daily detail is right, or longer is wanted.
- How to handle an account whose rebuilt history doesn't match a balance Plaid reports later (show the gap, or trust Plaid and adjust).

**Related:** [decisions.md](../../decisions.md) 002, 003 · [design.md](./design.md) §6 Trajectory

## 6. Transaction rules

**Success looks like:** Amounts are correct above all: nothing is counted twice and nothing is missed. Moving my own money around (paying my credit card from checking, putting money into my brokerage or HYSA) is never counted as spending or income. Merchants are shown alongside categories so I can spot mistakes, but I won't check often or thoroughly, so the app has to be right by default and point me to the few things it isn't sure about.

**Done when:**

*Moving my own money is never spending or income*
- [x] **Credit card payments:** a purchase on the card counts as spending once, on the purchase. Paying the card from checking is a transfer and counts as neither spending nor income.
- [x] **Into savings or investments:** moving money from checking to my HYSA or brokerage is a transfer, not spending. Buying or selling investments inside the brokerage is not spending or income either.
- [x] When both sides are linked, the two halves are matched automatically (decision 005: same amount, within ~5 days, Plaid's transfer categories first).
- [x] Each match is shown as one "Transfer: Checking → HYSA" item, and can be undone.

*Income is complete*
- [x] **Interest** (HYSA, checking, savings) and **dividends** count as income, along with paychecks.
- [x] Refunds, reimbursements, and transfers in from my own accounts are not counted as income.

*The numbers add up (automatic checks)*
- [x] **Per account, per period:** starting balance + money in − money out = ending balance, checked against the snapshots (§5). Any difference is shown as "unexplained" on that account, not hidden.
- [x] **Across everything:** income − spending ± transfers to and from accounts that aren't linked ± investment gains and losses = change in net worth. Any leftover difference is shown.
- [x] Every transaction is counted in exactly one bucket: spending, income, or transfer. A test checks this for every transaction in the test data.
- [x] Splits add up to the original amount; a refund linked to a purchase can't reduce it below zero.
- [x] Tests cover each case above with Sandbox data and hand-built examples (§1).

*Low-effort checking*
- [x] Every place a transaction appears shows **merchant + category + amount** together.
- [x] A short **"Needs a look"** list holds only the things the app is unsure about: transfer-like transactions with no matching other half, uncategorised transactions, possible duplicates, and large unusual amounts. Everything else is assumed right.
- [x] Fixing a category takes one action and offers "always do this for this merchant".
- [x] Rules apply in order: my per-transaction fix → my rules → Plaid's category (decision 005).

*Transfers to accounts that aren't linked*
- [x] A transaction Plaid labels as a transfer, with no matching other half, counts as a transfer (not spending), and goes into "Needs a look" until I confirm it or a rule covers it. (Plaid sometimes labels payments to people, like Venmo or Zelle, as transfers; this catches those.)

*Poker banking*
- [x] I sometimes act as banker for poker games, so money comes in and goes out to friends (Venmo, Zelle, cash). I can mark these transactions as **Poker**, with a rule so a given payer or payee is always Poker.
- [x] Individual Poker transactions are kept out of normal spending and income, so collecting buy-ins doesn't look like income and paying out doesn't look like spending.
- [x] My **net poker result counts as income**: for each period, Poker money in − Poker money out is added to income as one "Poker" line (a net loss shows as negative Poker income).
- [x] A Poker summary shows money in, money out, and the net result for any period.

*Cash*
- [x] Cash is tracked as a manual account (§3). Cash transactions I add follow the same rules as bank transactions (spending, income, transfer, or Poker), and withdrawing from an ATM into the cash account is a transfer.

**Not yet / later:** reimbursements (e.g. Venmo from friends) offsetting the original spending.

**Open:**
- Confirm the proposed date rule (purchase date when available) and income rule from decision 005.

**Related:** [decisions.md](../../decisions.md) 005 · [design.md](./design.md) §2

## 7. Transactions view

**Success looks like:** The transactions list is mostly for seeing everything from one merchant and for seeing what's behind a chart number. Finding one specific charge should be possible but matters less. I can add a note to any transaction: purchases, transfers, investments, card payments, anything.

**Done when:**

*What's behind a chart number*
- [ ] Clicking any number, bar, segment, or cell in any chart opens the transactions list filtered to exactly the transactions behind it, with the filter shown at the top (e.g. "Dining · October · excluding transfers").
- [x] The list's total always equals the number I clicked. A test checks this for every chart.
- [x] Split parts and linked refunds appear with their parent purchase, so the total is explainable.

*Everything from a merchant*
- [x] Clicking a merchant anywhere opens a merchant view: all its transactions, total for the period, number of transactions, and a trend over the last 6–12 months.
- [ ] Merchant names are grouped sensibly (e.g. "AMAZON MKTP US*2K4" and "Amazon.com" count as one merchant), and I can merge or separate merchants if the grouping is wrong.

*Finding a specific charge*
- [x] Basic search by merchant, description, amount, or note, plus filters for date range, account, and category.

*Notes*
- [x] I can add, edit, and remove a **note on any transaction**: purchases, income, transfers (one note on the matched pair), investment buys and sells, credit card payments, Poker, and manual cash transactions.
- [x] Notes show in the list next to the transaction and are searchable.

*Each row*
- [x] Shows date, merchant, category, amount, account, and markers for pending, transfer, split, refund, Poker, and note.
- [x] Fixes happen from the row: recategorise, split, mark or undo a transfer, link a refund, mark as Poker (§6).

- [x] The AI assistant can read notes (§16).

**Not yet / later:** bulk editing many transactions at once; attaching receipts or files.

**Related:** [decisions.md](../../decisions.md) 005, 006 · [design.md](./design.md) §1, §2, §3

## 8. Spending views

**Success looks like:** I learn where my money goes each month and cut out spending I decide is unnecessary. These views are worth building if they give me a good understanding of how I spend and save, and help me notice places to improve.

**Done when:**

*Where it went this month*
- [x] A **monthly summary** for any month: income, spending, amount saved, and savings rate, each compared with the previous month and my recent average.
- [x] The **flow diagram** shows the month in one picture: income sources → categories → top merchants, with what's left over flowing to "Saved" (or "Overspent").
- [ ] **Per-category monthly charts** (one small chart per category, shared scale) show each category's trend and how this month compares with usual.
- [x] **Top merchants** with trend lines, and the **spending heatmap** by day, as in design.md §3.
- [x] Every figure drills down to its transactions (§7).

*How I save*
- [x] Money moved into savings and investment accounts is shown each month as **saved**, by destination (e.g. HYSA, brokerage), not hidden as transfers.
- [x] Savings rate is shown month over month.

*Necessary vs. not*
- [x] I can mark categories and merchants as **necessary** or **not necessary**, and override it on a single transaction. **There are no defaults:** everything starts as "not set" until I label it myself.
- [ ] Spending views can split or filter by necessary / not necessary / not set, and show the trend of not-necessary spending month over month. Spending that isn't labelled yet is shown as "not set", never guessed.

*Places to improve (rule-based, no AI)*
- [x] A **"Worth a look"** list highlights, with the numbers behind each:
  - categories running above their usual pace or recent average
  - merchants whose spending is rising
  - small, frequent purchases that add up (e.g. "Coffee: 18 purchases, $97 this month")
  - new recurring charges and price increases (§9)
- [x] I can put a category or merchant on a **cutting back** list and see, month by month, whether it actually went down.

**Not yet / later:** AI-written explanations or suggestions on these views happen only when I ask (§16).

*What "usual" means*
- [x] "Usual" is the average of the previous **1–3 months**. I can choose 1, 2, or 3 months (default 3), and every comparison says which it used.

**Related:** [decisions.md](../../decisions.md) 005 · [design.md](./design.md) §1, §3, §6 cash flow

## 9. Recurring charges

**Success looks like:** I know what my recurring charges are, but the real goal is **not getting blindsided**: I always know where my account balances stand relative to what I'm about to owe. This should save me stress more than money; I'm already careful about what I subscribe to.

**Done when:**

*Will I be covered?*
- [ ] For each account that pays bills, an **upcoming view** shows the current balance, every recurring charge due before the next expected income, and the **lowest point** the balance is projected to reach.
- [x] **Credit card payments** are included: the statement balance and due date for each card (from Plaid's Liabilities product), shown as an upcoming payment from the account I pay it from.
- [ ] If a projected balance would go **below zero**, a warning appears (there's no separate low-balance buffer) at the top of the Overview and the recurring view: which account, how much short, and on what date.
- [x] Each projection shows what it's based on (which charges, which income, which dates), so I can check it.

*What they are*
- [x] A list of all recurring charges and income: name, amount, how often, next date, and which account it comes from. Detected using Plaid's Recurring Transactions (included in the Trial plan).
- [x] A **month calendar** shows when each charge hits, with the total of fixed costs for the month.
- [x] Bills that vary (e.g. utilities) show an estimate based on recent amounts, marked as an estimate.
- [x] I can add a recurring item Plaid missed, edit one it got wrong (amount, date, account), or remove one, and the projections update.
- [ ] Price changes on an existing charge are noted, without alarms; new charges are listed quietly.

**Not yet / later:** warnings outside the app (macOS notifications); suggestions about which subscriptions to cancel.

**Open:**
- How far ahead to project if no income is expected soon (e.g. 30 days).

**Related:** [decisions.md](../../decisions.md) 002 · [design.md](./design.md) §3 Recurring charges

## 10. Budgets

**Success looks like:** One overall spending budget for a period (e.g. a calendar month), and inside it, expected spend for specific things: eating out, clothes, a particular trip. I can see how well I stick to what I planned, and where I overspend or underspend compared with what I expected.

**Done when:**

*Setting it up*
- [x] An **overall budget** for a period (calendar month by default; weekly, yearly, or custom dates also possible, decision 004).
- [x] **Parts inside it**, each with an expected amount. A part can be defined by:
  - one or more **categories** (e.g. Eating out = Restaurants + Fast food + Bars)
  - **merchants**
  - a **tag** I put on transactions by hand, for one-off things like a trip ("Lisbon trip").
- [x] Whatever the parts don't cover shows as **"Everything else"** = overall − sum of parts. If the parts add up to more than the overall, the app says so.
- [x] Each spending transaction counts toward **at most one part**, so nothing is counted twice. A tag (e.g. the trip) takes priority over a category. A test checks this.
- [x] Each new period starts fresh, with no carryover (decision 004). Parts carry over to the next month as the same plan unless I change them.
- [x] **Trips (and other one-off tagged budgets) have their own start and end dates**, which can span months. A trip has one expected total and its own bar and pace across its dates.
- [x] Trip spending still counts toward the **overall** budget of the month it happens in, shown there as a "Trip: $X this month" line, so each month's overall total stays complete. It doesn't count toward any monthly part.

*During the period*
- [x] A bar for the overall budget and one per part: spent vs. expected, with a **pace marker** for where I should be by today and a projection to the end of the period (design.md §4).
- [x] Pending charges shown as a faded extension, not counted (decision 005).
- [ ] Each bar drills down to its transactions (§7).

*How well I stick to it*
- [x] At the end of each period, a **planned vs. actual** summary: each part and the overall, how much over or under, in dollars and percent.
- [x] A **history grid** (parts × past periods) coloured by how far over or under, so I can see which parts are always over (unrealistic) or always under (could be lowered).
- [x] A simple **track record** per part and overall: how many of the last N periods I stayed within the plan, and the average difference.

**Not yet / later:** warnings or notifications as I approach a limit.

**Open:**
- Whether "Everything else" is a real part with its own pace and history, or just the remainder.

**Related:** [decisions.md](../../decisions.md) 004, 005 · [design.md](./design.md) §4

## 11. Savings goals

**Success looks like:** Watching goals grow feels great. Making progress and reaching a goal is celebrated with an animation. Each goal shows the actual thing I'm saving for (e.g. a DGX Spark) next to it. I can set a deadline or an expected contribution per period, and see where I am compared with it.

**Done when:**

*The goal itself*
- [x] A goal has a name, target amount, account, priority, an optional **picture of the thing** (an image I add), and optionally a **deadline** and/or an **expected contribution** per period (e.g. $300/month).
- [x] The goal card shows the picture prominently next to a progress ring: saved / target and percent.
- [x] Money is assigned to goals in priority order after any protected amount, and withdrawals reduce the lowest-priority goals first (decision 004). Tests cover this, including several goals on one account and a balance below the protected amount.

*Am I on track?*
- [x] With a **deadline:** the card shows how much per month is needed from now to make it, and whether I'm ahead or behind (e.g. "$180 behind · need $420/month to hit June 1").
- [x] With an **expected contribution:** the card shows actual vs. expected for the current period and recent periods (e.g. "$250 of $300 this month").
- [x] Every goal shows a **projected completion date** at my recent contribution rate. If there's a deadline and the projection is later, both are shown.
- [x] When a goal loses money (a withdrawal, or a higher-priority goal being added or reordered), the card explains why (design.md §5).

*Celebrating*
- [x] Crossing a **milestone** plays a small celebration animation the next time I open the app or the Goals window. Milestones are every **25% or every $300, whichever is the smaller amount** (e.g. a $4,000 goal celebrates every $300; an $800 goal at $200, $400, $600).
- [x] **Completing a goal** plays a bigger celebration featuring the goal's picture.
- [ ] Each milestone is celebrated **only once**, even if the balance dips below it and comes back.
- [ ] Animations respect macOS "Reduce motion" (a gentler version instead).
- [x] Completed goals can be archived and stay viewable as achievements, optionally linked to the purchase transaction.

*Planning*
- [ ] Drag-to-reorder priorities, what-if contribution controls, and the account bar split by goal, as in design.md §5, with projections updating live.

**Not yet / later:** finding the product image automatically from a name or link; goals not tied to an account.

- [ ] Goal pictures are stored **on my Mac only**, not on the backend. If a picture is missing (e.g. on a new Mac), the goal shows a placeholder and I can add it again.

**Related:** [decisions.md](../../decisions.md) 004 · [design.md](./design.md) §5

## 12. Trajectory

**Success looks like:** Looking back, I can see how my ratio of earning to spending has changed, how my investments have changed, and how much my HYSA has earned in interest compared with the principal I put in. Looking forward, I get an outlook based on expected returns and extrapolated spending, over 1, 20, 30, and 40 years.

**Done when:**

*Looking back*
- [x] **Earning vs. spending:** a chart of income vs. spending per month and per year, with the savings rate (and spending as a share of income) over time.
- [ ] **Investments:** value over time, split into **what I put in** (contributions) and **growth** (market gains and losses, dividends). History starts when each investment account was connected (§5).
- [x] **Interest vs. principal:** for my HYSA, and any other interest-earning account, a chart of principal deposited vs. **total interest earned**, cumulative over time, plus interest earned per month and per year.
- [x] Net worth over time, stacked by account (§5).
- [x] All of these can be viewed by month or by year, and drill down to transactions where it makes sense.

*Looking forward*
- [x] A **projection** of net worth (and of each part: cash, HYSA, investments) over **1, 20, 30, and 40 years**, switchable.
- [x] It's built from **assumptions I can see and edit**:
  - expected annual return for investments
  - the HYSA's interest rate
  - income and spending, extrapolated from my recent averages (§8's "usual")
  - how much I contribute to each account per month
- [x] **Assumptions can change over time.** My income, spending, and saving will change as I get older, so I can set **life phases** by year range (e.g. "2026–2030: savings rate 20%; 2031–2045: income $X, spending $Y"). Today's habits only drive the near term; later years use the phases I set.
- [x] If no phase is set for a period, the projection carries the last assumption forward and labels it clearly as "assumed to stay the same", so I can see where my present habits are being stretched too far.
- [x] The projection is shown as a **range** (lower / expected / higher return) rather than one line, widening over time.
- [x] A **toggle** switches between **today's dollars** (adjusted for inflation) and **future dollars**. The inflation rate is one of the editable assumptions.
- [ ] Changing an assumption updates the projection immediately.
- [x] Projections are deterministic: the same assumptions always give the same numbers, and a test checks them against standard compound-interest formulas.
- [x] The view states plainly that it's a projection from my own assumptions, not a prediction or advice.

**Not yet / later:** modelling specific life events (a big purchase, a job change) in the projection; tax effects.

**Open:**
- How wide the lower/higher range is by default.
- Whether to also offer simple built-in shapes (e.g. "income grows X% a year") as an alternative to setting phases by hand.

**Related:** [decisions.md](../../decisions.md) 005 · [design.md](./design.md) §6

## 13. Overview

**Success looks like:** At a quick glance, without clicking anything, I see this month's spending breakdown, what I've recently spent money on, and a snapshot of where I am with my budgets and goals.

**Done when:**

*Always visible, no clicks*
- [x] **This month's spending breakdown:** total spent so far and the split by category (or by budget part), compared with usual (§8).
- [x] **Recent spending:** the latest transactions (e.g. last 7–10), each showing merchant, category, amount, and date (§7).
- [x] **Budgets snapshot:** the overall budget bar with its pace marker, plus the parts that are over or running hot (§10).
- [x] **Goals snapshot:** each active goal's picture, progress, and whether it's on track for its deadline or contribution target (§11).
- [x] **Net worth:** today's total with the change since last month, and a small trend line (§5).
- [x] **Account balances:** every account's current balance, with its "last updated" time and any out-of-date marker (§4).
- [ ] Everything fits in the Overview window at its default size without scrolling.

*Only when there's something to deal with*
- [x] A compact alerts strip at the top appears only when needed: a projected low balance (§9), a bank needing reconnection (§4), an "unexplained" difference (§6), or items in "Needs a look" (§6).
- [x] When nothing needs attention, the strip doesn't appear, so a clean Overview means "all good".
- [ ] Goal celebrations (§11) play over the Overview when a milestone was crossed since I last opened the app.

*Getting further*
- [x] Every element clicks through: the breakdown to the Spending window, a transaction to its details, a budget or goal to its window.
- [ ] The Overview loads quickly when the app opens (data appears within about a second after Touch ID on a normal connection).

**Not yet / later:** customising which cards appear on the Overview.

**Open:**
- Whether "this month" means the calendar month or the overall budget's period (§10); they're the same by default.

**Related:** [design.md](./design.md) §9 Visual style & shell

## 14. Desktop shell

**Success looks like:** A pretty basic desktop layout that feels delightful. Usually one window is in focus at a time, but I can drag windows around and switch focus like on a real desktop. The layout stays the same between sessions. The desktop background can be my Claude Code background.

**Done when:**

*Basic desktop*
- [x] Each area (Overview, Spending, Budgets, Goals, Recurring, Trajectory, Investments, Transactions, AI Assistant) opens as a **window** with a title bar and minimise, maximise, and close buttons.
- [x] A **dock** shows every area. Clicking an area opens it, or brings it to the front if it's already open; each area has at most one window.
- [x] Windows can be **dragged** by the title bar and **resized** from edges and corners.
- [x] Clicking a window brings it into **focus**: it comes to the front and is visibly highlighted, and other windows are visibly in the background.
- [x] Minimised windows go to the dock and come back from it.
- [x] Windows stay **inside the app window**; they can't be dragged outside it, and they always keep their title bar visible, including after the app window is resized.

*Remembered between sessions*
- [x] Which windows are open or minimised, their positions, sizes, stacking order, and which one is in focus are restored the next time I open the app.
- [x] On first run, only the Overview is open, centred.

*Delightful, not fiddly*
- [x] Opening, minimising, and focusing windows have short, smooth animations (respecting "Reduce motion").
- [x] Dragging and resizing stay smooth even with charts inside the window.
- [x] Keyboard shortcuts: open each area (e.g. ⌘1–⌘9), close the focused window (⌘W), switch between open windows.
- [x] Controls use the shared raised/pressed style (§15).

*Background*
- [x] The **desktop background** is my Claude Code "pixel waves" scene: a pixel-art cream sky with clouds and layered ocean waves. It isn't an image file; it's an SVG generated from `~/.claude/skills/pixel-waves/hooks/scene.js` (the scene parts) and `register.tsx` (how they're composed). The app gets its own copy of the scene parts in the repo and draws the same scene, so it doesn't depend on my `.claude` folder at runtime.
- [x] The background stays crisp (pixel-art edges, no blurring) at any window size and fills the desktop without stretching.

**Not yet / later:** snapping windows to edges or halves; several desktops; animating the clouds and waves (the scene parts include drift timings, but the Claude Code version is still).

**Related:** [design.md](./design.md) §9

## 15. Visual style system

**Success looks like:** Above all, the app feels very nice and intuitive to use. The UI is uncluttered; if that means splitting things across more windows ("apps"), that's preferred over crowding one. Colours: cream, white, blue, and shades of orange and pink.

**Done when:**

*Uncluttered*
- [ ] Each window answers **one main question** (e.g. "Am I on budget this month?"). If a window starts doing several jobs, it's split into another window instead of adding sections.
- [ ] Each window has one clear primary element (the main chart or list); secondary details live behind a click (drill-down, tabs, or another window), not on screen at once.
- [ ] Generous spacing and a small set of text sizes; numbers are the most prominent thing, labels quieter.

*Intuitive*
- [x] Every control has a visible label or a clear icon with a tooltip; no unexplained abbreviations or jargon.
- [x] Every empty state says what goes there and offers the next step (e.g. "No goals yet · Add a goal").
- [x] The same action looks and works the same everywhere (e.g. clicking a number always drills down to transactions).

*Colour*
- [x] A palette built from **cream, white, blue, and shades of orange and pink**, defined once as named design tokens (e.g. `--surface-cream`, `--accent-blue`) and used everywhere; no one-off colours in components.
- [x] Cream is the main surface; white for raised cards and controls; blue for primary actions and focus; orange and pink for highlights, chart series, and warnings.
- [x] Each category and each goal keeps the **same colour everywhere** in the app. Where there are more categories than distinguishable colours, smaller ones share a neutral "Other" shade, in line with design.md's "small multiples over rainbow stacks".
- [ ] Text and key chart elements meet accessible contrast (WCAG AA), checked with a contrast tool.
- [x] Over / under / on-track status never relies on colour alone; there's always a label, icon, or number too.

*Raised controls*
- [x] Every interactive surface (buttons, toggles, tabs, draggable cards, dock items) uses one shared component set with the **raised look and a clear pressed state**: a hard offset shadow that collapses as the element moves down on press (`ideas.md`, design.md §9).
- [x] Hover, focus (keyboard), pressed, and disabled states exist for every control and look consistent.

- [x] **Light only.** There is no dark mode.
- [x] The palette starts from the pixel-waves background's colours so the windows sit naturally on it: cream surfaces (`#efe6d0`, `#f4ecd8`, `#faf5e8`), ocean-blue accent (`#1d4c9e`), and navy text (`#14233f`, `#33435f`, `#55627a`), with oranges and pinks added for highlights and charts.

**Not yet / later:** themes or user-chosen accent colours; dark mode.

**Open:**
- The exact orange and pink shades (to settle with a small style sample once components exist).

**Related:** [design.md](./design.md) §1 Principles, §9 · `ideas.md`

## 16. AI assistant

**Success looks like:** I can ask things like "what category am I spending the most in this month?", "where can I cut back?", and "where is money going to waste that could go to another budget or goal?" The assistant can also do anything I can do through manual entry in the UI (update budgets, recategorise, and so on), except changing my bank connections, and every action waits for my approval.

**Done when:**

*Answering*
- [x] It only runs when I ask (decision 006); nothing is generated on sync or page load.
- [ ] Answers use real numbers from the same queries the charts use (§2), never estimates the model made up. Each figure in an answer links to the chart or transactions behind it.
- [ ] It answers the example questions well, and they're built in as ready-made prompts:
  - **"What am I spending the most on this month?"** — top categories with amounts and comparison with usual (§8).
  - **"Where can I cut back?"** — uses my necessary / not-necessary labels, the cutting-back list, and "Worth a look" (§8), and names specific merchants and amounts.
  - **"Where is money going to waste that could go elsewhere?"** — finds budget parts I consistently underspend, rising not-necessary spending, and recurring charges, and shows what moving that amount would do, e.g. "Clothes has been $120 under for 3 months; adding $120/month to the DGX Spark goal would finish it 7 weeks sooner" (§10, §11).
- [x] Suggestions come with a **proposed action** I can approve in one click when one fits (e.g. "Lower Clothes to $180 and raise the DGX Spark goal's monthly contribution to $420").
- [ ] It never moves money. Where a suggestion means moving money, it says so and I do it at my bank.

*Acting, with my approval*
- [x] **Parity with manual entry:** every manual action in the UI is also available to the assistant, including:
  - budgets and their parts; goals, priorities, deadlines, contributions
  - recategorising, merchant rules, necessary / not-necessary labels
  - splits, transfers, refund links, Poker tags, notes
  - manual cash accounts and their transactions
- [x] **Excluded:** connecting, reconnecting, or removing banks; sign-in, Touch ID, and security settings; anything involving moving money.
- [x] A test lists every UI action and fails if one has no matching assistant tool, unless it's on the excluded list.
- [x] **Every change waits for approval:** the assistant proposes, I see exactly what will change (before → after), and nothing is applied until I approve. Several changes can be proposed together and approved or rejected one by one.
- [x] Every applied change is in an **action log** and can be **undone**.
- [x] Merchant names and descriptions are treated as untrusted text: text in transaction data can't make the assistant act, because every change needs my approval anyway.

*Privacy and cost*
- [ ] The assistant sees only what its tools return: mostly totals, individual transactions only when needed. Account numbers, Plaid tokens, and personal identifiers are never sent (decision 006).
- [x] Each conversation has a **"what was sent"** view showing exactly what went to Gemini.
- [ ] When Gemini's free-tier limit is hit, the assistant says so plainly and when it can be used again; nothing breaks.

- [x] The assistant **can read my transaction notes** (§7), since they often explain what a transaction was.
- [ ] **Conversations aren't saved.** A conversation (and its "what was sent" view) lasts until I close it or quit the app, and nothing from it is stored on the backend. The action log of approved changes is kept, since undo depends on it.

**Not yet / later:** the assistant remembering preferences or past conversations; voice input.

**Related:** [decisions.md](../../decisions.md) 003, 006 · [design.md](./design.md) §7 · `ideas.md` (Harness)

## 17. Investments

**Success looks like:** Investments are part of the first version.

**Done when:**
- [ ] An **Investments** window (in the dock, §14) shows each investment account's current value and its **holdings**: name, ticker, quantity, current value, and share of the account. Data comes from Plaid's Investments product (included in the Trial plan).
- [x] **Allocation:** a breakdown of all investments by type (e.g. stocks, ETFs, funds, cash) and by holding.
- [x] **Performance vs. what I put in:** for each account and in total, contributions vs. current value and the gain or loss in dollars and percent (§12). **Contributions are measured from transfers in** (money moved into the account, minus money moved out, §6), not from Plaid's cost basis.
- [ ] **Activity:** buys, sells, dividends, and fees are listed with notes allowed (§7); dividends count as income and buys/sells as neither spending nor income (§6).
- [x] Holdings and values refresh with the daily sync and the Refresh button (§4), and investment values feed net worth and snapshots (§5).
- [x] Holdings history is kept from the day each account is connected (§5); older performance uses what Plaid provides and says where it starts.

**Not yet / later:** rebuilding past investment values from market prices; benchmarks (e.g. comparing with an index); tax lots and cost-basis detail beyond what Plaid gives.

**Not planned:**
- **macOS notifications:** not needed; alerts stay inside the app (§4, §9, §13).
- **Sharing with a partner:** not needed; single user only (§2).
- **Importing older history from CSV:** not requested for the first version (decision 002 keeps it as a fallback).

**Related:** [decisions.md](../../decisions.md) 002 · [design.md](./design.md) §10 Open questions
