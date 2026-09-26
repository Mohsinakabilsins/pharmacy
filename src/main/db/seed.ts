/**
 * Sample data for demonstration and testing. Everything is clearly fictional: brand names,
 * manufacturers, suppliers and customers are invented. Data is generated through the real
 * services with a back-dated clock, so batches, movements, ledgers and cash shifts are all
 * internally consistent.
 */
import type { ServiceContext } from '../core/context';
import { get } from '../core/context';
import { overrides } from '../core/overrides';
import { updateSettingsSection } from '../core/settings';
import { addDays, toLocalDate } from '@shared/dates';
import { ProductSaveSchema } from '@shared/schemas/catalog';
import { CustomerSaveSchema } from '@shared/schemas/customers';
import { PurchaseDraftSchema, SupplierSaveSchema } from '@shared/schemas/purchasing';
import { SaleCompleteSchema } from '@shared/schemas/sales';
import { saveCategory, saveManufacturer, saveProduct } from '../modules/catalog/catalog.service';
import { saveSupplier } from '../modules/purchasing/suppliers.service';
import { postPurchase, savePurchaseDraft } from '../modules/purchasing/purchases.service';
import { saveCustomer, savePrescription } from '../modules/customers/customers.service';
import { openCashSession, closeCashSession, currentCashSession } from '../modules/finance/cash.service';
import { buildQuote, completeSale } from '../modules/sales/sales.service';
import { createReturn } from '../modules/sales/returns.service';
import { createExpense } from '../modules/finance/expenses.service';
import { createCustomerPayment, createSupplierPayment } from '../modules/finance/payments.service';
import { adjustStock, productBatches } from '../modules/inventory/inventory.service';

/** EAN-13 with a valid check digit (for realistic, scannable sample barcodes). */
export function ean13(first12: string): string {
  const digits = first12.padStart(12, '0').slice(0, 12).split('').map(Number);
  const sum = digits.reduce((s, d, i) => s + d * (i % 2 === 0 ? 1 : 3), 0);
  return `${digits.join('')}${(10 - (sum % 10)) % 10}`;
}

