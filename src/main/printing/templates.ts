/**
 * Print templates: pure functions (data, settings) → complete HTML documents.
 * The same HTML is used for the in-app preview, the printer and PDF export.
 */
import bwipjs from 'bwip-js/node';
import type { AppSettings } from '@shared/settings';
import type { SaleDetail, ReturnDetail } from '@shared/types/sales';
import type { CashSessionDetail } from '@shared/types/finance';
import type { PurchaseDetail } from '@shared/types/purchasing';
import type { ReportResult, ReportColumn } from '@shared/types/reports';
import { PAYMENT_METHOD_LABELS } from '@shared/types/common';
import { escapeHtml as e, formatDate, formatDateTime, formatExpiry, formatMoney, formatNumber, formatPercent, formatQty, type CurrencyFormat } from '@shared/format';

function money(s: AppSettings) {
  const c: CurrencyFormat = { ...s.currency, locale: s.locale.numberLocale };
  return (v: number | null | undefined, opts?: { symbol?: boolean }) => formatMoney(v, c, opts);
}

export function barcodeSvg(text: string, opts: { height?: number; scale?: number; includeText?: boolean; bcid?: string } = {}): string {
  try {
    return bwipjs.toSVG({
      bcid: opts.bcid ?? 'code128',
      text,
      height: opts.height ?? 9,
      scale: opts.scale ?? 2,
      includetext: opts.includeText ?? false,
      textxalign: 'center',
      textsize: 8,
    });
  } catch {
    return '';
  }
}

const BASE_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#fff;color:#0f172a;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font-family:"Segoe UI","Inter","Helvetica Neue",Arial,sans-serif}
table{border-collapse:collapse;width:100%}
.r{text-align:right}.c{text-align:center}.b{font-weight:700}.m{color:#64748b}
`;

function doc(title: string, css: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>${e(title)}</title><style>${BASE_CSS}${css}</style></head><body>${body}</body></html>`;
}

/* ───────────────────────────── Thermal receipt ───────────────────────────── */

function receiptCss(width: '58mm' | '80mm') {
  const w = width === '58mm' ? 48 : 72; // printable width in mm
  const fs = width === '58mm' ? 10.5 : 11.5;
  return `
@page{size:${width} auto;margin:0}
body{width:${w}mm;margin:0 auto;padding:3mm 0 6mm;font-size:${fs}px;line-height:1.35}
.hd{text-align:center;padding-bottom:2mm}
.logo{max-width:${w * 0.45}mm;max-height:18mm;margin:0 auto 1.5mm;display:block;filter:grayscale(1)}
.name{font-size:${fs + 4}px;font-weight:800;letter-spacing:.2px}
.tag{font-size:${fs - 1}px;color:#334155}
.sep{border-top:1px dashed #000;margin:2mm 0}
.sep2{border-top:2px solid #000;margin:2mm 0}
.meta td{padding:.2mm 0;font-size:${fs - 0.5}px}
.items td{padding:.8mm 0;vertical-align:top}
.items .nm{font-weight:600}
.items .sub{font-size:${fs - 1.5}px;color:#334155}
.tot td{padding:.4mm 0}
.grand td{font-size:${fs + 3}px;font-weight:800;padding-top:1mm}
.foot{text-align:center;font-size:${fs - 1}px;margin-top:2mm;white-space:pre-line}
.bc{text-align:center;margin-top:2mm}.bc svg{width:${w * 0.8}mm;height:10mm}
.badge{display:inline-block;border:1px solid #000;padding:0 1.5mm;font-size:${fs - 2}px;font-weight:700;margin-top:1mm}
.void{text-align:center;font-size:${fs + 6}px;font-weight:900;border:2px solid #000;padding:1mm;margin:2mm 0;letter-spacing:3px}
`;
}

function header(s: AppSettings, opts: { thermal: boolean }) {
  const ph = s.pharmacy;
  const logo = s.receipt.showLogo && ph.logo ? `<img class="logo" src="${e(ph.logo)}" alt="">` : '';
  return `<div class="hd">${opts.thermal ? logo : ''}<div class="name">${e(ph.name)}</div>${ph.tagline ? `<div class="tag">${e(ph.tagline)}</div>` : ''}
    ${ph.address ? `<div class="tag">${e(ph.address)}${ph.city ? `, ${e(ph.city)}` : ''}</div>` : ''}
    ${ph.phone ? `<div class="tag">Tel: ${e(ph.phone)}</div>` : ''}
    ${ph.licenseNo ? `<div class="tag">Drug Lic: ${e(ph.licenseNo)}</div>` : ''}
    ${s.tax.enabled && s.tax.registrationNo ? `<div class="tag">${e(s.tax.label)} Reg: ${e(s.tax.registrationNo)}</div>` : ''}</div>`;
}

