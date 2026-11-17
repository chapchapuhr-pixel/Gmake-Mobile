import React, { useState, useRef } from 'react';
import {
  Database,
  Download,
  Upload,
  RefreshCw,
  FileSpreadsheet,
  Layers,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Cloud,
  Code,
  AlertCircle,
  Warehouse,
  ShieldAlert,
  SlidersHorizontal,
  History as HistoryIcon,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { db } from '../../db/storage';
import { BackupService } from '../../services/backupService';
import { QuickBooksService } from '../../services/quickbooksService';
import { SyncService } from '../../services/syncService';
import { CsvDataService, ImportValidationResult } from '../../services/csvDataService';
import {
  CanonicalImportField,
  ExcelImportService,
  ImportFormatType,
  MigrationCommitResult,
  MigrationStrategy,
  UnifiedParseResult,
} from '../../services/excelImportService';
import { ExcelExportService } from '../../services/excelExportService';
import { CsvDataType } from '../../types';
import { formatCurrency, formatDateTime } from '../../utils/formatters';

type ExportFormat = 'xlsx' | 'csv';

export const AdminDataManagement: React.FC = () => {
  const { currentUser, dbState, addToast } = useApp();
  const [activeSubTab, setActiveSubTab] = useState<'csv' | 'backup' | 'quickbooks' | 'sync'>('csv');

  // Sub-tab state
  const [csvSection, setCsvSection] = useState<'import' | 'export' | 'templates' | 'history'>('import');
  const [selectedExportType, setSelectedExportType] = useState<CsvDataType>('PRODUCTS');
  const [selectedExportShopId, setSelectedExportShopId] = useState<string>('');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('xlsx');

  // CSV Import State
  const [importDataType, setImportDataType] = useState<CsvDataType>('PRODUCTS');
  const [uploadedFileName, setUploadedFileName] = useState<string>('');
  const [validationResult, setValidationResult] = useState<ImportValidationResult | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  // EXCEL / CSV IMPORT STATE
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [excelShopId, setExcelShopId] = useState<string>(() => (dbState.shops || [])[0]?.id || '');
  const [excelParseResult, setExcelParseResult] = useState<UnifiedParseResult | null>(null);
  const [targetStoreId, setTargetStoreId] = useState<string>('');
  const [migrationStrategy, setMigrationStrategy] = useState<MigrationStrategy>('RESTORE_REPLACE');
  const [shopFloorLocationName, setShopFloorLocationName] = useState<string>('');
  const [showColumnMapping, setShowColumnMapping] = useState<boolean>(false);
  const [lastImportReport, setLastImportReport] = useState<MigrationCommitResult | null>(null);
  const [isParsingExcel, setIsParsingExcel] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);

  // QuickBooks Import state
  const [qbImportText, setQbImportText] = useState('');
  const [qbImportResult, setQbImportResult] = useState<any>(null);
  const [isProcessingQB, setIsProcessingQB] = useState(false);

  // Sync state
  const [isSyncing, setIsSyncing] = useState(false);
  const [showWipeConfirm, setShowWipeConfirm] = useState(false);
  const [isWiping, setIsWiping] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const csvFileInputRef = useRef<HTMLInputElement>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);

  if (!currentUser || currentUser.role !== 'ADMIN') return null;

  const shops = dbState.shops || [];
  const stores = dbState.stores || [];
  const settings = dbState.settings;
  const importHistory = dbState.importHistory || [];
  const preSnapshotInfo = db.hasPreMigrationSnapshot();

  // ==============================
  // EXCEL / CSV IMPORT HANDLERS
  // ==============================
  const handleExcelFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const effectiveShopId = excelShopId || shops[0]?.id || '';
    if (!effectiveShopId) {
      addToast({
        type: 'warning',
        title: 'Select Shop First',
        description: 'Please create or choose a target shop before uploading.',
      });
      return;
    }
    if (!excelShopId) setExcelShopId(effectiveShopId);

    setExcelFile(file);
    setLastImportReport(null);
    setIsParsingExcel(true);
    const result = await ExcelImportService.parseImportFile(file, effectiveShopId);
    setIsParsingExcel(false);
    setExcelParseResult(result);
    setShowColumnMapping(result.needsManualMapping);

    if (result.format === 'SIMPLE_4_COL') {
      setMigrationStrategy('MERGE_ADD');
      setTargetStoreId('');
    } else if (result.format === 'SONKO_19_COL') {
      setMigrationStrategy('RESTORE_REPLACE');
      const defaultFloor = result.previewSummary.storesDetected.find(s => s.isDefaultFloor);
      setShopFloorLocationName(defaultFloor ? defaultFloor.name : 'NONE');
    } else if (result.format === 'DETAILED_SALES_HISTORY') {
      setMigrationStrategy('NEW_ONLY');
    }

    if (result.needsManualMapping) {
      addToast({
        type: 'warning',
        title: 'Column Mapping Needed',
        description: 'Verify or map columns manually before importing.',
      });
    } else if (result.duplicateImportWarning) {
      addToast({
        type: 'warning',
        title: 'File Already Imported Earlier',
        description: 'Duplicate file detected. Use Restore/Replace or New Only to prevent double stock.',
      });
    } else if (result.errors.length > 0) {
      addToast({
        type: 'warning',
        title: 'Validation Issues',
        description: `${result.errors.length} issue(s) found. Review before committing.`,
      });
    } else {
      addToast({
        type: 'success',
        title: 'File Analyzed & Ready',
        description: `${result.previewSummary.validRows} rows (${result.previewSummary.uniqueProductsCount} products) ready to import.`,
      });
    }
  };

  const handleManualMappingChange = (
    field: CanonicalImportField,
    headerName: string,
    overrideFormat?: ImportFormatType
  ) => {
    if (!excelParseResult) return;
    const nextMap = { ...excelParseResult.columnMapping };
    if (headerName) {
      nextMap[field] = headerName;
    } else {
      delete nextMap[field];
    }
    const nextFormat = overrideFormat || excelParseResult.format;
    const updated = ExcelImportService.reparseWithMapping(
      excelParseResult,
      nextMap,
      nextFormat === 'UNCERTAIN' ? 'SONKO_19_COL' : nextFormat,
      excelShopId
    );
    setExcelParseResult(updated);
  };

  const handleManualFormatSwitch = (nextFormat: ImportFormatType) => {
    if (!excelParseResult) return;
    const updated = ExcelImportService.reparseWithMapping(
      excelParseResult,
      excelParseResult.columnMapping,
      nextFormat,
      excelShopId
    );
    setExcelParseResult(updated);
    if (nextFormat === 'SIMPLE_4_COL') {
      setMigrationStrategy('MERGE_ADD');
    } else if (nextFormat === 'SONKO_19_COL') {
      setMigrationStrategy('RESTORE_REPLACE');
      const defaultFloor = updated.previewSummary.storesDetected.find(s => s.isDefaultFloor);
      setShopFloorLocationName(defaultFloor ? defaultFloor.name : 'NONE');
    }
  };

  const handleCommitExcelImport = async () => {
    if (!excelParseResult || !excelShopId) return;
    setIsCommitting(true);

    const res = ExcelImportService.commitMigrationImport(
      excelParseResult,
      {
        shopId: excelShopId,
        targetStoreId: excelParseResult.format === 'SIMPLE_4_COL' ? targetStoreId : undefined,
        shopFloorLocationName:
          excelParseResult.format === 'SONKO_19_COL' ? shopFloorLocationName : undefined,
        strategy: migrationStrategy,
        createPreSnapshot: true,
      },
      currentUser
    );
    setIsCommitting(false);
    setLastImportReport(res);

    if (res.success) {
      const targetShopName = shops.find(s => s.id === excelShopId)?.name || 'shop';
      addToast({
        type: 'success',
        title: 'Import Successful',
        description:
          res.format === 'DETAILED_SALES_HISTORY'
            ? `${res.salesImported} historical sales imported (${res.skippedRecords} skipped).`
            : `${res.createdProducts} created, ${res.updatedProducts} updated in ${targetShopName}${
                res.storesCreated.length > 0 ? `, ${res.storesCreated.length} store(s) created` : ''
              }.`,
      });
      setExcelParseResult(null);
      setExcelFile(null);
      setShowColumnMapping(false);
      if (excelInputRef.current) excelInputRef.current.value = '';
    } else {
      addToast({
        type: 'error',
        title: 'Import Completed with Errors',
        description: `${res.createdProducts} created, ${res.updatedProducts} updated, ${res.errors.length} error(s).`,
      });
    }
  };

  const handleRollbackLastImport = () => {
    const res = db.restorePreMigrationSnapshot();
    if (res.success) {
      setLastImportReport(null);
      addToast({
        type: 'success',
        title: 'Rollback Completed',
        description: res.message,
      });
    } else {
      addToast({
        type: 'error',
        title: 'Rollback Failed',
        description: res.message,
      });
    }
  };

  // ==============================
  // EXPORT HANDLERS
  // ==============================
  const handleExportCsv = () => {
    const { fileName, csvContent } = CsvDataService.exportDataToCsv(
      selectedExportType,
      selectedExportShopId || 'ALL'
    );
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    addToast({
      type: 'success',
      title: 'CSV Export Generated',
      description: `Downloaded ${fileName}.`,
    });
  };

  const handleExportProductsExcel = () => {
    if (!selectedExportShopId) {
      addToast({
        type: 'warning',
        title: 'Select Shop First',
        description: 'Choose the shop you want to export products from.',
      });
      return;
    }

    const res = ExcelExportService.exportAllProducts(selectedExportShopId);

    if (res.success) {
      addToast({
        type: 'success',
        title: 'Export Ready',
        description: `${res.rowCount} products saved to ${res.fileName}`,
      });
    } else {
      addToast({
        type: 'error',
        title: 'Export Failed',
        description: res.error || 'Could not generate file.',
      });
    }
  };

  // ==============================
  // CSV HANDLERS
  // ==============================
  const handleDownloadTemplate = (type: CsvDataType) => {
    const { fileName, csvContent } = CsvDataService.getCsvTemplate(type);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    addToast({
      type: 'info',
      title: 'Template Downloaded',
      description: `Downloaded ${fileName}.`,
    });
  };

  const handleCsvFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadedFileName(file.name);
    const reader = new FileReader();
    reader.onload = event => {
      try {
        const text = event.target?.result as string;
        const validation = CsvDataService.validateCsv(importDataType, text, file.name);
        setValidationResult(validation);
      } catch (err: any) {
        addToast({
          type: 'error',
          title: 'CSV Read Error',
          description: err.message || 'Failed to parse file.',
        });
      }
    };
    reader.readAsText(file);
  };

  const handleCommitImport = async () => {
    if (!validationResult) return;
    setIsImporting(true);

    const res = await CsvDataService.commitImport(validationResult, currentUser);
    setIsImporting(false);

    if (res.success) {
      addToast({
        type: 'success',
        title: 'Import Successful',
        description: `Imported ${res.importedCount} records.`,
      });
      setValidationResult(null);
      setUploadedFileName('');
      if (csvFileInputRef.current) csvFileInputRef.current.value = '';
    } else {
      addToast({
        type: 'error',
        title: 'Import Failed',
        description: res.error || 'Failed to commit import records.',
      });
    }
  };

  // ==============================
  // BACKUP HANDLERS
  // ==============================
  const handleExportBackup = () => {
    BackupService.exportBackupFile(currentUser);
    addToast({
      type: 'success',
      title: 'Backup Generated',
      description: 'Full database snapshot exported.',
    });
  };

  const handleRestoreFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async event => {
      try {
        const content = event.target?.result as string;
        const res = BackupService.restoreFromBackupFile(content, currentUser);
        if (res.success) {
          addToast({
            type: 'success',
            title: 'Database Restored',
            description: 'All data restored successfully.',
          });
          window.location.reload();
        } else {
          addToast({
            type: 'error',
            title: 'Restore Failed',
            description: res.error || 'Invalid backup file.',
          });
        }
      } catch (err: any) {
        addToast({
          type: 'error',
          title: 'File Read Error',
          description: err.message,
        });
      }
    };
    reader.readAsText(file);
  };

  const handleWipeAllData = () => {
    setIsWiping(true);
    const res = BackupService.wipeAllData(currentUser);
    setIsWiping(false);
    setShowWipeConfirm(false);

    if (res.success) {
      addToast({
        type: 'success',
        title: 'All Data Deleted',
        description: 'Database cleanly purged.',
      });
      window.location.reload();
    } else {
      addToast({
        type: 'error',
        title: 'Action Failed',
        description: res.error || 'Failed to wipe data.',
      });
    }
  };

  // ==============================
  // QUICKBOOKS HANDLERS
  // ==============================
  const handleLoadQBSample = () => {
    const sample = QuickBooksService.generateSampleIIF();
    setQbImportText(sample);
    setQbImportResult(null);
  };

  const handleExecuteQBImport = () => {
    if (!qbImportText.trim()) return;

    setIsProcessingQB(true);
    const result = QuickBooksService.parseAndImportIIF(qbImportText, currentUser);
    setIsProcessingQB(false);
    setQbImportResult(result);

    if (result.success) {
      addToast({
        type: 'success',
        title: 'QuickBooks Import Complete',
        description: `Imported ${result.itemsImported} products.`,
      });
    }
  };

  // ==============================
  // SYNC HANDLER
  // ==============================
  const handleSimulateSync = async () => {
    setIsSyncing(true);
    const result = await SyncService.processSyncQueue(currentUser, true);
    setIsSyncing(false);

    if (result.success) {
      addToast({
        type: 'success',
        title: 'Sync Successful',
        description: result.message || `Synchronized ${result.processedCount} records.`,
      });
    }
  };

  const queueStats = SyncService.getSyncStats();

  return (
    <div
      id="admin-data-management-view"
      className="flex-1 p-3.5 bg-slate-950 text-slate-100 overflow-y-auto space-y-4 pb-24"
    >
      {/* Top Header */}
      <div className="flex flex-col gap-3 pb-3.5 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-blue-400" />
            <h2 className="text-lg font-bold text-white tracking-tight">Data Management</h2>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Import from Excel, export CSV datasets, and manage backups
          </p>
        </div>

        <button
          onClick={handleExportBackup}
          className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-200 text-xs font-semibold border border-slate-700 transition"
        >
          <Download className="w-4 h-4" />
          <span>Export JSON Backup</span>
        </button>
      </div>

      {/* Main Navigation Tabs - Horizontal scroll */}
      <div className="flex items-center gap-1 border-b border-slate-800 overflow-x-auto pb-px -mx-3.5 px-3.5">
        <button
          onClick={() => setActiveSubTab('csv')}
          className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
            activeSubTab === 'csv'
              ? 'border-blue-500 text-blue-400'
              : 'border-transparent text-slate-400'
          }`}
        >
          <FileSpreadsheet className="w-4 h-4" />
          <span>Import / Export</span>
        </button>

        <button
          onClick={() => setActiveSubTab('backup')}
          className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
            activeSubTab === 'backup'
              ? 'border-blue-500 text-blue-400'
              : 'border-transparent text-slate-400'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>JSON Backup</span>
        </button>

        <button
          onClick={() => setActiveSubTab('quickbooks')}
          className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
            activeSubTab === 'quickbooks'
              ? 'border-blue-500 text-blue-400'
              : 'border-transparent text-slate-400'
          }`}
        >
          <Code className="w-4 h-4" />
          <span>QuickBooks</span>
        </button>

        <button
          onClick={() => setActiveSubTab('sync')}
          className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
            activeSubTab === 'sync'
              ? 'border-blue-500 text-blue-400'
              : 'border-transparent text-slate-400'
          }`}
        >
          <Cloud className="w-4 h-4" />
          <span>Sync ({queueStats.pending})</span>
        </button>
      </div>

      {/* SUB-TAB 1: CSV / EXCEL DATA MANAGEMENT */}
      {activeSubTab === 'csv' && (
        <div className="space-y-4">
          {/* Sub Navigation Bar - Horizontal scroll */}
          <div className="flex items-center gap-1.5 bg-slate-900/80 p-1.5 rounded-xl border border-slate-800 overflow-x-auto -mx-3.5 px-3.5">
            <button
              onClick={() => setCsvSection('import')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap ${
                csvSection === 'import'
                  ? 'bg-emerald-600 text-white shadow'
                  : 'text-slate-400'
              }`}
            >
              📥 Import Excel
            </button>
            <button
              onClick={() => setCsvSection('export')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap ${
                csvSection === 'export'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-400'
              }`}
            >
              📤 Export Data
            </button>
            <button
              onClick={() => setCsvSection('templates')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap ${
                csvSection === 'templates'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-400'
              }`}
            >
              📋 Templates
            </button>
            <button
              onClick={() => setCsvSection('history')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap ${
                csvSection === 'history'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-400'
              }`}
            >
              📜 History ({importHistory.length})
            </button>
          </div>

          {/* 1. IMPORT EXCEL / CSV SECTION */}
          {csvSection === 'import' && (
            <div className="space-y-4">
              {/* Pre-migration rollback card */}
              {preSnapshotInfo.exists && (
                <div className="bg-amber-950/30 border border-amber-700/40 rounded-2xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div className="text-xs">
                    <div className="font-bold text-amber-300 flex items-center gap-1.5">
                      <RotateCcw className="w-3.5 h-3.5" />
                      Pre-Import Snapshot Available
                    </div>
                    <p className="text-[11px] text-amber-200/80 mt-0.5">
                      Saved before "{preSnapshotInfo.label}" ({preSnapshotInfo.productCount} products, {preSnapshotInfo.storeCount} stores)
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleRollbackLastImport}
                    className="px-3 py-2 rounded-xl bg-amber-600/25 hover:bg-amber-600/40 text-amber-200 border border-amber-500/40 text-xs font-semibold transition shrink-0"
                  >
                    Rollback Last Import
                  </button>
                </div>
              )}

              {/* Post-Import Summary Banner */}
              {lastImportReport && (
                <div className="bg-emerald-950/30 border border-emerald-700/50 rounded-2xl p-4 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-bold text-emerald-300 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4" />
                      Migration &amp; Import Report ({lastImportReport.format})
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-900/50 text-emerald-200">
                      {lastImportReport.strategy}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                    <div className="p-2 rounded-lg bg-slate-950/80 border border-slate-800">
                      <span className="text-slate-400 block">Created</span>
                      <span className="font-bold text-emerald-400 font-mono">
                        {lastImportReport.format === 'DETAILED_SALES_HISTORY'
                          ? `${lastImportReport.salesImported} sales`
                          : `${lastImportReport.createdProducts} products`}
                      </span>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-950/80 border border-slate-800">
                      <span className="text-slate-400 block">Updated</span>
                      <span className="font-bold text-blue-400 font-mono">
                        {lastImportReport.updatedProducts}
                      </span>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-950/80 border border-slate-800">
                      <span className="text-slate-400 block">Skipped</span>
                      <span className="font-bold text-slate-300 font-mono">
                        {lastImportReport.skippedRecords}
                      </span>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-950/80 border border-slate-800">
                      <span className="text-slate-400 block">New Stores</span>
                      <span className="font-bold text-purple-300 font-mono">
                        {lastImportReport.storesCreated.length}
                      </span>
                    </div>
                  </div>
                  {lastImportReport.storesCreated.length > 0 && (
                    <p className="text-[11px] text-slate-300">
                      <strong>Created Stores:</strong> {lastImportReport.storesCreated.join(', ')}
                    </p>
                  )}
                  {lastImportReport.categoriesCreated.length > 0 && (
                    <p className="text-[11px] text-slate-300">
                      <strong>Created Categories:</strong> {lastImportReport.categoriesCreated.join(', ')}
                    </p>
                  )}
                  {lastImportReport.historicalUnitsPreserved > 0 && (
                    <p className="text-[11px] text-amber-300">
                      <strong>Historical Totals Preserved:</strong> {lastImportReport.historicalUnitsPreserved.toLocaleString()} units sold (stored with "Historical date unavailable" — excluded from dated sales reports).
                    </p>
                  )}
                  {lastImportReport.errors.length > 0 && (
                    <div className="p-2 rounded-lg bg-rose-950/40 border border-rose-800/40 text-rose-200 text-[11px]">
                      {lastImportReport.errors.slice(0, 5).map((err, i) => (
                        <div key={i}>• {err}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Upload Box */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
                <div>
                  <h3 className="font-bold text-sm text-white flex items-center gap-2">
                    <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                    Import Products &amp; Legacy Store Data
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Automatically detects 4-column Excel sheets, 19-column SONKO multi-store exports, and timestamped sales history (.xlsx, .xls, .csv)
                  </p>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Target Shop <span className="text-rose-400">*</span>
                    </label>
                    <select
                      value={excelShopId}
                      onChange={e => {
                        setExcelShopId(e.target.value);
                        setExcelParseResult(null);
                        setExcelFile(null);
                        setTargetStoreId('');
                        if (excelInputRef.current) excelInputRef.current.value = '';
                      }}
                      className="w-full bg-slate-950 text-xs text-white px-3 py-2.5 rounded-xl border border-slate-800 focus:outline-none focus:border-blue-500"
                    >
                      <option value="">-- Select a shop --</option>
                      {shops.map(sh => (
                        <option key={sh.id} value={sh.id}>
                          🏪 {sh.name} ({sh.code || 'UNIT'})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Spreadsheet File (.xlsx / .xls / .csv) <span className="text-rose-400">*</span>
                    </label>
                    <input
                      ref={excelInputRef}
                      type="file"
                      accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                      disabled={!excelShopId}
                      onChange={handleExcelFileSelected}
                      className="w-full bg-slate-950 text-xs text-slate-300 file:mr-2 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-emerald-600 file:text-white hover:file:bg-emerald-500 cursor-pointer p-1.5 rounded-xl border border-slate-800 disabled:opacity-40"
                    />
                    {!excelShopId && (
                      <p className="text-[10px] text-amber-400 mt-1">
                        ⚠ Select a shop above to enable upload
                      </p>
                    )}
                  </div>
                </div>

                {/* Supported Formats hint */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                  <div className="p-3 bg-blue-950/30 border border-blue-800/40 rounded-xl text-blue-200">
                    <strong>Simple Format (4 Columns):</strong>
                    <div className="mt-1 font-mono text-[10px] text-blue-100 overflow-x-auto whitespace-nowrap">
                      Product Name | Buying Price | Selling Price | Quantity
                    </div>
                  </div>
                  <div className="p-3 bg-emerald-950/25 border border-emerald-800/40 rounded-xl text-emerald-200">
                    <strong>Full SONKO Export (19 Columns):</strong>
                    <div className="mt-1 font-mono text-[10px] text-emerald-100 overflow-x-auto whitespace-nowrap">
                      SKU | Product | Variation | Category | Location | Prices | Stock | Sold…
                    </div>
                  </div>
                </div>
              </div>

              {/* Parsing indicator */}
              {isParsingExcel && (
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center text-slate-400 text-xs">
                  <RefreshCw className="w-5 h-5 mx-auto mb-2 animate-spin text-blue-400" />
                  Analyzing spreadsheet columns &amp; stores...
                </div>
              )}

              {/* Parse Result Preview, Mapping & Strategy Options */}
              {excelParseResult && !isParsingExcel && (
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-bold text-sm text-white">Preview &amp; Validation</h4>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/15 text-blue-300 border border-blue-500/30">
                          {excelParseResult.format === 'SONKO_19_COL'
                            ? 'SONKO 19-Column Migration'
                            : excelParseResult.format === 'SIMPLE_4_COL'
                              ? 'Simple 4-Column Excel'
                              : excelParseResult.format === 'DETAILED_SALES_HISTORY'
                                ? 'Timestamped Sales History'
                                : 'Manual Mapping Required'}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {excelParseResult.fileName} • {excelParseResult.sheetName || 'Sheet1'} • {excelParseResult.headers.length} columns
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowColumnMapping(v => !v)}
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition"
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5" />
                      <span>{showColumnMapping ? 'Hide Mapping' : 'Column Mapping'}</span>
                    </button>
                  </div>

                  {/* Duplicate File Warning */}
                  {excelParseResult.duplicateImportWarning && (
                    <div className="p-3 bg-amber-950/40 border border-amber-600/50 rounded-xl text-xs text-amber-200 flex items-start gap-2.5">
                      <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-bold text-amber-300">
                          Duplicate File Warning — Previously Imported
                        </div>
                        <p className="text-[11px] text-amber-200/90 mt-0.5">
                          Identical file content ("{excelParseResult.duplicateImportWarning.fileName}") was imported on{' '}
                          {formatDateTime(excelParseResult.duplicateImportWarning.importedAt)}.
                          Using <strong>Restore / Replace</strong> or <strong>New Only</strong> prevents doubling stock or historical sales.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Column Mapping Screen (when uncertain or toggled) */}
                  {(showColumnMapping || excelParseResult.needsManualMapping) && (
                    <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 space-y-3 text-xs">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div>
                          <div className="font-bold text-white">Column Detection &amp; Mapping</div>
                          <p className="text-[11px] text-slate-400">
                            Match file headers to system fields if needed.
                          </p>
                        </div>
                        <select
                          value={excelParseResult.format}
                          onChange={e => handleManualFormatSwitch(e.target.value as ImportFormatType)}
                          className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                        >
                          <option value="SIMPLE_4_COL">Simple 4-Column Format</option>
                          <option value="SONKO_19_COL">Full SONKO 19-Column Format</option>
                          <option value="DETAILED_SALES_HISTORY">Detailed Sales History (Dated)</option>
                        </select>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                        {(
                          excelParseResult.format === 'SIMPLE_4_COL'
                            ? ([
                                ['productName', 'Product Name *'],
                                ['buyingPrice', 'Buying Price'],
                                ['sellingPrice', 'Selling Price *'],
                                ['quantity', 'Quantity *'],
                              ] as [CanonicalImportField, string][])
                            : excelParseResult.format === 'DETAILED_SALES_HISTORY'
                              ? ([
                                  ['saleDate', 'Sale Date *'],
                                  ['receiptNumber', 'Receipt / Invoice #'],
                                  ['productName', 'Product Name *'],
                                  ['variation', 'Variation'],
                                  ['sku', 'SKU'],
                                  ['quantity', 'Quantity *'],
                                  ['sellingPrice', 'Selling Price *'],
                                  ['buyingPrice', 'Buying Price'],
                                  ['location', 'Location / Store'],
                                  ['paymentMethod', 'Payment Method'],
                                ] as [CanonicalImportField, string][])
                              : ([
                                  ['productName', 'Product *'],
                                  ['sku', 'SKU'],
                                  ['variation', 'Variation'],
                                  ['category', 'Category'],
                                  ['location', 'Location (Store)'],
                                  ['buyingPrice', 'Unit Purchase Price'],
                                  ['sellingPrice', 'Unit Selling Price *'],
                                  ['quantity', 'Current Stock *'],
                                  ['purchaseValue', 'Stock Value (Purchase)'],
                                  ['saleValue', 'Stock Value (Sale)'],
                                  ['potentialProfit', 'Potential Profit'],
                                  ['totalSold', 'Total Unit Sold'],
                                  ['totalTransferred', 'Total Unit Transfered'],
                                  ['totalAdjusted', 'Total Unit Adjusted'],
                                  ['customField1', 'Custom Field1'],
                                  ['customField2', 'Custom Field2'],
                                  ['customField3', 'Custom Field3'],
                                  ['customField4', 'Custom Field4'],
                                ] as [CanonicalImportField, string][])
                        ).map(([field, label]) => (
                          <div key={field}>
                            <label className="block text-[10px] text-slate-400 mb-1">{label}</label>
                            <select
                              value={excelParseResult.columnMapping[field] || ''}
                              onChange={e => handleManualMappingChange(field, e.target.value)}
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-white"
                            >
                              <option value="">-- Not mapped --</option>
                              {excelParseResult.headers.map(h => (
                                <option key={h} value={h}>
                                  {h}
                                </option>
                              ))}
                            </select>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Simple 4-Col Store Destination Selector */}
                  {excelParseResult.format === 'SIMPLE_4_COL' && (
                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2 text-xs">
                      <label className="block font-semibold text-slate-200 flex items-center gap-1.5">
                        <Warehouse className="w-3.5 h-3.5 text-blue-400" />
                        Destination Store for Imported Stock
                      </label>
                      <select
                        value={targetStoreId}
                        onChange={e => setTargetStoreId(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                      >
                        <option value="">Direct to Shop Floor (POS Sellable Stock)</option>
                        {stores
                          .filter(st => st.shopId === excelShopId && st.status === 'ACTIVE')
                          .map(st => (
                            <option key={st.id} value={st.id}>
                              Store: {st.name}
                              {st.location ? ` (${st.location})` : ''}
                            </option>
                          ))}
                      </select>
                      <p className="text-[10px] text-slate-400">
                        Choose whether these quantities go directly onto the Shop Floor or into a specific Warehouse Store.
                      </p>
                    </div>
                  )}

                  {/* SONKO 19-Col Floor Store Mapping Selector */}
                  {excelParseResult.format === 'SONKO_19_COL' &&
                    excelParseResult.previewSummary.storesDetected.length > 0 && (
                      <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2.5 text-xs">
                        <label className="block font-semibold text-slate-200 flex items-center gap-1.5">
                          <Warehouse className="w-3.5 h-3.5 text-blue-400" />
                          Stores Detected ({excelParseResult.previewSummary.storesDetected.length})
                        </label>

                        <div className="flex flex-wrap gap-1.5">
                          {excelParseResult.previewSummary.storesDetected.map(st => (
                            <div
                              key={st.name}
                              className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px] flex items-center gap-2"
                            >
                              <span className="font-semibold text-white">{st.name}</span>
                              <span className="text-slate-400 font-mono">
                                {st.rowCount} rows · {st.totalUnits.toLocaleString()} qty
                              </span>
                              <span
                                className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${
                                  st.existsInShop
                                    ? 'bg-blue-500/15 text-blue-300'
                                    : 'bg-emerald-500/15 text-emerald-300'
                                }`}
                              >
                                {st.existsInShop ? 'Matched' : 'New Store'}
                              </span>
                              {shopFloorLocationName === st.name && (
                                <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300">
                                  POS Floor
                                </span>
                              )}
                            </div>
                          ))}
                        </div>

                        <div>
                          <label className="block text-[11px] text-slate-400 mb-1">
                            Which location acts as POS Shop Floor (direct sellable stock)?
                          </label>
                          <select
                            value={shopFloorLocationName}
                            onChange={e => setShopFloorLocationName(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                          >
                            {excelParseResult.previewSummary.storesDetected.map(st => (
                              <option key={st.name} value={st.name}>
                                {st.name} (POS Shop Floor + Store View)
                              </option>
                            ))}
                            <option value="NONE">None (Keep all locations in Warehouse Stores)</option>
                          </select>
                        </div>
                      </div>
                    )}

                  {/* Import Strategy Selector */}
                  {excelParseResult.format !== 'DETAILED_SALES_HISTORY' &&
                    excelParseResult.format !== 'UNCERTAIN' && (
                      <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2 text-xs">
                        <label className="block font-semibold text-slate-200">
                          Import Strategy
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          {[
                            {
                              id: 'RESTORE_REPLACE' as MigrationStrategy,
                              title: 'Restore / Replace',
                              desc: 'Sets exact store quantities & historical totals. Safe if re-importing same file.',
                            },
                            {
                              id: 'NEW_ONLY' as MigrationStrategy,
                              title: 'New Only',
                              desc: 'Only imports products or store allocations that do not exist yet.',
                            },
                            {
                              id: 'MERGE_ADD' as MigrationStrategy,
                              title: 'Merge & Add Stock',
                              desc: 'Adds imported quantities onto existing stock levels.',
                            },
                          ].map(opt => (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => setMigrationStrategy(opt.id)}
                              className={`p-2.5 rounded-xl border text-left transition ${
                                migrationStrategy === opt.id
                                  ? 'bg-blue-600/20 border-blue-500 text-white'
                                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              <div className="font-bold text-xs">{opt.title}</div>
                              <div className="text-[10px] opacity-80 mt-0.5 leading-snug">
                                {opt.desc}
                              </div>
                            </button>
                          ))}
                        </div>
                        {migrationStrategy === 'MERGE_ADD' &&
                          excelParseResult.duplicateImportWarning && (
                            <p className="text-[11px] text-amber-400 pt-1">
                              ⚠ Warning: Re-importing this exact file with "Merge &amp; Add" will double existing quantities. Consider "Restore / Replace".
                            </p>
                          )}
                      </div>
                    )}

                  {/* Preview Summary Metrics */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800 text-center">
                      <span className="text-[10px] text-slate-400 uppercase block">Products</span>
                      <span className="text-sm font-bold text-white font-mono">
                        {excelParseResult.previewSummary.uniqueProductsCount}
                      </span>
                      {excelParseResult.previewSummary.variationsCount > 0 && (
                        <span className="text-[10px] text-blue-300 block">
                          {excelParseResult.previewSummary.variationsCount} variations
                        </span>
                      )}
                    </div>
                    <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800 text-center">
                      <span className="text-[10px] text-slate-400 uppercase block">Records</span>
                      <span className="text-sm font-bold text-emerald-400 font-mono">
                        {excelParseResult.previewSummary.validRows}
                      </span>
                      <span className="text-[10px] text-slate-500 block">
                        {excelParseResult.previewSummary.totalQuantity.toLocaleString()} units
                      </span>
                    </div>
                    <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800 text-center">
                      <span className="text-[10px] text-slate-400 uppercase block">Stock Value (Cost)</span>
                      <span className="text-xs font-bold text-purple-300 font-mono">
                        {formatCurrency(
                          excelParseResult.previewSummary.totalPurchaseValue,
                          settings.currencySymbol
                        )}
                      </span>
                      <span className="text-[10px] text-slate-500 block">
                        Errors: {excelParseResult.errors.length}
                      </span>
                    </div>
                    <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800 text-center">
                      <span className="text-[10px] text-slate-400 uppercase block">Potential Sale</span>
                      <span className="text-xs font-bold text-emerald-400 font-mono">
                        {formatCurrency(
                          excelParseResult.previewSummary.totalSaleValue,
                          settings.currencySymbol
                        )}
                      </span>
                      <span className="text-[10px] text-emerald-300/80 block font-mono">
                        +{formatCurrency(
                          excelParseResult.previewSummary.totalPotentialProfit,
                          settings.currencySymbol
                        )}
                      </span>
                    </div>
                  </div>

                  {/* Separate Historical Reference Notice (Never mixed into dated sales) */}
                  {excelParseResult.format === 'SONKO_19_COL' &&
                    (excelParseResult.previewSummary.totalHistoricalSold > 0 ||
                      excelParseResult.previewSummary.totalHistoricalTransferred > 0 ||
                      excelParseResult.previewSummary.totalHistoricalAdjusted > 0) && (
                      <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1.5 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-slate-200 flex items-center gap-1.5">
                            <HistoryIcon className="w-3.5 h-3.5 text-amber-400" />
                            Historical Activity Totals Detected
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 font-semibold">
                            Historical date unavailable
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-[11px] font-mono">
                          <div>
                            Sold: <strong className="text-white">{excelParseResult.previewSummary.totalHistoricalSold.toLocaleString()}</strong>
                          </div>
                          <div>
                            Transferred: <strong className="text-white">{excelParseResult.previewSummary.totalHistoricalTransferred.toLocaleString()}</strong>
                          </div>
                          <div>
                            Adjusted: <strong className="text-white">{excelParseResult.previewSummary.totalHistoricalAdjusted.toLocaleString()}</strong>
                          </div>
                        </div>
                        <p className="text-[10px] text-slate-400">
                          Stored strictly as historical reference on Store &amp; Product records. Never counted as today's/monthly/yearly live sales and never deducted from restored stock.
                        </p>
                      </div>
                    )}

                  {/* Warnings */}
                  {excelParseResult.warnings.length > 0 && (
                    <div className="p-3 bg-amber-950/20 border border-amber-800/40 rounded-xl space-y-1.5">
                      <h5 className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4" />
                        Warnings ({excelParseResult.warnings.length})
                      </h5>
                      <div className="max-h-28 overflow-y-auto space-y-1 text-[11px] text-amber-200/90">
                        {excelParseResult.warnings.slice(0, 15).map((w, i) => (
                          <div key={i}>
                            <span className="font-mono text-[10px] bg-amber-900/50 px-1 py-0.2 rounded mr-1.5">
                              Row {w.rowNumber}
                            </span>
                            {w.message}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Errors */}
                  {excelParseResult.errors.length > 0 && (
                    <div className="p-3 bg-rose-950/20 border border-rose-800/40 rounded-xl space-y-2">
                      <h5 className="text-xs font-bold text-rose-300 flex items-center gap-1.5">
                        <AlertCircle className="w-4 h-4" />
                        Errors ({excelParseResult.errors.length})
                      </h5>
                      <div className="max-h-40 overflow-y-auto space-y-1 text-[11px] text-rose-200">
                        {excelParseResult.errors.map((err, i) => (
                          <div key={i} className="flex items-start gap-2">
                            <span className="font-mono text-[10px] bg-rose-900/60 px-1.5 py-0.5 rounded shrink-0">
                              Row {err.rowNumber}
                            </span>
                            <span className="break-words flex-1">{err.message}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Row Previews */}
                  {excelParseResult.previewSummary.validRows > 0 && (
                    <div>
                      <h5 className="text-xs font-bold text-slate-300 mb-2">
                        Sample Records (first 10 of {excelParseResult.previewSummary.validRows})
                      </h5>
                      <div className="space-y-2 max-h-72 overflow-y-auto">
                        {excelParseResult.format === 'SIMPLE_4_COL' &&
                          excelParseResult.simpleRows.slice(0, 10).map((r, idx) => (
                            <div
                              key={idx}
                              className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs"
                            >
                              <div className="font-semibold text-white truncate mb-1">
                                {r.productName}
                              </div>
                              <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                                <span>Buy: {r.buyingPrice.toLocaleString()}</span>
                                <span className="text-emerald-400 font-bold">
                                  Sell: {r.sellingPrice.toLocaleString()}
                                </span>
                                <span className="text-blue-300">Qty: {r.quantity}</span>
                              </div>
                            </div>
                          ))}

                        {excelParseResult.format === 'SONKO_19_COL' &&
                          excelParseResult.sonkoRows.slice(0, 10).map((r, idx) => (
                            <div
                              key={idx}
                              className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs space-y-1"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold text-white truncate">
                                  {r.productName}
                                  {r.variation ? ` (${r.variation})` : ''}
                                </span>
                                <span className="px-1.5 py-0.2 rounded bg-blue-500/15 text-blue-300 text-[10px] font-semibold shrink-0">
                                  {r.location}
                                </span>
                              </div>
                              <div className="flex items-center justify-between flex-wrap gap-2 text-[11px] text-slate-400 font-mono">
                                <span>{r.sku || 'No SKU'} · {r.categoryName || 'Uncategorized'}</span>
                                <span>
                                  Buy {r.unitPurchasePrice.toLocaleString()} →{' '}
                                  <strong className="text-emerald-400">
                                    {r.unitSellingPrice.toLocaleString()}
                                  </strong>{' '}
                                  · Qty <strong className="text-blue-300">{r.currentStock}</strong>
                                </span>
                              </div>
                            </div>
                          ))}

                        {excelParseResult.format === 'DETAILED_SALES_HISTORY' &&
                          excelParseResult.detailedSaleRows.slice(0, 10).map((r, idx) => (
                            <div
                              key={idx}
                              className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold text-white truncate">
                                  #{r.receiptNumber} · {r.productName}
                                </span>
                                <span className="text-[10px] text-slate-400 font-mono">
                                  {r.saleDateIso.slice(0, 10)}
                                </span>
                              </div>
                              <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                                {r.quantity} × {r.unitPrice.toLocaleString()} ({r.paymentMethod})
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* Commit CTA */}
                  {excelParseResult.previewSummary.validRows > 0 &&
                    !excelParseResult.needsManualMapping && (
                      <button
                        type="button"
                        onClick={handleCommitExcelImport}
                        disabled={isCommitting}
                        className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-xs font-semibold py-3 rounded-xl shadow-sm transition disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>
                          {isCommitting
                            ? 'Importing...'
                            : `Confirm & Import (${excelParseResult.previewSummary.validRows} records) to ${
                                shops.find(s => s.id === excelShopId)?.name || 'Shop'
                              }`}
                        </span>
                      </button>
                    )}
                </div>
              )}
            </div>
          )}

          {/* 2. EXPORT SECTION */}
          {csvSection === 'export' && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
              <div>
                <h3 className="font-bold text-sm text-white">Export Dataset</h3>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    File Format
                  </label>
                  <select
                    value={exportFormat}
                    onChange={e => setExportFormat(e.target.value as ExportFormat)}
                    className="w-full bg-slate-950 text-xs text-white px-3 py-2.5 rounded-xl border border-slate-800 focus:outline-none focus:border-blue-500"
                  >
                    <option value="xlsx">📊 Excel (.xlsx)</option>
                    <option value="csv">📄 CSV (.csv)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Data Category
                  </label>
                  <select
                    value={selectedExportType}
                    onChange={e => setSelectedExportType(e.target.value as CsvDataType)}
                    className="w-full bg-slate-950 text-xs text-white px-3 py-2.5 rounded-xl border border-slate-800 focus:outline-none focus:border-blue-500"
                  >
                    <option value="PRODUCTS">📦 Products</option>
                    <option value="INVENTORY">📊 Inventory</option>
                    <option value="SALES">🛒 Sales</option>
                    <option value="PURCHASES">🚚 Purchases</option>
                    <option value="EXPENSES">📉 Expenses</option>
                    <option value="SELLERS">👥 Sellers</option>
                    <option value="SHOPS">🏪 Shops</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Target Shop <span className="text-rose-400">*</span>
                  </label>
                  <select
                    value={selectedExportShopId}
                    onChange={e => setSelectedExportShopId(e.target.value)}
                    className="w-full bg-slate-950 text-xs text-white px-3 py-2.5 rounded-xl border border-slate-800 focus:outline-none focus:border-blue-500"
                  >
                    <option value="">-- Select a shop --</option>
                    {shops.map(sh => (
                      <option key={sh.id} value={sh.id}>
                        🏪 {sh.name} ({sh.code || 'UNIT'})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {exportFormat === 'xlsx' && selectedExportType === 'PRODUCTS' ? (
                <button
                  onClick={handleExportProductsExcel}
                  disabled={!selectedExportShopId}
                  className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-xs font-semibold py-3 rounded-xl shadow-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Download className="w-4 h-4" />
                  <span>Download PRODUCTS Excel</span>
                </button>
              ) : (
                <button
                  onClick={handleExportCsv}
                  disabled={!selectedExportShopId}
                  className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-xs font-semibold py-3 rounded-xl shadow-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Download className="w-4 h-4" />
                  <span>
                    Download {selectedExportType} {exportFormat === 'xlsx' ? 'Excel' : 'CSV'}
                  </span>
                </button>
              )}
            </div>
          )}

          {/* 3. CSV TEMPLATES SECTION */}
          {csvSection === 'templates' && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
              <div>
                <h3 className="font-bold text-sm text-white">CSV Templates</h3>
                <p className="text-[11px] text-slate-400 mt-1">
                  Download pre-formatted templates for bulk data entry
                </p>
              </div>

              <div className="grid grid-cols-1 gap-2.5">
                {[
                  { type: 'PRODUCTS' as CsvDataType, emoji: '📦', name: 'Products', desc: 'SKU, prices, initial stock' },
                  { type: 'SHOPS' as CsvDataType, emoji: '🏪', name: 'Shops', desc: 'Names, codes, addresses' },
                  { type: 'EXPENSES' as CsvDataType, emoji: '📉', name: 'Expenses', desc: 'Shop/company expenses' },
                  { type: 'SELLERS' as CsvDataType, emoji: '👥', name: 'Sellers', desc: 'Usernames, assigned shops' },
                ].map(t => (
                  <button
                    key={t.type}
                    onClick={() => handleDownloadTemplate(t.type)}
                    className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex items-center gap-3 active:scale-95 transition text-left"
                  >
                    <span className="text-2xl shrink-0">{t.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-xs text-white">{t.name}</div>
                      <div className="text-[10px] text-slate-400 truncate">{t.desc}</div>
                    </div>
                    <Download className="w-4 h-4 text-blue-400 shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 4. IMPORT HISTORY SECTION */}
          {csvSection === 'history' && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
              <div>
                <h3 className="font-bold text-sm text-white">Import History</h3>
                <p className="text-[11px] text-slate-400 mt-1">
                  Log of all bulk uploads processed
                </p>
              </div>

              {importHistory.length > 0 ? (
                <div className="space-y-2.5">
                  {importHistory.map(item => (
                    <div
                      key={item.id}
                      className="p-3 bg-slate-950/70 rounded-xl border border-slate-800/80 space-y-2 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-white truncate">{item.fileName}</span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {item.format && (
                            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300">
                              {item.format}
                            </span>
                          )}
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                            {item.dataType}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-400">
                        <span>
                          Success: <b className="text-emerald-400">{item.successCount}</b>/{item.totalRecords}
                        </span>
                        <span>
                          +{item.createdCount || 0} / ⟳{item.updatedCount || 0}
                          {item.skippedCount ? ` / ⏭${item.skippedCount}` : ''}
                        </span>
                      </div>
                      {item.notes && (
                        <div className="text-[10px] text-slate-400 truncate">{item.notes}</div>
                      )}
                      <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-slate-900">
                        <span>By: {item.importedByName}</span>
                        <span className="font-mono">{formatDateTime(item.createdAt)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center bg-slate-950/40 rounded-xl border border-slate-800 text-slate-400 text-xs">
                  No imports recorded yet.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 2: JSON BACKUP */}
      {activeSubTab === 'backup' && (
        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2 text-blue-400">
              <Download className="w-5 h-5" />
              <h3 className="font-bold text-sm text-white">Export JSON Backup</h3>
            </div>
            <p className="text-[11px] text-slate-400 mb-4 leading-relaxed">
              Export all shops, products, sales, purchases, expenses, and sellers as a portable .json file
            </p>
            <button
              onClick={handleExportBackup}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-semibold text-xs transition"
            >
              <Download className="w-4 h-4" />
              <span>Download .json Backup</span>
            </button>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2 text-emerald-400">
              <Upload className="w-5 h-5" />
              <h3 className="font-bold text-sm text-white">Restore Database</h3>
            </div>
            <p className="text-[11px] text-slate-400 mb-4 leading-relaxed">
              Restore the entire database from a previously exported backup
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleRestoreFile}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs transition"
            >
              <Upload className="w-4 h-4" />
              <span>Select .json File</span>
            </button>
          </div>

          {/* Danger Zone */}
          <div className="bg-slate-900/90 border border-rose-900/40 rounded-2xl p-4">
            <div className="flex items-start gap-2 text-rose-400 mb-2">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <div>
                <h3 className="font-bold text-sm text-white">Delete All Demo Data</h3>
                <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                  Permanently delete products, sales, purchases, expenses, and movements. Your shops and admin account are preserved.
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowWipeConfirm(true)}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-rose-600/20 hover:bg-rose-600 active:bg-rose-700 text-rose-300 hover:text-white border border-rose-500/40 font-semibold text-xs transition mt-3"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Delete Demo Data</span>
            </button>
          </div>

          {/* Wipe Confirmation Modal - bottom sheet on mobile */}
          {showWipeConfirm && (
            <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm">
              <div className="bg-slate-900 border border-rose-800/60 rounded-t-2xl sm:rounded-2xl p-4 max-w-md w-full max-h-[92vh] overflow-y-auto shadow-2xl space-y-4">
                <div className="flex items-center gap-3 text-rose-400">
                  <div className="p-2 rounded-xl bg-rose-950/80 border border-rose-800/50">
                    <AlertTriangle className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">Delete All Data?</h4>
                    <p className="text-[11px] text-slate-400">Cannot be undone</p>
                  </div>
                </div>

                <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs text-slate-300 space-y-1.5">
                  <p className="text-rose-300 font-semibold">Will be cleared:</p>
                  <ul className="list-disc pl-4 space-y-1 text-slate-400 text-[11px]">
                    <li>All products & catalog</li>
                    <li>All sales & receipts</li>
                    <li>All purchases & movements</li>
                    <li>All expenses</li>
                    <li>All debts & notifications</li>
                  </ul>
                  <p className="text-slate-400 text-[11px] pt-1">
                    Admin account and shops will be kept.
                  </p>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowWipeConfirm(false)}
                    disabled={isWiping}
                    className="flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleWipeAllData}
                    disabled={isWiping}
                    className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-lg transition disabled:opacity-50"
                  >
                    {isWiping ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Purging...</span>
                      </>
                    ) : (
                      <>
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Delete All</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 3: QUICKBOOKS */}
      {activeSubTab === 'quickbooks' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
          <div>
            <h3 className="font-bold text-sm text-white">QuickBooks IIF Importer</h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Paste QuickBooks .IIF text to import products
            </p>
          </div>

          <button
            onClick={handleLoadQBSample}
            className="w-full px-3 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition"
          >
            Load Sample IIF Data
          </button>

          <textarea
            rows={6}
            value={qbImportText}
            onChange={e => setQbImportText(e.target.value)}
            placeholder="Paste QuickBooks .IIF text here..."
            className="w-full bg-slate-950 font-mono text-xs text-slate-200 p-3 rounded-xl border border-slate-800 focus:outline-none focus:border-blue-500"
          />

          <button
            onClick={handleExecuteQBImport}
            disabled={isProcessingQB || !qbImportText.trim()}
            className="w-full px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-semibold text-xs shadow transition disabled:opacity-50"
          >
            {isProcessingQB ? 'Processing IIF...' : 'Import Products from IIF'}
          </button>

          {qbImportResult && (
            <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 text-xs text-slate-300">
              <span className="font-bold text-emerald-400">Result:</span> Imported {qbImportResult.itemsImported} products.
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 4: SYNC QUEUE */}
      {activeSubTab === 'sync' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
          <div>
            <h3 className="font-bold text-sm text-white">Offline Sync Queue</h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Local changes waiting to sync with cloud
            </p>
          </div>

          <button
            onClick={handleSimulateSync}
            disabled={isSyncing}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-xs font-semibold transition disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{isSyncing ? 'Syncing...' : 'Sync with Cloud'}</span>
          </button>

          <div className="grid grid-cols-3 gap-2">
            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-center">
              <span className="text-[10px] text-slate-400 block mb-0.5">Pending</span>
              <span className="text-sm font-bold text-amber-400">{queueStats.pending}</span>
            </div>
            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-center">
              <span className="text-[10px] text-slate-400 block mb-0.5">Synced</span>
              <span className="text-sm font-bold text-emerald-400">{queueStats.synced}</span>
            </div>
            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-center">
              <span className="text-[10px] text-slate-400 block mb-0.5">Total</span>
              <span className="text-sm font-bold text-slate-200">{queueStats.total}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
