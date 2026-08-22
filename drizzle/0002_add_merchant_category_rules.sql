CREATE TABLE `merchant_category_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`merchant_key` text NOT NULL,
	`category_id` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_merchant_key` ON `merchant_category_rules` (`merchant_key`);--> statement-breakpoint
ALTER TABLE `transactions` ADD `category_override_id` integer REFERENCES categories(id);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_category_name` ON `categories` (`name`);