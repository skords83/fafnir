DROP TABLE `categorization_rules`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_categories`("id", "name") SELECT "id", "name" FROM `categories`;--> statement-breakpoint
DROP TABLE `categories`;--> statement-breakpoint
ALTER TABLE `__new_categories` RENAME TO `categories`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_category_name` ON `categories` (`name`);--> statement-breakpoint
CREATE TABLE `__new_transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`booking_date` text NOT NULL,
	`value_date` text,
	`amount_cents` integer NOT NULL,
	`counterparty` text,
	`purpose` text,
	`category_override_id` integer,
	`import_batch_id` integer,
	`external_hash` text NOT NULL,
	`is_manual_entry` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_override_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`import_batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_transactions`("id", "account_id", "booking_date", "value_date", "amount_cents", "counterparty", "purpose", "category_override_id", "import_batch_id", "external_hash", "is_manual_entry") SELECT "id", "account_id", "booking_date", "value_date", "amount_cents", "counterparty", "purpose", "category_override_id", "import_batch_id", "external_hash", "is_manual_entry" FROM `transactions`;--> statement-breakpoint
DROP TABLE `transactions`;--> statement-breakpoint
ALTER TABLE `__new_transactions` RENAME TO `transactions`;--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_account_hash` ON `transactions` (`account_id`,`external_hash`);--> statement-breakpoint
CREATE INDEX `idx_booking_date` ON `transactions` (`booking_date`);