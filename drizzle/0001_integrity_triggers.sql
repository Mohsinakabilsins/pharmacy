-- Integrity triggers: append-only ledgers and no hard deletes of financial / master records.
-- Corrections must be made with void / reversal entries (see docs/BUSINESS_RULES.md).
CREATE TRIGGER `trg_audit_logs_no_update` BEFORE UPDATE ON `audit_logs`
BEGIN
  SELECT RAISE(ABORT, 'PROTECTED_RECORD: audit_logs is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_audit_logs_no_delete` BEFORE DELETE ON `audit_logs`
BEGIN
  SELECT RAISE(ABORT, 'PROTECTED_RECORD: audit_logs is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_stock_movements_no_update` BEFORE UPDATE ON `stock_movements`
BEGIN
  SELECT RAISE(ABORT, 'PROTECTED_RECORD: stock_movements is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_stock_movements_no_delete` BEFORE DELETE ON `stock_movements`
BEGIN
  SELECT RAISE(ABORT, 'PROTECTED_RECORD: stock_movements is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_supplier_transactions_no_update` BEFORE UPDATE ON `supplier_transactions`
BEGIN
  SELECT RAISE(ABORT, 'PROTECTED_RECORD: supplier_transactions is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_supplier_transactions_no_delete` BEFORE DELETE ON `supplier_transactions`
BEGIN
  SELECT RAISE(ABORT, 'PROTECTED_RECORD: supplier_transactions is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_customer_transactions_no_update` BEFORE UPDATE ON `customer_transactions`
BEGIN
  SELECT RAISE(ABORT, 'PROTECTED_RECORD: customer_transactions is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_customer_transactions_no_delete` BEFORE DELETE ON `customer_transactions`
BEGIN
  SELECT RAISE(ABORT, 'PROTECTED_RECORD: customer_transactions is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_sales_no_delete` BEFORE DELETE ON `sales`
BEGIN
  SELECT RAISE(ABORT, 'PROTECTED_RECORD: sales cannot be deleted; deactivate or void instead');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_sale_items_no_delete` BEFORE DELETE ON `sale_items`
BEGIN
  SELECT RAISE(ABORT, 'PROTECTED_RECORD: sale_items cannot be deleted; deactivate or void instead');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_sale_payments_no_delete` BEFORE DELETE ON `sale_payments`
BEGIN
  SELECT RAISE(ABORT, 'PROTECTED_RECORD: sale_payments cannot be deleted; deactivate or void instead');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_sale_returns_no_delete` BEFORE DELETE ON `sale_returns`
BEGIN
  SELECT RAISE(ABORT, 'PROTECTED_RECORD: sale_returns cannot be deleted; deactivate or void instead');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_sale_return_items_no_delete` BEFORE DELETE ON `sale_return_items`
BEGIN
  SELECT RAISE(ABORT, 'PROTECTED_RECORD: sale_return_items cannot be deleted; deactivate or void instead');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_payments_no_delete` BEFORE DELETE ON `payments`
BEGIN
  SELECT RAISE(ABORT, 'PROTECTED_RECORD: payments cannot be deleted; deactivate or void instead');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_expenses_no_delete` BEFORE DELETE ON `expenses`
BEGIN
  SELECT RAISE(ABORT, 'PROTECTED_RECORD: expenses cannot be deleted; deactivate or void instead');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_cash_sessions_no_delete` BEFORE DELETE ON `cash_sessions`
BEGIN
  SELECT RAISE(ABORT, 'PROTECTED_RECORD: cash_sessions cannot be deleted; deactivate or void instead');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_cash_adjustments_no_delete` BEFORE DELETE ON `cash_adjustments`
BEGIN
  SELECT RAISE(ABORT, 'PROTECTED_RECORD: cash_adjustments cannot be deleted; deactivate or void instead');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_stock_adjustments_no_delete` BEFORE DELETE ON `stock_adjustments`
BEGIN
  SELECT RAISE(ABORT, 'PROTECTED_RECORD: stock_adjustments cannot be deleted; deactivate or void instead');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_batches_no_delete` BEFORE DELETE ON `batches`
BEGIN
  SELECT RAISE(ABORT, 'PROTECTED_RECORD: batches cannot be deleted; deactivate or void instead');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_products_no_delete` BEFORE DELETE ON `products`
BEGIN
  SELECT RAISE(ABORT, 'PROTECTED_RECORD: products cannot be deleted; deactivate or void instead');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_users_no_delete` BEFORE DELETE ON `users`
BEGIN
  SELECT RAISE(ABORT, 'PROTECTED_RECORD: users cannot be deleted; deactivate or void instead');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_suppliers_no_delete` BEFORE DELETE ON `suppliers`
BEGIN
  SELECT RAISE(ABORT, 'PROTECTED_RECORD: suppliers cannot be deleted; deactivate or void instead');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_customers_no_delete` BEFORE DELETE ON `customers`
BEGIN
  SELECT RAISE(ABORT, 'PROTECTED_RECORD: customers cannot be deleted; deactivate or void instead');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_prescriptions_no_delete` BEFORE DELETE ON `prescriptions`
BEGIN
  SELECT RAISE(ABORT, 'PROTECTED_RECORD: prescriptions cannot be deleted; deactivate or void instead');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_purchases_delete_draft_only` BEFORE DELETE ON `purchases`
WHEN OLD.status <> 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'PROTECTED_RECORD: posted or void purchases cannot be deleted; void instead');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_purchase_items_delete_draft_only` BEFORE DELETE ON `purchase_items`
WHEN (SELECT status FROM purchases WHERE id = OLD.purchase_id) <> 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'PROTECTED_RECORD: items of a posted purchase cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_purchase_items_update_draft_only` BEFORE UPDATE ON `purchase_items`
WHEN (SELECT status FROM purchases WHERE id = OLD.purchase_id) = 'VOID'
BEGIN
  SELECT RAISE(ABORT, 'PROTECTED_RECORD: items of a void purchase cannot be changed');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_sale_items_immutable` BEFORE UPDATE OF `sale_id`, `product_id`, `batch_id`, `quantity`, `unit_price`, `unit_cost`, `gross_amount`, `discount_amount`, `tax_amount`, `line_total`, `cost_amount` ON `sale_items`
BEGIN
  SELECT RAISE(ABORT, 'PROTECTED_RECORD: sale items are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_sales_amounts_immutable` BEFORE UPDATE OF `invoice_no`, `subtotal`, `discount_total`, `tax_total`, `round_off`, `total`, `paid_total`, `cost_total`, `created_by`, `created_at` ON `sales`
BEGIN
  SELECT RAISE(ABORT, 'PROTECTED_RECORD: completed sale amounts are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_sales_no_unvoid` BEFORE UPDATE OF `status` ON `sales`
WHEN OLD.status = 'VOID'
BEGIN
  SELECT RAISE(ABORT, 'PROTECTED_RECORD: a void sale cannot be reinstated');
END;
