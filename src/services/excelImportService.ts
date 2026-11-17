// src/services/excelImportService.ts
import * as XLSX from 'xlsx';
import { db } from '../db/storage';
import { generateUUID } from '../utils/crypto';
import {
  Category,
  Product,
  ProductCustomFields,
  ProductStoreStockDetail,
  Sale,
  SaleItem,
  Store,
  User,
} from '../types';

export interface ExcelProductRow {
  productName: string;
  buyingPrice: number;
  sellingPrice: number;
  quantity: number;
  rowNumber?: number;
}

export interface ExcelParseResult {
  success: boolean;
  rows: ExcelProductRow[];
  errors: { rowNumber: number; message: string }[];
  sheetName?: string;
}

export type ImportFormatType =
  | 'SIMPLE_4_COL'
  | 'SONKO_19_COL'
  | 'DETAILED_SALES_HISTORY'
  | 'UNCERTAIN';

export type MigrationStrategy = 'RESTORE_REPLACE' | 'NEW_ONLY' | 'MERGE_ADD';

export interface SonkoImportRow {
  rowNumber: number;
  action?: string;
  sku?: string;
  productName: string;
  variation?: string;
  categoryName?: string;
  location: string;
  unitPurchasePrice: number;
  unitSellingPrice: number;
  currentStock: number;
  importedPurchaseValue?: number;
  importedSaleValue?: number;
  importedPotentialProfit?: number;
  historicalUnitsSold: number;
  historicalUnitsTransferred: number;
  historicalUnitsAdjusted: number;
  customFields?: ProductCustomFields;
}

export interface DetailedSaleImportRow {
  rowNumber: number;
  saleDateIso: string;
  receiptNumber: string;
  productName: string;
  variation?: string;
  sku?: string;
  quantity: number;
  unitPrice: number;
  buyingPrice?: number;
  location?: string;
  paymentMethod: 'CASH' | 'MOBILE_MONEY' | 'CARD' | 'BANK' | 'OTHER';
  customerName?: string;
  sellerName?: string;
}

export type CanonicalImportField =
  | 'action'
  | 'sku'
  | 'productName'
  | 'variation'
  | 'category'
  | 'location'
  | 'buyingPrice'
  | 'sellingPrice'
  | 'quantity'
  | 'purchaseValue'
  | 'saleValue'
  | 'potentialProfit'
  | 'totalSold'
  | 'totalTransferred'
  | 'totalAdjusted'
  | 'customField1'
  | 'customField2'
  | 'customField3'
  | 'customField4'
  | 'saleDate'
  | 'receiptNumber'
  | 'paymentMethod'
  | 'customerName'
  | 'sellerName';

export interface StorePreviewInfo {
  name: string;
  rowCount: number;
  totalUnits: number;
  existsInShop: boolean;
  existingStoreId?: string;
  isDefaultFloor: boolean;
}

export interface ImportPreviewSummary {
  totalRows: number;
  validRows: number;
  errorRows: number;
  uniqueProductsCount: number;
  variationsCount: number;
  categoriesDetected: { name: string; existsInShop: boolean }[];
  storesDetected: StorePreviewInfo[];
  duplicateStoreRowsInFile: number;
  totalQuantity: number;
  totalPurchaseValue: number;
  totalSaleValue: number;
  totalPotentialProfit: number;
  totalHistoricalSold: number;
  totalHistoricalTransferred: number;
  totalHistoricalAdjusted: number;
}

export interface UnifiedParseResult {
  success: boolean;
  format: ImportFormatType;
  detectionConfidence: 'HIGH' | 'MEDIUM' | 'LOW';
  needsManualMapping: boolean;
  fileName: string;
  sheetName: string;
  fileHash: string;
  headers: string[];
  rawRows: Record<string, any>[];
  columnMapping: Partial<Record<CanonicalImportField, string>>;
  duplicateImportWarning?: {
    importedAt: string;
    fileName: string;
    strategy?: string;
    totalRecords: number;
  };
  simpleRows: ExcelProductRow[];
  sonkoRows: SonkoImportRow[];
  detailedSaleRows: DetailedSaleImportRow[];
  errors: { rowNumber: number; message: string }[];
  warnings: { rowNumber: number; message: string }[];
  previewSummary: ImportPreviewSummary;
}

export interface MigrationCommitOptions {
  shopId: string;
  /** For SIMPLE_4_COL: '' = Direct to Shop Floor, else Store.id */
  targetStoreId?: string;
  /** For SONKO_19_COL: which location name represents POS Floor stock, or 'NONE' for all warehouses */
  shopFloorLocationName?: string;
  strategy: MigrationStrategy;
  createPreSnapshot?: boolean;
}

export interface MigrationCommitResult {
  success: boolean;
  format: ImportFormatType;
  strategy: MigrationStrategy;
  createdProducts: number;
  updatedProducts: number;
  skippedRecords: number;
  storesCreated: string[];
  storesMatched: string[];
  categoriesCreated: string[];
  salesImported: number;
  historicalUnitsPreserved: number;
  snapshotSaved: boolean;
  errors: string[];
  warnings: string[];
}

const HEADER_SYNONYMS: Record<CanonicalImportField, string[]> = {
  action: ['action', 'actions'],
  sku: ['sku', 'productsku', 'itemcode', 'code', 'barcode'],
  productName: ['productname', 'product', 'name', 'title', 'itemname', 'item'],
  variation: ['variation', 'variant', 'variations', 'size', 'color', 'option'],
  category: ['category', 'categories', 'productcategory', 'group'],
  location: ['location', 'store', 'storename', 'warehouse', 'branchlocation', 'outlet'],
  buyingPrice: [
    'unitpurchaseprice',
    'buyingprice',
    'buyprice',
    'purchaseprice',
    'costprice',
    'unitcost',
    'cost',
  ],
  sellingPrice: [
    'unitsellingprice',
    'sellingprice',
    'sellprice',
    'saleprice',
    'unitprice',
    'retailprice',
    'price',
  ],
  quantity: [
    'currentstock',
    'quantity',
    'qty',
    'stock',
    'stockqty',
    'units',
    'onhand',
    'available',
  ],
  purchaseValue: [
    'currentstockvaluebypurchaseprice',
    'stockvaluebypurchaseprice',
    'currentstockvaluepurchase',
    'purchasevalue',
    'costvalue',
  ],
  saleValue: [
    'currentstockvaluebysaleprice',
    'currentstockvaluebysellingprice',
    'stockvaluebysaleprice',
    'currentstockvaluesale',
    'salevalue',
    'retailvalue',
  ],
  potentialProfit: ['potentialprofit', 'expectedprofit', 'estprofit', 'profitpotential'],
  totalSold: ['totalunitsold', 'totalunitssold', 'unitssold', 'totalsold', 'soldunits'],
  totalTransferred: [
    'totalunittransfered',
    'totalunittransferred',
    'totalunitstransferred',
    'totaltransferred',
    'unitstransferred',
  ],
  totalAdjusted: [
    'totalunitadjusted',
    'totalunitsadjusted',
    'totaladjusted',
    'unitsadjusted',
  ],
  customField1: ['customfield1', 'custom1', 'field1'],
  customField2: ['customfield2', 'custom2', 'field2'],
  customField3: ['customfield3', 'custom3', 'field3'],
  customField4: ['customfield4', 'custom4', 'field4'],
  saleDate: [
    'date',
    'saledate',
    'transactiondate',
    'datetime',
    'timestamp',
    'invoicedate',
    'createdat',
  ],
  receiptNumber: [
    'receiptnumber',
    'receiptno',
    'receipt',
    'invoicenumber',
    'invoiceno',
    'invoice',
    'orderno',
    'refno',
  ],
  paymentMethod: ['paymentmethod', 'payment', 'paymenttype', 'paymethod'],
  customerName: ['customer', 'customername', 'client', 'buyer'],
  sellerName: ['seller', 'sellername', 'cashier', 'staff'],
};

