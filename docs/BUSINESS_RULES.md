# PharmaDesk — Business Rules

These rules are implemented in the main-process services (`src/main/modules/**`) and the pure
calculation library (`src/shared/calc/**`), and are covered by the Vitest suites in `/tests`.
All amounts are integer paisa; `round()` is round-half-up to the nearest paisa.

## 1. Inventory model

1. Inventory is **PRODUCT → BATCH → STOCK MOVEMENTS**. There is no product-level quantity
   column; product stock is always the sum of its batches.
2. Every change to a batch quantity writes exactly one `stock_movements` row in the same
   transaction, with the signed quantity, resulting balance, cost, user and source document.
3. Movements and ledgers are append-only. Mistakes are corrected with a new, opposite entry
   (void / adjustment), never by editing history.
4. **Negative stock** is rejected unless *Settings → Inventory → Allow negative stock* is on.
5. A batch number is unique per product. Receiving an existing batch again adds to it (its
   expiry date must match; the cost becomes the quantity-weighted average of on-hand and
   received stock). Different batches are never merged.
6. Expiry must be after the manufacturing date, and a newly received batch must not already be
   expired (an administrator may record already-expired stock through an adjustment for
   write-off purposes only).
7. **Sellable stock** = batches with status `ACTIVE`, quantity > 0 and `expiry_date > today`.
   Expired and quarantined/recalled stock stays visible in every inventory screen and report.

## 2. Expiry

| Bucket | Rule (days = expiry_date − today) |
|---|---|
| Expired | days ≤ 0 (stock is not sold **on** its expiry date — conservative) |
| ≤ 30 days | 1 – 30 |
| 31 – 60 days | 31 – 60 |
| 61 – 90 days | 61 – 90 |
| Later | > 90 |

When a pack shows only month/year, the last day of that month is stored.
The POS highlights batches within *Settings → Inventory → Expiry warning days* (default 90).

## 3. FEFO (First Expiry, First Out)

1. When a product is added to a sale, sellable batches are ordered by `expiry_date ASC, id ASC`
   and consumed in that order until the requested quantity is covered. A line may therefore span
   several batches; each batch becomes its own `sale_items` row with its own price and cost.
2. The cashier can see every batch (number, expiry, available quantity, price) and may pick a
   specific batch manually. Picking a batch other than the FEFO choice is allowed (it is recorded).
3. **Expired batches are never auto-selected.** Selling from an expired batch requires the
   `sales.sell_expired` permission; a user without it needs a supervisor override
   (username + password of a user who has it). Every such line is flagged
   `expired_override = 1` and an `EXPIRED_STOCK_OVERRIDE` audit entry (CRITICAL) is written.
4. Quarantined / recalled batches can never be sold.

## 4. Stock status and reorder

For each active product, with `S` = sellable units on hand:

| Status | Rule |
|---|---|
| Out of stock | S = 0 |
| Low stock | 0 < S ≤ `min_stock` |
| Reorder | `min_stock` < S ≤ `reorder_level` |
| Overstock | `max_stock` > 0 and S > `max_stock` |
| OK | otherwise |

Suggested order quantity (packs) = ⌈(target − S) ÷ pack_size⌉ where target = `max_stock` if set,
otherwise 2 × `reorder_level` (minimum 1 pack). New products get the default min/reorder levels
from settings.

## 5. Pricing and sale calculation

Prices are per pack. For a line allocation of `q` units from a batch:

1. `gross = round(q × unit_price ÷ pack_size)` where `unit_price` is the batch sale price, or an
   override price (requires `sales.price_override`).
2. **Line discount** (percent or amount) is split across the line's batch rows in proportion to
   gross (largest-remainder method, so the parts sum exactly).
3. **Invoice discount** (percent or amount) is computed on Σ(gross − line discount) and split
   across all rows proportionally. Discounts above *Settings → Sales → Max discount %* need
   `sales.discount_unlimited` or a supervisor override. A discount can never exceed the amount.
4. **Tax** (if enabled), per row with `net = gross − discount`:
   * exclusive: `tax = round(net × rate ÷ 10000)`, `line_total = net + tax`
   * inclusive: `line_total = net`, `tax = net − round(net × 10000 ÷ (10000 + rate))`
5. `total = Σ line_total + round_off`, where round-off applies the optional cash rounding step
   (none / Rs 1 / Rs 5 / Rs 10) to the nearest step.
6. **Cost**: `cost_amount = round(q × batch.cost_price ÷ pack_size)` captured at the moment of sale.
7. Loose (unit) quantities are only allowed when the product allows loose sale; otherwise the
   quantity must be a multiple of the pack size.

The POS always displays a server-computed quote. On completion the main process recomputes the
quote inside the transaction and rejects the sale (`QUOTE_CHANGED`) if the total differs from
the one the cashier confirmed.

## 6. Completing a sale (atomic)

In one transaction: allocate batches (re-checking stock), insert `sales`, `sale_items`,
`sale_payments`, decrement batches with `SALE` movements, write customer ledger entry for any
credit portion, link the open cash session, issue the invoice number, write the audit entry.
Any failure rolls back everything.

Payment rules:
* Σ non-credit payments + credit amount = total.
* Cash tendered ≥ cash due; `change = tendered − cash due`.
* A credit (on-account) portion requires a customer and `sales.credit`; the customer's credit
  limit (if set) may not be exceeded without override.
* An open cash session is required to sell (*Settings → Sales → Require open shift*, default on).

## 7. Prescriptions and controlled medicines

*Settings → Sales → Prescription enforcement* = `off` · `warn` (default) · `require`.
With `require`, a sale containing a prescription-only or controlled product must be linked to a
prescription record. Controlled products always require a linked prescription when enforcement
is `warn` or `require`. The system records but never evaluates prescriptions clinically.

