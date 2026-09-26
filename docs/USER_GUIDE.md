# PharmaDesk — User Guide

PharmaDesk runs entirely on the pharmacy computer. It never needs the internet: sales,
stock, purchasing, reports, printing and backups all work offline.

---

## 1. Installing

1. Run `PharmaDesk-Setup-<version>.exe`.
2. Choose the install folder (the default is fine) and finish the wizard. A desktop
   shortcut is created.
3. Start **PharmaDesk**.

Your data is stored in `%APPDATA%\PharmaDesk\data\pharmacy.db`. Uninstalling the app
**does not delete your data**.

## 2. First sign-in

| Username | Password |
|---|---|
| `admin` | `admin123` |

You must choose a new password immediately. Then:

1. **Settings → Pharmacy profile**: enter the pharmacy name, address, phone, licence number
   and logo. These appear on receipts and invoices.
2. **Settings → Receipt / Printers**: pick the paper width (80 mm or 58 mm) and the receipt
   printer, then print a test page.
3. **Users & roles**: create an account for each staff member. Every person should sign in
   with their own account, because every action is recorded in the audit log under
   their name.
4. **Backup & restore**: choose a backup folder and run the first backup.

> **Trying it out?** On an empty database, **Settings → About → Load sample data** loads a
> fictional pharmacy with 62 products, suppliers, customers and 45 days of sales. Use a
> fresh installation for real trading.

### Default roles

| Role | Can do |
|---|---|
| Administrator | Everything, including users, settings, backup/restore and voids |
| Pharmacist | POS, returns, prescriptions, stock, expiry, overrides for discounts and Rx items |
| Cashier | POS, their own sales and shift, customers |
| Inventory staff | Products, batches, purchases, suppliers, stock adjustments |
| Accountant | Reports, expenses, payments, cash sessions (read-only for stock) |

Permissions for each role can be changed under **Users & roles → Roles & permissions**.

## 3. Daily routine

1. **Open the shift** — POS asks for the opening cash float the first time you sell.
2. **Sell** (see §4).
3. **Record expenses** paid from the drawer under **Expenses**.
4. **Close the shift** — **Cash register → Close shift**, count notes by denomination.
   PharmaDesk shows expected cash, counted cash and the variance, and prints the
   shift report.
5. **Back up** to a USB drive (**Backup & restore → Backup database…**).

## 4. Point of sale

Press **F2** from anywhere to open POS.

| Key | Action |
|---|---|
| **F2** | Focus search / scan box |
| **Enter** | Add the highlighted product (a barcode scan adds it directly) |
| **+ / −** | Change quantity of the selected line |
| **Ctrl + ↑ / ↓** | Select previous / next line |
| **Del** | Remove the selected line |
| **F4** | Choose customer |
| **F5** | Link a prescription |
| **F6** | Hold the bill · **F7** recall a held bill |
| **F9** | Take payment · **Enter** completes the sale |
| **F10** | Reprint the last receipt |
| **Ctrl + Del** | Clear the bill |
| **Ctrl + K** | Command palette · **Ctrl + L** lock the screen |

- Search by brand, generic name, strength, manufacturer, code or barcode.
- Each line can be sold by **pack** (e.g. box/strip) or by **unit** (tablet).
- The batch is chosen automatically **first-expiry-first-out (FEFO)**. You can pick a
  different batch from the batch chip. Expired batches can never be sold.
- Discounts above the configured limit, price changes and prescription-only items (when
  required) ask for a supervisor's password. The approval is recorded in the audit log.
- Payment: cash (with change calculation and quick-cash buttons), card, mobile wallet,
  bank transfer, customer credit (on account), or split between several methods.

## 5. Returns

**Returns → New return**: scan or type the invoice number, choose items and quantities,
say whether the stock is resaleable, and choose the refund method. Refunds are
proportional to what the customer actually paid (invoice discounts are shared out).
Non-resaleable returns are written off as a loss.

A completed sale is never deleted. To cancel one, an authorised user can **void** it
from **Sales history**; the stock goes back to the same batches and the void appears in
reports and the audit log.

## 6. Products and stock

- **Products**: the medicine master (brand, generic, strength, form, pack size, unit and
  pack names, category, manufacturer, barcode, price, tax, min stock, reorder level,
  shelf location, Rx / controlled flags). Print barcode labels from the product sheet.
