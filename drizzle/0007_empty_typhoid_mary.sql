CREATE TABLE `customer_sessions` (
	`hash` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`csrf` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `customer_sessions_owner` ON `customer_sessions` (`customer_id`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text DEFAULT '' NOT NULL,
	`recipient` text DEFAULT '' NOT NULL,
	`contact` text DEFAULT '' NOT NULL,
	`shipping_address` text DEFAULT '' NOT NULL,
	`verified_at` integer,
	`is_demo` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`last_login_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_email_mode` ON `customers` (`email`,`is_demo`);--> statement-breakpoint
CREATE TABLE `email_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`code_hash` text NOT NULL,
	`is_demo` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`sent_at` integer,
	`consumed_at` integer,
	`consume_token` text
);
--> statement-breakpoint
CREATE INDEX `email_challenges_rate` ON `email_challenges` (`email`,`created_at`);--> statement-breakpoint
CREATE TABLE `shipment_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`actor` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `orders` ADD `customer_id` text REFERENCES customers(id);--> statement-breakpoint
ALTER TABLE `orders` ADD `shipment_group_id` text REFERENCES shipment_groups(id);--> statement-breakpoint
ALTER TABLE `orders` ADD `archived_at` integer;--> statement-breakpoint
ALTER TABLE `orders` ADD `admin_note` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `orders_customer_created` ON `orders` (`customer_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `orders_shipment_group` ON `orders` (`shipment_group_id`);