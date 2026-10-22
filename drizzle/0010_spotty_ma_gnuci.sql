ALTER TABLE `wallet_topups` ADD `flow` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `wallet_topups` ADD `expires_at` integer;--> statement-breakpoint
ALTER TABLE `wallet_topups` ADD `paid_at` integer;