- **Stock & batches**: every batch with expiry, quantity, cost and price.
  - **Opening stock** records stock you already had when starting to use PharmaDesk.
  - **Adjust stock** records damage, breakage, theft, count corrections, or returns to a
    supplier (with supplier credit). Every change is a stock movement with a reason.
  - **Movement ledger** shows the complete history of every unit.
  - **Verify integrity** checks that every batch quantity equals the sum of its movements.
- **Expiry**: batches grouped by expired / 30 / 60 / 90 days / later, with value at cost.
  Write off expired stock from here.
- **Reorder**: products at or below their reorder level with a suggested order quantity
  and last supplier. **Create purchase** turns the selection into a purchase draft.

## 7. Purchases and suppliers

1. **Purchases → New purchase**: choose the supplier and enter the invoice number and date.
2. Add each item with **batch number, expiry (MM/YYYY), quantity, bonus packs, cost and
   selling price**. The landed cost (after discounts, bonus and freight) is calculated
   automatically.
3. **Save draft** to finish later, or **Review & post** to receive the stock. Posting
   creates the batches and adds the amount to the supplier balance (or records the payment
   if paid now).

Supplier payments are recorded from the supplier page or **Payments**. A posted purchase
can be voided only while none of its stock has been sold.

## 8. Customers and prescriptions

- **Customers**: contact details, credit limit and balance. Credit sales increase the
  balance; **Receive payment** reduces it. The ledger lists every transaction.
- **Prescriptions**: doctor, patient, date, notes and scanned images/PDFs. Link a
  prescription to a sale with **F5** in POS.

## 9. Reports

**Reports** has 31 reports in five groups (sales, financial, inventory, purchases,
analytics): sales summary, invoice register, product/category/cashier-wise sales, payment
methods, profit & loss, expenses, cash sessions, supplier aging, customer balances,
current stock, stock valuation, low/out of stock, expiry, batch report, movement ledger,
adjustments, purchase registers and more. Every report can be filtered by date range,
printed, and exported to **Excel** or **CSV**.

Profit always uses the **actual cost of the batch sold**, not the latest purchase price.

## 10. Backup and restore

- **Backup database…** asks for a folder (e.g. a USB drive). **Backup to default folder**
  uses the configured folder.
- Every backup is verified with an integrity check and saved with a timestamped name
  (`PharmacyBackup_YYYY-MM-DD_HHmmss.db`). Existing files are never overwritten.
- **Automatic backups** run in the background (every 24 h by default) and when you close
  the app after making changes. Only automatic backups are pruned; manual backups are
  kept.
- **Restore database…**: choose a backup file. PharmaDesk shows what it contains (pharmacy
  name, last activity, number of products/sales), asks you to type `RESTORE`, saves a
  safety copy of the current data, then restores and restarts.

**Keep at least one recent backup away from the pharmacy computer.**

## 11. Security

- The screen locks automatically after inactivity (Settings → Security). **Ctrl + L**
  locks it immediately.
- Accounts are locked for a period after repeated wrong passwords.
- Passwords are stored as salted scrypt hashes, never in plain text.
- The **Audit log** records sign-ins, sales, voids, returns, price and discount overrides,
  stock adjustments, purchases, payments, settings changes, backups and restores.

## 12. Troubleshooting

| Problem | What to do |
|---|---|
| Receipt prints blank or cut off | Settings → Receipt: check paper width; Settings → Printers: choose the thermal printer and print a test page |
| "Open a shift first" | Open the shift in POS or **Cash register**, or turn off *Require an open cash shift* in Settings → Sales |
| Cannot sell a batch | It is expired, quarantined, or inside the *Block selling within* window (Settings → Inventory) |
| Forgot admin password | Another administrator can reset it from **Users & roles** |
| Computer failed | Install PharmaDesk on the new computer, sign in, and **Restore database…** from your latest backup |

---

## For developers

```bash
npm install            # Node 22.12+
npm run dev            # run with hot reload
npm test               # unit & integration tests (vitest)
npm run test:e2e       # build + offline end-to-end smoke test (Playwright + Electron)
npm run seed:demo      # load sample data into the local database
npm run dist:win       # build the Windows installer (on Windows, or Linux with wine)
```

See [`ARCHITECTURE.md`](./ARCHITECTURE.md), [`DATABASE.md`](./DATABASE.md) and
[`BUSINESS_RULES.md`](./BUSINESS_RULES.md).
