CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text,
	`plaid_account_id` text,
	`name` text NOT NULL,
	`nickname` text,
	`mask` text,
	`type` text NOT NULL,
	`subtype` text,
	`kind_override` text,
	`is_manual` integer DEFAULT false NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`protected_amount_cents` integer DEFAULT 0 NOT NULL,
	`income_fallback` integer DEFAULT false NOT NULL,
	`iso_currency_code` text,
	`current_balance_cents` integer,
	`balance_updated_at` text,
	`connected_on` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `plaid_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_plaid_account_id_uq` ON `accounts` (`plaid_account_id`);--> statement-breakpoint
CREATE TABLE `action_log` (
	`id` text PRIMARY KEY NOT NULL,
	`action_name` text NOT NULL,
	`input_json` text NOT NULL,
	`summary` text NOT NULL,
	`mutations_json` text NOT NULL,
	`inverse_json` text NOT NULL,
	`source` text NOT NULL,
	`applied_at` text NOT NULL,
	`undone_at` text
);
--> statement-breakpoint
CREATE INDEX `action_log_applied_idx` ON `action_log` (`applied_at`);--> statement-breakpoint
CREATE TABLE `ai_rate_counters` (
	`bucket` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`reset_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `app_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`label` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text,
	`last_used_at` text,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_credentials_token_hash_uq` ON `app_credentials` (`token_hash`);--> statement-breakpoint
CREATE TABLE `balance_snapshots` (
	`account_id` text NOT NULL,
	`date` text NOT NULL,
	`balance_cents` integer NOT NULL,
	`source` text NOT NULL,
	`is_estimated` integer DEFAULT false NOT NULL,
	`is_carried_forward` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`account_id`, `date`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `budget_amounts` (
	`budget_id` text NOT NULL,
	`effective_from` text NOT NULL,
	`amount_cents` integer NOT NULL,
	PRIMARY KEY(`budget_id`, `effective_from`),
	FOREIGN KEY (`budget_id`) REFERENCES `budgets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `budget_part_targets` (
	`part_id` text NOT NULL,
	`target_kind` text NOT NULL,
	`target_value` text NOT NULL,
	PRIMARY KEY(`part_id`, `target_kind`, `target_value`),
	FOREIGN KEY (`part_id`) REFERENCES `budget_parts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `budget_parts` (
	`id` text PRIMARY KEY NOT NULL,
	`budget_id` text NOT NULL,
	`name` text NOT NULL,
	`expected_cents` integer NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`position` integer NOT NULL,
	FOREIGN KEY (`budget_id`) REFERENCES `budgets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `budget_parts_budget_idx` ON `budget_parts` (`budget_id`);--> statement-breakpoint
CREATE TABLE `budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`period_kind` text NOT NULL,
	`anchor_date` text NOT NULL,
	`custom_end_date` text,
	`archived_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cutting_back` (
	`id` text PRIMARY KEY NOT NULL,
	`target_kind` text NOT NULL,
	`target_value` text NOT NULL,
	`started_on` text NOT NULL,
	`ended_on` text
);
--> statement-breakpoint
CREATE TABLE `goal_milestones_seen` (
	`goal_id` text NOT NULL,
	`milestone_cents` integer NOT NULL,
	`seen_at` text NOT NULL,
	PRIMARY KEY(`goal_id`, `milestone_cents`),
	FOREIGN KEY (`goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `goals` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`account_id` text NOT NULL,
	`target_cents` integer NOT NULL,
	`priority` integer NOT NULL,
	`deadline` text,
	`expected_contribution_cents` integer,
	`contribution_period` text,
	`color_slot` integer NOT NULL,
	`completed_at` text,
	`archived_at` text,
	`purchase_transaction_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purchase_transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `holdings` (
	`account_id` text NOT NULL,
	`security_id` text NOT NULL,
	`as_of_date` text NOT NULL,
	`quantity` real NOT NULL,
	`value_cents` integer NOT NULL,
	`iso_currency_code` text,
	PRIMARY KEY(`account_id`, `security_id`, `as_of_date`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `investment_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`plaid_investment_transaction_id` text,
	`account_id` text NOT NULL,
	`security_id` text,
	`date` text NOT NULL,
	`type` text NOT NULL,
	`subtype` text,
	`amount_cents` integer NOT NULL,
	`quantity` real,
	`fees_cents` integer,
	`raw_description` text NOT NULL,
	`note` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `investment_transactions_plaid_id_uq` ON `investment_transactions` (`plaid_investment_transaction_id`);--> statement-breakpoint
CREATE TABLE `liabilities` (
	`account_id` text PRIMARY KEY NOT NULL,
	`last_statement_balance_cents` integer,
	`last_statement_issue_date` text,
	`next_payment_due_date` text,
	`minimum_payment_cents` integer,
	`paying_account_id` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`paying_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `merchant_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`match_key` text NOT NULL,
	`source` text NOT NULL,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `merchant_aliases_key_uq` ON `merchant_aliases` (`match_key`);--> statement-breakpoint
CREATE TABLE `merchants` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `necessary_labels` (
	`id` text PRIMARY KEY NOT NULL,
	`target_kind` text NOT NULL,
	`target_value` text NOT NULL,
	`necessity` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `necessary_labels_target_uq` ON `necessary_labels` (`target_kind`,`target_value`);--> statement-breakpoint
CREATE TABLE `transaction_overrides` (
	`transaction_id` text PRIMARY KEY NOT NULL,
	`category` text,
	`bucket` text,
	`necessity` text,
	`note` text,
	`confirmed_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `plaid_items` (
	`id` text PRIMARY KEY NOT NULL,
	`plaid_item_id` text NOT NULL,
	`institution_id` text,
	`institution_name` text,
	`access_token_enc` text NOT NULL,
	`transactions_cursor` text,
	`status` text DEFAULT 'ok' NOT NULL,
	`error_code` text,
	`consent_expires_at` text,
	`last_successful_update_at` text,
	`last_synced_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plaid_items_plaid_item_id_uq` ON `plaid_items` (`plaid_item_id`);--> statement-breakpoint
CREATE TABLE `recurring_item_transactions` (
	`recurring_item_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	PRIMARY KEY(`recurring_item_id`, `transaction_id`),
	FOREIGN KEY (`recurring_item_id`) REFERENCES `recurring_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `recurring_items` (
	`id` text PRIMARY KEY NOT NULL,
	`plaid_stream_id` text,
	`source` text NOT NULL,
	`account_id` text NOT NULL,
	`direction` text NOT NULL,
	`description` text NOT NULL,
	`merchant_name` text,
	`category` text,
	`frequency` text NOT NULL,
	`average_amount_cents` integer NOT NULL,
	`last_amount_cents` integer,
	`last_date` text,
	`predicted_next_date` text,
	`is_active` integer DEFAULT true NOT NULL,
	`plaid_status` text,
	`first_seen_on` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recurring_items_stream_uq` ON `recurring_items` (`plaid_stream_id`);--> statement-breakpoint
CREATE TABLE `recurring_overrides` (
	`recurring_item_id` text PRIMARY KEY NOT NULL,
	`name` text,
	`amount_cents` integer,
	`next_date` text,
	`account_id` text,
	`frequency` text,
	`removed` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`recurring_item_id`) REFERENCES `recurring_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `refund_links` (
	`id` text PRIMARY KEY NOT NULL,
	`refund_transaction_id` text NOT NULL,
	`purchase_transaction_id` text NOT NULL,
	`source` text NOT NULL,
	`undone_at` text,
	`needs_review` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`refund_transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purchase_transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `refund_links_purchase_idx` ON `refund_links` (`purchase_transaction_id`);--> statement-breakpoint
CREATE TABLE `rules` (
	`id` text PRIMARY KEY NOT NULL,
	`position` integer NOT NULL,
	`match_kind` text NOT NULL,
	`match_value` text NOT NULL,
	`account_id` text,
	`set_category` text,
	`set_bucket` text,
	`set_necessity` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `securities` (
	`id` text PRIMARY KEY NOT NULL,
	`plaid_security_id` text NOT NULL,
	`name` text,
	`ticker_symbol` text,
	`type` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `securities_plaid_security_id_uq` ON `securities` (`plaid_security_id`);--> statement-breakpoint
CREATE TABLE `splits` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`category` text,
	`necessity` text,
	`note` text,
	`position` integer NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `splits_transaction_idx` ON `splits` (`transaction_id`);--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text,
	`trigger` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`error_code` text,
	`added_count` integer DEFAULT 0 NOT NULL,
	`modified_count` integer DEFAULT 0 NOT NULL,
	`removed_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `plaid_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sync_runs_item_idx` ON `sync_runs` (`item_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_uq` ON `tags` (`name`);--> statement-breakpoint
CREATE TABLE `transaction_tags` (
	`transaction_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`transaction_id`, `tag_id`),
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`plaid_transaction_id` text,
	`account_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`iso_currency_code` text,
	`date` text NOT NULL,
	`authorized_date` text,
	`pending` integer NOT NULL,
	`pending_transaction_id` text,
	`raw_description` text NOT NULL,
	`merchant_name` text,
	`merchant_entity_id` text,
	`plaid_category_primary` text,
	`plaid_category_detailed` text,
	`plaid_category_confidence` text,
	`is_manual` integer DEFAULT false NOT NULL,
	`removed` integer DEFAULT false NOT NULL,
	`removed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_plaid_transaction_id_uq` ON `transactions` (`plaid_transaction_id`);--> statement-breakpoint
CREATE INDEX `transactions_account_date_idx` ON `transactions` (`account_id`,`date`);--> statement-breakpoint
CREATE INDEX `transactions_date_idx` ON `transactions` (`date`);--> statement-breakpoint
CREATE TABLE `transfer_links` (
	`id` text PRIMARY KEY NOT NULL,
	`out_transaction_id` text NOT NULL,
	`in_transaction_id` text NOT NULL,
	`source` text NOT NULL,
	`undone_at` text,
	`needs_review` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`out_transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`in_transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `transfer_links_out_idx` ON `transfer_links` (`out_transaction_id`);--> statement-breakpoint
CREATE INDEX `transfer_links_in_idx` ON `transfer_links` (`in_transaction_id`);--> statement-breakpoint
CREATE TABLE `trips` (
	`id` text PRIMARY KEY NOT NULL,
	`tag_id` text NOT NULL,
	`name` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`expected_cents` integer NOT NULL,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE no action
);
