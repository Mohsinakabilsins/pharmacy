export interface CustomerRow {
  id: number;
  code: string;
  name: string;
  phone: string | null;
  address: string | null;
  balance: number;
  creditLimit: number;
  totalPurchases: number;
  visitCount: number;
  lastVisit: string | null;
  isActive: boolean;
}

export interface CustomerDetail extends CustomerRow {
  notes: string | null;
  openingBalance: number;
  createdAt: string;
  prescriptionCount: number;
}

export interface CustomerHit {
  id: number;
  code: string;
  name: string;
  phone: string | null;
  balance: number;
  creditLimit: number;
}

export interface PrescriptionRow {
  id: number;
  prescriptionNo: string;
  prescriptionDate: string;
  patientName: string;
  customerId: number | null;
  customerName: string | null;
  prescriberName: string;
  clinic: string | null;
  itemCount: number;
  attachmentCount: number;
  salesCount: number;
  status: 'ACTIVE' | 'ARCHIVED';
  recordedByName: string | null;
  createdAt: string;
}

export interface PrescriptionDetail extends PrescriptionRow {
  patientAge: string | null;
  prescriberRegistration: string | null;
  notes: string | null;
  items: Array<{ id: number; productId: number | null; productName: string | null; medicineText: string; quantity: number | null; instructions: string | null }>;
  attachments: Array<{ id: number; fileName: string; mimeType: string; size: number; createdAt: string }>;
  sales: Array<{ id: number; invoiceNo: string; createdAt: string; total: number; status: string }>;
}
