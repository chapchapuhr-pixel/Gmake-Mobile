// src/services/voiceSaleService.ts
export interface SaleDraftItem {
  productId: string | null;
  productName: string | null;
  quantity: number;               // 1 by default, or spoken number
  unitPrice: number | null;
  inStock: boolean;
  stockQty: number;
  // Freeform attributes — populate whatever the seller said,
  // regardless of category. { ram: "8GB", size: "XL", color: "red", ... }
  attributes: Record<string, string>;
}

export interface SaleDraft {
  items: SaleDraftItem[];
  saleType: 'NEW_PRODUCT_SALE';
  paymentMethod: string | null;
  shopId: string | null;
}

export interface ParseSaleResult {
  draft: SaleDraft;
  transcript: string;
  needsManualReview: boolean;
  warnings: string[];
}
