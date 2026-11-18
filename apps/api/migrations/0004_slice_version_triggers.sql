-- Data-slice versions (db/data.ts cache): every write to a slice's table gives it a new random token.
-- FOR EACH ROW is SQLite's only trigger kind; one token update per changed row.
INSERT INTO slice_versions (slice, token) VALUES ('items', lower(hex(randomblob(8))));--> statement-breakpoint
CREATE TRIGGER sv_plaid_items_insert AFTER INSERT ON plaid_items BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'items'; END;--> statement-breakpoint
CREATE TRIGGER sv_plaid_items_update AFTER UPDATE ON plaid_items BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'items'; END;--> statement-breakpoint
CREATE TRIGGER sv_plaid_items_delete AFTER DELETE ON plaid_items BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'items'; END;--> statement-breakpoint
INSERT INTO slice_versions (slice, token) VALUES ('accounts', lower(hex(randomblob(8))));--> statement-breakpoint
CREATE TRIGGER sv_accounts_insert AFTER INSERT ON accounts BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'accounts'; END;--> statement-breakpoint
CREATE TRIGGER sv_accounts_update AFTER UPDATE ON accounts BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'accounts'; END;--> statement-breakpoint
CREATE TRIGGER sv_accounts_delete AFTER DELETE ON accounts BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'accounts'; END;--> statement-breakpoint
INSERT INTO slice_versions (slice, token) VALUES ('transactions', lower(hex(randomblob(8))));--> statement-breakpoint
CREATE TRIGGER sv_transactions_insert AFTER INSERT ON transactions BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'transactions'; END;--> statement-breakpoint
CREATE TRIGGER sv_transactions_update AFTER UPDATE ON transactions BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'transactions'; END;--> statement-breakpoint
CREATE TRIGGER sv_transactions_delete AFTER DELETE ON transactions BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'transactions'; END;--> statement-breakpoint
INSERT INTO slice_versions (slice, token) VALUES ('overrides', lower(hex(randomblob(8))));--> statement-breakpoint
CREATE TRIGGER sv_transaction_overrides_insert AFTER INSERT ON transaction_overrides BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'overrides'; END;--> statement-breakpoint
CREATE TRIGGER sv_transaction_overrides_update AFTER UPDATE ON transaction_overrides BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'overrides'; END;--> statement-breakpoint
CREATE TRIGGER sv_transaction_overrides_delete AFTER DELETE ON transaction_overrides BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'overrides'; END;--> statement-breakpoint
INSERT INTO slice_versions (slice, token) VALUES ('tags', lower(hex(randomblob(8))));--> statement-breakpoint
CREATE TRIGGER sv_tags_insert AFTER INSERT ON tags BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'tags'; END;--> statement-breakpoint
CREATE TRIGGER sv_tags_update AFTER UPDATE ON tags BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'tags'; END;--> statement-breakpoint
CREATE TRIGGER sv_tags_delete AFTER DELETE ON tags BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'tags'; END;--> statement-breakpoint
INSERT INTO slice_versions (slice, token) VALUES ('transactionTags', lower(hex(randomblob(8))));--> statement-breakpoint
CREATE TRIGGER sv_transaction_tags_insert AFTER INSERT ON transaction_tags BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'transactionTags'; END;--> statement-breakpoint
CREATE TRIGGER sv_transaction_tags_update AFTER UPDATE ON transaction_tags BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'transactionTags'; END;--> statement-breakpoint
CREATE TRIGGER sv_transaction_tags_delete AFTER DELETE ON transaction_tags BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'transactionTags'; END;--> statement-breakpoint
INSERT INTO slice_versions (slice, token) VALUES ('splits', lower(hex(randomblob(8))));--> statement-breakpoint
CREATE TRIGGER sv_splits_insert AFTER INSERT ON splits BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'splits'; END;--> statement-breakpoint
CREATE TRIGGER sv_splits_update AFTER UPDATE ON splits BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'splits'; END;--> statement-breakpoint
CREATE TRIGGER sv_splits_delete AFTER DELETE ON splits BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'splits'; END;--> statement-breakpoint
INSERT INTO slice_versions (slice, token) VALUES ('transferLinks', lower(hex(randomblob(8))));--> statement-breakpoint
CREATE TRIGGER sv_transfer_links_insert AFTER INSERT ON transfer_links BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'transferLinks'; END;--> statement-breakpoint
CREATE TRIGGER sv_transfer_links_update AFTER UPDATE ON transfer_links BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'transferLinks'; END;--> statement-breakpoint
CREATE TRIGGER sv_transfer_links_delete AFTER DELETE ON transfer_links BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'transferLinks'; END;--> statement-breakpoint
INSERT INTO slice_versions (slice, token) VALUES ('refundLinks', lower(hex(randomblob(8))));--> statement-breakpoint
CREATE TRIGGER sv_refund_links_insert AFTER INSERT ON refund_links BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'refundLinks'; END;--> statement-breakpoint
CREATE TRIGGER sv_refund_links_update AFTER UPDATE ON refund_links BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'refundLinks'; END;--> statement-breakpoint
CREATE TRIGGER sv_refund_links_delete AFTER DELETE ON refund_links BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'refundLinks'; END;--> statement-breakpoint
INSERT INTO slice_versions (slice, token) VALUES ('merchants', lower(hex(randomblob(8))));--> statement-breakpoint
CREATE TRIGGER sv_merchants_insert AFTER INSERT ON merchants BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'merchants'; END;--> statement-breakpoint
CREATE TRIGGER sv_merchants_update AFTER UPDATE ON merchants BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'merchants'; END;--> statement-breakpoint
CREATE TRIGGER sv_merchants_delete AFTER DELETE ON merchants BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'merchants'; END;--> statement-breakpoint
INSERT INTO slice_versions (slice, token) VALUES ('merchantAliases', lower(hex(randomblob(8))));--> statement-breakpoint
CREATE TRIGGER sv_merchant_aliases_insert AFTER INSERT ON merchant_aliases BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'merchantAliases'; END;--> statement-breakpoint
CREATE TRIGGER sv_merchant_aliases_update AFTER UPDATE ON merchant_aliases BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'merchantAliases'; END;--> statement-breakpoint
CREATE TRIGGER sv_merchant_aliases_delete AFTER DELETE ON merchant_aliases BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'merchantAliases'; END;--> statement-breakpoint
INSERT INTO slice_versions (slice, token) VALUES ('rules', lower(hex(randomblob(8))));--> statement-breakpoint
CREATE TRIGGER sv_rules_insert AFTER INSERT ON rules BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'rules'; END;--> statement-breakpoint
CREATE TRIGGER sv_rules_update AFTER UPDATE ON rules BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'rules'; END;--> statement-breakpoint
CREATE TRIGGER sv_rules_delete AFTER DELETE ON rules BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'rules'; END;--> statement-breakpoint
INSERT INTO slice_versions (slice, token) VALUES ('necessaryLabels', lower(hex(randomblob(8))));--> statement-breakpoint
CREATE TRIGGER sv_necessary_labels_insert AFTER INSERT ON necessary_labels BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'necessaryLabels'; END;--> statement-breakpoint
CREATE TRIGGER sv_necessary_labels_update AFTER UPDATE ON necessary_labels BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'necessaryLabels'; END;--> statement-breakpoint
CREATE TRIGGER sv_necessary_labels_delete AFTER DELETE ON necessary_labels BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'necessaryLabels'; END;--> statement-breakpoint
INSERT INTO slice_versions (slice, token) VALUES ('cuttingBack', lower(hex(randomblob(8))));--> statement-breakpoint
CREATE TRIGGER sv_cutting_back_insert AFTER INSERT ON cutting_back BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'cuttingBack'; END;--> statement-breakpoint
CREATE TRIGGER sv_cutting_back_update AFTER UPDATE ON cutting_back BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'cuttingBack'; END;--> statement-breakpoint
CREATE TRIGGER sv_cutting_back_delete AFTER DELETE ON cutting_back BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'cuttingBack'; END;--> statement-breakpoint
INSERT INTO slice_versions (slice, token) VALUES ('budgets', lower(hex(randomblob(8))));--> statement-breakpoint
CREATE TRIGGER sv_budgets_insert AFTER INSERT ON budgets BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'budgets'; END;--> statement-breakpoint
CREATE TRIGGER sv_budgets_update AFTER UPDATE ON budgets BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'budgets'; END;--> statement-breakpoint
CREATE TRIGGER sv_budgets_delete AFTER DELETE ON budgets BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'budgets'; END;--> statement-breakpoint
INSERT INTO slice_versions (slice, token) VALUES ('budgetAmounts', lower(hex(randomblob(8))));--> statement-breakpoint
CREATE TRIGGER sv_budget_amounts_insert AFTER INSERT ON budget_amounts BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'budgetAmounts'; END;--> statement-breakpoint
CREATE TRIGGER sv_budget_amounts_update AFTER UPDATE ON budget_amounts BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'budgetAmounts'; END;--> statement-breakpoint
CREATE TRIGGER sv_budget_amounts_delete AFTER DELETE ON budget_amounts BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'budgetAmounts'; END;--> statement-breakpoint
INSERT INTO slice_versions (slice, token) VALUES ('budgetParts', lower(hex(randomblob(8))));--> statement-breakpoint
CREATE TRIGGER sv_budget_parts_insert AFTER INSERT ON budget_parts BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'budgetParts'; END;--> statement-breakpoint
CREATE TRIGGER sv_budget_parts_update AFTER UPDATE ON budget_parts BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'budgetParts'; END;--> statement-breakpoint
CREATE TRIGGER sv_budget_parts_delete AFTER DELETE ON budget_parts BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'budgetParts'; END;--> statement-breakpoint
INSERT INTO slice_versions (slice, token) VALUES ('budgetPartTargets', lower(hex(randomblob(8))));--> statement-breakpoint
CREATE TRIGGER sv_budget_part_targets_insert AFTER INSERT ON budget_part_targets BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'budgetPartTargets'; END;--> statement-breakpoint
CREATE TRIGGER sv_budget_part_targets_update AFTER UPDATE ON budget_part_targets BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'budgetPartTargets'; END;--> statement-breakpoint
CREATE TRIGGER sv_budget_part_targets_delete AFTER DELETE ON budget_part_targets BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'budgetPartTargets'; END;--> statement-breakpoint
INSERT INTO slice_versions (slice, token) VALUES ('trips', lower(hex(randomblob(8))));--> statement-breakpoint
CREATE TRIGGER sv_trips_insert AFTER INSERT ON trips BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'trips'; END;--> statement-breakpoint
CREATE TRIGGER sv_trips_update AFTER UPDATE ON trips BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'trips'; END;--> statement-breakpoint
CREATE TRIGGER sv_trips_delete AFTER DELETE ON trips BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'trips'; END;--> statement-breakpoint
INSERT INTO slice_versions (slice, token) VALUES ('goals', lower(hex(randomblob(8))));--> statement-breakpoint
CREATE TRIGGER sv_goals_insert AFTER INSERT ON goals BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'goals'; END;--> statement-breakpoint
CREATE TRIGGER sv_goals_update AFTER UPDATE ON goals BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'goals'; END;--> statement-breakpoint
CREATE TRIGGER sv_goals_delete AFTER DELETE ON goals BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'goals'; END;--> statement-breakpoint
INSERT INTO slice_versions (slice, token) VALUES ('goalMilestonesSeen', lower(hex(randomblob(8))));--> statement-breakpoint
CREATE TRIGGER sv_goal_milestones_seen_insert AFTER INSERT ON goal_milestones_seen BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'goalMilestonesSeen'; END;--> statement-breakpoint
CREATE TRIGGER sv_goal_milestones_seen_update AFTER UPDATE ON goal_milestones_seen BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'goalMilestonesSeen'; END;--> statement-breakpoint
CREATE TRIGGER sv_goal_milestones_seen_delete AFTER DELETE ON goal_milestones_seen BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'goalMilestonesSeen'; END;--> statement-breakpoint
INSERT INTO slice_versions (slice, token) VALUES ('recurringItems', lower(hex(randomblob(8))));--> statement-breakpoint
CREATE TRIGGER sv_recurring_items_insert AFTER INSERT ON recurring_items BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'recurringItems'; END;--> statement-breakpoint
CREATE TRIGGER sv_recurring_items_update AFTER UPDATE ON recurring_items BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'recurringItems'; END;--> statement-breakpoint
CREATE TRIGGER sv_recurring_items_delete AFTER DELETE ON recurring_items BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'recurringItems'; END;--> statement-breakpoint
INSERT INTO slice_versions (slice, token) VALUES ('recurringOverrides', lower(hex(randomblob(8))));--> statement-breakpoint
CREATE TRIGGER sv_recurring_overrides_insert AFTER INSERT ON recurring_overrides BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'recurringOverrides'; END;--> statement-breakpoint
CREATE TRIGGER sv_recurring_overrides_update AFTER UPDATE ON recurring_overrides BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'recurringOverrides'; END;--> statement-breakpoint
CREATE TRIGGER sv_recurring_overrides_delete AFTER DELETE ON recurring_overrides BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'recurringOverrides'; END;--> statement-breakpoint
INSERT INTO slice_versions (slice, token) VALUES ('recurringItemTransactions', lower(hex(randomblob(8))));--> statement-breakpoint
CREATE TRIGGER sv_recurring_item_transactions_insert AFTER INSERT ON recurring_item_transactions BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'recurringItemTransactions'; END;--> statement-breakpoint
CREATE TRIGGER sv_recurring_item_transactions_update AFTER UPDATE ON recurring_item_transactions BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'recurringItemTransactions'; END;--> statement-breakpoint
CREATE TRIGGER sv_recurring_item_transactions_delete AFTER DELETE ON recurring_item_transactions BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'recurringItemTransactions'; END;--> statement-breakpoint
INSERT INTO slice_versions (slice, token) VALUES ('liabilities', lower(hex(randomblob(8))));--> statement-breakpoint
CREATE TRIGGER sv_liabilities_insert AFTER INSERT ON liabilities BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'liabilities'; END;--> statement-breakpoint
CREATE TRIGGER sv_liabilities_update AFTER UPDATE ON liabilities BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'liabilities'; END;--> statement-breakpoint
CREATE TRIGGER sv_liabilities_delete AFTER DELETE ON liabilities BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'liabilities'; END;--> statement-breakpoint
INSERT INTO slice_versions (slice, token) VALUES ('securities', lower(hex(randomblob(8))));--> statement-breakpoint
CREATE TRIGGER sv_securities_insert AFTER INSERT ON securities BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'securities'; END;--> statement-breakpoint
CREATE TRIGGER sv_securities_update AFTER UPDATE ON securities BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'securities'; END;--> statement-breakpoint
CREATE TRIGGER sv_securities_delete AFTER DELETE ON securities BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'securities'; END;--> statement-breakpoint
INSERT INTO slice_versions (slice, token) VALUES ('holdings', lower(hex(randomblob(8))));--> statement-breakpoint
CREATE TRIGGER sv_holdings_insert AFTER INSERT ON holdings BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'holdings'; END;--> statement-breakpoint
CREATE TRIGGER sv_holdings_update AFTER UPDATE ON holdings BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'holdings'; END;--> statement-breakpoint
CREATE TRIGGER sv_holdings_delete AFTER DELETE ON holdings BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'holdings'; END;--> statement-breakpoint
INSERT INTO slice_versions (slice, token) VALUES ('investmentTransactions', lower(hex(randomblob(8))));--> statement-breakpoint
CREATE TRIGGER sv_investment_transactions_insert AFTER INSERT ON investment_transactions BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'investmentTransactions'; END;--> statement-breakpoint
CREATE TRIGGER sv_investment_transactions_update AFTER UPDATE ON investment_transactions BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'investmentTransactions'; END;--> statement-breakpoint
CREATE TRIGGER sv_investment_transactions_delete AFTER DELETE ON investment_transactions BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'investmentTransactions'; END;--> statement-breakpoint
INSERT INTO slice_versions (slice, token) VALUES ('balanceSnapshots', lower(hex(randomblob(8))));--> statement-breakpoint
CREATE TRIGGER sv_balance_snapshots_insert AFTER INSERT ON balance_snapshots BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'balanceSnapshots'; END;--> statement-breakpoint
CREATE TRIGGER sv_balance_snapshots_update AFTER UPDATE ON balance_snapshots BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'balanceSnapshots'; END;--> statement-breakpoint
CREATE TRIGGER sv_balance_snapshots_delete AFTER DELETE ON balance_snapshots BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'balanceSnapshots'; END;--> statement-breakpoint
INSERT INTO slice_versions (slice, token) VALUES ('trajectoryAssumptions', lower(hex(randomblob(8))));--> statement-breakpoint
CREATE TRIGGER sv_trajectory_assumptions_insert AFTER INSERT ON trajectory_assumptions BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'trajectoryAssumptions'; END;--> statement-breakpoint
CREATE TRIGGER sv_trajectory_assumptions_update AFTER UPDATE ON trajectory_assumptions BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'trajectoryAssumptions'; END;--> statement-breakpoint
CREATE TRIGGER sv_trajectory_assumptions_delete AFTER DELETE ON trajectory_assumptions BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'trajectoryAssumptions'; END;--> statement-breakpoint
INSERT INTO slice_versions (slice, token) VALUES ('lifePhases', lower(hex(randomblob(8))));--> statement-breakpoint
CREATE TRIGGER sv_life_phases_insert AFTER INSERT ON life_phases BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'lifePhases'; END;--> statement-breakpoint
CREATE TRIGGER sv_life_phases_update AFTER UPDATE ON life_phases BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'lifePhases'; END;--> statement-breakpoint
CREATE TRIGGER sv_life_phases_delete AFTER DELETE ON life_phases BEGIN UPDATE slice_versions SET token = lower(hex(randomblob(8))) WHERE slice = 'lifePhases'; END;
