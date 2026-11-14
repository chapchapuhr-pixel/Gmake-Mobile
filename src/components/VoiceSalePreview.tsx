// src/components/VoiceSalePreview.tsx
import React, { useMemo, useState } from 'react';
import {
  Check,
  X,
  AlertTriangle,
  Plus,
  Minus,
  Sparkles,
  Mic,
  Trash2,
  DollarSign,
  Smartphone,
  CreditCard,
  Landmark,
  PackageX,
  TrendingUp,
  ShieldCheck,
} from 'lucide-react';
import { ParseSaleResult, SaleDraftItem } from '../services/voiceSaleService';
import { formatCurrency } from '../utils/formatters';

const PAYMENT_METHODS = [
  { id: 'CASH',          label: 'Cash',        icon: DollarSign },
  { id: 'MOBILE_MONEY',  label: 'Mobile',      icon: Smartphone },
  { id: 'CARD',          label: 'Card',        icon: CreditCard },
  { id: 'BANK',          label: 'Bank',        icon: Landmark   },
] as const;

interface Props {
  result: ParseSaleResult;
  defaultPaymentMethod?: string;
  currencySymbol?: string;
  onConfirm: (payload: {
    shopId: string | null;
    paymentMethod: string;
    saleType: string;
    items: { productId: string; quantity: number; unitPrice: number }[];
  }) => Promise<void>;
  onCancel: () => void;
}

// ── helpers ──────────────────────────────────────────────────────
const num = (v: number | string | null | undefined): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const p = parseFloat(String(v ?? ''));
  return Number.isFinite(p) ? p : 0;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

// Per-item health color
type ItemHealth = 'ok' | 'review' | 'blocked';
const getHealth = (it: SaleDraftItem): ItemHealth => {
  if (!it.productId) return 'blocked';
  if (!it.inStock) return 'blocked';
  if (!it.unitPrice || it.unitPrice <= 0) return 'review';
  if (it.stockQty > 0 && it.quantity > it.stockQty) return 'review';
  return 'ok';
};

const HEALTH_STYLES: Record<ItemHealth, {
  border: string; bg: string; chip: string; chipText: string; label: string;
}> = {
  ok:      { border: 'border-emerald-500/30', bg: 'bg-emerald-500/5',  chip: 'bg-emerald-500/15 border-emerald-500/30', chipText: 'text-emerald-300', label: 'Ready' },
  review:  { border: 'border-amber-500/40',   bg: 'bg-amber-500/5',    chip: 'bg-amber-500/15 border-amber-500/30',    chipText: 'text-amber-300',   label: 'Review' },
  blocked: { border: 'border-rose-500/40',    bg: 'bg-rose-500/5',     chip: 'bg-rose-500/15 border-rose-500/30',      chipText: 'text-rose-300',    label: 'Blocked' },
};

