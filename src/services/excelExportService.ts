// src/services/excelExportService.ts
import * as XLSX from 'xlsx';
import { db } from '../db/storage';
import { Product, Store } from '../types';

export interface ExcelExportResult {
  success: boolean;
  fileName: string;
  rowCount?: number;
  error?: string;
}

// These 4 headers match ExcelImportService 4-column import headers exactly
const IMPORT_HEADERS = ['Product Name', 'Buying Price', 'Selling Price', 'Quantity'];

function todayStamp(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function slugifyFileName(name: string): string {
  const cleaned = String(name || 'store')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || 'store';
}

function autoColWidths(rows: any[][]): { wch: number }[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, idx) => {
      const len = String(cell ?? '').length;
      widths[idx] = Math.max(widths[idx] || 0, len);
    });
  }
  return widths.map(w => ({ wch: Math.min(w + 2, 45) }));
}

function productToRow(p: Product, quantityOverride?: number): (string | number)[] {
  const displayName = p.variation ? `${p.name} (${p.variation})` : p.name || '';
  return [
    displayName,
    p.purchasePrice ?? 0,
    p.sellingPrice ?? 0,
    quantityOverride !== undefined ? quantityOverride : (p.currentStock ?? 0),
  ];
}

export function resolveProductQtyInStore(
  product: Product,
  store: Store,
  allStoresInShop: Store[]
): number {
  if (product.storeStocks && product.storeStocks[store.id] !== undefined) {
    return Number(product.storeStocks[store.id] || 0);
  }
  if (store.isShopFloor) {
    return Number(product.currentStock || 0);
  }
  const nonFloorInShop = allStoresInShop.filter(
    s => s.shopId === product.shopId && !s.isShopFloor && s.status === 'ACTIVE'
  );
  if (
    nonFloorInShop.length <= 1 &&
    (!product.storeStocks || Object.keys(product.storeStocks).length === 0)
  ) {
    return Number(product.storeStock || 0);
  }
  return 0;
}

export function resolveProductTotalTrackedUnits(
  product: Product,
  allStoresInShop: Store[]
): number {
  if (product.storeStocks && Object.keys(product.storeStocks).length > 0) {
    const mappedStores = Object.entries(product.storeStocks);
    const mappedTotal = mappedStores.reduce((s, [, qty]) => s + Number(qty || 0), 0);
    const hasFloorMapped = mappedStores.some(
      ([sid]) => allStoresInShop.find(st => st.id === sid)?.isShopFloor
    );
    return hasFloorMapped ? mappedTotal : mappedTotal + Number(product.currentStock || 0);
  }
  return Number(product.currentStock || 0) + Number(product.storeStock || 0);
}

export class ExcelExportService {
  public static exportAllProducts(shopId: string): ExcelExportResult {
    try {
      if (!shopId) {
        return { success: false, fileName: '', error: 'Shop ID is required.' };
      }

      const all = db.getProducts();
      const filtered = all.filter(p => p.shopId === shopId && p.status !== 'INACTIVE');

      if (filtered.length === 0) {
        return { success: false, fileName: '', error: 'No products found for this shop.' };
      }

      const aoa: any[][] = [IMPORT_HEADERS, ...filtered.map(p => productToRow(p))];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = autoColWidths(aoa);

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Products');

      const fileName = `products_${todayStamp()}.xlsx`;
      XLSX.writeFile(wb, fileName);

      return { success: true, fileName, rowCount: filtered.length };
    } catch (err: any) {
      return { success: false, fileName: '', error: err.message || 'Export failed.' };
    }
  }

  public static buildStoreProductsAoa(
    store: Store,
    products?: Product[],
    allStores?: Store[]
  ): any[][] {
    const storeList = allStores ?? db.getStores();
    const storesInShop = storeList.filter(s => s.shopId === store.shopId);
    const sourceProducts =
      products ??
      db
        .getProducts()
        .filter(p => {
          if (p.shopId !== store.shopId || p.status === 'INACTIVE') return false;
          const qty = resolveProductQtyInStore(p, store, storesInShop);
          return qty > 0 || Boolean(p.storeDetails?.[store.id]);
        });

    const rows = sourceProducts.map(p =>
      productToRow(p, resolveProductQtyInStore(p, store, storesInShop))
    );
    return [IMPORT_HEADERS, ...rows];
  }

  public static exportStoreProducts(
    store: Store,
    products?: Product[]
  ): ExcelExportResult {
    try {
      if (!store || !store.id) {
        return { success: false, fileName: '', error: 'Store is required.' };
      }

      const aoa = this.buildStoreProductsAoa(store, products);
      const rowCount = aoa.length - 1;

      if (rowCount === 0) {
        return {
          success: false,
          fileName: '',
          error: `No stocked products found in "${store.name}".`,
        };
      }

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = autoColWidths(aoa);

      const wb = XLSX.utils.book_new();
      const safeSheetName = (store.name || 'Store').replace(/[\\/?*[\]:]/g, '').slice(0, 31) || 'Store';
      XLSX.utils.book_append_sheet(wb, ws, safeSheetName);

      const fileName = `${slugifyFileName(store.name)}_products_${todayStamp()}.xlsx`;
      XLSX.writeFile(wb, fileName);

      return { success: true, fileName, rowCount };
    } catch (err: any) {
      return { success: false, fileName: '', error: err.message || 'Store export failed.' };
    }
  }

  public static exportCombinedStoresProducts(
    stores: Store[],
    products: Product[]
  ): ExcelExportResult {
    try {
      const activeProducts = products.filter(p => p.status !== 'INACTIVE');
      if (activeProducts.length === 0) {
        return { success: false, fileName: '', error: 'No products found to export.' };
      }

      const rows = activeProducts.map(p => {
        const shopStores = stores.filter(s => s.shopId === p.shopId);
        return productToRow(p, resolveProductTotalTrackedUnits(p, shopStores));
      });
      const aoa: any[][] = [IMPORT_HEADERS, ...rows];

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = autoColWidths(aoa);

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'All Stores Inventory');

      const fileName = `all_stores_products_${todayStamp()}.xlsx`;
      XLSX.writeFile(wb, fileName);

      return { success: true, fileName, rowCount: rows.length };
    } catch (err: any) {
      return { success: false, fileName: '', error: err.message || 'Export failed.' };
    }
  }
}