/** Deterministic PRNG so demo data is reproducible. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface DemoProduct {
  brand: string;
  generic: string;
  strength: string;
  form: string;
  pack: number;
  unit: string;
  packName: string;
  price: number; // Rs per pack
  cat: string;
  rx?: boolean;
  controlled?: boolean;
  loose?: boolean;
  popularity: number; // relative sales weight
  storage?: string;
}

const CATEGORIES = ['Analgesics', 'Antibiotics', 'Gastro-intestinal', 'Cardiovascular', 'Diabetes', 'Respiratory', 'Vitamins & Supplements', 'Dermatology', 'Antihistamines', 'Neurology', 'Ophthalmic', 'Baby Care', 'Medical Devices', 'Surgical'];
const MANUFACTURERS = ['Demo Pharma Labs', 'Sample Healthcare Ltd', 'Crescent Demo Pharmaceuticals', 'Indus Sample Labs', 'Northwind Pharma (Demo)', 'Placebo Life Sciences', 'Evergreen Test Pharma'];

const PRODUCTS: DemoProduct[] = [
  { brand: 'Calmol', generic: 'Paracetamol', strength: '500 mg', form: 'Tablet', pack: 20, unit: 'Tablet', packName: 'Box', price: 60, cat: 'Analgesics', loose: true, popularity: 30 },
  { brand: 'Calmol Extra', generic: 'Paracetamol + Caffeine', strength: '500/65 mg', form: 'Tablet', pack: 20, unit: 'Tablet', packName: 'Box', price: 95, cat: 'Analgesics', loose: true, popularity: 14 },
  { brand: 'Calmol Syrup', generic: 'Paracetamol', strength: '120 mg/5 ml', form: 'Syrup', pack: 1, unit: 'Bottle', packName: 'Bottle', price: 110, cat: 'Analgesics', popularity: 12 },
  { brand: 'Ibuzen', generic: 'Ibuprofen', strength: '400 mg', form: 'Tablet', pack: 30, unit: 'Tablet', packName: 'Box', price: 145, cat: 'Analgesics', loose: true, popularity: 12 },
  { brand: 'Ibuzen Kids', generic: 'Ibuprofen', strength: '100 mg/5 ml', form: 'Suspension', pack: 1, unit: 'Bottle', packName: 'Bottle', price: 135, cat: 'Analgesics', popularity: 8 },
  { brand: 'Diclosam', generic: 'Diclofenac Sodium', strength: '50 mg', form: 'Tablet', pack: 20, unit: 'Tablet', packName: 'Box', price: 120, cat: 'Analgesics', loose: true, rx: true, popularity: 9 },
  { brand: 'Diclosam Gel', generic: 'Diclofenac Diethylamine', strength: '1%', form: 'Gel', pack: 1, unit: 'Tube', packName: 'Tube', price: 240, cat: 'Analgesics', popularity: 5 },
  { brand: 'Naprexa', generic: 'Naproxen', strength: '500 mg', form: 'Tablet', pack: 20, unit: 'Tablet', packName: 'Box', price: 210, cat: 'Analgesics', loose: true, rx: true, popularity: 3 },
  { brand: 'Amoxidem', generic: 'Amoxicillin', strength: '500 mg', form: 'Capsule', pack: 20, unit: 'Capsule', packName: 'Box', price: 280, cat: 'Antibiotics', loose: true, rx: true, popularity: 9 },
  { brand: 'Amoxidem Susp.', generic: 'Amoxicillin', strength: '250 mg/5 ml', form: 'Suspension', pack: 1, unit: 'Bottle', packName: 'Bottle', price: 165, cat: 'Antibiotics', rx: true, popularity: 5 },
  { brand: 'Clavusam', generic: 'Amoxicillin + Clavulanic acid', strength: '625 mg', form: 'Tablet', pack: 6, unit: 'Tablet', packName: 'Box', price: 395, cat: 'Antibiotics', loose: true, rx: true, popularity: 8 },
  { brand: 'Azithro-D', generic: 'Azithromycin', strength: '500 mg', form: 'Tablet', pack: 6, unit: 'Tablet', packName: 'Box', price: 420, cat: 'Antibiotics', loose: true, rx: true, popularity: 7 },
  { brand: 'Ciprodem', generic: 'Ciprofloxacin', strength: '500 mg', form: 'Tablet', pack: 10, unit: 'Tablet', packName: 'Box', price: 310, cat: 'Antibiotics', loose: true, rx: true, popularity: 5 },
  { brand: 'Cefixa', generic: 'Cefixime', strength: '400 mg', form: 'Capsule', pack: 5, unit: 'Capsule', packName: 'Box', price: 540, cat: 'Antibiotics', loose: true, rx: true, popularity: 5 },
  { brand: 'Metrozol', generic: 'Metronidazole', strength: '400 mg', form: 'Tablet', pack: 20, unit: 'Tablet', packName: 'Box', price: 95, cat: 'Antibiotics', loose: true, rx: true, popularity: 5 },
  { brand: 'Omepra-S', generic: 'Omeprazole', strength: '20 mg', form: 'Capsule', pack: 14, unit: 'Capsule', packName: 'Box', price: 245, cat: 'Gastro-intestinal', loose: true, popularity: 14 },
  { brand: 'Esomez', generic: 'Esomeprazole', strength: '40 mg', form: 'Capsule', pack: 14, unit: 'Capsule', packName: 'Box', price: 385, cat: 'Gastro-intestinal', loose: true, popularity: 8 },
  { brand: 'Antacid Plus', generic: 'Aluminium + Magnesium Hydroxide', strength: '200 ml', form: 'Suspension', pack: 1, unit: 'Bottle', packName: 'Bottle', price: 190, cat: 'Gastro-intestinal', popularity: 8 },
  { brand: 'ORS Sample', generic: 'Oral Rehydration Salts', strength: '20.5 g', form: 'Sachet', pack: 10, unit: 'Sachet', packName: 'Box', price: 150, cat: 'Gastro-intestinal', loose: true, popularity: 12 },
  { brand: 'Loperex', generic: 'Loperamide', strength: '2 mg', form: 'Capsule', pack: 10, unit: 'Capsule', packName: 'Box', price: 85, cat: 'Gastro-intestinal', loose: true, popularity: 5 },
  { brand: 'Domperi', generic: 'Domperidone', strength: '10 mg', form: 'Tablet', pack: 30, unit: 'Tablet', packName: 'Box', price: 160, cat: 'Gastro-intestinal', loose: true, popularity: 5 },
  { brand: 'Amlosam', generic: 'Amlodipine', strength: '5 mg', form: 'Tablet', pack: 20, unit: 'Tablet', packName: 'Box', price: 220, cat: 'Cardiovascular', loose: true, rx: true, popularity: 8 },
  { brand: 'Losartem', generic: 'Losartan Potassium', strength: '50 mg', form: 'Tablet', pack: 20, unit: 'Tablet', packName: 'Box', price: 340, cat: 'Cardiovascular', loose: true, rx: true, popularity: 6 },
  { brand: 'Atorvex', generic: 'Atorvastatin', strength: '20 mg', form: 'Tablet', pack: 10, unit: 'Tablet', packName: 'Box', price: 295, cat: 'Cardiovascular', loose: true, rx: true, popularity: 6 },
  { brand: 'Cardiasp', generic: 'Aspirin', strength: '75 mg', form: 'Tablet', pack: 30, unit: 'Tablet', packName: 'Box', price: 75, cat: 'Cardiovascular', loose: true, popularity: 9 },
  { brand: 'Bisopro', generic: 'Bisoprolol', strength: '5 mg', form: 'Tablet', pack: 30, unit: 'Tablet', packName: 'Box', price: 380, cat: 'Cardiovascular', loose: true, rx: true, popularity: 3 },
  { brand: 'Glucomet', generic: 'Metformin', strength: '500 mg', form: 'Tablet', pack: 50, unit: 'Tablet', packName: 'Box', price: 190, cat: 'Diabetes', loose: true, rx: true, popularity: 10 },
  { brand: 'Glucomet XR', generic: 'Metformin ER', strength: '1000 mg', form: 'Tablet', pack: 30, unit: 'Tablet', packName: 'Box', price: 360, cat: 'Diabetes', loose: true, rx: true, popularity: 5 },
  { brand: 'Glimsam', generic: 'Glimepiride', strength: '2 mg', form: 'Tablet', pack: 20, unit: 'Tablet', packName: 'Box', price: 260, cat: 'Diabetes', loose: true, rx: true, popularity: 5 },
  { brand: 'Sitaglin', generic: 'Sitagliptin', strength: '50 mg', form: 'Tablet', pack: 14, unit: 'Tablet', packName: 'Box', price: 890, cat: 'Diabetes', loose: true, rx: true, popularity: 3 },
  { brand: 'InsuDemo 70/30', generic: 'Insulin (Human) Premix', strength: '100 IU/ml', form: 'Injection', pack: 1, unit: 'Vial', packName: 'Vial', price: 1450, cat: 'Diabetes', rx: true, popularity: 3, storage: 'Refrigerate 2–8 °C' },
  { brand: 'Glucostrip Sample', generic: 'Blood glucose test strips', strength: '50 strips', form: 'Device', pack: 1, unit: 'Pack', packName: 'Pack', price: 1850, cat: 'Medical Devices', popularity: 3 },
  { brand: 'Salbudem Inhaler', generic: 'Salbutamol', strength: '100 mcg/dose', form: 'Inhaler', pack: 1, unit: 'Inhaler', packName: 'Inhaler', price: 420, cat: 'Respiratory', rx: true, popularity: 5 },
  { brand: 'Montesam', generic: 'Montelukast', strength: '10 mg', form: 'Tablet', pack: 14, unit: 'Tablet', packName: 'Box', price: 480, cat: 'Respiratory', loose: true, rx: true, popularity: 5 },
  { brand: 'Coughex', generic: 'Dextromethorphan + Guaifenesin', strength: '120 ml', form: 'Syrup', pack: 1, unit: 'Bottle', packName: 'Bottle', price: 175, cat: 'Respiratory', popularity: 9 },
  { brand: 'Bromhex', generic: 'Bromhexine', strength: '4 mg/5 ml', form: 'Syrup', pack: 1, unit: 'Bottle', packName: 'Bottle', price: 140, cat: 'Respiratory', popularity: 6 },
  { brand: 'Cetrizem', generic: 'Cetirizine', strength: '10 mg', form: 'Tablet', pack: 10, unit: 'Tablet', packName: 'Box', price: 90, cat: 'Antihistamines', loose: true, popularity: 12 },
  { brand: 'Loratex', generic: 'Loratadine', strength: '10 mg', form: 'Tablet', pack: 10, unit: 'Tablet', packName: 'Box', price: 110, cat: 'Antihistamines', loose: true, popularity: 6 },
  { brand: 'Fexosam', generic: 'Fexofenadine', strength: '120 mg', form: 'Tablet', pack: 10, unit: 'Tablet', packName: 'Box', price: 285, cat: 'Antihistamines', loose: true, popularity: 5 },
  { brand: 'Chlorphen', generic: 'Chlorpheniramine', strength: '4 mg', form: 'Tablet', pack: 100, unit: 'Tablet', packName: 'Jar', price: 250, cat: 'Antihistamines', loose: true, popularity: 3 },
  { brand: 'VitaDemo C', generic: 'Ascorbic acid', strength: '500 mg', form: 'Tablet', pack: 30, unit: 'Tablet', packName: 'Bottle', price: 320, cat: 'Vitamins & Supplements', loose: false, popularity: 6 },
  { brand: 'Calci-D Sample', generic: 'Calcium + Vitamin D3', strength: '600 mg/400 IU', form: 'Tablet', pack: 30, unit: 'Tablet', packName: 'Bottle', price: 520, cat: 'Vitamins & Supplements', loose: false, popularity: 7 },
  { brand: 'Neurovit-S', generic: 'Vitamin B1 + B6 + B12', strength: '100/200/0.2 mg', form: 'Tablet', pack: 30, unit: 'Tablet', packName: 'Box', price: 410, cat: 'Vitamins & Supplements', loose: true, popularity: 6 },
  { brand: 'Ferrosam', generic: 'Iron + Folic acid', strength: '150/0.5 mg', form: 'Capsule', pack: 30, unit: 'Capsule', packName: 'Box', price: 275, cat: 'Vitamins & Supplements', loose: true, popularity: 5 },
  { brand: 'MultiVita Kids', generic: 'Multivitamin', strength: '120 ml', form: 'Syrup', pack: 1, unit: 'Bottle', packName: 'Bottle', price: 360, cat: 'Vitamins & Supplements', popularity: 4 },
  { brand: 'D-Sun 200K', generic: 'Cholecalciferol', strength: '200,000 IU', form: 'Injection', pack: 1, unit: 'Ampoule', packName: 'Ampoule', price: 180, cat: 'Vitamins & Supplements', popularity: 4 },
  { brand: 'Fusiderm', generic: 'Fusidic acid', strength: '2%', form: 'Cream', pack: 1, unit: 'Tube', packName: 'Tube', price: 310, cat: 'Dermatology', rx: true, popularity: 4 },
  { brand: 'Clotrisam', generic: 'Clotrimazole', strength: '1%', form: 'Cream', pack: 1, unit: 'Tube', packName: 'Tube', price: 185, cat: 'Dermatology', popularity: 5 },
  { brand: 'Hydrocort-S', generic: 'Hydrocortisone', strength: '1%', form: 'Ointment', pack: 1, unit: 'Tube', packName: 'Tube', price: 160, cat: 'Dermatology', rx: true, popularity: 3 },
  { brand: 'Calamine Demo', generic: 'Calamine', strength: '100 ml', form: 'Lotion', pack: 1, unit: 'Bottle', packName: 'Bottle', price: 120, cat: 'Dermatology', popularity: 4 },
  { brand: 'Alprasam', generic: 'Alprazolam', strength: '0.5 mg', form: 'Tablet', pack: 30, unit: 'Tablet', packName: 'Box', price: 180, cat: 'Neurology', loose: true, rx: true, controlled: true, popularity: 2 },
  { brand: 'Gabasam', generic: 'Gabapentin', strength: '300 mg', form: 'Capsule', pack: 20, unit: 'Capsule', packName: 'Box', price: 520, cat: 'Neurology', loose: true, rx: true, popularity: 2 },
  { brand: 'Tearsoft', generic: 'Carboxymethylcellulose', strength: '0.5% 10 ml', form: 'Drops', pack: 1, unit: 'Bottle', packName: 'Bottle', price: 290, cat: 'Ophthalmic', popularity: 4 },
  { brand: 'Optimox', generic: 'Moxifloxacin eye drops', strength: '0.5% 5 ml', form: 'Drops', pack: 1, unit: 'Bottle', packName: 'Bottle', price: 380, cat: 'Ophthalmic', rx: true, popularity: 3 },
  { brand: 'BabySoft Diapers (M)', generic: 'Baby diapers — medium', strength: '40 pcs', form: 'Baby care', pack: 1, unit: 'Pack', packName: 'Pack', price: 1650, cat: 'Baby Care', popularity: 5 },
  { brand: 'BabyGentle Wipes', generic: 'Baby wipes', strength: '80 pcs', form: 'Baby care', pack: 1, unit: 'Pack', packName: 'Pack', price: 420, cat: 'Baby Care', popularity: 5 },
  { brand: 'ThermoCheck Digital', generic: 'Digital thermometer', strength: '', form: 'Device', pack: 1, unit: 'Piece', packName: 'Piece', price: 450, cat: 'Medical Devices', popularity: 2 },
  { brand: 'BP Monitor S-200', generic: 'Automatic blood pressure monitor', strength: '', form: 'Device', pack: 1, unit: 'Piece', packName: 'Piece', price: 6900, cat: 'Medical Devices', popularity: 1 },
  { brand: 'Syringe 5 ml (Demo)', generic: 'Disposable syringe', strength: '5 ml', form: 'Surgical', pack: 100, unit: 'Piece', packName: 'Box', price: 1500, cat: 'Surgical', loose: true, popularity: 4 },
  { brand: 'Gauze Roll Sample', generic: 'Sterile gauze', strength: '10 cm', form: 'Surgical', pack: 1, unit: 'Roll', packName: 'Roll', price: 95, cat: 'Surgical', popularity: 3 },
  { brand: 'SaniHand 500', generic: 'Hand sanitiser 70% alcohol', strength: '500 ml', form: 'Personal care', pack: 1, unit: 'Bottle', packName: 'Bottle', price: 480, cat: 'Surgical', popularity: 3 },
  { brand: 'Masks 3-Ply (Demo)', generic: 'Surgical face mask', strength: '50 pcs', form: 'Surgical', pack: 50, unit: 'Piece', packName: 'Box', price: 350, cat: 'Surgical', loose: true, popularity: 3 },
];

const SUPPLIERS = [
  { name: 'Sample Medical Distributors (Pvt) Ltd', contact: 'Sales Desk (Demo)', city: 'Lahore', terms: 30, opening: 4500000 },
  { name: 'Demo Pharma Traders', contact: 'Order Booker (Demo)', city: 'Karachi', terms: 15, opening: 0 },
  { name: 'Placeholder Health Supplies', contact: 'Accounts (Demo)', city: 'Islamabad', terms: 45, opening: 1250000 },
  { name: 'Example Surgical & Devices Co.', contact: 'Showroom (Demo)', city: 'Rawalpindi', terms: 30, opening: 0 },
];

const EXPENSES: Array<[string, number, string]> = [
  ['Electricity', 1850000, 'Electricity bill (sample)'],
  ['Internet & Phone', 350000, 'Broadband & phone (sample)'],
  ['Transport', 60000, 'Delivery rickshaw (sample)'],
  ['Cleaning', 150000, 'Shop cleaning (sample)'],
  ['Stationery & Printing', 90000, 'Receipt rolls (sample)'],
  ['Maintenance', 250000, 'AC service (sample)'],
  ['Miscellaneous', 40000, 'Tea & refreshments (sample)'],
];

/** Load demo data into an empty database. */
export function loadDemoData(base: ServiceContext, opts: { days?: number; seed?: number } = {}): { loaded: boolean; message: string } {
  const existing = get<{ p: number; s: number }>(base, 'SELECT (SELECT COUNT(*) FROM products) AS p, (SELECT COUNT(*) FROM sales) AS s')!;
  if (existing.p > 0 || existing.s > 0) return { loaded: false, message: 'Sample data can only be loaded into an empty database.' };
  const rand = rng(opts.seed ?? 20260927);
  const pick = <T>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
  const days = opts.days ?? 45;
  const realNow = base.now();
  const today = toLocalDate(realNow);
  const at = (date: string, hour: number, minute = 0) => new Date(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`);
  let clock = realNow;
  const ctx: ServiceContext = { ...base, now: () => clock };
  const setClock = (d: Date) => {
    clock = d > realNow ? realNow : d;
  };

  updateSettingsSection(ctx, 'pharmacy', {
    name: 'Shifa Care Pharmacy (Sample)',
    tagline: 'Your trusted neighbourhood chemist',
    address: 'Shop 12, Sample Plaza, Main Boulevard',
    city: 'Lahore',
    phone: '042-0000000',
    licenseNo: 'DL-SAMPLE-0001',
  });

  const start = addDays(today, -days);
  setClock(at(addDays(start, -120), 10));
  const catIds = new Map<string, number>();
  for (const c of CATEGORIES) catIds.set(c, saveCategory(ctx, { name: c, description: null, isActive: true }).id);
  const manIds = MANUFACTURERS.map((m, i) => saveManufacturer(ctx, { name: m, country: 'Pakistan', phone: `042-00000${i}`, isActive: true }).id);
  const supplierIds = SUPPLIERS.map((s, i) =>
    saveSupplier(
      ctx,
      SupplierSaveSchema.parse({
        name: s.name,
        contactPerson: s.contact,
        phone: `0300-000000${i}`,
        city: s.city,
        paymentTermsDays: s.terms,
        openingBalance: s.opening,
        address: 'Sample address — not a real business',
      }),
    ).id,
  );

  const products = PRODUCTS.map((p, i) => {
    const salePaisa = p.price * 100;
    const costPaisa = Math.round(salePaisa * (0.72 + rand() * 0.12));
    const avgDailyUnits = p.popularity * (p.pack >= 20 ? 1.4 : 0.35);
    const reorder = Math.max(p.pack, Math.round((avgDailyUnits * 7) / p.pack) * p.pack);
    const detail = saveProduct(
      ctx,
      ProductSaveSchema.parse({
        barcode: ean13(`896${String(100000000 + i * 7919).slice(-9)}`),
        brandName: p.brand,
        genericName: p.generic,
        strength: p.strength,
        dosageForm: p.form,
        packSize: p.pack,
        unitName: p.unit,
        packName: p.packName,
        allowLooseSale: p.loose ?? p.pack === 1,
        requiresPrescription: !!p.rx,
        isControlled: !!p.controlled,
        categoryId: catIds.get(p.cat),
        manufacturerId: manIds[i % manIds.length],
        storageLocation: `Rack ${String.fromCharCode(65 + (i % 6))}-${1 + (i % 5)}`,
        storageCondition: p.storage ?? null,
        minStock: Math.round(reorder / 2),
        reorderLevel: reorder,
        maxStock: reorder * 4,
        defaultCostPrice: costPaisa,
        defaultSalePrice: salePaisa,
        notes: 'Sample product for demonstration',
      }),
    );
    return { ...p, id: detail.id, salePaisa, costPaisa, avgDailyUnits };
  });

  // Purchases: an initial stocking order, then periodic replenishment
  const purchaseRound = (date: string, share: number, invoice: string, opts2: { nearExpiry?: boolean; expired?: boolean } = {}) => {
    const bySupplier = new Map<number, typeof products>();
    products.forEach((p, i) => {
      if (rand() > share) return;
      const sid = supplierIds[p.cat === 'Medical Devices' || p.cat === 'Surgical' ? 3 : i % 3];
      bySupplier.set(sid, [...(bySupplier.get(sid) ?? []), p]);
    });
    let n = 0;
    for (const [supplierId, items] of bySupplier) {
      n += 1;
      setClock(at(date, 11, n * 7));
      const draft = savePurchaseDraft(
        ctx,
        PurchaseDraftSchema.parse({
          supplierId,
          supplierInvoiceNo: `${invoice}-${n}`,
          invoiceDate: date,
          invoiceDiscount: 0,
          otherCharges: rand() > 0.7 ? 50000 : 0,
          items: items.map((p) => {
            const packs = Math.max(3, Math.round((p.avgDailyUnits * (40 + rand() * 20)) / p.pack));
            const monthsToExpiry = opts2.nearExpiry && rand() > 0.5 ? 2 : 10 + Math.floor(rand() * 20);
            // stock from the "expired" round expires shortly before the demo period starts
            const exp = opts2.expired ? addDays(start, -40) : addDays(date, monthsToExpiry * 30);
            const [y, m] = exp.split('-').map(Number);
            const expiry = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
            return {
              productId: p.id,
              batchNumber: `${p.brand.replace(/[^A-Z]/gi, '').slice(0, 3).toUpperCase()}${date.slice(2, 4)}${date.slice(5, 7)}${String(Math.floor(rand() * 900 + 100))}`,
              manufactureDate: addDays(date, -60 - Math.floor(rand() * 60)),
              expiryDate: expiry,
              quantity: packs * p.pack,
              bonusQuantity: rand() > 0.8 ? p.pack : 0,
              costPrice: p.costPaisa,
              salePrice: p.salePaisa,
              discountBp: rand() > 0.6 ? 200 : 0,
            };
          }),
        }),
      );
      const total = draft.total;
      const paid = rand() > 0.5 ? Math.round(total * 0.5) : 0;
      postPurchase(ctx, { id: draft.id, paidAmount: paid, paymentMethod: paid ? 'BANK_TRANSFER' : 'CASH', paymentReference: paid ? 'IBFT-SAMPLE' : null });
    }
  };
  purchaseRound(addDays(start, -100), 0.25, 'OLD', { expired: true }); // becomes expired stock
  purchaseRound(addDays(start, -2), 1, 'INIT');
  purchaseRound(addDays(start, -1), 0.5, 'INIT2', { nearExpiry: true });

  const customers = Array.from({ length: 14 }, (_, i) =>
    saveCustomer(
      ctx,
      CustomerSaveSchema.parse({
        name: `Sample Customer ${String(i + 1).padStart(2, '0')}`,
        phone: `0300-55500${String(i).padStart(2, '0')}`,
        address: 'Sample Street — fictional',
        creditLimit: i < 5 ? 2000000 : 0,
        notes: i < 5 ? 'Monthly account (sample)' : null,
      }),
    ),
  );
  setClock(at(addDays(start, 1), 10));
  const rx = savePrescription(ctx, {
    customerId: customers[0].id,
    patientName: customers[0].name,
    patientAge: '54',
    prescriberName: 'Dr. Sample Physician',
    prescriberRegistration: 'PMDC-00000-S',
    clinic: 'Demo Family Clinic',
    prescriptionDate: addDays(start, 1),
    notes: 'Sample prescription for demonstration',
    items: [
      { productId: products.find((p) => p.brand === 'Glucomet')!.id, medicineText: 'Glucomet 500 mg', quantity: 60, instructions: '1 tablet twice daily after meals' },
      { productId: products.find((p) => p.brand === 'Amlosam')!.id, medicineText: 'Amlosam 5 mg', quantity: 30, instructions: '1 tablet at night' },
    ],
  });

  const weights = products.map((p) => p.popularity);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const weightedPick = () => {
    let r = rand() * totalWeight;
    for (let i = 0; i < products.length; i++) {
      r -= weights[i];
      if (r <= 0) return products[i];
    }
    return products[0];
  };

  const admin = base.user!;
  let salesCount = 0;
  for (let d = 0; d <= days; d++) {
    const date = addDays(start, d);
    const isToday = date === today;
    setClock(at(date, 9, 5));
    if (!currentCashSession(ctx)) openCashSession(ctx, { openingCash: 500000, notes: null });
    const dow = new Date(`${date}T12:00:00`).getDay();
    const invoices = Math.round((dow === 5 ? 18 : dow === 0 ? 14 : 24) * (0.8 + rand() * 0.4) * (isToday ? Math.min(1, (realNow.getHours() - 9) / 13) : 1));
    const minutes = Array.from({ length: Math.max(0, invoices) }, () => Math.floor(rand() * 13 * 60)).sort((a, b) => a - b);
    for (const offset of minutes) {
      const time = new Date(at(date, 9, 10).getTime() + offset * 60_000);
      if (time > realNow) break;
      setClock(time);
      const lineCount = 1 + Math.floor(rand() * rand() * 5);
      const chosen = new Map<number, (typeof products)[number]>();
      for (let k = 0; k < lineCount; k++) {
        const p = weightedPick();
        if (!p.rx || rand() > 0.4) chosen.set(p.id, p);
      }
      if (chosen.size === 0) continue;
      const customer = rand() > 0.72 ? pick(customers) : null;
      const lines = Array.from(chosen.values()).map((p, idx) => {
        const loose = (p.loose ?? p.pack === 1) && p.pack > 1 && rand() > 0.45;
        const qty = loose ? Math.max(1, Math.round(p.pack * (0.2 + rand() * 0.5))) : p.pack * (1 + (rand() > 0.85 ? 1 : 0));
        return { key: `L${idx}`, productId: p.id, quantity: qty, discount: rand() > 0.93 ? { type: 'PERCENT' as const, value: 500 } : null };
      });
      const hasControlled = Array.from(chosen.values()).some((p) => p.controlled);
      const draft = { lines, customerId: customer?.id ?? null, invoiceDiscount: null, prescriptionId: hasControlled ? rx.id : null, overrideTokens: [] as string[] };
      try {
        const q = buildQuote(ctx, SaleCompleteSchema.parse({ ...draft, payments: [{ method: 'CASH', amount: 0 }], expectedTotal: 0 })).quote;
        if (!q.canComplete || q.total <= 0) continue;
        const credit = customer && customer.creditLimit > 0 && rand() > 0.55 ? q.total : 0;
        const method = credit ? 'CREDIT' : rand() > 0.82 ? (rand() > 0.5 ? 'CARD' : 'MOBILE_WALLET') : 'CASH';
        const tendered = method === 'CASH' ? Math.ceil(q.total / 50000) * 50000 : 0;
        completeSale(
          ctx,
          SaleCompleteSchema.parse({
            ...draft,
            payments: [{ method, amount: q.total, reference: method === 'CARD' ? 'POS-SAMPLE' : null }],
            cashTendered: tendered,
            expectedTotal: q.total,
          }),
          overrides,
        );
        salesCount += 1;
      } catch {
        // stock may run out for some items — skip that bill
      }
    }

    // occasional return
    if (rand() > 0.6) {
      const recent = get<{ id: number }>(ctx, "SELECT id FROM sales WHERE status = 'COMPLETED' ORDER BY id DESC LIMIT 1 OFFSET 3");
      if (recent) {
        const item = get<{ id: number; quantity: number; returned_quantity: number }>(ctx, 'SELECT id, quantity, returned_quantity FROM sale_items WHERE sale_id = ? LIMIT 1', recent.id);
        if (item && item.quantity - item.returned_quantity > 0) {
          setClock(at(date, 19, 30));
          try {
            createReturn(ctx, { saleId: recent.id, items: [{ saleItemId: item.id, quantity: Math.max(1, Math.floor((item.quantity - item.returned_quantity) / 2)), restock: true }], refundMethod: 'CASH', reason: 'Customer changed mind (sample)', notes: null, overrideToken: null }, overrides);
          } catch {
            /* ignore */
          }
        }
      }
    }
    // expenses
    if (d % 7 === 3) {
      setClock(at(date, 13, 15));
      const [cat, amount, desc] = EXPENSES[(d / 7) % EXPENSES.length | 0];
      const catId = get<{ id: number }>(ctx, 'SELECT id FROM expense_categories WHERE name = ?', cat)!.id;
      createExpense(ctx, { expenseDate: date, categoryId: catId, amount, description: desc, paymentMethod: 'CASH', reference: null });
    }
    if (d === 5 || d === 35) {
      setClock(at(date, 12, 0));
      const catId = get<{ id: number }>(ctx, "SELECT id FROM expense_categories WHERE name = 'Rent'")!.id;
      createExpense(ctx, { expenseDate: date, categoryId: catId, amount: 8500000, description: 'Monthly shop rent (sample)', paymentMethod: 'BANK_TRANSFER', reference: 'CHQ-SAMPLE' });
      const salCat = get<{ id: number }>(ctx, "SELECT id FROM expense_categories WHERE name = 'Salaries'")!.id;
      createExpense(ctx, { expenseDate: date, categoryId: salCat, amount: 12000000, description: 'Staff salaries (sample)', paymentMethod: 'BANK_TRANSFER', reference: null });
    }
    // supplier payments & customer receipts
    if (d % 10 === 6) {
      setClock(at(date, 15, 0));
      const sid = supplierIds[(d / 10) % supplierIds.length | 0];
      const bal = get<{ b: number }>(ctx, 'SELECT COALESCE(SUM(amount), 0) AS b FROM supplier_transactions WHERE supplier_id = ?', sid)!.b;
      if (bal > 100000) createSupplierPayment(ctx, { supplierId: sid, amount: Math.round(bal * 0.6), method: 'BANK_TRANSFER', reference: 'IBFT-SAMPLE', paymentDate: date, notes: null });
    }
    if (d % 6 === 4) {
      setClock(at(date, 17, 30));
      for (const c of customers.slice(0, 5)) {
        const bal = get<{ b: number }>(ctx, 'SELECT COALESCE(SUM(amount), 0) AS b FROM customer_transactions WHERE customer_id = ?', c.id)!.b;
        if (bal > 0 && rand() > 0.5) createCustomerPayment(ctx, { customerId: c.id, amount: Math.round(bal * 0.5), method: 'CASH', reference: null, paymentDate: date, notes: null });
      }
    }
    // replenishment every ~12 days
    if (d > 0 && d % 10 === 0 && !isToday) purchaseRound(date, 0.6, `R${d}`);
    // a damaged write-off now and then
    if (d === 20) {
      setClock(at(date, 18, 0));
      const p = products[3];
      const b = productBatches(ctx, p.id).find((x) => x.quantityOnHand > p.pack && !x.isExpired);
      if (b) adjustStock(ctx, { batchId: b.id, direction: 'OUT', reason: 'DAMAGED', quantity: p.pack, notes: 'Box crushed in storage (sample)', supplierId: null, supplierCredit: 0 });
    }

    if (!isToday) {
      setClock(at(date, 22, 10));
      const cur = currentCashSession(ctx);
      if (cur) {
        const variance = rand() > 0.85 ? (rand() > 0.5 ? 5000 : -10000) : 0;
        closeCashSession(ctx, { countedCash: cur.summary.expectedCash + variance, denominations: null, notes: variance ? 'Minor difference (sample)' : null });
      }
    }
  }
  void admin;
  return { loaded: true, message: `Loaded ${products.length} sample products, ${salesCount} sample sales over ${days} days.` };
}