// ── component ────────────────────────────────────────────────────
export const VoiceSalePreview: React.FC<Props> = ({
  result,
  defaultPaymentMethod = 'CASH',
  currencySymbol = 'TZS',
  onConfirm,
  onCancel,
}) => {
  const [items, setItems] = useState<SaleDraftItem[]>(result.draft.items);
  const [paymentMethod, setPaymentMethod] = useState(defaultPaymentMethod);
  const [saving, setSaving] = useState(false);

  const update = (i: number, patch: Partial<SaleDraftItem>) =>
    setItems(arr => arr.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));

  const remove = (i: number) =>
    setItems(arr => arr.filter((_, idx) => idx !== i));

  const changeQty = (i: number, delta: number) => {
    const it = items[i];
    const next = Math.max(1, round2(it.quantity + delta));
    const capped = it.stockQty > 0 ? Math.min(next, it.stockQty) : next;
    update(i, { quantity: capped });
  };

  const setQty = (i: number, raw: string) => {
    const n = parseFloat(raw);
    if (!Number.isFinite(n)) return;
    const it = items[i];
    const capped = it.stockQty > 0 ? Math.min(Math.max(n, 1), it.stockQty) : Math.max(n, 1);
    update(i, { quantity: round2(capped) });
  };

  const setPrice = (i: number, raw: string) => {
    const n = parseFloat(raw);
    update(i, { unitPrice: Number.isFinite(n) ? n : 0 });
  };

  // ── derived state ─────────────────────────────────────────────
  const health = useMemo(() => items.map(getHealth), [items]);
  const total = useMemo(
    () => items.reduce((s, i) => s + num(i.unitPrice) * num(i.quantity), 0),
    [items]
  );
  const totalUnits = useMemo(
    () => items.reduce((s, i) => s + num(i.quantity), 0),
    [items]
  );
  const anyBlocked = health.includes('blocked');
  const anyReview  = health.includes('review');
  const canConfirm = items.length > 0 && !anyBlocked && !!paymentMethod;
  const needsAttention = anyBlocked || anyReview || result.needsManualReview;

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setSaving(true);
    try {
      await onConfirm({
        shopId: result.draft.shopId,
        paymentMethod,
        saleType: 'NEW_PRODUCT_SALE',
        items: items.map(i => ({
          productId: i.productId!,
          quantity: num(i.quantity),
          unitPrice: num(i.unitPrice),
        })),
      });
    } finally {
      setSaving(false);
    }
  };

  // ── render ────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className="relative w-full sm:max-w-xl bg-slate-900 border border-slate-800
                   rounded-t-3xl sm:rounded-2xl shadow-2xl
                   max-h-[92vh] sm:max-h-[90vh] flex flex-col overflow-hidden"
      >
        {/* ── Header ── */}
        <div className="relative px-5 pt-5 pb-4 bg-gradient-to-br from-blue-600/20 via-indigo-600/10 to-transparent border-b border-slate-800">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/30">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white leading-tight">
                  Voice Sale Preview
                </h2>
                <p className="text-[11px] text-blue-300/80 flex items-center gap-1 mt-0.5">
                  <Mic className="w-3 h-3" />
                  AI-parsed · confirm to save
                </p>
              </div>
            </div>
            <button
              onClick={onCancel}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/80 transition"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Transcript pill */}
          {result.transcript && (
            <div className="mt-3 px-3 py-2 rounded-lg bg-slate-950/70 border border-slate-800 text-[11px] text-slate-300 italic flex items-start gap-2">
              <Mic className="w-3.5 h-3.5 text-blue-400 mt-0.5 shrink-0" />
              <span className="line-clamp-3">"{result.transcript}"</span>
            </div>
          )}

          {/* Summary strip */}
          <div className="mt-3 grid grid-cols-3 gap-1.5">
            <div className="px-2.5 py-1.5 rounded-lg bg-slate-950/60 border border-slate-800 text-center">
              <div className="text-[9px] uppercase tracking-wider text-slate-500">Items</div>
              <div className="text-sm font-bold text-white font-mono">{items.length}</div>
            </div>
            <div className="px-2.5 py-1.5 rounded-lg bg-slate-950/60 border border-slate-800 text-center">
              <div className="text-[9px] uppercase tracking-wider text-slate-500">Units</div>
              <div className="text-sm font-bold text-white font-mono">{round2(totalUnits)}</div>
            </div>
            <div className="px-2.5 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-center">
              <div className="text-[9px] uppercase tracking-wider text-emerald-400/80">Total</div>
              <div className="text-sm font-bold text-emerald-300 font-mono">
                {formatCurrency(total, currencySymbol)}
              </div>
            </div>
          </div>
        </div>

        {/* ── Scrollable body ── */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-3">

          {/* Warnings */}
          {result.warnings.length > 0 && (
            <div className="space-y-1.5">
              {result.warnings.map((w, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 px-2.5 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 text-[11px]"
                >
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span className="flex-1">{w}</span>
                </div>
              ))}
            </div>
          )}

          {result.needsManualReview && (
            <div className="flex items-start gap-2 px-2.5 py-2 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-200 text-[11px]">
              <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span className="flex-1">
                Low confidence in the transcript. Double-check quantities and prices before saving.
              </span>
            </div>
          )}

          {/* Item cards */}
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <PackageX className="w-10 h-10 text-slate-700 mb-2" />
              <p className="text-sm font-semibold text-slate-400">No items to preview</p>
              <p className="text-xs text-slate-500 mt-1">Try recording again.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {items.map((it, i) => {
                const h = health[i];
                const s = HEALTH_STYLES[h];
                const lineTotal = num(it.unitPrice) * num(it.quantity);
                const attrEntries = Object.entries(it.attributes ?? {});

                return (
                  <div
                    key={i}
                    className={`relative rounded-xl border ${s.border} ${s.bg} p-3 space-y-2.5 transition`}
                  >
                    {/* Top row: name + status + remove */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="w-5 h-5 rounded-md bg-slate-800 text-[10px] font-bold text-slate-300 flex items-center justify-center shrink-0">
                            {i + 1}
                          </span>
                          <h4 className="text-sm font-semibold text-white truncate">
                            {it.productName ?? '— Product not found —'}
                          </h4>
                          <span
                            className={`text-[9px] px-1.5 py-0.5 rounded border font-bold uppercase tracking-wide ${s.chip} ${s.chipText}`}
                          >
                            {s.label}
                          </span>
                        </div>
                        {attrEntries.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {attrEntries.map(([k, v]) => (
                              <span
                                key={k}
                                className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-400 border border-slate-700"
                              >
                                {k}: {v}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => remove(i)}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 transition shrink-0"
                        title="Remove item"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Stock hint */}
                    <div className="flex items-center gap-2 text-[10px]">
                      <TrendingUp
                        className={`w-3 h-3 ${
                          it.inStock ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      />
                      <span className={it.inStock ? 'text-slate-400' : 'text-rose-400 font-semibold'}>
                        {it.inStock
                          ? `Stock available: ${round2(it.stockQty)}`
                          : 'Out of stock'}
                      </span>
                    </div>

                    {/* Controls row */}
                    <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr_auto] gap-2 items-center">
                      {/* Qty stepper */}
                      <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-lg p-0.5 w-fit">
                        <button
                          type="button"
                          onClick={() => changeQty(i, -1)}
                          className="w-7 h-7 rounded-md flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-800 active:scale-95 transition"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={it.quantity}
                          onChange={e => setQty(i, e.target.value)}
                          onFocus={e => e.target.select()}
                          className="w-12 bg-transparent text-center text-xs font-bold text-white font-mono py-1 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => changeQty(i, 1)}
                          className="w-7 h-7 rounded-md flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-800 active:scale-95 transition"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Price input */}
                      <div className="relative">
                        <span className="absolute inset-y-0 left-2 flex items-center text-[10px] text-slate-500 pointer-events-none">
                          {currencySymbol}
                        </span>
                        <input
                          type="number"
                          inputMode="decimal"
                          value={it.unitPrice ?? 0}
                          onChange={e => setPrice(i, e.target.value)}
                          onFocus={e => e.target.select()}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-2 py-1.5 text-xs font-mono text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </div>

                      {/* Line total */}
                      <div className="text-right text-[11px] font-mono font-semibold text-emerald-400 sm:min-w-[100px]">
                        = {formatCurrency(lineTotal, currencySymbol)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Payment method */}
          <div className="pt-1">
            <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
              Payment Method
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              {PAYMENT_METHODS.map(m => {
                const Icon = m.icon;
                const active = paymentMethod === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setPaymentMethod(m.id)}
                    className={`flex flex-col items-center justify-center py-2 rounded-lg text-[10px] font-semibold border transition active:scale-95 ${
                      active
                        ? 'bg-blue-600 border-blue-500 text-white shadow-md shadow-blue-500/20'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 mb-0.5" />
                    <span className="truncate">{m.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Sticky footer ── */}
        <div className="border-t border-slate-800 bg-slate-950/90 backdrop-blur px-4 sm:px-5 py-3 space-y-2.5">
          {needsAttention && (
            <div className="flex items-center gap-1.5 text-[10px] text-amber-300">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              <span>
                {anyBlocked
                  ? 'Fix blocked items before confirming.'
                  : 'Review highlighted items before confirming.'}
              </span>
            </div>
          )}

          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold">
              Grand Total
            </span>
            <span className="text-xl font-extrabold text-emerald-400 font-mono">
              {formatCurrency(total, currencySymbol)}
            </span>
          </div>

          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="flex-1 py-2.5 rounded-xl border border-slate-700 text-slate-300 text-sm font-semibold hover:bg-slate-800/60 transition active:scale-[0.98]"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!canConfirm || saving}
              className="flex-[1.4] py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white text-sm font-bold shadow-lg shadow-emerald-500/25 flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition"
            >
              <Check className="w-4 h-4" />
              {saving ? 'Saving…' : 'Confirm Sale'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