## 8. Returns

1. Returns are made **against an invoice**; the original sale is never modified except for the
   cached `returned_quantity` on its items.
2. Returnable quantity per sale item = `quantity − returned_quantity`.
3. Amounts are prorated cumulatively so repeated partial returns sum exactly to the line:
   `amount = round(L × (r + q) ÷ Q) − round(L × r ÷ Q)` (same for tax and cost), where `L` is the
   line total, `Q` the sold quantity, `r` the already returned and `q` the returned quantity.
   When a return completes the invoice, the invoice round-off is included so total refunds equal
   the amount paid.
4. **Restock** (default) puts the units back into the **same batch** (`SALE_RETURN` movement).
   If the batch is expired or the item is damaged, the user chooses *dispose*: a `SALE_RETURN`
   movement is followed by a `WRITE_OFF` movement so the unit is still traceable.
5. Refund methods: cash (needs an open shift), card, bank, wallet, or customer account (reduces
   the customer's balance; requires a customer).
6. A return window (days) may be configured; returns outside it need `returns.override`.

## 9. Voids

* A sale may be voided (`sales.void`) only while its cash session is still open; stock is put back
  into the original batches (`SALE_VOID` movements) and credit is reversed. Otherwise use a return.
* A posted purchase may be voided (`purchases.void`) only if every receiving batch still holds at
  least the quantity received by that purchase. Stock, supplier ledger and the linked payment are
  reversed.
* Expenses and payments are voided with a reason; closed cash sessions are never changed
  retroactively (their totals are snapshotted at closing).
* Nothing financial is ever hard-deleted. A deletion attempt on protected tables is blocked by a
  database trigger and the attempt is audit-logged.

## 10. Purchases

Per line (`qty` = paid units, `bonus` = free units):

```
gross      = round(qty × cost_price ÷ pack_size)
discount   = discount_amount or round(gross × discount_bp ÷ 10000)
tax        = round((gross − discount) × tax_rate_bp ÷ 10000)
line_total = gross − discount + tax
invoice total = Σ line_total − invoice_discount + other_charges
```

* `(other_charges − invoice_discount)` is allocated to lines in proportion to `line_total`
  (largest remainder) giving each line's landed total.
* **Landed cost per pack** = `round(landed_total × pack_size ÷ (qty + bonus))` — bonus units
  lower the unit cost, so profit on free goods is not overstated.
* Posting (DRAFT → POSTED) creates/merges batches, writes `PURCHASE` movements, adds the invoice
  total to the supplier ledger and records any amount paid as a supplier payment. Drafts can be
  edited or deleted freely; posted purchases are immutable (void + re-enter).
* The same supplier invoice number cannot be posted twice for one supplier.

## 11. Suppliers & customers ledgers

* Supplier balance = Σ `supplier_transactions.amount` (+ purchases, − payments, − voids of
  purchases, + voids of payments, ± adjustments, + opening balance). Positive = payable.
* Customer balance = Σ `customer_transactions.amount` (+ credit sales, − receipts, − returns
  credited, ± adjustments, + opening balance). Positive = receivable.
* Editing an opening balance posts an `ADJUSTMENT` for the difference (history preserved).

## 12. Cash management

A shift (cash session) is opened with an opening float and closed with a counted amount.

```
expected = opening_cash
         + cash sales (tendered − change) + cash customer receipts + cash adjustments IN
         − cash refunds − cash expenses − cash supplier payments − cash adjustments OUT
         − cash reversed by voids performed in this shift
variance = counted − expected
```

Only one shift can be open. At closing all components are snapshotted into the session
(immutable closing report). Non-cash methods are listed on the closing report for reconciliation.

## 13. Profit and financial reporting

Terminology used in all reports:

| Line | Definition |
|---|---|
| Gross sales | Σ sale item gross (non-void sales, by sale date) |
| Discounts | Σ sale item discounts |
| Net sales (excl. tax) | gross − discounts − tax for inclusive pricing (i.e. Σ line_total − tax) + round-off |
| Returns | Σ returned amounts excl. tax (by return date) |
| **Revenue** | Net sales − returns |
| **Cost of goods sold (COGS)** | Σ sale item `cost_amount` − cost of **restocked** returns |
| **Gross profit** | Revenue − COGS |
| Gross margin | Gross profit ÷ revenue |
| Inventory losses | Write-offs and negative adjustments at cost (expired, damaged, lost, disposed returns) |
| **Operating expenses** | Σ non-void expenses by expense date |
| **Net operating result** | Gross profit − inventory losses − operating expenses |

Assumptions: revenue is recognised at sale time (credit sales included, accrual basis); tax
collected is excluded from revenue; purchases are *not* expenses — they become inventory and
reach profit only through COGS when sold; supplier payments are balance-sheet movements.

## 14. Roles (defaults — all editable)

| Role | Summary |
|---|---|
| Administrator | Everything (system role; cannot be removed) |
| Pharmacist | POS, sales history, returns, products, batches, stock adjustments, expiry, prescriptions, customers, sales & inventory reports, sell-expired override |
| Cashier | POS, own sales, customers (view/create), reprint receipts |
| Inventory staff | Products, batches, stock adjustments, purchases, suppliers, expiry & reorder, inventory/purchase reports |
| Accountant | Expenses, payments, cash register view, supplier/customer ledgers, financial reports, audit log view |

## 15. Audit

Logged (with user, time, entity, description and before/after details): login, failed login,
logout, lock/unlock, product create/update/deactivate, price change, stock adjustment, sale,
sale void, return, purchase create/post/void, supplier/customer create/update, payments,
expenses, cash open/close/adjust, user create/update/reset/deactivate, role permission changes,
settings changes, backup, restore, deletion attempts, expired-stock overrides, supervisor overrides.
