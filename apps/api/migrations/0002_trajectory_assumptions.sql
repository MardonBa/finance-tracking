CREATE TABLE `life_phases` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`from_year` integer NOT NULL,
	`to_year` integer NOT NULL,
	`monthly_income_cents` integer,
	`monthly_spending_cents` integer,
	`savings_rate_pct` real,
	`investment_return_pct` real,
	`hysa_rate_pct` real,
	`inflation_pct` real,
	`contributions_json` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trajectory_assumptions` (
	`id` text PRIMARY KEY NOT NULL,
	`assumptions_json` text NOT NULL,
	`updated_at` text NOT NULL
);