export function receiptHtml(sale: SaleDetail, s: AppSettings, opts: { reprint?: boolean } = {}): string {
  const m = money(s);
  const r = s.receipt;
  const dt = s.locale.dateFormat;
  const items = sale.items
    .map((i) => {
      const qty = formatQty(i.quantity, i.packSize, i.unitName, i.packName);
      const sub = [
        `${qty} × ${m(i.unitPrice, { symbol: false })}${i.packSize > 1 ? `/${i.packName.toLowerCase()}` : ''}`,
        r.showBatch ? `B: ${e(i.batchNumber)}` : '',
        r.showExpiry ? `Exp: ${formatExpiry(i.expiryDate)}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      return `<tr><td colspan="2"><div class="nm">${e(i.productName)}</div>${r.showGeneric && i.genericName ? `<div class="sub">${e(i.genericName)}</div>` : ''}
        <div class="sub">${sub}</div>${i.discountAmount ? `<div class="sub">Discount −${m(i.discountAmount, { symbol: false })}</div>` : ''}</td>
        <td class="r b">${m(i.lineTotal, { symbol: false })}</td></tr>`;
    })
    .join('');
  const pays = sale.payments.map((p) => `<tr><td>${e(PAYMENT_METHOD_LABELS[p.method] ?? p.method)}${p.reference ? ` <span class="m">(${e(p.reference)})</span>` : ''}</td><td class="r">${m(p.amount)}</td></tr>`).join('');
  const body = `
  ${header(s, { thermal: true })}
  ${r.headerNote ? `<div class="foot" style="margin:0 0 1mm">${e(r.headerNote)}</div>` : ''}
  <div class="c b" style="letter-spacing:1px">${s.tax.enabled ? 'SALES TAX INVOICE' : 'CASH MEMO'}</div>
  ${opts.reprint ? '<div class="c"><span class="badge">DUPLICATE</span></div>' : ''}
  ${sale.status === 'VOID' ? '<div class="void">VOID</div>' : ''}
  <div class="sep"></div>
  <table class="meta">
    <tr><td>Invoice</td><td class="r b">${e(sale.invoiceNo)}</td></tr>
    <tr><td>Date</td><td class="r">${formatDateTime(sale.createdAt, dt, s.locale.timeFormat)}</td></tr>
    ${r.showCashier ? `<tr><td>Cashier</td><td class="r">${e(sale.cashierName)}</td></tr>` : ''}
    ${sale.customerName ? `<tr><td>Customer</td><td class="r">${e(sale.customerName)}</td></tr>` : ''}
    ${sale.prescriptionNo ? `<tr><td>Prescription</td><td class="r">${e(sale.prescriptionNo)}</td></tr>` : ''}
  </table>
  <div class="sep"></div>
  <table class="items">${items}</table>
  <div class="sep"></div>
  <table class="tot">
    <tr><td>Subtotal (${formatNumber(sale.items.length)} items)</td><td class="r">${m(sale.subtotal)}</td></tr>
    ${sale.discountTotal ? `<tr><td>Discount</td><td class="r">−${m(sale.discountTotal)}</td></tr>` : ''}
    ${sale.taxTotal ? `<tr><td>${e(s.tax.label)}${s.tax.mode === 'INCLUSIVE' ? ' (incl.)' : ''}</td><td class="r">${m(sale.taxTotal)}</td></tr>` : ''}
    ${sale.roundOff ? `<tr><td>Rounding</td><td class="r">${m(sale.roundOff)}</td></tr>` : ''}
  </table>
  <div class="sep2"></div>
  <table class="grand"><tr><td>TOTAL</td><td class="r">${m(sale.total)}</td></tr></table>
  <div class="sep"></div>
  <table class="tot">${pays}
    ${sale.cashTendered ? `<tr><td>Cash received</td><td class="r">${m(sale.cashTendered)}</td></tr><tr><td class="b">Change</td><td class="r b">${m(sale.changeDue)}</td></tr>` : ''}
    ${sale.creditAmount ? `<tr><td class="b">On account</td><td class="r b">${m(sale.creditAmount)}</td></tr>` : ''}
  </table>
  ${sale.returns.length ? `<div class="sep"></div><table class="tot">${sale.returns.map((x) => `<tr><td>Returned ${e(x.returnNo)}</td><td class="r">−${m(x.total)}</td></tr>`).join('')}</table>` : ''}
  <div class="sep"></div>
  ${r.footerNote ? `<div class="foot b">${e(r.footerNote)}</div>` : ''}
  ${r.returnPolicy ? `<div class="foot">${e(r.returnPolicy)}</div>` : ''}
  ${r.showBarcode ? `<div class="bc">${barcodeSvg(sale.invoiceNo)}</div>` : ''}
  <div class="foot m" style="font-size:9px">Printed ${formatDateTime(new Date(), dt, s.locale.timeFormat)}</div>`;
  return doc(`Receipt ${sale.invoiceNo}`, receiptCss(r.paperWidth), body);
}

export function returnReceiptHtml(ret: ReturnDetail, s: AppSettings): string {
  const m = money(s);
  const items = ret.items
    .map(
      (i) => `<tr><td colspan="2"><div class="nm">${e(i.productName)}</div><div class="sub">${formatQty(i.quantity, i.packSize, i.unitName, 'pack', 'units')} · B: ${e(i.batchNumber)} · ${i.restock ? 'Restocked' : 'Disposed'}</div></td><td class="r b">${m(i.amount, { symbol: false })}</td></tr>`,
    )
    .join('');
  const body = `${header(s, { thermal: true })}
  <div class="c b" style="letter-spacing:1px">SALES RETURN / REFUND</div><div class="sep"></div>
  <table class="meta">
    <tr><td>Return</td><td class="r b">${e(ret.returnNo)}</td></tr>
    <tr><td>Against invoice</td><td class="r">${e(ret.invoiceNo)}</td></tr>
    <tr><td>Date</td><td class="r">${formatDateTime(ret.createdAt, s.locale.dateFormat, s.locale.timeFormat)}</td></tr>
    <tr><td>Processed by</td><td class="r">${e(ret.createdByName)}</td></tr>
    ${ret.customerName ? `<tr><td>Customer</td><td class="r">${e(ret.customerName)}</td></tr>` : ''}
  </table><div class="sep"></div>
  <table class="items">${items}</table><div class="sep2"></div>
  <table class="grand"><tr><td>REFUND</td><td class="r">${m(ret.total)}</td></tr></table>
  <table class="tot"><tr><td>Refund method</td><td class="r">${e(PAYMENT_METHOD_LABELS[ret.refundMethod] ?? ret.refundMethod)}</td></tr><tr><td>Reason</td><td class="r">${e(ret.reason)}</td></tr></table>
  <div class="sep"></div><div class="bc">${barcodeSvg(ret.returnNo)}</div>
  <div class="foot" style="margin-top:4mm">Customer signature: ____________________</div>`;
  return doc(`Return ${ret.returnNo}`, receiptCss(s.receipt.paperWidth), body);
}

/* ─────────────────────────────── A4 documents ─────────────────────────────── */

const A4_CSS = `
@page{size:A4;margin:14mm 13mm 16mm}
body{font-size:10.5px;line-height:1.45;color:#0f172a}
.top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0f766e;padding-bottom:12px;margin-bottom:14px}
.brand{display:flex;gap:12px;align-items:center}
.brand img{max-height:54px;max-width:120px}
.brand .name{font-size:20px;font-weight:800;color:#0f172a;letter-spacing:-.2px}
.brand .tag{color:#475569;font-size:10px}
.doc-title{text-align:right}
.doc-title h1{font-size:18px;letter-spacing:2px;color:#0f766e;font-weight:800}
.doc-title .no{font-size:12px;font-weight:700;margin-top:2px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}
.box{border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px}
.box h3{font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#64748b;margin-bottom:5px}
.kv{display:grid;grid-template-columns:auto 1fr;gap:2px 12px}.kv span:nth-child(odd){color:#64748b}
table.lines th{background:#f1f5f9;color:#334155;font-size:9px;text-transform:uppercase;letter-spacing:.6px;padding:7px 8px;text-align:left;border-bottom:1px solid #cbd5e1}
table.lines td{padding:6px 8px;border-bottom:1px solid #eef2f7;vertical-align:top}
table.lines tr:nth-child(even) td{background:#fbfdff}
table.lines .r,table.lines th.r{text-align:right}
.sub{color:#64748b;font-size:9.5px}
.totals{display:flex;justify-content:flex-end;margin-top:12px}
.totals table{width:280px}
.totals td{padding:4px 8px}
.totals tr.grand td{border-top:2px solid #0f172a;font-size:14px;font-weight:800;padding-top:8px}
.words{margin-top:10px;color:#334155;font-style:italic}
.foot{margin-top:28px;display:flex;justify-content:space-between;align-items:flex-end;color:#64748b;font-size:9.5px}
.sig{border-top:1px solid #94a3b8;padding-top:4px;width:200px;text-align:center;color:#334155}
.stamp{display:inline-block;border:2px solid #b91c1c;color:#b91c1c;font-weight:900;letter-spacing:4px;padding:4px 14px;transform:rotate(-8deg);font-size:18px}
`;

function a4Header(s: AppSettings, title: string, number: string) {
  const ph = s.pharmacy;
  return `<div class="top"><div class="brand">${ph.logo ? `<img src="${e(ph.logo)}" alt="">` : ''}<div><div class="name">${e(ph.name)}</div>
    ${ph.tagline ? `<div class="tag">${e(ph.tagline)}</div>` : ''}<div class="tag">${[ph.address, ph.city].filter(Boolean).map(e).join(', ')}</div>
    <div class="tag">${[ph.phone ? `Tel ${e(ph.phone)}` : '', ph.email ? e(ph.email) : ''].filter(Boolean).join(' · ')}</div>
    <div class="tag">${[ph.licenseNo ? `Drug Lic. ${e(ph.licenseNo)}` : '', ph.ntn ? `NTN ${e(ph.ntn)}` : '', s.tax.enabled && s.tax.registrationNo ? `${e(s.tax.label)} ${e(s.tax.registrationNo)}` : ''].filter(Boolean).join(' · ')}</div></div></div>
    <div class="doc-title"><h1>${e(title)}</h1><div class="no">${e(number)}</div></div></div>`;
}

export function invoiceA4Html(sale: SaleDetail, s: AppSettings): string {
  const m = money(s);
  const dt = s.locale.dateFormat;
  const rows = sale.items
    .map(
      (i, idx) => `<tr><td>${idx + 1}</td><td><b>${e(i.productName)}</b>${i.genericName ? `<div class="sub">${e(i.genericName)}</div>` : ''}</td>
      <td>${e(i.batchNumber)}</td><td>${formatExpiry(i.expiryDate)}</td><td class="r">${formatQty(i.quantity, i.packSize, i.unitName, i.packName)}</td>
      <td class="r">${m(i.unitPrice, { symbol: false })}</td><td class="r">${i.discountAmount ? m(i.discountAmount, { symbol: false }) : '—'}</td>
      ${s.tax.enabled ? `<td class="r">${i.taxAmount ? m(i.taxAmount, { symbol: false }) : '—'}</td>` : ''}<td class="r"><b>${m(i.lineTotal, { symbol: false })}</b></td></tr>`,
    )
    .join('');
  const body = `${a4Header(s, s.tax.enabled ? s.invoice.title : 'INVOICE', sale.invoiceNo)}
  ${sale.status === 'VOID' ? '<div style="text-align:center;margin:-4px 0 10px"><span class="stamp">VOID</span></div>' : ''}
  <div class="grid"><div class="box"><h3>Bill to</h3><div style="font-size:12px;font-weight:700">${e(sale.customerName ?? s.sales.walkInLabel)}</div>
    ${sale.customerPhone ? `<div>${e(sale.customerPhone)}</div>` : ''}${sale.prescriptionNo ? `<div class="sub">Prescription ${e(sale.prescriptionNo)}</div>` : ''}</div>
    <div class="box"><h3>Invoice details</h3><div class="kv"><span>Date</span><span>${formatDateTime(sale.createdAt, dt, s.locale.timeFormat)}</span>
    <span>Cashier</span><span>${e(sale.cashierName)}</span><span>Payment</span><span>${sale.payments.map((p) => e(PAYMENT_METHOD_LABELS[p.method] ?? p.method)).join(', ')}</span></div></div></div>
  <table class="lines"><thead><tr><th>#</th><th>Item</th><th>Batch</th><th>Exp.</th><th class="r">Qty</th><th class="r">Rate / pack</th><th class="r">Discount</th>${s.tax.enabled ? `<th class="r">${e(s.tax.label)}</th>` : ''}<th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="totals"><table>
    <tr><td>Subtotal</td><td class="r">${m(sale.subtotal)}</td></tr>
    ${sale.discountTotal ? `<tr><td>Discount</td><td class="r">−${m(sale.discountTotal)}</td></tr>` : ''}
    ${sale.taxTotal ? `<tr><td>${e(s.tax.label)}${s.tax.mode === 'INCLUSIVE' ? ' (included)' : ''}</td><td class="r">${m(sale.taxTotal)}</td></tr>` : ''}
    ${sale.roundOff ? `<tr><td>Rounding</td><td class="r">${m(sale.roundOff)}</td></tr>` : ''}
    <tr class="grand"><td>Total</td><td class="r">${m(sale.total)}</td></tr>
    <tr><td>Paid</td><td class="r">${m(sale.paidTotal)}</td></tr>
    ${sale.creditAmount ? `<tr><td><b>Balance on account</b></td><td class="r"><b>${m(sale.creditAmount)}</b></td></tr>` : ''}
  </table></div>
  ${s.invoice.terms ? `<div class="box" style="margin-top:14px"><h3>Terms</h3><div style="white-space:pre-line">${e(s.invoice.terms)}</div></div>` : ''}
  <div class="foot"><div>${e(s.invoice.footer)}<br>${barcodeSvg(sale.invoiceNo, { height: 7 }).replace('<svg', '<svg style="height:28px;width:160px;margin-top:6px"')}</div><div class="sig">Authorised signature</div></div>`;
  return doc(`Invoice ${sale.invoiceNo}`, A4_CSS, body);
}

export function purchaseA4Html(p: PurchaseDetail, s: AppSettings): string {
  const m = money(s);
  const rows = p.items
    .map(
      (i) => `<tr><td>${i.lineNo}</td><td><b>${e(i.productName)}</b><div class="sub">${e(i.productCode)}</div></td><td>${e(i.batchNumber)}</td><td>${formatExpiry(i.expiryDate)}</td>
      <td class="r">${formatQty(i.quantity, i.packSize, i.unitName, i.packName)}</td><td class="r">${i.bonusQuantity ? formatQty(i.bonusQuantity, i.packSize, i.unitName, i.packName) : '—'}</td>
      <td class="r">${m(i.costPrice, { symbol: false })}</td><td class="r">${i.discountAmount ? m(i.discountAmount, { symbol: false }) : '—'}</td><td class="r">${m(i.salePrice, { symbol: false })}</td><td class="r"><b>${m(i.lineTotal, { symbol: false })}</b></td></tr>`,
    )
    .join('');
  const body = `${a4Header(s, 'PURCHASE', p.purchaseNo)}
  ${p.status === 'VOID' ? '<div style="text-align:center;margin:-4px 0 10px"><span class="stamp">VOID</span></div>' : p.status === 'DRAFT' ? '<div style="text-align:center;margin:-4px 0 10px"><span class="stamp" style="border-color:#b45309;color:#b45309">DRAFT</span></div>' : ''}
  <div class="grid"><div class="box"><h3>Supplier</h3><div style="font-size:12px;font-weight:700">${e(p.supplierName)}</div><div class="sub">Balance ${m(p.supplierBalance)}</div></div>
  <div class="box"><h3>Document</h3><div class="kv"><span>Supplier invoice</span><span>${e(p.supplierInvoiceNo ?? '—')}</span><span>Invoice date</span><span>${formatDate(p.invoiceDate, s.locale.dateFormat)}</span>
  <span>Status</span><span>${e(p.status)}</span><span>Posted by</span><span>${e(p.postedByName ?? '—')}</span></div></div></div>
  <table class="lines"><thead><tr><th>#</th><th>Product</th><th>Batch</th><th>Exp.</th><th class="r">Qty</th><th class="r">Bonus</th><th class="r">Cost / pack</th><th class="r">Disc.</th><th class="r">MRP / pack</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="totals"><table><tr><td>Gross</td><td class="r">${m(p.subtotal)}</td></tr><tr><td>Line discounts</td><td class="r">−${m(p.discountTotal)}</td></tr>
  ${p.taxTotal ? `<tr><td>Tax</td><td class="r">${m(p.taxTotal)}</td></tr>` : ''}${p.invoiceDiscount ? `<tr><td>Invoice discount</td><td class="r">−${m(p.invoiceDiscount)}</td></tr>` : ''}
  ${p.otherCharges ? `<tr><td>Other charges</td><td class="r">${m(p.otherCharges)}</td></tr>` : ''}<tr class="grand"><td>Total</td><td class="r">${m(p.total)}</td></tr><tr><td>Paid at posting</td><td class="r">${m(p.paidAmount)}</td></tr></table></div>
  <div class="foot"><div>Printed ${formatDateTime(new Date(), s.locale.dateFormat, s.locale.timeFormat)}</div><div class="sig">Received by</div></div>`;
  return doc(`Purchase ${p.purchaseNo}`, A4_CSS, body);
}

export function cashSessionHtml(cs: CashSessionDetail, s: AppSettings, format: 'receipt' | 'a4'): string {
  const m = money(s);
  const x = cs.summary;
  const line = (label: string, value: number, sign = '') => `<tr><td>${e(label)}</td><td class="r">${sign}${m(value)}</td></tr>`;
  const table = `<table class="tot">
    ${line('Opening float', x.openingCash)}
    ${line('Cash sales', x.cashSales, '+')}
    ${x.customerReceipts ? line('Customer receipts', x.customerReceipts, '+') : ''}
    ${x.adjustmentsIn ? line('Cash in', x.adjustmentsIn, '+') : ''}
    ${x.cashRefunds ? line('Cash refunds', x.cashRefunds, '−') : ''}
    ${x.cashExpenses ? line('Expenses', x.cashExpenses, '−') : ''}
    ${x.supplierPayments ? line('Supplier payments', x.supplierPayments, '−') : ''}
    ${x.adjustmentsOut ? line('Cash out', x.adjustmentsOut, '−') : ''}
    ${x.voidReversals ? line('Voided sales', x.voidReversals, '−') : ''}
  </table>`;
  const recon = `<table class="tot"><tr class="b"><td>Expected cash</td><td class="r">${m(cs.status === 'CLOSED' ? cs.expectedCash : x.expectedCash)}</td></tr>
    ${cs.countedCash !== null ? `<tr><td>Counted cash</td><td class="r">${m(cs.countedCash)}</td></tr><tr class="b"><td>Variance</td><td class="r">${m(cs.variance, {})}</td></tr>` : ''}</table>`;
  const other = `<table class="tot">${x.nonCash.map((n) => line(PAYMENT_METHOD_LABELS[n.method] ?? n.method, n.amount)).join('')}${x.creditSales ? line('Credit sales', x.creditSales) : ''}
    ${line(`Sales (${x.salesCount} invoices)`, x.salesTotal)}${x.returnsCount ? line(`Returns (${x.returnsCount})`, x.returnsTotal) : ''}</table>`;
  const denoms = cs.denominations
    ? `<table class="tot">${Object.entries(cs.denominations)
        .filter(([, n]) => n > 0)
        .sort((a, b) => Number(b[0]) - Number(a[0]))
        .map(([d, n]) => `<tr><td>${formatNumber(Number(d))} × ${n}</td><td class="r">${m(Number(d) * 100 * n)}</td></tr>`)
        .join('')}</table>`
    : '';
  const meta = `<table class="meta"><tr><td>Shift</td><td class="r b">${e(cs.sessionNo)}</td></tr><tr><td>Opened</td><td class="r">${formatDateTime(cs.openedAt, s.locale.dateFormat, s.locale.timeFormat)} · ${e(cs.openedByName)}</td></tr>
    ${cs.closedAt ? `<tr><td>Closed</td><td class="r">${formatDateTime(cs.closedAt, s.locale.dateFormat, s.locale.timeFormat)} · ${e(cs.closedByName)}</td></tr>` : '<tr><td>Status</td><td class="r b">OPEN (interim)</td></tr>'}</table>`;
  if (format === 'receipt') {
    return doc(`Shift ${cs.sessionNo}`, receiptCss(s.receipt.paperWidth), `${header(s, { thermal: true })}<div class="c b">CASH CLOSING REPORT</div><div class="sep"></div>${meta}<div class="sep"></div>${table}<div class="sep2"></div>${recon}<div class="sep"></div><div class="b">Other takings</div>${other}${denoms ? `<div class="sep"></div><div class="b">Denominations</div>${denoms}` : ''}${cs.closingNotes ? `<div class="sep"></div><div class="foot">${e(cs.closingNotes)}</div>` : ''}<div class="foot" style="margin-top:6mm">Signature: ____________________</div>`);
  }
  const css = `${A4_CSS}.tot td{padding:5px 8px;border-bottom:1px solid #eef2f7}.tot .b td{font-weight:800}.meta td{padding:3px 0}.meta{margin-bottom:10px}`;
  return doc(`Shift ${cs.sessionNo}`, css, `${a4Header(s, 'CASH CLOSING', cs.sessionNo)}${meta}<div class="grid"><div class="box"><h3>Drawer movement</h3>${table}</div><div class="box"><h3>Reconciliation</h3>${recon}<h3 style="margin-top:12px">Other takings</h3>${other}</div></div>${denoms ? `<div class="box"><h3>Denomination count</h3>${denoms}</div>` : ''}<div class="foot"><div>${e(cs.closingNotes ?? '')}</div><div class="sig">Cashier / Manager</div></div>`);
}

/* ─────────────────────────────── Labels ─────────────────────────────── */

export interface LabelData {
  name: string;
  strength: string | null;
  code: string;
  barcode: string | null;
  price: number;
  batchNumber: string | null;
  expiryDate: string | null;
  copies: number;
}

export function labelsHtml(labels: LabelData[], s: AppSettings, layout: '38x25' | '50x25' | 'a4-40', showPrice: boolean): string {
  const m = money(s);
  const one = (l: LabelData) => {
    const code = l.barcode || l.code;
    const isEan = /^\d{13}$/.test(code);
    return `<div class="lbl"><div class="ph">${e(s.pharmacy.name)}</div><div class="nm">${e(l.name)}${l.strength ? ` ${e(l.strength)}` : ''}</div>
      <div class="bc">${barcodeSvg(code, { height: 6, bcid: isEan ? 'ean13' : 'code128' })}</div><div class="cd">${e(code)}</div>
      <div class="ft">${showPrice ? `<b>${m(l.price)}</b>` : ''}${l.batchNumber ? `<span>B:${e(l.batchNumber)}${l.expiryDate ? ` E:${formatExpiry(l.expiryDate)}` : ''}</span>` : ''}</div></div>`;
  };
  const all = labels.flatMap((l) => Array.from({ length: l.copies }, () => one(l))).join('');
  const css =
    layout === 'a4-40'
      ? `@page{size:A4;margin:10mm 7mm}body{display:grid;grid-template-columns:repeat(4,1fr);gap:0;font-size:8px}.lbl{height:27.2mm;padding:1.5mm 2mm;border:.2mm dashed #ddd;overflow:hidden}`
      : `@page{size:${layout === '38x25' ? '38mm 25mm' : '50mm 25mm'};margin:0}body{font-size:7.5px}.lbl{width:${layout === '38x25' ? 38 : 50}mm;height:25mm;padding:1.2mm 1.6mm;page-break-after:always;overflow:hidden}`;
  return doc(
    'Labels',
    `${css}.ph{font-size:6px;color:#475569;text-transform:uppercase;letter-spacing:.4px;white-space:nowrap;overflow:hidden}.nm{font-weight:700;font-size:8.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.bc svg{width:100%;height:9mm}.cd{text-align:center;font-size:6.5px;letter-spacing:.8px}.ft{display:flex;justify-content:space-between;align-items:baseline;font-size:7px}.ft b{font-size:9px}`,
    all,
  );
}

/* ─────────────────────────────── Reports ─────────────────────────────── */

function cell(c: ReportColumn, row: Record<string, unknown>, s: AppSettings): string {
  const v = row[c.key];
  if (v === null || v === undefined || v === '') return '<span class="m">—</span>';
  switch (c.type) {
    case 'money':
      return formatMoney(Number(v), { ...s.currency, locale: s.locale.numberLocale }, { symbol: false });
    case 'number':
      return formatNumber(Number(v), Number.isInteger(Number(v)) ? 0 : 1, s.locale.numberLocale);
    case 'qty':
      return c.packKey ? formatQty(Number(v), Number(row[c.packKey] ?? 1), 'unit', 'pack') : formatNumber(Number(v));
    case 'percent':
      return formatPercent(Number(v));
    case 'date':
      return formatDate(String(v), s.locale.dateFormat);
    case 'datetime':
      return formatDateTime(String(v), s.locale.dateFormat, s.locale.timeFormat);
    default:
      return e(v);
  }
}

export function reportHtml(r: ReportResult, s: AppSettings, user: string): string {
  const landscape = r.columns.length > 7;
  const m = money(s);
  const summary = r.summary?.length
    ? `<div class="sum">${r.summary
        .map((x) => `<div class="card"><div class="lab">${e(x.label)}</div><div class="val">${x.value === null ? '—' : x.type === 'money' ? m(x.value) : x.type === 'percent' ? formatPercent(x.value) : formatNumber(x.value)}</div></div>`)
        .join('')}</div>`
    : '';
  const body = r.statement
    ? `<table class="st">${r.statement
        .map((l) => `<tr class="lv${l.level} ${l.emphasis ?? ''}"><td>${e(l.label)}${l.note ? ` <span class="m">(${e(l.note)})</span>` : ''}</td><td class="r">${l.value === null ? '' : m(l.value)}</td></tr>`)
        .join('')}</table>`
    : `<table class="lines"><thead><tr>${r.columns.map((c) => `<th class="${c.align === 'right' ? 'r' : ''}">${e(c.label)}</th>`).join('')}</tr></thead>
       <tbody>${r.rows.map((row) => `<tr>${r.columns.map((c) => `<td class="${c.align === 'right' ? 'r' : ''}">${cell(c, row, s)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${r.columns.length}" class="c m" style="padding:20px">No data for the selected period</td></tr>`}</tbody>
       ${r.totals ? `<tfoot><tr>${r.columns.map((c) => `<td class="${c.align === 'right' ? 'r' : ''}">${r.totals![c.key] !== undefined ? cell(c, r.totals as Record<string, unknown>, s) : ''}</td>`).join('')}</tr></tfoot>` : ''}</table>`;
  const css = `${A4_CSS}@page{size:A4 ${landscape ? 'landscape' : 'portrait'};margin:12mm 10mm 14mm}
  body{font-size:9.5px}.sum{display:flex;gap:10px;margin-bottom:12px}.card{flex:1;border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px}.lab{font-size:8.5px;color:#64748b;text-transform:uppercase;letter-spacing:.6px}.val{font-size:14px;font-weight:800;margin-top:2px}
  table.lines td{padding:4px 6px}table.lines th{padding:6px}table.lines tfoot td{font-weight:800;border-top:2px solid #0f172a;background:#f8fafc}
  .st td{padding:6px 8px;border-bottom:1px solid #eef2f7}.st .lv1 td:first-child{padding-left:22px}.st .lv2 td:first-child{padding-left:40px;color:#475569}.st .total td{font-weight:800;border-top:1px solid #0f172a}.st .grand td{font-weight:900;font-size:13px;border-top:2px solid #0f172a;border-bottom:3px double #0f172a}.st .muted td{color:#64748b}
  .notes{margin-top:12px;color:#64748b;font-size:9px}.notes li{margin-left:14px}`;
  const html = `${a4Header(s, r.title.toUpperCase(), r.subtitle)}${summary}${body}
  ${r.notes?.length ? `<ul class="notes">${r.notes.map((n) => `<li>${e(n)}</li>`).join('')}</ul>` : ''}
  <div class="foot"><div>Generated ${formatDateTime(r.generatedAt, s.locale.dateFormat, s.locale.timeFormat)} by ${e(user)} · PharmaDesk</div><div></div></div>`;
  return doc(r.title, css, html);
}

export function testPageHtml(s: AppSettings, target: 'receipt' | 'a4'): string {
  if (target === 'receipt') {
    return doc('Test', receiptCss(s.receipt.paperWidth), `${header(s, { thermal: true })}<div class="c b">PRINTER TEST</div><div class="sep"></div><div class="c">If you can read this clearly, the receipt printer is configured correctly.</div><div class="sep"></div><div class="bc">${barcodeSvg('TEST-123456')}</div><div class="foot">${formatDateTime(new Date())}</div>`);
  }
  return doc('Test', A4_CSS, `${a4Header(s, 'TEST PAGE', formatDate(new Date()))}<p style="font-size:13px">This A4 test page confirms that invoices and reports print correctly.</p>`);
}
