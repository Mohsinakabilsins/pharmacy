CREATE TABLE `audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer,
	`username` text,
	`action` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`description` text NOT NULL,
	`details` text,
	`severity` text DEFAULT 'INFO' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_logs_created_idx` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_user_idx` ON `audit_logs` (`user_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_action_idx` ON `audit_logs` (`action`);--> statement-breakpoint
CREATE INDEX `audit_logs_entity_idx` ON `audit_logs` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `backup_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_path` text NOT NULL,
	`file_name` text NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`integrity` text,
	`error` text,
	`created_by` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `backup_logs_created_idx` ON `backup_logs` (`created_at`);--> statement-breakpoint
CREATE TABLE `batches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`product_id` integer NOT NULL,
	`batch_number` text NOT NULL,
	`manufacture_date` text,
	`expiry_date` text NOT NULL,
	`cost_price` integer DEFAULT 0 NOT NULL,
	`sale_price` integer DEFAULT 0 NOT NULL,
	`quantity_received` integer DEFAULT 0 NOT NULL,
	`quantity_on_hand` integer DEFAULT 0 NOT NULL,
	`supplier_id` integer,
	`purchase_id` integer,
	`location` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "batches_dates_ck" CHECK("batches"."manufacture_date" IS NULL OR "batches"."expiry_date" > "batches"."manufacture_date"),
	CONSTRAINT "batches_prices_ck" CHECK("batches"."cost_price" >= 0 AND "batches"."sale_price" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `batches_uuid_unique` ON `batches` (`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `batches_product_batch_uq` ON `batches` (`product_id`,`batch_number`);--> statement-breakpoint
CREATE INDEX `batches_fefo_idx` ON `batches` (`product_id`,`expiry_date`);--> statement-breakpoint
CREATE INDEX `batches_expiry_idx` ON `batches` (`expiry_date`);--> statement-breakpoint
CREATE TABLE `cash_adjustments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cash_session_id` integer NOT NULL,
	`direction` text NOT NULL,
	`amount` integer NOT NULL,
	`reason` text NOT NULL,
	`created_by` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`cash_session_id`) REFERENCES `cash_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cash_adjustments_amount_ck" CHECK("cash_adjustments"."amount" > 0)
);
--> statement-breakpoint
CREATE INDEX `cash_adjustments_session_idx` ON `cash_adjustments` (`cash_session_id`);--> statement-breakpoint
CREATE TABLE `cash_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`session_no` text NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`opened_by` integer NOT NULL,
	`opened_at` text NOT NULL,
	`opening_cash` integer DEFAULT 0 NOT NULL,
	`closed_by` integer,
	`closed_at` text,
	`expected_cash` integer,
	`counted_cash` integer,
	`variance` integer,
	`denominations` text,
	`summary` text,
	`closing_notes` text,
	FOREIGN KEY (`opened_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cash_sessions_uuid_unique` ON `cash_sessions` (`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `cash_sessions_session_no_unique` ON `cash_sessions` (`session_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `cash_sessions_one_open_uq` ON `cash_sessions` (`status`) WHERE "cash_sessions"."status" = 'OPEN';--> statement-breakpoint
CREATE INDEX `cash_sessions_opened_idx` ON `cash_sessions` (`opened_at`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_uuid_unique` ON `categories` (`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `categories_name_uq` ON `categories` ("name" COLLATE NOCASE);--> statement-breakpoint
CREATE TABLE `customer_transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`customer_id` integer NOT NULL,
	`txn_date` text NOT NULL,
	`type` text NOT NULL,
	`amount` integer NOT NULL,
	`reference_type` text,
	`reference_id` integer,
	`description` text,
	`created_by` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_transactions_uuid_unique` ON `customer_transactions` (`uuid`);--> statement-breakpoint
CREATE INDEX `customer_txn_customer_idx` ON `customer_transactions` (`customer_id`,`txn_date`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`address` text,
	`notes` text,
	`credit_limit` integer DEFAULT 0 NOT NULL,
	`opening_balance` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customers_uuid_unique` ON `customers` (`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `customers_code_unique` ON `customers` (`code`);--> statement-breakpoint
CREATE INDEX `customers_name_idx` ON `customers` (`name`);--> statement-breakpoint
CREATE INDEX `customers_phone_idx` ON `customers` (`phone`);--> statement-breakpoint
CREATE TABLE `expense_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `expense_categories_name_uq` ON `expense_categories` ("name" COLLATE NOCASE);--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`expense_no` text NOT NULL,
	`expense_date` text NOT NULL,
	`category_id` integer NOT NULL,
	`amount` integer NOT NULL,
	`description` text NOT NULL,
	`payment_method` text NOT NULL,
	`reference` text,
	`cash_session_id` integer,
	`status` text DEFAULT 'POSTED' NOT NULL,
	`created_by` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`voided_by` integer,
	`voided_at` text,
	`void_reason` text,
	FOREIGN KEY (`category_id`) REFERENCES `expense_categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cash_session_id`) REFERENCES `cash_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`voided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "expenses_amount_ck" CHECK("expenses"."amount" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `expenses_uuid_unique` ON `expenses` (`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `expenses_expense_no_unique` ON `expenses` (`expense_no`);--> statement-breakpoint
CREATE INDEX `expenses_date_idx` ON `expenses` (`expense_date`);--> statement-breakpoint
CREATE INDEX `expenses_category_idx` ON `expenses` (`category_id`);--> statement-breakpoint
CREATE INDEX `expenses_session_idx` ON `expenses` (`cash_session_id`);--> statement-breakpoint
CREATE TABLE `held_bills` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label` text NOT NULL,
	`customer_id` integer,
	`payload` text NOT NULL,
	`item_count` integer DEFAULT 0 NOT NULL,
	`total_estimate` integer DEFAULT 0 NOT NULL,
	`created_by` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `manufacturers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`name` text NOT NULL,
	`country` text,
	`phone` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `manufacturers_uuid_unique` ON `manufacturers` (`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `manufacturers_name_uq` ON `manufacturers` ("name" COLLATE NOCASE);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`payment_no` text NOT NULL,
	`direction` text NOT NULL,
	`supplier_id` integer,
	`customer_id` integer,
	`purchase_id` integer,
	`amount` integer NOT NULL,
	`method` text NOT NULL,
	`reference` text,
	`payment_date` text NOT NULL,
	`notes` text,
	`cash_session_id` integer,
	`status` text DEFAULT 'POSTED' NOT NULL,
	`created_by` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`voided_by` integer,
	`voided_at` text,
	`void_reason` text,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cash_session_id`) REFERENCES `cash_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`voided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payments_amount_ck" CHECK("payments"."amount" > 0),
	CONSTRAINT "payments_party_ck" CHECK(("payments"."direction" = 'OUT' AND "payments"."supplier_id" IS NOT NULL) OR ("payments"."direction" = 'IN' AND "payments"."customer_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_uuid_unique` ON `payments` (`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `payments_payment_no_unique` ON `payments` (`payment_no`);--> statement-breakpoint
CREATE INDEX `payments_supplier_idx` ON `payments` (`supplier_id`);--> statement-breakpoint
CREATE INDEX `payments_customer_idx` ON `payments` (`customer_id`);--> statement-breakpoint
CREATE INDEX `payments_date_idx` ON `payments` (`payment_date`);--> statement-breakpoint
CREATE INDEX `payments_session_idx` ON `payments` (`cash_session_id`);--> statement-breakpoint
CREATE TABLE `permissions` (
	`key` text PRIMARY KEY NOT NULL,
	`module` text NOT NULL,
	`label` text NOT NULL,
	`description` text
);
--> statement-breakpoint
CREATE TABLE `prescription_attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`prescription_id` integer NOT NULL,
	`file_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`data` blob NOT NULL,
	`created_by` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`prescription_id`) REFERENCES `prescriptions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `prescription_attachments_rx_idx` ON `prescription_attachments` (`prescription_id`);--> statement-breakpoint
CREATE TABLE `prescription_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`prescription_id` integer NOT NULL,
	`product_id` integer,
	`medicine_text` text NOT NULL,
	`quantity` integer,
	`instructions` text,
	FOREIGN KEY (`prescription_id`) REFERENCES `prescriptions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `prescription_items_rx_idx` ON `prescription_items` (`prescription_id`);--> statement-breakpoint
CREATE TABLE `prescriptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`prescription_no` text NOT NULL,
	`customer_id` integer,
	`patient_name` text NOT NULL,
	`patient_age` text,
	`prescriber_name` text NOT NULL,
	`prescriber_registration` text,
	`clinic` text,
	`prescription_date` text NOT NULL,
	`notes` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`recorded_by` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prescriptions_uuid_unique` ON `prescriptions` (`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `prescriptions_prescription_no_unique` ON `prescriptions` (`prescription_no`);--> statement-breakpoint
CREATE INDEX `prescriptions_customer_idx` ON `prescriptions` (`customer_id`);--> statement-breakpoint
CREATE INDEX `prescriptions_date_idx` ON `prescriptions` (`prescription_date`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`code` text NOT NULL,
	`barcode` text,
	`brand_name` text NOT NULL,
	`generic_name` text,
	`manufacturer_id` integer,
	`category_id` integer,
	`dosage_form` text,
	`strength` text,
	`pack_size` integer DEFAULT 1 NOT NULL,
	`unit_name` text DEFAULT 'Unit' NOT NULL,
	`pack_name` text DEFAULT 'Pack' NOT NULL,
	`allow_loose_sale` integer DEFAULT true NOT NULL,
	`requires_prescription` integer DEFAULT false NOT NULL,
	`is_controlled` integer DEFAULT false NOT NULL,
	`storage_location` text,
	`storage_condition` text,
	`min_stock` integer DEFAULT 0 NOT NULL,
	`reorder_level` integer DEFAULT 0 NOT NULL,
	`max_stock` integer DEFAULT 0 NOT NULL,
	`default_cost_price` integer DEFAULT 0 NOT NULL,
	`default_sale_price` integer DEFAULT 0 NOT NULL,
	`tax_rate_bp` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`notes` text,
	`search_text` text DEFAULT '' NOT NULL,
	`created_by` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`manufacturer_id`) REFERENCES `manufacturers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "products_pack_size_ck" CHECK("products"."pack_size" >= 1),
	CONSTRAINT "products_prices_ck" CHECK("products"."default_cost_price" >= 0 AND "products"."default_sale_price" >= 0),
	CONSTRAINT "products_levels_ck" CHECK("products"."min_stock" >= 0 AND "products"."reorder_level" >= 0 AND "products"."max_stock" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_uuid_unique` ON `products` (`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `products_code_unique` ON `products` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `products_barcode_unique` ON `products` (`barcode`);--> statement-breakpoint
CREATE INDEX `products_brand_idx` ON `products` (`brand_name`);--> statement-breakpoint
CREATE INDEX `products_generic_idx` ON `products` (`generic_name`);--> statement-breakpoint
CREATE INDEX `products_category_idx` ON `products` (`category_id`);--> statement-breakpoint
CREATE INDEX `products_manufacturer_idx` ON `products` (`manufacturer_id`);--> statement-breakpoint
CREATE INDEX `products_active_idx` ON `products` (`is_active`);--> statement-breakpoint
CREATE TABLE `purchase_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`purchase_id` integer NOT NULL,
	`line_no` integer NOT NULL,
	`product_id` integer NOT NULL,
	`batch_id` integer,
	`batch_number` text NOT NULL,
	`manufacture_date` text,
	`expiry_date` text NOT NULL,
	`quantity` integer NOT NULL,
	`bonus_quantity` integer DEFAULT 0 NOT NULL,
	`cost_price` integer DEFAULT 0 NOT NULL,
	`sale_price` integer DEFAULT 0 NOT NULL,
	`discount_bp` integer DEFAULT 0 NOT NULL,
	`discount_amount` integer DEFAULT 0 NOT NULL,
	`tax_rate_bp` integer DEFAULT 0 NOT NULL,
	`tax_amount` integer DEFAULT 0 NOT NULL,
	`line_total` integer DEFAULT 0 NOT NULL,
	`landed_cost_price` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "purchase_items_qty_ck" CHECK("purchase_items"."quantity" >= 0 AND "purchase_items"."bonus_quantity" >= 0)
);
--> statement-breakpoint
CREATE INDEX `purchase_items_purchase_idx` ON `purchase_items` (`purchase_id`);--> statement-breakpoint
CREATE INDEX `purchase_items_product_idx` ON `purchase_items` (`product_id`);--> statement-breakpoint
CREATE TABLE `purchases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`purchase_no` text NOT NULL,
	`supplier_id` integer NOT NULL,
	`supplier_invoice_no` text,
	`invoice_date` text NOT NULL,
	`due_date` text,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`subtotal` integer DEFAULT 0 NOT NULL,
	`discount_total` integer DEFAULT 0 NOT NULL,
	`invoice_discount` integer DEFAULT 0 NOT NULL,
	`other_charges` integer DEFAULT 0 NOT NULL,
	`tax_total` integer DEFAULT 0 NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`paid_amount` integer DEFAULT 0 NOT NULL,
	`payment_method` text,
	`notes` text,
	`created_by` integer,
	`posted_by` integer,
	`posted_at` text,
	`voided_by` integer,
	`voided_at` text,
	`void_reason` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`posted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`voided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchases_uuid_unique` ON `purchases` (`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `purchases_purchase_no_unique` ON `purchases` (`purchase_no`);--> statement-breakpoint
CREATE INDEX `purchases_supplier_idx` ON `purchases` (`supplier_id`);--> statement-breakpoint
CREATE INDEX `purchases_date_idx` ON `purchases` (`invoice_date`);--> statement-breakpoint
CREATE INDEX `purchases_status_idx` ON `purchases` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `purchases_supplier_invoice_uq` ON `purchases` (`supplier_id`,"supplier_invoice_no" COLLATE NOCASE) WHERE "purchases"."status" = 'POSTED' AND "purchases"."supplier_invoice_no" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`role_id` integer NOT NULL,
	`permission_key` text NOT NULL,
	PRIMARY KEY(`role_id`, `permission_key`),
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`permission_key`) REFERENCES `permissions`(`key`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_system` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roles_name_unique` ON `roles` (`name`);--> statement-breakpoint
CREATE TABLE `sale_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sale_id` integer NOT NULL,
	`line_no` integer NOT NULL,
	`product_id` integer NOT NULL,
	`batch_id` integer NOT NULL,
	`product_name` text NOT NULL,
	`batch_number` text NOT NULL,
	`expiry_date` text NOT NULL,
	`pack_size` integer NOT NULL,
	`quantity` integer NOT NULL,
	`unit_price` integer DEFAULT 0 NOT NULL,
	`unit_cost` integer DEFAULT 0 NOT NULL,
	`gross_amount` integer DEFAULT 0 NOT NULL,
	`discount_amount` integer DEFAULT 0 NOT NULL,
	`tax_rate_bp` integer DEFAULT 0 NOT NULL,
	`tax_amount` integer DEFAULT 0 NOT NULL,
	`line_total` integer DEFAULT 0 NOT NULL,
	`cost_amount` integer DEFAULT 0 NOT NULL,
	`returned_quantity` integer DEFAULT 0 NOT NULL,
	`expired_override` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sale_items_qty_ck" CHECK("sale_items"."quantity" > 0),
	CONSTRAINT "sale_items_returned_ck" CHECK("sale_items"."returned_quantity" >= 0 AND "sale_items"."returned_quantity" <= "sale_items"."quantity")
);
--> statement-breakpoint
CREATE INDEX `sale_items_sale_idx` ON `sale_items` (`sale_id`);--> statement-breakpoint
CREATE INDEX `sale_items_product_idx` ON `sale_items` (`product_id`);--> statement-breakpoint
CREATE INDEX `sale_items_batch_idx` ON `sale_items` (`batch_id`);--> statement-breakpoint
CREATE TABLE `sale_payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sale_id` integer NOT NULL,
	`method` text NOT NULL,
	`amount` integer NOT NULL,
	`reference` text,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sale_payments_sale_idx` ON `sale_payments` (`sale_id`);--> statement-breakpoint
CREATE INDEX `sale_payments_method_idx` ON `sale_payments` (`method`);--> statement-breakpoint
CREATE TABLE `sale_return_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`return_id` integer NOT NULL,
	`sale_item_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`batch_id` integer NOT NULL,
	`quantity` integer NOT NULL,
	`amount` integer DEFAULT 0 NOT NULL,
	`tax_amount` integer DEFAULT 0 NOT NULL,
	`cost_amount` integer DEFAULT 0 NOT NULL,
	`restock` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`return_id`) REFERENCES `sale_returns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_item_id`) REFERENCES `sale_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sale_return_items_qty_ck" CHECK("sale_return_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE INDEX `sale_return_items_return_idx` ON `sale_return_items` (`return_id`);--> statement-breakpoint
CREATE INDEX `sale_return_items_sale_item_idx` ON `sale_return_items` (`sale_item_id`);--> statement-breakpoint
CREATE TABLE `sale_returns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`return_no` text NOT NULL,
	`sale_id` integer NOT NULL,
	`customer_id` integer,
	`cash_session_id` integer,
	`refund_method` text NOT NULL,
	`subtotal` integer DEFAULT 0 NOT NULL,
	`tax_total` integer DEFAULT 0 NOT NULL,
	`round_off` integer DEFAULT 0 NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`cost_total` integer DEFAULT 0 NOT NULL,
	`reason` text NOT NULL,
	`notes` text,
	`created_by` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cash_session_id`) REFERENCES `cash_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sale_returns_uuid_unique` ON `sale_returns` (`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `sale_returns_return_no_unique` ON `sale_returns` (`return_no`);--> statement-breakpoint
CREATE INDEX `sale_returns_sale_idx` ON `sale_returns` (`sale_id`);--> statement-breakpoint
CREATE INDEX `sale_returns_created_idx` ON `sale_returns` (`created_at`);--> statement-breakpoint
CREATE INDEX `sale_returns_session_idx` ON `sale_returns` (`cash_session_id`);--> statement-breakpoint
CREATE TABLE `sales` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`invoice_no` text NOT NULL,
	`customer_id` integer,
	`prescription_id` integer,
	`cash_session_id` integer,
	`status` text DEFAULT 'COMPLETED' NOT NULL,
	`subtotal` integer DEFAULT 0 NOT NULL,
	`discount_total` integer DEFAULT 0 NOT NULL,
	`tax_total` integer DEFAULT 0 NOT NULL,
	`round_off` integer DEFAULT 0 NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`paid_total` integer DEFAULT 0 NOT NULL,
	`cash_tendered` integer DEFAULT 0 NOT NULL,
	`change_due` integer DEFAULT 0 NOT NULL,
	`credit_amount` integer DEFAULT 0 NOT NULL,
	`cost_total` integer DEFAULT 0 NOT NULL,
	`item_count` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`created_by` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`voided_by` integer,
	`voided_at` text,
	`void_reason` text,
	`void_cash_session_id` integer,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`prescription_id`) REFERENCES `prescriptions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cash_session_id`) REFERENCES `cash_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`voided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`void_cash_session_id`) REFERENCES `cash_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_uuid_unique` ON `sales` (`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `sales_invoice_no_unique` ON `sales` (`invoice_no`);--> statement-breakpoint
CREATE INDEX `sales_created_idx` ON `sales` (`created_at`);--> statement-breakpoint
CREATE INDEX `sales_customer_idx` ON `sales` (`customer_id`);--> statement-breakpoint
CREATE INDEX `sales_session_idx` ON `sales` (`cash_session_id`);--> statement-breakpoint
CREATE INDEX `sales_user_idx` ON `sales` (`created_by`);--> statement-breakpoint
CREATE INDEX `sales_status_idx` ON `sales` (`status`);--> statement-breakpoint
CREATE TABLE `sequences` (
	`key` text PRIMARY KEY NOT NULL,
	`prefix` text NOT NULL,
	`next_value` integer DEFAULT 1 NOT NULL,
	`padding` integer DEFAULT 6 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_by` integer,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `stock_adjustments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`adjustment_no` text NOT NULL,
	`batch_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`direction` text NOT NULL,
	`reason` text NOT NULL,
	`quantity` integer NOT NULL,
	`cost_value` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`created_by` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "stock_adjustments_qty_ck" CHECK("stock_adjustments"."quantity" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stock_adjustments_uuid_unique` ON `stock_adjustments` (`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `stock_adjustments_adjustment_no_unique` ON `stock_adjustments` (`adjustment_no`);--> statement-breakpoint
CREATE INDEX `stock_adjustments_batch_idx` ON `stock_adjustments` (`batch_id`);--> statement-breakpoint
CREATE INDEX `stock_adjustments_created_idx` ON `stock_adjustments` (`created_at`);--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`batch_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`movement_type` text NOT NULL,
	`quantity` integer NOT NULL,
	`balance_after` integer NOT NULL,
	`unit_cost` integer DEFAULT 0 NOT NULL,
	`reference_type` text,
	`reference_id` integer,
	`note` text,
	`user_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stock_movements_uuid_unique` ON `stock_movements` (`uuid`);--> statement-breakpoint
CREATE INDEX `stock_movements_batch_idx` ON `stock_movements` (`batch_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `stock_movements_product_idx` ON `stock_movements` (`product_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `stock_movements_ref_idx` ON `stock_movements` (`reference_type`,`reference_id`);--> statement-breakpoint
CREATE INDEX `stock_movements_created_idx` ON `stock_movements` (`created_at`);--> statement-breakpoint
CREATE TABLE `supplier_transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`supplier_id` integer NOT NULL,
	`txn_date` text NOT NULL,
	`type` text NOT NULL,
	`amount` integer NOT NULL,
	`reference_type` text,
	`reference_id` integer,
	`description` text,
	`created_by` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `supplier_transactions_uuid_unique` ON `supplier_transactions` (`uuid`);--> statement-breakpoint
CREATE INDEX `supplier_txn_supplier_idx` ON `supplier_transactions` (`supplier_id`,`txn_date`);--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`name` text NOT NULL,
	`contact_person` text,
	`phone` text,
	`email` text,
	`address` text,
	`city` text,
	`ntn` text,
	`strn` text,
	`drug_license_no` text,
	`payment_terms_days` integer DEFAULT 0 NOT NULL,
	`opening_balance` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `suppliers_uuid_unique` ON `suppliers` (`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `suppliers_name_uq` ON `suppliers` ("name" COLLATE NOCASE);--> statement-breakpoint
CREATE TABLE `user_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`started_at` text NOT NULL,
	`last_activity_at` text NOT NULL,
	`ended_at` text,
	`end_reason` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `user_sessions_user_idx` ON `user_sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`username` text NOT NULL,
	`full_name` text NOT NULL,
	`phone` text,
	`password_hash` text NOT NULL,
	`role_id` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`must_change_password` integer DEFAULT false NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`locked_until` text,
	`last_login_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_uuid_unique` ON `users` (`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_uq` ON `users` ("username" COLLATE NOCASE);