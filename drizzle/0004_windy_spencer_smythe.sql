DROP INDEX `uniq_merchant_key`;--> statement-breakpoint
ALTER TABLE `merchant_category_rules` ADD `purpose_contains` text;--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_merchant_key` ON `merchant_category_rules` (`merchant_key`,`purpose_contains`);