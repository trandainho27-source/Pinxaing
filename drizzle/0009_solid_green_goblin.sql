ALTER TABLE `order_items` ADD `shipping_exempt` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `shipping_class` text DEFAULT 'standard' NOT NULL;