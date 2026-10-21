CREATE TABLE `media_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`object_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`actor` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_assets_object_key_unique` ON `media_assets` (`object_key`);--> statement-breakpoint
CREATE TABLE `order_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`event` text NOT NULL,
	`recipient` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`first_attempt_at` integer,
	`next_attempt_at` integer DEFAULT 0 NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`lease_token` text DEFAULT '' NOT NULL,
	`request_json` text,
	`provider_id` text,
	`sent_at` integer,
	`last_error` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `order_notification_event` ON `order_notifications` (`order_id`,`event`);--> statement-breakpoint
CREATE INDEX `order_notification_pending` ON `order_notifications` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `wallet_accounts` (
	`customer_id` text PRIMARY KEY NOT NULL,
	`balance` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "wallet_balance_range" CHECK("wallet_accounts"."balance" >= 0 AND "wallet_accounts"."balance" <= 100000000 AND typeof("wallet_accounts"."balance") = 'integer')
);
--> statement-breakpoint
CREATE TABLE `wallet_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`event_key` text NOT NULL,
	`customer_id` text NOT NULL,
	`kind` text NOT NULL,
	`delta` integer NOT NULL,
	`balance_after` integer NOT NULL,
	`order_id` text,
	`topup_id` text,
	`description` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`topup_id`) REFERENCES `wallet_topups`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "wallet_ledger_balance" CHECK("wallet_ledger"."balance_after" >= 0 AND typeof("wallet_ledger"."delta") = 'integer')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wallet_ledger_event_key_unique` ON `wallet_ledger` (`event_key`);--> statement-breakpoint
CREATE INDEX `wallet_ledger_customer` ON `wallet_ledger` (`customer_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `wallet_topups` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`amount` integer NOT NULL,
	`method` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`request_key` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`reference` text,
	`review_note` text DEFAULT '' NOT NULL,
	`actor` text,
	`created_at` integer NOT NULL,
	`reviewed_at` integer,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "wallet_topup_amount" CHECK("wallet_topups"."amount" >= 100 AND "wallet_topups"."amount" <= 1000000 AND typeof("wallet_topups"."amount") = 'integer')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wallet_topup_request` ON `wallet_topups` (`customer_id`,`request_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `wallet_topup_receipt` ON `wallet_topups` (`reference`);--> statement-breakpoint
CREATE INDEX `wallet_topup_status` ON `wallet_topups` (`status`,`created_at`);--> statement-breakpoint
ALTER TABLE `orders` ADD `contact_email` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `images_json` text DEFAULT '[]' NOT NULL;