function normalizeHeaderKey(header: string): string {
  return String(header || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function normalizeVariation(val: any): string | undefined {
  const s = String(val ?? '').trim();
  if (!s) return undefined;
  if (s.toUpperCase() === 'DUMMY') return undefined;
  if (s === '-' || s.toUpperCase() === 'N/A' || s.toUpperCase() === 'NONE') return undefined;
  return s;
}

function cleanText(val: any): string | undefined {
  const s = String(val ?? '').trim();
  return s ? s : undefined;
}

function computeContentHash(headers: string[], rawRows: Record<string, any>[]): string {
  // Deterministic 64-bit style dual FNV-1a fingerprint string (fast, synchronous, collision-safe)
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;

  const feed = (str: string) => {
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 ^= ch;
      h1 = Math.imul(h1, 0x01000193);
      h2 ^= (ch + i) & 0xff;
      h2 = Math.imul(h2, 0x01000193);
    }
  };

  feed(headers.map(h => normalizeHeaderKey(h)).join('|'));
  feed(`::rows=${rawRows.length}::`);
  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i];
    for (const h of headers) {
      feed(String(row[h] ?? '').trim());
      feed(',');
    }
    feed(';');
  }

  return `imp_${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

export class ExcelImportService {
  // =========================================================================
  // BACKWARD-COMPATIBLE 4-COLUMN METHODS (preserved for any existing callers)
  // =========================================================================

  /**
   * Parse an Excel file into structured simple 4-column product rows.
   */
  public static async parseExcelFile(file: File): Promise<ExcelParseResult> {
    const unified = await this.parseImportFile(file);
    if (unified.format === 'SIMPLE_4_COL') {
      return {
        success: unified.errors.length === 0,
        rows: unified.simpleRows,
        errors: unified.errors,
        sheetName: unified.sheetName,
      };
    }

    if (unified.format === 'SONKO_19_COL') {
      const converted: ExcelProductRow[] = unified.sonkoRows.map(r => ({
        productName: r.variation ? `${r.productName} (${r.variation})` : r.productName,
        buyingPrice: r.unitPurchasePrice,
        sellingPrice: r.unitSellingPrice,
        quantity: r.currentStock,
        rowNumber: r.rowNumber,
      }));
      return {
        success: unified.errors.length === 0,
        rows: converted,
        errors: unified.errors,
        sheetName: unified.sheetName,
      };
    }

    return {
      success: false,
      rows: [],
      errors:
        unified.errors.length > 0
          ? unified.errors
          : [
              {
                rowNumber: 1,
                message:
                  'Missing required columns. Need: "Product Name", "Selling Price", "Quantity". Optional: "Buying Price".',
              },
            ],
      sheetName: unified.sheetName,
    };
  }

  /**
   * Backward-compatible commit method for 4-column rows directly to Shop Floor.
   */
  public static commitImport(
    rows: ExcelProductRow[],
    shopId: string,
    currentUser: User,
    targetStoreId?: string
  ): { success: boolean; created: number; updated: number; errors: string[] } {
    const res = this.commitSimpleRows(rows, {
      shopId,
      targetStoreId,
      strategy: 'MERGE_ADD',
      fileName: 'Excel Import',
      currentUser,
    });
    return {
      success: res.errors.length === 0,
      created: res.createdProducts,
      updated: res.updatedProducts,
      errors: res.errors,
    };
  }

  // =========================================================================
  // NEW INTELLIGENT MULTI-FORMAT IMPORT & MIGRATION ENGINE
  // =========================================================================

  /**
   * Read an .xlsx, .xls, or .csv file, auto-detect its structure & columns,
   * compute duplicate-file fingerprint, and build validation + preview metrics.
   */
  public static async parseImportFile(
    file: File,
    shopId?: string
  ): Promise<UnifiedParseResult> {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: false });
      const firstSheetName = workbook.SheetNames[0];

      if (!firstSheetName) {
        return this.buildEmptyParseResult(
          file.name,
          '',
          'Uploaded file has no worksheet or readable data.'
        );
      }

      const sheet = workbook.Sheets[firstSheetName];
      // Extract header array directly from sheet rows so even empty columns are visible
      const rawAoa: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      if (!rawAoa || rawAoa.length === 0) {
        return this.buildEmptyParseResult(file.name, firstSheetName, 'File is empty.');
      }

      // Find the header row (first row with >= 2 non-empty cells)
      let headerRowIndex = 0;
      for (let i = 0; i < Math.min(rawAoa.length, 10); i++) {
        const nonEmpty = (rawAoa[i] || []).filter(c => String(c ?? '').trim() !== '').length;
        if (nonEmpty >= 2) {
          headerRowIndex = i;
          break;
        }
      }

      const headerCells = (rawAoa[headerRowIndex] || []).map((c, idx) => {
        const val = String(c ?? '').trim();
        return val || `Column_${idx + 1}`;
      });

      const jsonRows: Record<string, any>[] = [];
      for (let r = headerRowIndex + 1; r < rawAoa.length; r++) {
        const rowArr = rawAoa[r] || [];
        const hasAnyValue = rowArr.some(c => String(c ?? '').trim() !== '');
        if (!hasAnyValue) continue;
        const obj: Record<string, any> = { __rowNum: r + 1 };
        headerCells.forEach((h, cIdx) => {
          obj[h] = rowArr[cIdx] !== undefined ? rowArr[cIdx] : '';
        });
        jsonRows.push(obj);
      }

      if (jsonRows.length === 0) {
        return this.buildEmptyParseResult(
          file.name,
          firstSheetName,
          'No data rows found beneath the header row.'
        );
      }

      const autoDetection = this.autoDetectMappingAndFormat(headerCells);
      const fileHash = computeContentHash(headerCells, jsonRows);

      return this.evaluateParsedRows({
        fileName: file.name,
        sheetName: firstSheetName,
        fileHash,
        headers: headerCells,
        rawRows: jsonRows,
        columnMapping: autoDetection.mapping,
        format: autoDetection.format,
        detectionConfidence: autoDetection.confidence,
        shopId,
      });
    } catch (err: any) {
      return this.buildEmptyParseResult(
        file.name,
        '',
        err?.message || 'Failed to read spreadsheet file.'
      );
    }
  }

  /**
   * Re-evaluate previously parsed rows after the user updates column mapping
   * or switches detected import format manually in the UI.
   */
  public static reparseWithMapping(
    previous: UnifiedParseResult,
    newMapping: Partial<Record<CanonicalImportField, string>>,
    targetFormat: ImportFormatType,
    shopId?: string
  ): UnifiedParseResult {
    return this.evaluateParsedRows({
      fileName: previous.fileName,
      sheetName: previous.sheetName,
      fileHash: previous.fileHash,
      headers: previous.headers,
      rawRows: previous.rawRows,
      columnMapping: newMapping,
      format: targetFormat,
      detectionConfidence: 'HIGH',
      shopId,
    });
  }

  private static autoDetectMappingAndFormat(headers: string[]): {
    format: ImportFormatType;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    mapping: Partial<Record<CanonicalImportField, string>>;
  } {
    const mapping: Partial<Record<CanonicalImportField, string>> = {};
    const usedHeaders = new Set<string>();

    // Pass 1: exact normalized synonym matches
    const fieldOrder: CanonicalImportField[] = [
      'saleDate',
      'receiptNumber',
      'paymentMethod',
      'customerName',
      'sellerName',
      'sku',
      'productName',
      'variation',
      'category',
      'location',
      'buyingPrice',
      'sellingPrice',
      'quantity',
      'purchaseValue',
      'saleValue',
      'potentialProfit',
      'totalSold',
      'totalTransferred',
      'totalAdjusted',
      'customField1',
      'customField2',
      'customField3',
      'customField4',
      'action',
    ];

    for (const field of fieldOrder) {
      const synonyms = HEADER_SYNONYMS[field];
      for (const h of headers) {
        if (usedHeaders.has(h)) continue;
        const norm = normalizeHeaderKey(h);
        if (synonyms.includes(norm)) {
          mapping[field] = h;
          usedHeaders.add(h);
          break;
        }
      }
    }

    // Pass 2: fuzzy substring fallback for slightly renamed columns
    const fuzzyPairs: [CanonicalImportField, (n: string) => boolean][] = [
      ['productName', n => n.includes('productname') || n === 'product' || n.includes('itemname')],
      ['buyingPrice', n => n.includes('purchaseprice') || n.includes('buyingprice') || n.includes('costprice')],
      ['sellingPrice', n => n.includes('sellingprice') || n.includes('saleprice') || n.includes('unitprice')],
      ['quantity', n => n === 'currentstock' || n.includes('quantity') || n === 'qty'],
      ['purchaseValue', n => n.includes('stockvalue') && (n.includes('purchase') || n.includes('cost'))],
      ['saleValue', n => n.includes('stockvalue') && (n.includes('sale') || n.includes('sell'))],
      ['potentialProfit', n => n.includes('potentialprofit')],
      ['totalSold', n => n.includes('unitsold') || n.includes('totalsold')],
      ['totalTransferred', n => n.includes('transfered') || n.includes('transferred')],
      ['totalAdjusted', n => n.includes('adjusted')],
      ['location', n => n.includes('location') || n.includes('storename') || n.includes('warehouse')],
      ['category', n => n.includes('category')],
      ['variation', n => n.includes('variation') || n.includes('variant')],
      ['sku', n => n.includes('sku')],
      ['saleDate', n => n.includes('saledate') || n.includes('transactiondate')],
      ['receiptNumber', n => n.includes('receipt') || n.includes('invoice')],
    ];

    for (const [field, predicate] of fuzzyPairs) {
      if (mapping[field]) continue;
      for (const h of headers) {
        if (usedHeaders.has(h)) continue;
        if (predicate(normalizeHeaderKey(h))) {
          mapping[field] = h;
          usedHeaders.add(h);
          break;
        }
      }
    }

    // Decide format
    const hasSaleHistorySignals = Boolean(
      mapping.saleDate && (mapping.receiptNumber || mapping.paymentMethod) && mapping.productName
    );
    const sonkoRichSignals = [
      mapping.location,
      mapping.sku,
      mapping.variation,
      mapping.category,
      mapping.purchaseValue,
      mapping.saleValue,
      mapping.potentialProfit,
      mapping.totalSold,
      mapping.totalTransferred,
      mapping.totalAdjusted,
      mapping.customField1,
    ].filter(Boolean).length;

    if (hasSaleHistorySignals && sonkoRichSignals < 3) {
      const hasRequired = Boolean(mapping.productName && mapping.sellingPrice && mapping.quantity);
      return {
        format: 'DETAILED_SALES_HISTORY',
        confidence: hasRequired ? 'HIGH' : 'MEDIUM',
        mapping,
      };
    }

    if (sonkoRichSignals >= 2 || headers.length >= 10) {
      const hasCore = Boolean(mapping.productName && mapping.sellingPrice && mapping.quantity);
      return {
        format: 'SONKO_19_COL',
        confidence: hasCore && mapping.location ? 'HIGH' : hasCore ? 'MEDIUM' : 'LOW',
        mapping,
      };
    }

    if (mapping.productName && mapping.sellingPrice && mapping.quantity) {
      return {
        format: 'SIMPLE_4_COL',
        confidence: mapping.buyingPrice ? 'HIGH' : 'MEDIUM',
        mapping,
      };
    }

    return {
      format: 'UNCERTAIN',
      confidence: 'LOW',
      mapping,
    };
  }

  private static evaluateParsedRows(params: {
    fileName: string;
    sheetName: string;
    fileHash: string;
    headers: string[];
    rawRows: Record<string, any>[];
    columnMapping: Partial<Record<CanonicalImportField, string>>;
    format: ImportFormatType;
    detectionConfidence: 'HIGH' | 'MEDIUM' | 'LOW';
    shopId?: string;
  }): UnifiedParseResult {
    const {
      fileName,
      sheetName,
      fileHash,
      headers,
      rawRows,
      columnMapping,
      format,
      detectionConfidence,
      shopId,
    } = params;

    const errors: { rowNumber: number; message: string }[] = [];
    const warnings: { rowNumber: number; message: string }[] = [];
    const simpleRows: ExcelProductRow[] = [];
    const sonkoRows: SonkoImportRow[] = [];
    const detailedSaleRows: DetailedSaleImportRow[] = [];

    // Check prior import with matching file hash
    const priorMatch = db
      .getImportHistory()
      .find(h => h.fileHash && h.fileHash === fileHash);

    const duplicateImportWarning = priorMatch
      ? {
          importedAt: priorMatch.createdAt,
          fileName: priorMatch.fileName,
          strategy: priorMatch.strategy,
          totalRecords: priorMatch.totalRecords,
        }
      : undefined;

    let needsManualMapping =
      format === 'UNCERTAIN' ||
      !columnMapping.productName ||
      !columnMapping.sellingPrice ||
      !columnMapping.quantity;

    if (format === 'DETAILED_SALES_HISTORY' && !columnMapping.saleDate) {
      needsManualMapping = true;
    }

    if (needsManualMapping) {
      const missing: string[] = [];
      if (!columnMapping.productName) missing.push('Product Name');
      if (!columnMapping.sellingPrice) missing.push('Selling Price');
      if (!columnMapping.quantity) missing.push('Quantity / Current Stock');
      if (format === 'DETAILED_SALES_HISTORY' && !columnMapping.saleDate) missing.push('Sale Date');
      errors.push({
        rowNumber: 1,
        message:
          missing.length > 0
            ? `Could not automatically match required column(s): ${missing.join(', ')}. Use Column Mapping below to assign columns manually.`
            : 'File structure is uncertain. Verify column mapping below before importing.',
      });
    } else if (format === 'SIMPLE_4_COL') {
      rawRows.forEach((row, idx) => {
        const rowNum = Number(row.__rowNum || idx + 2);
        const name = String(row[columnMapping.productName!] ?? '').trim();
        const buyingPrice = columnMapping.buyingPrice
          ? this.parseNumber(row[columnMapping.buyingPrice])
          : 0;
        const sellingPrice = this.parseNumber(row[columnMapping.sellingPrice!]);
        const quantity = this.parseNumber(row[columnMapping.quantity!]);

        if (!name && isNaN(sellingPrice) && isNaN(quantity)) return;

        if (!name) {
          errors.push({ rowNumber: rowNum, message: 'Product Name is required.' });
          return;
        }
        if (isNaN(sellingPrice) || sellingPrice < 0) {
          errors.push({ rowNumber: rowNum, message: `Invalid Selling Price for "${name}".` });
          return;
        }
        if (isNaN(quantity) || quantity < 0) {
          errors.push({ rowNumber: rowNum, message: `Invalid Quantity for "${name}".` });
          return;
        }

        simpleRows.push({
          rowNumber: rowNum,
          productName: name,
          buyingPrice: isNaN(buyingPrice) || buyingPrice < 0 ? 0 : buyingPrice,
          sellingPrice,
          quantity: Math.floor(quantity),
        });
      });
    } else if (format === 'SONKO_19_COL') {
      const targetShop = shopId ? db.getShops().find(s => s.id === shopId) : undefined;
      const defaultLoc = targetShop?.name || 'Main Store';

      rawRows.forEach((row, idx) => {
        const rowNum = Number(row.__rowNum || idx + 2);
        const productName = String(row[columnMapping.productName!] ?? '').trim();
        const sku = columnMapping.sku ? cleanText(row[columnMapping.sku]) : undefined;
        const variation = columnMapping.variation
          ? normalizeVariation(row[columnMapping.variation])
          : undefined;
        const categoryName = columnMapping.category
          ? cleanText(row[columnMapping.category])
          : undefined;
        const locationRaw = columnMapping.location
          ? cleanText(row[columnMapping.location])
          : undefined;
        const location = locationRaw || defaultLoc;

        const unitPurchasePrice = columnMapping.buyingPrice
          ? this.parseNumber(row[columnMapping.buyingPrice])
          : 0;
        const unitSellingPrice = this.parseNumber(row[columnMapping.sellingPrice!]);
        const currentStockRaw = this.parseNumber(row[columnMapping.quantity!]);

        if (
          !productName &&
          !sku &&
          isNaN(unitSellingPrice) &&
          isNaN(currentStockRaw)
        ) {
          return;
        }

        if (!productName) {
          errors.push({ rowNumber: rowNum, message: 'Product name is missing.' });
          return;
        }

        if (!locationRaw && columnMapping.location) {
          warnings.push({
            rowNumber: rowNum,
            message: `"${productName}" had empty Location; assigned to "${location}".`,
          });
        }

        if (isNaN(unitSellingPrice) || unitSellingPrice < 0) {
          errors.push({
            rowNumber: rowNum,
            message: `Invalid Unit Selling Price for "${productName}" (${location}).`,
          });
          return;
        }

        if (isNaN(currentStockRaw) || currentStockRaw < 0) {
          errors.push({
            rowNumber: rowNum,
            message: `Invalid Current Stock for "${productName}" (${location}).`,
          });
          return;
        }

        const purchaseVal = columnMapping.purchaseValue
          ? this.parseOptionalNumber(row[columnMapping.purchaseValue])
          : undefined;
        const saleVal = columnMapping.saleValue
          ? this.parseOptionalNumber(row[columnMapping.saleValue])
          : undefined;
        const potentialProfit = columnMapping.potentialProfit
          ? this.parseOptionalNumber(row[columnMapping.potentialProfit])
          : undefined;

        const histSold = columnMapping.totalSold
          ? Math.max(0, this.parseNumberOrZero(row[columnMapping.totalSold]))
          : 0;
        const histTransferred = columnMapping.totalTransferred
          ? Math.max(0, this.parseNumberOrZero(row[columnMapping.totalTransferred]))
          : 0;
        const histAdjusted = columnMapping.totalAdjusted
          ? Math.max(0, this.parseNumberOrZero(row[columnMapping.totalAdjusted]))
          : 0;

        const customFields: ProductCustomFields = {};
        if (columnMapping.customField1) {
          const v = cleanText(row[columnMapping.customField1]);
          if (v) customFields.field1 = v;
        }
        if (columnMapping.customField2) {
          const v = cleanText(row[columnMapping.customField2]);
          if (v) customFields.field2 = v;
        }
        if (columnMapping.customField3) {
          const v = cleanText(row[columnMapping.customField3]);
          if (v) customFields.field3 = v;
        }
        if (columnMapping.customField4) {
          const v = cleanText(row[columnMapping.customField4]);
          if (v) customFields.field4 = v;
        }
        const hasCustomFields = Object.keys(customFields).length > 0;

        sonkoRows.push({
          rowNumber: rowNum,
          action: columnMapping.action ? cleanText(row[columnMapping.action]) : undefined,
          sku,
          productName,
          variation,
          categoryName,
          location,
          unitPurchasePrice: isNaN(unitPurchasePrice) || unitPurchasePrice < 0 ? 0 : unitPurchasePrice,
          unitSellingPrice,
          currentStock: Math.floor(currentStockRaw),
          importedPurchaseValue: purchaseVal,
          importedSaleValue: saleVal,
          importedPotentialProfit: potentialProfit,
          historicalUnitsSold: histSold,
          historicalUnitsTransferred: histTransferred,
          historicalUnitsAdjusted: histAdjusted,
          customFields: hasCustomFields ? customFields : undefined,
        });
      });
    } else if (format === 'DETAILED_SALES_HISTORY') {
      rawRows.forEach((row, idx) => {
        const rowNum = Number(row.__rowNum || idx + 2);
        const productName = String(row[columnMapping.productName!] ?? '').trim();
        const rawDate = row[columnMapping.saleDate!];
        const parsedDate = this.parseStrictDate(rawDate);
        const quantity = this.parseNumber(row[columnMapping.quantity!]);
        const unitPrice = this.parseNumber(row[columnMapping.sellingPrice!]);
        const buyingPrice = columnMapping.buyingPrice
          ? this.parseOptionalNumber(row[columnMapping.buyingPrice])
          : undefined;

        if (!productName && !rawDate && isNaN(quantity)) return;

        if (!parsedDate) {
          errors.push({
            rowNumber: rowNum,
            message: `Rejected "${productName || 'row'}": missing or invalid original sale date (historical dates are never fabricated).`,
          });
          return;
        }
        if (!productName) {
          errors.push({ rowNumber: rowNum, message: 'Product Name is required.' });
          return;
        }
        if (isNaN(quantity) || quantity <= 0) {
          errors.push({ rowNumber: rowNum, message: `Invalid quantity for "${productName}".` });
          return;
        }
        if (isNaN(unitPrice) || unitPrice < 0) {
          errors.push({ rowNumber: rowNum, message: `Invalid selling price for "${productName}".` });
          return;
        }

        const receiptRaw = columnMapping.receiptNumber
          ? cleanText(row[columnMapping.receiptNumber])
          : undefined;
        const pmRaw = columnMapping.paymentMethod
          ? String(row[columnMapping.paymentMethod] ?? '').toUpperCase()
          : 'CASH';
        let paymentMethod: DetailedSaleImportRow['paymentMethod'] = 'CASH';
        if (pmRaw.includes('MOBILE') || pmRaw.includes('M-PESA') || pmRaw.includes('TIGO') || pmRaw.includes('AIRTEL')) {
          paymentMethod = 'MOBILE_MONEY';
        } else if (pmRaw.includes('CARD')) {
          paymentMethod = 'CARD';
        } else if (pmRaw.includes('BANK')) {
          paymentMethod = 'BANK';
        } else if (pmRaw.includes('OTHER')) {
          paymentMethod = 'OTHER';
        }

        detailedSaleRows.push({
          rowNumber: rowNum,
          saleDateIso: parsedDate,
          receiptNumber: receiptRaw || `HIST-${parsedDate.slice(0, 10).replace(/-/g, '')}-${rowNum}`,
          productName,
          variation: columnMapping.variation
            ? normalizeVariation(row[columnMapping.variation])
            : undefined,
          sku: columnMapping.sku ? cleanText(row[columnMapping.sku]) : undefined,
          quantity: Math.floor(quantity),
          unitPrice,
          buyingPrice,
          location: columnMapping.location ? cleanText(row[columnMapping.location]) : undefined,
          paymentMethod,
          customerName: columnMapping.customerName ? cleanText(row[columnMapping.customerName]) : undefined,
          sellerName: columnMapping.sellerName ? cleanText(row[columnMapping.sellerName]) : undefined,
        });
      });
    }

    // Build preview summary
    const previewSummary = this.buildPreviewSummary({
      format,
      rawCount: rawRows.length,
      errorCount: errors.length,
      simpleRows,
      sonkoRows,
      detailedSaleRows,
      shopId,
      warnings,
    });

    return {
      success: errors.length === 0 && !needsManualMapping,
      format,
      detectionConfidence,
      needsManualMapping,
      fileName,
      sheetName,
      fileHash,
      headers,
      rawRows,
      columnMapping,
      duplicateImportWarning,
      simpleRows,
      sonkoRows,
      detailedSaleRows,
      errors,
      warnings,
      previewSummary,
    };
  }

  private static buildPreviewSummary(params: {
    format: ImportFormatType;
    rawCount: number;
    errorCount: number;
    simpleRows: ExcelProductRow[];
    sonkoRows: SonkoImportRow[];
    detailedSaleRows: DetailedSaleImportRow[];
    shopId?: string;
    warnings: { rowNumber: number; message: string }[];
  }): ImportPreviewSummary {
    const { format, rawCount, errorCount, simpleRows, sonkoRows, detailedSaleRows, shopId, warnings } =
      params;

    const existingStores = shopId
      ? db.getStores().filter(s => s.shopId === shopId)
      : db.getStores();
    const existingCats = shopId
      ? db.getCategories().filter(c => c.shopId === shopId)
      : db.getCategories();
    const shopNameLower = shopId
      ? (db.getShops().find(s => s.id === shopId)?.name || '').trim().toLowerCase()
      : '';

    if (format === 'SIMPLE_4_COL') {
      const uniqueNames = new Set(simpleRows.map(r => r.productName.toLowerCase().trim()));
      const totalQty = simpleRows.reduce((s, r) => s + r.quantity, 0);
      const totalBuy = simpleRows.reduce((s, r) => s + r.quantity * r.buyingPrice, 0);
      const totalSell = simpleRows.reduce((s, r) => s + r.quantity * r.sellingPrice, 0);
      return {
        totalRows: rawCount,
        validRows: simpleRows.length,
        errorRows: errorCount,
        uniqueProductsCount: uniqueNames.size,
        variationsCount: 0,
        categoriesDetected: [],
        storesDetected: [],
        duplicateStoreRowsInFile: 0,
        totalQuantity: totalQty,
        totalPurchaseValue: totalBuy,
        totalSaleValue: totalSell,
        totalPotentialProfit: totalSell - totalBuy,
        totalHistoricalSold: 0,
        totalHistoricalTransferred: 0,
        totalHistoricalAdjusted: 0,
      };
    }

    if (format === 'DETAILED_SALES_HISTORY') {
      const uniqueProds = new Set(
        detailedSaleRows.map(
          r => `${r.productName.toLowerCase()}::${(r.variation || '').toLowerCase()}`
        )
      );
      const totalQty = detailedSaleRows.reduce((s, r) => s + r.quantity, 0);
      const totalSell = detailedSaleRows.reduce((s, r) => s + r.quantity * r.unitPrice, 0);
      const totalBuy = detailedSaleRows.reduce(
        (s, r) => s + r.quantity * (r.buyingPrice || 0),
        0
      );
      return {
        totalRows: rawCount,
        validRows: detailedSaleRows.length,
        errorRows: errorCount,
        uniqueProductsCount: uniqueProds.size,
        variationsCount: detailedSaleRows.filter(r => Boolean(r.variation)).length,
        categoriesDetected: [],
        storesDetected: [],
        duplicateStoreRowsInFile: 0,
        totalQuantity: totalQty,
        totalPurchaseValue: totalBuy,
        totalSaleValue: totalSell,
        totalPotentialProfit: totalSell - totalBuy,
        totalHistoricalSold: totalQty,
        totalHistoricalTransferred: 0,
        totalHistoricalAdjusted: 0,
      };
    }

    // SONKO_19_COL preview
    const productKeys = new Set<string>();
    const variationKeys = new Set<string>();
    const catNames = new Map<string, string>();
    const storeAgg = new Map<
      string,
      { displayName: string; rowCount: number; totalUnits: number }
    >();
    const seenInSameStore = new Set<string>();
    let duplicateStoreRowsInFile = 0;

    let totalQty = 0;
    let totalBuy = 0;
    let totalSell = 0;
    let totalProfit = 0;
    let totalHistSold = 0;
    let totalHistTrans = 0;
    let totalHistAdj = 0;

    for (const row of sonkoRows) {
      const idKey = this.buildProductIdentityKey(row.productName, row.sku, row.variation);
      productKeys.add(idKey);
      if (row.variation) {
        variationKeys.add(`${idKey}`);
      }

      if (row.categoryName) {
        const cKey = row.categoryName.toLowerCase().trim();
        if (!catNames.has(cKey)) catNames.set(cKey, row.categoryName.trim());
      }

      const locKey = row.location.toLowerCase().trim();
      const storeEntry = storeAgg.get(locKey) || {
        displayName: row.location.trim(),
        rowCount: 0,
        totalUnits: 0,
      };
      storeEntry.rowCount += 1;
      storeEntry.totalUnits += row.currentStock;
      storeAgg.set(locKey, storeEntry);

      const perStoreKey = `${idKey}::LOC::${locKey}`;
      if (seenInSameStore.has(perStoreKey)) {
        duplicateStoreRowsInFile += 1;
        warnings.push({
          rowNumber: row.rowNumber,
          message: `Duplicate entry in file for "${row.productName}"${row.variation ? ` (${row.variation})` : ''} at "${row.location}" — quantities will be combined for that store.`,
        });
      }
      seenInSameStore.add(perStoreKey);

      totalQty += row.currentStock;
      const buyVal =
        row.importedPurchaseValue !== undefined
          ? row.importedPurchaseValue
          : row.currentStock * row.unitPurchasePrice;
      const sellVal =
        row.importedSaleValue !== undefined
          ? row.importedSaleValue
          : row.currentStock * row.unitSellingPrice;
      const profitVal =
        row.importedPotentialProfit !== undefined ? row.importedPotentialProfit : sellVal - buyVal;

      totalBuy += buyVal;
      totalSell += sellVal;
      totalProfit += profitVal;
      totalHistSold += row.historicalUnitsSold;
      totalHistTrans += row.historicalUnitsTransferred;
      totalHistAdj += row.historicalUnitsAdjusted;
    }

    const categoriesDetected = Array.from(catNames.values()).map(name => ({
      name,
      existsInShop: existingCats.some(c => c.name.trim().toLowerCase() === name.toLowerCase()),
    }));

    const storesDetected: StorePreviewInfo[] = Array.from(storeAgg.entries()).map(([locKey, info]) => {
      const matched = existingStores.find(s => s.name.trim().toLowerCase() === locKey);
      const isDefaultFloor =
        Boolean(matched?.isShopFloor) ||
        (Boolean(shopNameLower) &&
          (locKey === shopNameLower ||
            locKey.includes(shopNameLower) ||
            shopNameLower.includes(locKey)));
      return {
        name: matched?.name || info.displayName,
        rowCount: info.rowCount,
        totalUnits: info.totalUnits,
        existsInShop: Boolean(matched),
        existingStoreId: matched?.id,
        isDefaultFloor,
      };
    });

    return {
      totalRows: rawCount,
      validRows: sonkoRows.length,
      errorRows: errorCount,
      uniqueProductsCount: productKeys.size,
      variationsCount: variationKeys.size,
      categoriesDetected,
      storesDetected,
      duplicateStoreRowsInFile,
      totalQuantity: totalQty,
      totalPurchaseValue: Number(totalBuy.toFixed(2)),
      totalSaleValue: Number(totalSell.toFixed(2)),
      totalPotentialProfit: Number(totalProfit.toFixed(2)),
      totalHistoricalSold: totalHistSold,
      totalHistoricalTransferred: totalHistTrans,
      totalHistoricalAdjusted: totalHistAdj,
    };
  }

  private static buildProductIdentityKey(
    productName: string,
    sku?: string,
    variation?: string
  ): string {
    const cleanSku = (sku || '').trim().toLowerCase();
    const cleanVar = (normalizeVariation(variation) || '').toLowerCase();
    const cleanName = productName.trim().toLowerCase();
    if (cleanSku) {
      return `SKU:${cleanSku}::VAR:${cleanVar}`;
    }
    return `NAME:${cleanName}::VAR:${cleanVar}`;
  }

  // =========================================================================
  // UNIFIED MIGRATION & IMPORT EXECUTION
  // =========================================================================

  public static commitMigrationImport(
    parsed: UnifiedParseResult,
    options: MigrationCommitOptions,
    currentUser: User
  ): MigrationCommitResult {
    const shop = db.getShops().find(s => s.id === options.shopId);
    if (!shop) {
      return {
        success: false,
        format: parsed.format,
        strategy: options.strategy,
        createdProducts: 0,
        updatedProducts: 0,
        skippedRecords: 0,
        storesCreated: [],
        storesMatched: [],
        categoriesCreated: [],
        salesImported: 0,
        historicalUnitsPreserved: 0,
        snapshotSaved: false,
        errors: ['Selected target shop does not exist.'],
        warnings: [],
      };
    }

    const snapshotSaved =
      options.createPreSnapshot !== false
        ? db.savePreMigrationSnapshot(parsed.fileName || 'Excel Import')
        : false;

    if (parsed.format === 'SIMPLE_4_COL') {
      const simpleRes = this.commitSimpleRows(parsed.simpleRows, {
        shopId: options.shopId,
        targetStoreId: options.targetStoreId,
        strategy: options.strategy,
        fileName: parsed.fileName,
        fileHash: parsed.fileHash,
        rollbackAvailable: snapshotSaved,
        currentUser,
      });
      return {
        ...simpleRes,
        snapshotSaved,
      };
    }

    if (parsed.format === 'DETAILED_SALES_HISTORY') {
      const salesRes = this.commitDetailedSalesHistory(parsed.detailedSaleRows, {
        shopId: options.shopId,
        fileName: parsed.fileName,
        fileHash: parsed.fileHash,
        rollbackAvailable: snapshotSaved,
        currentUser,
      });
      return {
        ...salesRes,
        snapshotSaved,
      };
    }

    if (parsed.format === 'SONKO_19_COL') {
      const sonkoRes = this.commitSonkoMigration(parsed.sonkoRows, {
        shopId: options.shopId,
        shopFloorLocationName: options.shopFloorLocationName,
        strategy: options.strategy,
        fileName: parsed.fileName,
        fileHash: parsed.fileHash,
        rollbackAvailable: snapshotSaved,
        currentUser,
      });
      return {
        ...sonkoRes,
        snapshotSaved,
      };
    }

    return {
      success: false,
      format: parsed.format,
      strategy: options.strategy,
      createdProducts: 0,
      updatedProducts: 0,
      skippedRecords: 0,
      storesCreated: [],
      storesMatched: [],
      categoriesCreated: [],
      salesImported: 0,
      historicalUnitsPreserved: 0,
      snapshotSaved,
      errors: ['Unsupported or unmapped import format.'],
      warnings: [],
    };
  }

  private static commitSimpleRows(
    rows: ExcelProductRow[],
    opts: {
      shopId: string;
      targetStoreId?: string;
      strategy: MigrationStrategy;
      fileName: string;
      fileHash?: string;
      rollbackAvailable?: boolean;
      currentUser: User;
    }
  ): Omit<MigrationCommitResult, 'snapshotSaved'> {
    const shop = db.getShops().find(s => s.id === opts.shopId);
    if (!shop) {
      return {
        success: false,
        format: 'SIMPLE_4_COL',
        strategy: opts.strategy,
        createdProducts: 0,
        updatedProducts: 0,
        skippedRecords: 0,
        storesCreated: [],
        storesMatched: [],
        categoriesCreated: [],
        salesImported: 0,
        historicalUnitsPreserved: 0,
        errors: ['Selected shop does not exist.'],
        warnings: [],
      };
    }

    const targetStore = opts.targetStoreId
      ? db.getStores().find(s => s.id === opts.targetStoreId && s.shopId === opts.shopId)
      : undefined;

    if (opts.targetStoreId && !targetStore) {
      return {
        success: false,
        format: 'SIMPLE_4_COL',
        strategy: opts.strategy,
        createdProducts: 0,
        updatedProducts: 0,
        skippedRecords: 0,
        storesCreated: [],
        storesMatched: [],
        categoriesCreated: [],
        salesImported: 0,
        historicalUnitsPreserved: 0,
        errors: ['Selected destination store does not exist in this shop.'],
        warnings: [],
      };
    }

    const allProducts = [...db.getProducts()];
    const allStoresInShop = db.getStores().filter(s => s.shopId === opts.shopId);
    const floorStoreIds = new Set(allStoresInShop.filter(s => s.isShopFloor).map(s => s.id));
    const now = new Date().toISOString();

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];
    const newMovements: any[] = [];

    rows.forEach(row => {
      try {
        const existingIndex = allProducts.findIndex(
          p =>
            p.shopId === opts.shopId &&
            p.name.toLowerCase().trim() === row.productName.toLowerCase().trim() &&
            !p.variation
        );

        if (existingIndex !== -1) {
          if (opts.strategy === 'NEW_ONLY') {
            skipped++;
            return;
          }

          const existing = allProducts[existingIndex];
          const isToStore = Boolean(targetStore);

          if (isToStore && targetStore) {
            const nextStoreStocks = { ...(existing.storeStocks || {}) };
            const prevInStore =
              nextStoreStocks[targetStore.id] !== undefined
                ? Number(nextStoreStocks[targetStore.id] || 0)
                : Number(existing.storeStock || 0);
            const nextInStore =
              opts.strategy === 'RESTORE_REPLACE' ? row.quantity : prevInStore + row.quantity;
            nextStoreStocks[targetStore.id] = nextInStore;

            const nextStoreDetails = {
              ...(existing.storeDetails || {}),
              [targetStore.id]: {
                ...(existing.storeDetails?.[targetStore.id] || {
                  storeId: targetStore.id,
                  storeName: targetStore.name,
                }),
                storeId: targetStore.id,
                storeName: targetStore.name,
                quantity: nextInStore,
                unitPurchasePrice: row.buyingPrice > 0 ? row.buyingPrice : existing.purchasePrice,
                unitSellingPrice: row.sellingPrice,
                lastImportedAt: now,
              },
            };

            const totalWarehouse = Object.entries(nextStoreStocks).reduce((sum, [sid, q]) => {
              return floorStoreIds.has(sid) ? sum : sum + Math.max(0, Number(q || 0));
            }, 0);

            allProducts[existingIndex] = {
              ...existing,
              purchasePrice: row.buyingPrice > 0 ? row.buyingPrice : existing.purchasePrice,
              sellingPrice: row.sellingPrice,
              storeStock: totalWarehouse,
              storeStocks: nextStoreStocks,
              storeDetails: nextStoreDetails,
              updatedAt: now,
            };

            const diff = nextInStore - prevInStore;
            if (diff !== 0) {
              newMovements.push({
                id: generateUUID(),
                shopId: shop.id,
                shopName: shop.name,
                storeId: targetStore.id,
                productId: existing.id,
                productName: existing.name,
                previousQty: prevInStore,
                changeQty: diff,
                newQty: nextInStore,
                type: 'ADJUSTMENT',
                reason: `Excel import to store '${targetStore.name}' by ${opts.currentUser.name}`,
                userId: opts.currentUser.id,
                userName: opts.currentUser.name,
                createdAt: now,
              });
            }
          } else {
            const prevStock = existing.currentStock || 0;
            const newStock =
              opts.strategy === 'RESTORE_REPLACE' ? row.quantity : prevStock + row.quantity;
            const nextStoreStocks = existing.storeStocks ? { ...existing.storeStocks } : undefined;
            if (nextStoreStocks) {
              for (const fid of floorStoreIds) {
                if (nextStoreStocks[fid] !== undefined) nextStoreStocks[fid] = newStock;
              }
            }

            allProducts[existingIndex] = {
              ...existing,
              purchasePrice: row.buyingPrice > 0 ? row.buyingPrice : existing.purchasePrice,
              sellingPrice: row.sellingPrice,
              currentStock: newStock,
              ...(nextStoreStocks ? { storeStocks: nextStoreStocks } : {}),
              updatedAt: now,
            };

            const diff = newStock - prevStock;
            if (diff !== 0) {
              newMovements.push({
                id: generateUUID(),
                shopId: shop.id,
                shopName: shop.name,
                productId: existing.id,
                productName: existing.name,
                previousQty: prevStock,
                changeQty: diff,
                newQty: newStock,
                type: 'ADJUSTMENT',
                reason: `Excel import by ${opts.currentUser.name}`,
                userId: opts.currentUser.id,
                userName: opts.currentUser.name,
                createdAt: now,
              });
            }
          }

          db.enqueueSync({
            id: generateUUID(),
            operation: 'UPDATE_PRODUCT',
            entityType: 'PRODUCT',
            entityId: existing.id,
            payload: { ...allProducts[existingIndex], storeId: undefined },
            status: 'PENDING',
            createdAt: now,
          });

          updated++;
        } else {
          const productId = generateUUID();
          const sku = `SKU-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 900 + 100)}`;
          const barcode = `${Math.floor(100000000000 + Math.random() * 900000000000)}`;
          const isToStore = Boolean(targetStore);

          const newProduct: Product = {
            id: productId,
            shopId: opts.shopId,
            name: row.productName,
            sku,
            barcode,
            categoryId: '',
            sellingPrice: row.sellingPrice,
            purchasePrice: row.buyingPrice || 0,
            currentStock: isToStore ? 0 : row.quantity,
            storeStock: isToStore ? row.quantity : 0,
            ...(isToStore && targetStore
              ? {
                  storeStocks: { [targetStore.id]: row.quantity },
                  storeDetails: {
                    [targetStore.id]: {
                      storeId: targetStore.id,
                      storeName: targetStore.name,
                      quantity: row.quantity,
                      unitPurchasePrice: row.buyingPrice || 0,
                      unitSellingPrice: row.sellingPrice,
                      lastImportedAt: now,
                    },
                  },
                }
              : {}),
            minStock: 5,
            unit: 'pcs',
            status: 'ACTIVE',
            createdAt: now,
            updatedAt: now,
          };

          allProducts.push(newProduct);

          db.enqueueSync({
            id: generateUUID(),
            operation: 'CREATE_PRODUCT',
            entityType: 'PRODUCT',
            entityId: productId,
            payload: { ...newProduct, storeId: undefined },
            status: 'PENDING',
            createdAt: now,
          });

          if (row.quantity > 0) {
            newMovements.push({
              id: generateUUID(),
              shopId: shop.id,
              shopName: shop.name,
              ...(isToStore && targetStore ? { storeId: targetStore.id } : {}),
              productId,
              productName: row.productName,
              previousQty: 0,
              changeQty: row.quantity,
              newQty: row.quantity,
              type: isToStore ? 'INITIAL_STOCK' : 'ADJUSTMENT',
              reason: isToStore && targetStore
                ? `Excel import to store '${targetStore.name}' by ${opts.currentUser.name}`
                : `Excel import by ${opts.currentUser.name}`,
              userId: opts.currentUser.id,
              userName: opts.currentUser.name,
              createdAt: now,
            });
          }

          created++;
        }
      } catch (err: any) {
        errors.push(`"${row.productName}": ${err.message}`);
      }
    });

    if (newMovements.length > 0) {
      db.saveMovements([...newMovements, ...db.getMovements()]);
    }

    if (created > 0 || updated > 0) {
      db.saveProducts(allProducts);

      db.addImportHistory({
        id: generateUUID(),
        fileName: opts.fileName || 'Excel Import',
        dataType: 'PRODUCTS',
        totalRecords: rows.length,
        successCount: created + updated,
        failedCount: errors.length,
        createdCount: created,
        updatedCount: updated,
        skippedCount: skipped,
        fileHash: opts.fileHash,
        format: 'SIMPLE_4_COL',
        strategy: opts.strategy,
        rollbackAvailable: opts.rollbackAvailable,
        importedByUserId: opts.currentUser.id,
        importedByName: opts.currentUser.name,
        createdAt: now,
        notes: targetStore
          ? `4-col import to ${shop.name} -> ${targetStore.name}`
          : `4-col import to ${shop.name} (Shop Floor)`,
      });
    }

    return {
      success: errors.length === 0,
      format: 'SIMPLE_4_COL',
      strategy: opts.strategy,
      createdProducts: created,
      updatedProducts: updated,
      skippedRecords: skipped,
      storesCreated: [],
      storesMatched: targetStore ? [targetStore.name] : [],
      categoriesCreated: [],
      salesImported: 0,
      historicalUnitsPreserved: 0,
      errors,
      warnings: [],
    };
  }

  /**
   * Complete SONKO SOUND SHOP 19-Column Migration:
   * - Restores multiple stores without duplication.
   * - Collapses same product+variation across different stores into ONE Product with per-store `storeStocks`.
   * - Preserves variations, categories, SKUs, custom fields, source valuations.
   * - Preserves aggregate historical sales/transfers/adjustments WITHOUT turning them into dated live Sales or Movements.
   */
  private static commitSonkoMigration(
    rows: SonkoImportRow[],
    opts: {
      shopId: string;
      shopFloorLocationName?: string;
      strategy: MigrationStrategy;
      fileName: string;
      fileHash?: string;
      rollbackAvailable?: boolean;
      currentUser: User;
    }
  ): Omit<MigrationCommitResult, 'snapshotSaved'> {
    const shop = db.getShops().find(s => s.id === opts.shopId)!;
    const now = new Date().toISOString();

    // 1. Resolve or create all Stores from Location column
    const existingStores = [...db.getStores()];
    const storeByLocationKey = new Map<string, Store>();
    const storesCreated: string[] = [];
    const storesMatchedSet = new Set<string>();

    // Determine which location name (if any) maps to Shop Floor
    const shopNameNorm = shop.name.trim().toLowerCase();
    const explicitFloorNorm =
      opts.shopFloorLocationName === 'NONE'
        ? '__NONE__'
        : opts.shopFloorLocationName
          ? opts.shopFloorLocationName.trim().toLowerCase()
          : null;

    const uniqueLocations = new Map<string, string>();
    for (const r of rows) {
      const key = r.location.trim().toLowerCase();
      if (!uniqueLocations.has(key)) {
        uniqueLocations.set(key, r.location.trim());
      }
    }

    for (const [locKey, displayName] of uniqueLocations.entries()) {
      const isDesignatedFloor =
        explicitFloorNorm === '__NONE__'
          ? false
          : explicitFloorNorm !== null
            ? locKey === explicitFloorNorm
            : locKey === shopNameNorm ||
              locKey.includes(shopNameNorm) ||
              shopNameNorm.includes(locKey);

      const existingIdx = existingStores.findIndex(
        s => s.shopId === opts.shopId && s.name.trim().toLowerCase() === locKey
      );

      if (existingIdx !== -1) {
        const currentStore = existingStores[existingIdx];
        if (isDesignatedFloor && !currentStore.isShopFloor) {
          existingStores[existingIdx] = {
            ...currentStore,
            isShopFloor: true,
            updatedAt: now,
          };
          db.enqueueSync({
            id: generateUUID(),
            operation: 'UPDATE_STORE',
            entityType: 'STORE',
            entityId: currentStore.id,
            payload: existingStores[existingIdx],
            status: 'PENDING',
            createdAt: now,
          });
        }
        storeByLocationKey.set(locKey, existingStores[existingIdx]);
        storesMatchedSet.add(existingStores[existingIdx].name);
      } else {
        const newStore: Store = {
          id: generateUUID(),
          shopId: opts.shopId,
          name: displayName, // Preserve original store name e.g. "STORE NO 1", "SONKO SOUND SHOP", "STORE NO 2 Spea"
          location: displayName,
          status: 'ACTIVE',
          isShopFloor: isDesignatedFloor,
          createdAt: now,
          updatedAt: now,
        };
        existingStores.push(newStore);
        storeByLocationKey.set(locKey, newStore);
        storesCreated.push(newStore.name);

        db.enqueueSync({
          id: generateUUID(),
          operation: 'CREATE_STORE',
          entityType: 'STORE',
          entityId: newStore.id,
          payload: newStore,
          status: 'PENDING',
          createdAt: now,
        });
      }
    }
    db.saveStores(existingStores);

    // 2. Resolve or create Categories in target shop
    const existingCats = [...db.getCategories()];
    const catByKey = new Map<string, Category>();
    const categoriesCreated: string[] = [];

    for (const c of existingCats) {
      if (c.shopId === opts.shopId) {
        catByKey.set(c.name.trim().toLowerCase(), c);
      }
    }

    const palette = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#06b6d4', '#ec4899'];
    for (const r of rows) {
      if (!r.categoryName) continue;
      const cKey = r.categoryName.trim().toLowerCase();
      if (!catByKey.has(cKey)) {
        const newCat: Category = {
          id: `cat-${generateUUID().slice(0, 8)}`,
          shopId: opts.shopId,
          name: r.categoryName.trim(),
          icon: 'Package',
          color: palette[categoriesCreated.length % palette.length],
          status: 'ACTIVE',
          createdAt: now,
          updatedAt: now,
        };
        existingCats.push(newCat);
        catByKey.set(cKey, newCat);
        categoriesCreated.push(newCat.name);

        db.enqueueSync({
          id: generateUUID(),
          operation: 'CREATE_CATEGORY',
          entityType: 'CATEGORY',
          entityId: newCat.id,
          payload: newCat,
          status: 'PENDING',
          createdAt: now,
        });
      }
    }
    if (categoriesCreated.length > 0) {
      db.saveCategories(existingCats);
    }

    // 3. Group rows into unique Product+Variation entries spanning multiple Stores
    interface AggregatedStoreBucket {
      store: Store;
      quantity: number;
      unitPurchasePrice: number;
      unitSellingPrice: number;
      importedPurchaseValue?: number;
      importedSaleValue?: number;
      importedPotentialProfit?: number;
      historicalUnitsSold: number;
      historicalUnitsTransferred: number;
      historicalUnitsAdjusted: number;
    }

    interface AggregatedProductGroup {
      identityKey: string;
      name: string;
      sku?: string;
      variation?: string;
      categoryId: string;
      unitPurchasePrice: number;
      unitSellingPrice: number;
      customFields?: ProductCustomFields;
      storeBuckets: Map<string, AggregatedStoreBucket>;
    }

    const productGroups = new Map<string, AggregatedProductGroup>();

    for (const r of rows) {
      const idKey = this.buildProductIdentityKey(r.productName, r.sku, r.variation);
      const locKey = r.location.trim().toLowerCase();
      const store = storeByLocationKey.get(locKey)!;
      const catId = r.categoryName
        ? catByKey.get(r.categoryName.trim().toLowerCase())?.id || ''
        : '';

      let group = productGroups.get(idKey);
      if (!group) {
        group = {
          identityKey: idKey,
          name: r.productName.trim(),
          sku: r.sku?.trim(),
          variation: r.variation,
          categoryId: catId,
          unitPurchasePrice: r.unitPurchasePrice,
          unitSellingPrice: r.unitSellingPrice,
          customFields: r.customFields ? { ...r.customFields } : undefined,
          storeBuckets: new Map(),
        };
        productGroups.set(idKey, group);
      } else {
        if (!group.categoryId && catId) group.categoryId = catId;
        if (r.unitPurchasePrice > 0) group.unitPurchasePrice = r.unitPurchasePrice;
        if (r.unitSellingPrice > 0) group.unitSellingPrice = r.unitSellingPrice;
        if (r.customFields) {
          group.customFields = { ...(group.customFields || {}), ...r.customFields };
        }
      }

      const existingBucket = group.storeBuckets.get(store.id);
      if (!existingBucket) {
        group.storeBuckets.set(store.id, {
          store,
          quantity: r.currentStock,
          unitPurchasePrice: r.unitPurchasePrice,
          unitSellingPrice: r.unitSellingPrice,
          importedPurchaseValue: r.importedPurchaseValue,
          importedSaleValue: r.importedSaleValue,
          importedPotentialProfit: r.importedPotentialProfit,
          historicalUnitsSold: r.historicalUnitsSold,
          historicalUnitsTransferred: r.historicalUnitsTransferred,
          historicalUnitsAdjusted: r.historicalUnitsAdjusted,
        });
      } else {
        // Same product+variation appeared twice in the same Location within the uploaded file
        existingBucket.quantity += r.currentStock;
        if (r.unitPurchasePrice > 0) existingBucket.unitPurchasePrice = r.unitPurchasePrice;
        if (r.unitSellingPrice > 0) existingBucket.unitSellingPrice = r.unitSellingPrice;
        if (r.importedPurchaseValue !== undefined) {
          existingBucket.importedPurchaseValue =
            (existingBucket.importedPurchaseValue || 0) + r.importedPurchaseValue;
        }
        if (r.importedSaleValue !== undefined) {
          existingBucket.importedSaleValue =
            (existingBucket.importedSaleValue || 0) + r.importedSaleValue;
        }
        if (r.importedPotentialProfit !== undefined) {
          existingBucket.importedPotentialProfit =
            (existingBucket.importedPotentialProfit || 0) + r.importedPotentialProfit;
        }
        existingBucket.historicalUnitsSold += r.historicalUnitsSold;
        existingBucket.historicalUnitsTransferred += r.historicalUnitsTransferred;
        existingBucket.historicalUnitsAdjusted += r.historicalUnitsAdjusted;
      }
    }

    // 4. Persist grouped Products cleanly under selected Strategy
    const allProducts = [...db.getProducts()];
    const shopStores = existingStores.filter(s => s.shopId === opts.shopId);
    const floorStoreIds = new Set(shopStores.filter(s => s.isShopFloor).map(s => s.id));
    const usedSkusInShop = new Set(
      allProducts
        .filter(p => p.shopId === opts.shopId && p.sku)
        .map(p => p.sku.trim().toLowerCase())
    );

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let totalHistoricalSoldPreserved = 0;
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const group of productGroups.values()) {
      try {
        // Match existing product strictly on (SKU+variation) when SKU exists, else (name+variation)
        const existingIndex = allProducts.findIndex(p => {
          if (p.shopId !== opts.shopId) return false;
          const pVar = (p.variation || '').trim().toLowerCase();
          const gVar = (group.variation || '').trim().toLowerCase();
          if (pVar !== gVar) return false;
          if (group.sku) {
            return p.sku.trim().toLowerCase() === group.sku.trim().toLowerCase();
          }
          return p.name.trim().toLowerCase() === group.name.trim().toLowerCase();
        });

        if (existingIndex !== -1) {
          const existing = allProducts[existingIndex];

          if (opts.strategy === 'NEW_ONLY') {
            // Only attach missing stores without altering existing stock or historical values
            const nextStoreStocks = { ...(existing.storeStocks || {}) };
            const nextStoreDetails = { ...(existing.storeDetails || {}) };
            let attachedNewStore = false;

            for (const bucket of group.storeBuckets.values()) {
              if (nextStoreStocks[bucket.store.id] === undefined) {
                nextStoreStocks[bucket.store.id] = bucket.quantity;
                nextStoreDetails[bucket.store.id] = {
                  storeId: bucket.store.id,
                  storeName: bucket.store.name,
                  quantity: bucket.quantity,
                  unitPurchasePrice: bucket.unitPurchasePrice,
                  unitSellingPrice: bucket.unitSellingPrice,
                  importedPurchaseValue: bucket.importedPurchaseValue,
                  importedSaleValue: bucket.importedSaleValue,
                  importedPotentialProfit: bucket.importedPotentialProfit,
                  historicalUnitsSold: bucket.historicalUnitsSold,
                  historicalUnitsTransferred: bucket.historicalUnitsTransferred,
                  historicalUnitsAdjusted: bucket.historicalUnitsAdjusted,
                  lastImportedAt: now,
                };
                attachedNewStore = true;
              } else {
                skipped++;
              }
            }

            if (attachedNewStore) {
              const totals = this.recomputeTotalsFromDetails(
                nextStoreStocks,
                nextStoreDetails,
                floorStoreIds,
                existing
              );
              allProducts[existingIndex] = {
                ...existing,
                ...totals,
                storeStocks: nextStoreStocks,
                storeDetails: nextStoreDetails,
                historicalNote:
                  totals.historicalUnitsSold ||
                  totals.historicalUnitsTransferred ||
                  totals.historicalUnitsAdjusted
                    ? 'Historical date unavailable'
                    : existing.historicalNote,
                updatedAt: now,
              };
              db.enqueueSync({
                id: generateUUID(),
                operation: 'UPDATE_PRODUCT',
                entityType: 'PRODUCT',
                entityId: existing.id,
                payload: { ...allProducts[existingIndex], storeId: undefined },
                status: 'PENDING',
                createdAt: now,
              });
              totalHistoricalSoldPreserved += totals.historicalUnitsSold || 0;
              updated++;
            }
            continue;
          }

          // RESTORE_REPLACE or MERGE_ADD
          const nextStoreStocks = { ...(existing.storeStocks || {}) };
          const nextStoreDetails = { ...(existing.storeDetails || {}) };

          for (const bucket of group.storeBuckets.values()) {
            const prevDetail = nextStoreDetails[bucket.store.id];
            const prevQty = Number(nextStoreStocks[bucket.store.id] ?? 0);

            if (opts.strategy === 'RESTORE_REPLACE') {
              nextStoreStocks[bucket.store.id] = bucket.quantity;
              nextStoreDetails[bucket.store.id] = {
                storeId: bucket.store.id,
                storeName: bucket.store.name,
                quantity: bucket.quantity,
                unitPurchasePrice: bucket.unitPurchasePrice,
                unitSellingPrice: bucket.unitSellingPrice,
                importedPurchaseValue: bucket.importedPurchaseValue,
                importedSaleValue: bucket.importedSaleValue,
                importedPotentialProfit: bucket.importedPotentialProfit,
                historicalUnitsSold: bucket.historicalUnitsSold,
                historicalUnitsTransferred: bucket.historicalUnitsTransferred,
                historicalUnitsAdjusted: bucket.historicalUnitsAdjusted,
                lastImportedAt: now,
              };
            } else {
              // MERGE_ADD
              const combinedQty = prevQty + bucket.quantity;
              nextStoreStocks[bucket.store.id] = combinedQty;
              nextStoreDetails[bucket.store.id] = {
                storeId: bucket.store.id,
                storeName: bucket.store.name,
                quantity: combinedQty,
                unitPurchasePrice:
                  bucket.unitPurchasePrice > 0
                    ? bucket.unitPurchasePrice
                    : prevDetail?.unitPurchasePrice || existing.purchasePrice,
                unitSellingPrice:
                  bucket.unitSellingPrice > 0
                    ? bucket.unitSellingPrice
                    : prevDetail?.unitSellingPrice || existing.sellingPrice,
                importedPurchaseValue:
                  bucket.importedPurchaseValue !== undefined ||
                  prevDetail?.importedPurchaseValue !== undefined
                    ? (prevDetail?.importedPurchaseValue || 0) +
                      (bucket.importedPurchaseValue || 0)
                    : undefined,
                importedSaleValue:
                  bucket.importedSaleValue !== undefined ||
                  prevDetail?.importedSaleValue !== undefined
                    ? (prevDetail?.importedSaleValue || 0) + (bucket.importedSaleValue || 0)
                    : undefined,
                importedPotentialProfit:
                  bucket.importedPotentialProfit !== undefined ||
                  prevDetail?.importedPotentialProfit !== undefined
                    ? (prevDetail?.importedPotentialProfit || 0) +
                      (bucket.importedPotentialProfit || 0)
                    : undefined,
                historicalUnitsSold:
                  (prevDetail?.historicalUnitsSold || 0) + bucket.historicalUnitsSold,
                historicalUnitsTransferred:
                  (prevDetail?.historicalUnitsTransferred || 0) +
                  bucket.historicalUnitsTransferred,
                historicalUnitsAdjusted:
                  (prevDetail?.historicalUnitsAdjusted || 0) + bucket.historicalUnitsAdjusted,
                lastImportedAt: now,
              };
            }
          }

          const totals = this.recomputeTotalsFromDetails(
            nextStoreStocks,
            nextStoreDetails,
            floorStoreIds,
            existing
          );

          allProducts[existingIndex] = {
            ...existing,
            name: group.name,
            ...(group.variation ? { variation: group.variation } : {}),
            categoryId: group.categoryId || existing.categoryId,
            purchasePrice:
              group.unitPurchasePrice > 0 ? group.unitPurchasePrice : existing.purchasePrice,
            sellingPrice:
              group.unitSellingPrice > 0 ? group.unitSellingPrice : existing.sellingPrice,
            ...(group.customFields
              ? { customFields: { ...(existing.customFields || {}), ...group.customFields } }
              : {}),
            storeStocks: nextStoreStocks,
            storeDetails: nextStoreDetails,
            ...totals,
            historicalNote:
              (totals.historicalUnitsSold || 0) > 0 ||
              (totals.historicalUnitsTransferred || 0) > 0 ||
              (totals.historicalUnitsAdjusted || 0) > 0
                ? 'Historical date unavailable'
                : existing.historicalNote,
            updatedAt: now,
          };

          db.enqueueSync({
            id: generateUUID(),
            operation: 'UPDATE_PRODUCT',
            entityType: 'PRODUCT',
            entityId: existing.id,
            payload: { ...allProducts[existingIndex], storeId: undefined },
            status: 'PENDING',
            createdAt: now,
          });

          totalHistoricalSoldPreserved += totals.historicalUnitsSold || 0;
          updated++;
        } else {
          // Create brand new single Product spanning all detected stores
          let resolvedSku = group.sku;
          if (!resolvedSku) {
            resolvedSku = `SKU-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 900 + 100)}`;
          } else if (usedSkusInShop.has(resolvedSku.toLowerCase())) {
            // Different variation sharing a parent SKU in legacy export — preserve base SKU cleanly
            const suffix = group.variation
              ? group.variation.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase()
              : `${Math.floor(Math.random() * 90 + 10)}`;
            const candidate = `${resolvedSku}-${suffix}`;
            resolvedSku = usedSkusInShop.has(candidate.toLowerCase())
              ? `${candidate}-${Math.floor(Math.random() * 90 + 10)}`
              : candidate;
          }
          usedSkusInShop.add(resolvedSku.toLowerCase());

          const nextStoreStocks: Record<string, number> = {};
          const nextStoreDetails: Record<string, ProductStoreStockDetail> = {};

          for (const bucket of group.storeBuckets.values()) {
            nextStoreStocks[bucket.store.id] = bucket.quantity;
            nextStoreDetails[bucket.store.id] = {
              storeId: bucket.store.id,
              storeName: bucket.store.name,
              quantity: bucket.quantity,
              unitPurchasePrice: bucket.unitPurchasePrice,
              unitSellingPrice: bucket.unitSellingPrice,
              importedPurchaseValue: bucket.importedPurchaseValue,
              importedSaleValue: bucket.importedSaleValue,
              importedPotentialProfit: bucket.importedPotentialProfit,
              historicalUnitsSold: bucket.historicalUnitsSold,
              historicalUnitsTransferred: bucket.historicalUnitsTransferred,
              historicalUnitsAdjusted: bucket.historicalUnitsAdjusted,
              lastImportedAt: now,
            };
          }

          const totals = this.recomputeTotalsFromDetails(
            nextStoreStocks,
            nextStoreDetails,
            floorStoreIds
          );

          const productId = generateUUID();
          const newProduct: Product = {
            id: productId,
            shopId: opts.shopId,
            name: group.name,
            ...(group.variation ? { variation: group.variation } : {}),
            sku: resolvedSku,
            barcode: `${Math.floor(100000000000 + Math.random() * 900000000000)}`,
            categoryId: group.categoryId || '',
            sellingPrice: group.unitSellingPrice,
            purchasePrice: group.unitPurchasePrice || 0,
            minStock: 5,
            unit: 'pcs',
            status: 'ACTIVE',
            ...(group.customFields ? { customFields: group.customFields } : {}),
            storeStocks: nextStoreStocks,
            storeDetails: nextStoreDetails,
            ...totals,
            ...((totals.historicalUnitsSold || 0) > 0 ||
            (totals.historicalUnitsTransferred || 0) > 0 ||
            (totals.historicalUnitsAdjusted || 0) > 0
              ? { historicalNote: 'Historical date unavailable' }
              : {}),
            createdAt: now,
            updatedAt: now,
          };

          allProducts.push(newProduct);

          db.enqueueSync({
            id: generateUUID(),
            operation: 'CREATE_PRODUCT',
            entityType: 'PRODUCT',
            entityId: productId,
            payload: { ...newProduct, storeId: undefined },
            status: 'PENDING',
            createdAt: now,
          });

          totalHistoricalSoldPreserved += totals.historicalUnitsSold || 0;
          created++;
        }
      } catch (err: any) {
        errors.push(`"${group.name}": ${err?.message || 'Import error'}`);
      }
    }

    if (created > 0 || updated > 0) {
      db.saveProducts(allProducts);
    }

    db.addImportHistory({
      id: generateUUID(),
      fileName: opts.fileName,
      dataType: 'PRODUCTS',
      totalRecords: rows.length,
      successCount: created + updated,
      failedCount: errors.length,
      createdCount: created,
      updatedCount: updated,
      skippedCount: skipped,
      fileHash: opts.fileHash,
      format: 'SONKO_19_COL',
      strategy: opts.strategy,
      storesCreated,
      historicalUnitsSold: totalHistoricalSoldPreserved,
      rollbackAvailable: opts.rollbackAvailable,
      importedByUserId: opts.currentUser.id,
      importedByName: opts.currentUser.name,
      createdAt: now,
      notes: `SONKO migration (${opts.strategy}) to ${shop.name} • Stores: ${Array.from(
        new Set([...storesCreated, ...storesMatchedSet])
      ).join(', ')}`,
    });

    db.addAuditLog({
      id: generateUUID(),
      userId: opts.currentUser.id,
      userName: opts.currentUser.name,
      action: 'MIGRATION_IMPORT',
      details: `Imported "${opts.fileName}" (${opts.strategy}) into [${shop.name}]: +${created} created, ${updated} updated, ${storesCreated.length} new stores, ${totalHistoricalSoldPreserved} historical units referenced (no fake dated sales generated).`,
      entityType: 'IMPORT',
      shopId: opts.shopId,
      timestamp: now,
    });

    return {
      success: errors.length === 0,
      format: 'SONKO_19_COL',
      strategy: opts.strategy,
      createdProducts: created,
      updatedProducts: updated,
      skippedRecords: skipped,
      storesCreated,
      storesMatched: Array.from(storesMatchedSet),
      categoriesCreated,
      salesImported: 0,
      historicalUnitsPreserved: totalHistoricalSoldPreserved,
      errors,
      warnings,
    };
  }

  private static recomputeTotalsFromDetails(
    storeStocks: Record<string, number>,
    storeDetails: Record<string, ProductStoreStockDetail>,
    floorStoreIds: Set<string>,
    existing?: Product
  ) {
    let currentStock = 0;
    let hasFloorKey = false;
    let storeStock = 0;

    for (const [sid, q] of Object.entries(storeStocks)) {
      const qty = Math.max(0, Number(q || 0));
      if (floorStoreIds.has(sid)) {
        currentStock += qty;
        hasFloorKey = true;
      } else {
        storeStock += qty;
      }
    }

    if (!hasFloorKey && existing && floorStoreIds.size === 0) {
      // Keep any non-store floor quantity if no location was designated as floor
      currentStock = existing.currentStock || 0;
    }

    let importedPurchaseValue: number | undefined;
    let importedSaleValue: number | undefined;
    let importedPotentialProfit: number | undefined;
    let historicalUnitsSold = 0;
    let historicalUnitsTransferred = 0;
    let historicalUnitsAdjusted = 0;

    for (const detail of Object.values(storeDetails)) {
      if (detail.importedPurchaseValue !== undefined) {
        importedPurchaseValue = (importedPurchaseValue || 0) + detail.importedPurchaseValue;
      }
      if (detail.importedSaleValue !== undefined) {
        importedSaleValue = (importedSaleValue || 0) + detail.importedSaleValue;
      }
      if (detail.importedPotentialProfit !== undefined) {
        importedPotentialProfit =
          (importedPotentialProfit || 0) + detail.importedPotentialProfit;
      }
      historicalUnitsSold += detail.historicalUnitsSold || 0;
      historicalUnitsTransferred += detail.historicalUnitsTransferred || 0;
      historicalUnitsAdjusted += detail.historicalUnitsAdjusted || 0;
    }

    return {
      currentStock,
      storeStock,
      ...(importedPurchaseValue !== undefined
        ? { importedPurchaseValue: Number(importedPurchaseValue.toFixed(2)) }
        : {}),
      ...(importedSaleValue !== undefined
        ? { importedSaleValue: Number(importedSaleValue.toFixed(2)) }
        : {}),
      ...(importedPotentialProfit !== undefined
        ? { importedPotentialProfit: Number(importedPotentialProfit.toFixed(2)) }
        : {}),
      historicalUnitsSold,
      historicalUnitsTransferred,
      historicalUnitsAdjusted,
    };
  }

  /**
   * Future Detailed Sales History Import:
   * Only commits timestamped Sale records that have genuine original dates.
   * Deduplicates on receiptNumber and never alters current stock.
   */
  private static commitDetailedSalesHistory(
    rows: DetailedSaleImportRow[],
    opts: {
      shopId: string;
      fileName: string;
      fileHash?: string;
      rollbackAvailable?: boolean;
      currentUser: User;
    }
  ): Omit<MigrationCommitResult, 'snapshotSaved'> {
    const shop = db.getShops().find(s => s.id === opts.shopId)!;
    const existingSales = [...db.getSales()];
    const existingReceipts = new Set(
      existingSales.map(s => s.receiptNumber.trim().toLowerCase())
    );
    const shopProducts = db.getProducts().filter(p => p.shopId === opts.shopId);
    const now = new Date().toISOString();

    // Group rows by receiptNumber
    const receiptGroups = new Map<string, DetailedSaleImportRow[]>();
    let skipped = 0;

    for (const row of rows) {
      const recKey = row.receiptNumber.trim().toLowerCase();
      if (existingReceipts.has(recKey)) {
        skipped++;
        continue;
      }
      const list = receiptGroups.get(row.receiptNumber.trim()) || [];
      list.push(row);
      receiptGroups.set(row.receiptNumber.trim(), list);
    }

    const newSales: Sale[] = [];
    const errors: string[] = [];

    for (const [receiptNumber, groupRows] of receiptGroups.entries()) {
      try {
        const saleId = generateUUID();
        const first = groupRows[0];
        let subtotal = 0;
        let costOfGoods = 0;

        const items: SaleItem[] = groupRows.map(r => {
          const matchedProd = shopProducts.find(p => {
            if (r.sku && p.sku.trim().toLowerCase() === r.sku.trim().toLowerCase()) {
              return (p.variation || '').toLowerCase() === (r.variation || '').toLowerCase();
            }
            return (
              p.name.trim().toLowerCase() === r.productName.trim().toLowerCase() &&
              (p.variation || '').toLowerCase() === (r.variation || '').toLowerCase()
            );
          });
          const buyPrice =
            r.buyingPrice !== undefined ? r.buyingPrice : matchedProd?.purchasePrice || 0;
          const lineTotal = Number((r.quantity * r.unitPrice).toFixed(2));
          subtotal += lineTotal;
          costOfGoods += r.quantity * buyPrice;

          return {
            id: generateUUID(),
            saleId,
            shopId: opts.shopId,
            productId: matchedProd?.id || `hist-${generateUUID().slice(0, 8)}`,
            productName: r.variation ? `${r.productName} (${r.variation})` : r.productName,
            sku: r.sku || matchedProd?.sku || 'HIST-SKU',
            unitPrice: r.unitPrice,
            purchasePrice: buyPrice,
            quantity: r.quantity,
            discount: 0,
            total: lineTotal,
          };
        });

        const total = Number(subtotal.toFixed(2));
        const cog = Number(costOfGoods.toFixed(2));
        const grossProfit = Number((total - cog).toFixed(2));

        const sale: Sale = {
          id: saleId,
          receiptNumber,
          shopId: opts.shopId,
          shopName: shop.name,
          sellerId: opts.currentUser.id,
          sellerName: first.sellerName || 'Historical Import',
          subtotal: total,
          discount: 0,
          tax: 0,
          total,
          costOfGoods: cog,
          grossProfit,
          paymentMethod: first.paymentMethod,
          amountReceived: total,
          change: 0,
          status: 'COMPLETED',
          notes: first.customerName
            ? `Imported historical sale • Customer: ${first.customerName}`
            : 'Imported historical sale',
          createdAt: first.saleDateIso,
          items,
        };

        newSales.push(sale);
        db.enqueueSync({
          id: generateUUID(),
          operation: 'CREATE_SALE',
          entityType: 'SALE',
          entityId: sale.id,
          payload: sale,
          status: 'PENDING',
          createdAt: now,
        });
      } catch (err: any) {
        errors.push(`Receipt "${receiptNumber}": ${err?.message || 'Error'}`);
      }
    }

    if (newSales.length > 0) {
      db.saveSales([...newSales, ...existingSales]);
      db.addImportHistory({
        id: generateUUID(),
        fileName: opts.fileName,
        dataType: 'SALES',
        totalRecords: rows.length,
        successCount: newSales.length,
        failedCount: errors.length,
        createdCount: newSales.length,
        skippedCount: skipped,
        fileHash: opts.fileHash,
        format: 'DETAILED_SALES_HISTORY',
        strategy: 'NEW_ONLY',
        rollbackAvailable: opts.rollbackAvailable,
        importedByUserId: opts.currentUser.id,
        importedByName: opts.currentUser.name,
        createdAt: now,
        notes: `Imported ${newSales.length} timestamped historical sales to ${shop.name}`,
      });
    }

    return {
      success: errors.length === 0,
      format: 'DETAILED_SALES_HISTORY',
      strategy: 'NEW_ONLY',
      createdProducts: 0,
      updatedProducts: 0,
      skippedRecords: skipped,
      storesCreated: [],
      storesMatched: [],
      categoriesCreated: [],
      salesImported: newSales.length,
      historicalUnitsPreserved: 0,
      errors,
      warnings: [],
    };
  }

  // =========================================================================
  // VALUE PARSING HELPERS
  // =========================================================================

  private static parseNumber(val: any): number {
    if (val === null || val === undefined || val === '') return NaN;
    if (typeof val === 'number') return val;
    const str = String(val).trim();
    if (!str) return NaN;
    const isParenNeg = /^\(.*\)$/.test(str);
    const cleaned = str.replace(/[^0-9.\-]/g, '');
    if (!cleaned || cleaned === '-' || cleaned === '.') return NaN;
    const n = parseFloat(cleaned);
    if (isNaN(n)) return NaN;
    return isParenNeg ? -Math.abs(n) : n;
  }

  private static parseOptionalNumber(val: any): number | undefined {
    const n = this.parseNumber(val);
    return isNaN(n) ? undefined : n;
  }

  private static parseNumberOrZero(val: any): number {
    const n = this.parseNumber(val);
    return isNaN(n) ? 0 : n;
  }

  private static parseStrictDate(val: any): string | null {
    if (val === null || val === undefined || val === '') return null;
    if (val instanceof Date && !isNaN(val.getTime())) {
      return val.toISOString();
    }
    if (typeof val === 'number' && val > 20000 && val < 80000) {
      // Excel serial date
      const utcMs = (val - 25569) * 86400 * 1000;
      const d = new Date(utcMs);
      return isNaN(d.getTime()) ? null : d.toISOString();
    }
    const s = String(val).trim();
    if (!s) return null;
    const parsed = new Date(s);
    if (!isNaN(parsed.getTime()) && parsed.getFullYear() >= 2000) {
      return parsed.toISOString();
    }
    // Try DD/MM/YYYY or DD-MM-YYYY
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) {
      const day = Number(m[1]);
      const month = Number(m[2]) - 1;
      const year = Number(m[3]);
      const hr = Number(m[4] || 12);
      const min = Number(m[5] || 0);
      const sec = Number(m[6] || 0);
      const d = new Date(year, month, day, hr, min, sec);
      if (!isNaN(d.getTime())) return d.toISOString();
    }
    return null;
  }

  private static buildEmptyParseResult(
    fileName: string,
    sheetName: string,
    errorMessage: string
  ): UnifiedParseResult {
    return {
      success: false,
      format: 'UNCERTAIN',
      detectionConfidence: 'LOW',
      needsManualMapping: false,
      fileName,
      sheetName,
      fileHash: '',
      headers: [],
      rawRows: [],
      columnMapping: {},
      simpleRows: [],
      sonkoRows: [],
      detailedSaleRows: [],
      errors: [{ rowNumber: 0, message: errorMessage }],
      warnings: [],
      previewSummary: {
        totalRows: 0,
        validRows: 0,
        errorRows: 1,
        uniqueProductsCount: 0,
        variationsCount: 0,
        categoriesDetected: [],
        storesDetected: [],
        duplicateStoreRowsInFile: 0,
        totalQuantity: 0,
        totalPurchaseValue: 0,
        totalSaleValue: 0,
        totalPotentialProfit: 0,
        totalHistoricalSold: 0,
        totalHistoricalTransferred: 0,
        totalHistoricalAdjusted: 0,
      },
    };
  }
}
