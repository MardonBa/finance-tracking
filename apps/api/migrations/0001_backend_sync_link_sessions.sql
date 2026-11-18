-- Phase 1 backend: Hosted Link sessions (§3) and backend-only sync state on plaid_items (§3, §4).
-- Every column's reason is commented in src/db/schema.ts.
CREATE TABLE `link_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`link_token` text NOT NULL,
	`mode` text NOT NULL,
	`item_id` text,
	`status` text NOT NULL,
	`error_code` text,
	`pending_access_token_enc` text,
	`pending_result_json` text,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`item_id`) REFERENCES `plaid_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `link_sessions_link_token_uq` ON `link_sessions` (`link_token`);--> statement-breakpoint
ALTER TABLE `plaid_items` ADD `transactions_update_status` text;--> statement-breakpoint
ALTER TABLE `plaid_items` ADD `refresh_available_at` text;