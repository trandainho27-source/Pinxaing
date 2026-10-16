CREATE TABLE `physical_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`product_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`status` text DEFAULT 'reserved' NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "physical_positive_quantity" CHECK("physical_reservations"."quantity" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `physical_order_product` ON `physical_reservations` (`order_id`,`product_id`);--> statement-breakpoint
CREATE INDEX `physical_reservation_status` ON `physical_reservations` (`status`,`order_id`);--> statement-breakpoint
CREATE TABLE `physical_stock` (
	`product_id` text PRIMARY KEY NOT NULL,
	`available` integer DEFAULT 0 NOT NULL,
	`reserved` integer DEFAULT 0 NOT NULL,
	`sold` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "physical_available_nonnegative" CHECK("physical_stock"."available" >= 0),
	CONSTRAINT "physical_reserved_nonnegative" CHECK("physical_stock"."reserved" >= 0),
	CONSTRAINT "physical_sold_nonnegative" CHECK("physical_stock"."sold" >= 0)
);
--> statement-breakpoint
CREATE TABLE `telegram_gifts` (
	`id` text PRIMARY KEY NOT NULL,
	`ciphertext` text NOT NULL,
	`fingerprint` text NOT NULL,
	`status` text DEFAULT 'available' NOT NULL,
	`order_id` text,
	`is_example` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`assigned_at` integer,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_gifts_fingerprint_unique` ON `telegram_gifts` (`fingerprint`);--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_gifts_order_id_unique` ON `telegram_gifts` (`order_id`);--> statement-breakpoint
CREATE INDEX `telegram_gift_availability` ON `telegram_gifts` (`status`,`is_example`);--> statement-breakpoint
ALTER TABLE `orders` ADD `order_type` text DEFAULT 'digital' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `subtotal` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `shipping_fee` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `recipient` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `shipping_address` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `shipping_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `tracking_number` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `shipped_at` integer;--> statement-breakpoint
ALTER TABLE `orders` ADD `payment_method` text DEFAULT 'wechat' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `checkout_hash` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `checkout_payload_hash` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `orders_checkout_hash` ON `orders` (`checkout_hash`);--> statement-breakpoint
ALTER TABLE `products` ADD `product_type` text DEFAULT 'digital' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `image_url` text DEFAULT '' NOT NULL;