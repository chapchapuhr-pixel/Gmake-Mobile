// src/services/voiceSaleService.ts
import { CloudflareApi } from './cloudflareApi';

// ── Types (unchanged) ─────────────────────────────────────────
export interface VoiceSaleItem {
  productId: string | null;
  productName: string | null;
  quantity: number;
  unit: string | null;
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

// ── Helpers (unchanged) ───────────────────────────────────────
const numOrNull = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
};

const numOr = (v: unknown, fallback: number): number => {
  const n = numOrNull(v);
  return n === null ? fallback : n;
};

const strOrNull = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length ? s : null;
};

const attributesObject = (v: unknown): Record<string, string> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (val === null || val === undefined) continue;
    out[k] = String(val);
  }
  return out;
};

function normalizeItem(raw: any): VoiceSaleItem {
  const rawQty = numOr(raw?.quantity, 1);
  const quantity = rawQty > 0 ? rawQty : 1;

  return {
    productId: strOrNull(raw?.productId),
    productName: strOrNull(raw?.productName),
    quantity,
    unit: strOrNull(raw?.unit),
    unitPrice: numOrNull(raw?.unitPrice),
    inStock: Boolean(raw?.inStock),
    stockQty: numOr(raw?.stockQty, 0),
    attributes: attributesObject(raw?.attributes),
  };
}

function normalizeResult(raw: any): VoiceSaleResult {
  const items: VoiceSaleItem[] = Array.isArray(raw?.draft?.items)
    ? raw.draft.items.map(normalizeItem)
    : [];

  return {
    draft: {
      items,
      saleType: 'NEW_PRODUCT_SALE',
      paymentMethod: null,
      shopId: strOrNull(raw?.draft?.shopId),
    },
    transcript: typeof raw?.transcript === 'string' ? raw.transcript : '',
    needsManualReview: Boolean(raw?.needsManualReview),
    warnings: Array.isArray(raw?.warnings)
      ? raw.warnings.filter((w: unknown) => typeof w === 'string')
      : [],
  };
}

// ── Token resolution (NEW — robust fallback chain) ────────────
/**
 * Try every known way the app might have persisted the session token.
 * Returns an empty string when nothing is found — the caller must
 * decide whether that's acceptable.
 */
function resolveAuthToken(explicitToken?: string | null): string {
  // 1. Caller-provided (highest priority — set by NewSalePOS)
  if (explicitToken && explicitToken.trim()) return explicitToken.trim();

  // 2. CloudflareApi.getToken() — the standard path
  try {
    const t = (CloudflareApi as any).getToken?.();
    if (typeof t === 'string' && t.trim()) return t.trim();
  } catch {
    /* ignore — getToken may not exist on older builds */
  }

  // 3. localStorage — cover the common keys your app might use
  try {
    const keys = [
      'cf_api_token',
      'omnibiz_api_token',
      'omnibiz_active_session_v1',
      'auth_token',
      'token',
    ];
    for (const k of keys) {
      const v = localStorage.getItem(k);
      if (!v) continue;
      // If it's a JSON blob (like the session), try to extract a token
      if (v.startsWith('{')) {
        try {
          const parsed = JSON.parse(v);
          const inner =
            parsed?.token ??
            parsed?.apiToken ??
            parsed?.accessToken ??
            parsed?.session?.token;
          if (typeof inner === 'string' && inner.trim()) return inner.trim();
        } catch {
          /* not JSON, ignore */
        }
      } else if (v.trim()) {
        return v.trim();
      }
    }
  } catch {
    /* localStorage blocked (Safari private mode, etc.) */
  }

  return '';
}

// ── Service ───────────────────────────────────────────────────
export class VoiceSaleService {
  /**
   * Send recorded audio to the AI parser and receive a normalized draft.
   *
   * @param audioBlob      The recorded audio (webm/opus preferred)
   * @param shopId         Optional shop scope; when supplied, matching
   *                       is restricted to products in that shop.
   * @param explicitToken  Optional override — pass the token from
   *                       NewSalePOS if you have it handy.
   */
  static async parseAudio(
    audioBlob: Blob,
    shopId: string | null,
    explicitToken?: string | null
  ): Promise<VoiceSaleResult> {
    if (!audioBlob || audioBlob.size === 0) {
      throw new Error('No audio recorded');
    }

    const fd = new FormData();
    fd.append(
      'audio',
      audioBlob,
      audioBlob.type.includes('mp4') ? 'sale.mp4' : 'sale.webm'
    );
    if (shopId) fd.append('shopId', shopId);

    // ── Resolve token robustly ──
    const token = resolveAuthToken(explicitToken);

    // Debug log — visible in DevTools console
    if (import.meta.env.DEV) {
      console.log(
        '[voiceSale] token:',
        token ? `${token.slice(0, 8)}… (len ${token.length})` : 'EMPTY'
      );
    }

    const headers: HeadersInit = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const baseUrl = CloudflareApi.getBaseUrl().replace(/\/+$/, '');
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/api/ai/parse-sale`, {
        method: 'POST',
        headers,
        body: fd,
      });
    } catch (netErr: any) {
      throw new Error(
        netErr?.message?.includes('fetch')
          ? 'Network error — check your connection and try again'
          : netErr?.message ?? 'Could not reach the voice service'
      );
    }

    // Safe JSON parse
    const payload: any = await res
      .json()
      .catch(() => ({ error: `Unexpected ${res.status} response` }));

    if (!res.ok) {
      // Map 401 to an actionable message
      if (res.status === 401) {
        throw new Error(
          token
            ? 'Session expired — please log in again'
            : 'Please log in to use voice sales'
        );
      }
      const message =
        typeof payload?.error === 'string'
          ? payload.error
          : `Voice service failed (HTTP ${res.status})`;
      throw new Error(message);
    }

    return normalizeResult(payload);
  }
}
