// src/services/voiceSaleService.ts
import { CloudflareApi } from './cloudflareApi';

export interface VoiceSaleItem {
  productId: string | null;
  productName: string | null;
  quantity: number;
  unitPrice: number | null;
  inStock: boolean;
  stockQty: number;
  attributes: Record<string, string>;
}

export interface VoiceSaleResult {
  draft: {
    items: VoiceSaleItem[];
    saleType: 'NEW_PRODUCT_SALE';
    paymentMethod: null;
    shopId: string | null;
  };
  transcript: string;
  needsManualReview: boolean;
  warnings: string[];
}

export class VoiceSaleService {
  static async parseAudio(audioBlob: Blob, shopId: string | null): Promise<VoiceSaleResult> {
    const fd = new FormData();
    fd.append('audio', audioBlob, 'sale.webm');
    if (shopId) fd.append('shopId', shopId);

    const token = CloudflareApi.getToken?.() ?? '';
    const res = await fetch('/api/ai/parse-sale', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as any).error ?? `HTTP ${res.status}`);
    }
    return res.json();
  }
}
