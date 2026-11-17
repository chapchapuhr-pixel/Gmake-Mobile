import React, { useMemo, useState } from 'react';
import {
  Warehouse,
  ArrowRightLeft,
  Plus,
  MapPin,
  Store as StoreIcon,
  AlertCircle,
  CheckCircle2,
  Package,
  Search,
  Edit3,
  Power,
  X,
  Layers,
  Tag,
  History,
  Eye,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { StoreService } from '../../services/storeService';
import { formatCurrency, formatDateTime } from '../../utils/formatters';
import {
  getAdminManagedShops,
  hasAdminAccess,
  isPlatformAdmin,
  isShopAdmin,
} from '../../utils/permissions';
import type { Product, Store } from '../../types';

export const AdminStores: React.FC = () => {
  const { currentUser, dbState, addToast, selectedShopId } = useApp();

  const [activeSubTab, setActiveSubTab] = useState<'stores' | 'inventory' | 'transfer'>('stores');

  // Create Store Modal / Form state
  const [isStoreModalOpen, setIsStoreModalOpen] = useState(false);
  const [editingStore, setEditingStore] = useState<Store | null>(null);
  const [storeName, setStoreName] = useState('');
  const [storeLocation, setStoreLocation] = useState('');
  const [storeShopId, setStoreShopId] = useState('');
  const [storeFormError, setStoreFormError] = useState('');

  // Store filter
  const [shopFilter, setShopFilter] = useState('ALL');
  const [storeSearch, setStoreSearch] = useState('');

  // Store Inventory Browser state
  const [selectedInventoryStoreId, setSelectedInventoryStoreId] = useState('ALL_COMBINED');
  const [invSearch, setInvSearch] = useState('');
  const [invCategoryFilter, setInvCategoryFilter] = useState('ALL');
  const [invStockedOnly, setInvStockedOnly] = useState(true);

  // Transfer Stock Form state
  const [sourceStoreId, setSourceStoreId] = useState('');
  const [transferProductId, setTransferProductId] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [transferQty, setTransferQty] = useState('');
  const [destShopId, setDestShopId] = useState('');
  const [transferNotes, setTransferNotes] = useState('');
  const [transferError, setTransferError] = useState('');

  if (!currentUser || !hasAdminAccess(currentUser)) return null;

  const settings = dbState.settings;
  const platformAdmin = isPlatformAdmin(currentUser);
  const shopAdmin = isShopAdmin(currentUser);
  const allShops = dbState.shops || [];

  const accessibleShops = useMemo(() => {
    return platformAdmin
      ? allShops
      : shopAdmin
        ? getAdminManagedShops(currentUser, allShops)
        : [];
  }, [allShops, currentUser, platformAdmin, shopAdmin]);

  const accessibleShopIdSet = useMemo(
    () => new Set(accessibleShops.map(s => s.id)),
    [accessibleShops]
  );

  const accessibleStores = useMemo(() => {
    return (dbState.stores || []).filter(
      st => platformAdmin || accessibleShopIdSet.has(st.shopId)
    );
  }, [dbState.stores, platformAdmin, accessibleShopIdSet]);

  const activeStores = useMemo(
    () => accessibleStores.filter(st => st.status === 'ACTIVE'),
    [accessibleStores]
  );

  const transferableStores = useMemo(
    () => activeStores.filter(st => !st.isShopFloor),
    [activeStores]
  );

  const accessibleCategories = useMemo(
    () =>
      (dbState.categories || []).filter(
        c => platformAdmin || accessibleShopIdSet.has(c.shopId)
      ),
    [dbState.categories, platformAdmin, accessibleShopIdSet]
  );

  const accessibleProducts = useMemo(
    () =>
      (dbState.products || []).filter(
        p => p.status !== 'INACTIVE' && (platformAdmin || accessibleShopIdSet.has(p.shopId))
      ),
    [dbState.products, platformAdmin, accessibleShopIdSet]
  );

  const getProductQtyInStore = (product: Product, store: Store): number => {
    if (product.storeStocks && product.storeStocks[store.id] !== undefined) {
      return Number(product.storeStocks[store.id] || 0);
    }
    if (store.isShopFloor) {
      return Number(product.currentStock || 0);
    }
    const nonFloorInShop = accessibleStores.filter(
      s => s.shopId === product.shopId && !s.isShopFloor && s.status === 'ACTIVE'
    );
    if (nonFloorInShop.length <= 1 && (!product.storeStocks || Object.keys(product.storeStocks).length === 0)) {
      return Number(product.storeStock || 0);
    }
    return 0;
  };

  const getProductTotalTrackedUnits = (product: Product): number => {
    if (product.storeStocks && Object.keys(product.storeStocks).length > 0) {
      const mappedStores = Object.entries(product.storeStocks);
      const mappedTotal = mappedStores.reduce((s, [, qty]) => s + Number(qty || 0), 0);
      const hasFloorMapped = mappedStores.some(([sid]) =>
        accessibleStores.find(st => st.id === sid)?.isShopFloor
      );
      return hasFloorMapped ? mappedTotal : mappedTotal + Number(product.currentStock || 0);
    }
    return Number(product.currentStock || 0) + Number(product.storeStock || 0);
  };

  const filteredStores = useMemo(() => {
    return accessibleStores.filter(st => {
      if (shopFilter !== 'ALL' && st.shopId !== shopFilter) return false;
      if (storeSearch.trim()) {
        const q = storeSearch.trim().toLowerCase();
        const shopName = accessibleShops.find(s => s.id === st.shopId)?.name.toLowerCase() || '';
        return (
          st.name.toLowerCase().includes(q) ||
          (st.location || '').toLowerCase().includes(q) ||
          shopName.includes(q)
        );
      }
      return true;
    });
  }, [accessibleStores, shopFilter, storeSearch, accessibleShops]);

  // Resolve effective source store for transfer tab (prefer warehouse stores, not POS floor)
  const effectiveSourceStoreId =
    sourceStoreId && transferableStores.some(s => s.id === sourceStoreId)
      ? sourceStoreId
      : transferableStores[0]?.id || '';

  const selectedSourceStore = useMemo(
    () => transferableStores.find(s => s.id === effectiveSourceStoreId),
    [transferableStores, effectiveSourceStoreId]
  );

  const effectiveDestShopId =
    destShopId && accessibleShops.some(s => s.id === destShopId)
      ? destShopId
      : selectedSourceStore?.shopId || accessibleShops[0]?.id || '';

  // Products belonging to the selected store's shop (with available qty in selected source store first)
  const storeScopedProducts = useMemo(() => {
    const base = accessibleProducts.filter(p => {
      if (selectedSourceStore) return p.shopId === selectedSourceStore.shopId;
      return true;
    });

    const filtered = productSearch.trim()
      ? base.filter(p => {
          const q = productSearch.trim().toLowerCase();
          return (
            p.name.toLowerCase().includes(q) ||
            (p.variation || '').toLowerCase().includes(q) ||
            (p.sku || '').toLowerCase().includes(q) ||
            (p.barcode || '').toLowerCase().includes(q)
          );
        })
      : base;

    return [...filtered].sort((a, b) => {
      const aQty = selectedSourceStore ? getProductQtyInStore(a, selectedSourceStore) : Number(a.storeStock || 0);
      const bQty = selectedSourceStore ? getProductQtyInStore(b, selectedSourceStore) : Number(b.storeStock || 0);
      return bQty - aQty;
    });
  }, [accessibleProducts, selectedSourceStore, productSearch, accessibleStores]);

  const selectedTransferProduct = useMemo(
    () => storeScopedProducts.find(p => p.id === transferProductId) || accessibleProducts.find(p => p.id === transferProductId),
    [storeScopedProducts, accessibleProducts, transferProductId]
  );

  // Recent store transfer & warehouse initial stock movements
  const transferMovements = useMemo(() => {
    return (dbState.movements || [])
      .filter(
        m =>
          (m.type === 'STORE_TRANSFER' || m.type === 'INITIAL_STOCK') &&
          (platformAdmin || accessibleShopIdSet.has(m.shopId))
      )
      .slice(0, 25);
  }, [dbState.movements, platformAdmin, accessibleShopIdSet]);

  // Summary metrics
  const totalStoreStockUnits = useMemo(() => {
    return accessibleProducts.reduce((sum, p) => sum + Number(p.storeStock || 0), 0);
  }, [accessibleProducts]);

  const productsInStoreCount = useMemo(() => {
    return accessibleProducts.filter(p => (p.storeStock || 0) > 0).length;
  }, [accessibleProducts]);

  // Store Inventory Browser derived data
  const selectedInventoryStore = useMemo(
    () =>
      selectedInventoryStoreId === 'ALL_COMBINED'
        ? undefined
        : accessibleStores.find(st => st.id === selectedInventoryStoreId),
    [accessibleStores, selectedInventoryStoreId]
  );

  const inventoryProducts = useMemo(() => {
    return accessibleProducts.filter(p => {
      if (selectedInventoryStore && p.shopId !== selectedInventoryStore.shopId) {
        return false;
      }
      if (invCategoryFilter !== 'ALL' && p.categoryId !== invCategoryFilter) {
        return false;
      }
      if (selectedInventoryStore && invStockedOnly) {
        const qtyHere = getProductQtyInStore(p, selectedInventoryStore);
        const hasDetailsHere = Boolean(p.storeDetails?.[selectedInventoryStore.id]);
        if (qtyHere <= 0 && !hasDetailsHere) return false;
      }
      if (invSearch.trim()) {
        const q = invSearch.trim().toLowerCase();
        const cf = p.customFields;
        const customMatch = cf
          ? [cf.field1, cf.field2, cf.field3, cf.field4].some(v =>
              (v || '').toLowerCase().includes(q)
            )
          : false;
        return (
          p.name.toLowerCase().includes(q) ||
          (p.variation || '').toLowerCase().includes(q) ||
          (p.sku || '').toLowerCase().includes(q) ||
          (p.barcode || '').toLowerCase().includes(q) ||
          customMatch
        );
      }
      return true;
    });
  }, [
    accessibleProducts,
    selectedInventoryStore,
    invCategoryFilter,
    invStockedOnly,
    invSearch,
    accessibleStores,
  ]);

  const inventoryTotals = useMemo(() => {
    let totalUnits = 0;
    let totalCostValue = 0;
    let totalSaleValue = 0;

    for (const p of inventoryProducts) {
      if (selectedInventoryStore) {
        const qty = getProductQtyInStore(p, selectedInventoryStore);
        const detail = p.storeDetails?.[selectedInventoryStore.id];
        totalUnits += qty;
        totalCostValue +=
          detail?.purchaseValue !== undefined ? detail.purchaseValue : qty * (p.purchasePrice || 0);
        totalSaleValue +=
          detail?.saleValue !== undefined ? detail.saleValue : qty * (p.sellingPrice || 0);
      } else {
        const qty = getProductTotalTrackedUnits(p);
        totalUnits += qty;
        totalCostValue +=
          p.importedPurchaseValue !== undefined
            ? p.importedPurchaseValue
            : qty * (p.purchasePrice || 0);
        totalSaleValue +=
          p.importedSaleValue !== undefined
            ? p.importedSaleValue
            : qty * (p.sellingPrice || 0);
      }
    }

    return {
      skuCount: inventoryProducts.length,
      totalUnits,
      totalCostValue,
      totalSaleValue,
      potentialProfit: totalSaleValue - totalCostValue,
    };
  }, [inventoryProducts, selectedInventoryStore, accessibleStores]);

  // Modal handlers
  const openCreateStoreModal = () => {
    setEditingStore(null);
    setStoreName('');
    setStoreLocation('');
    const defaultShop =
      selectedShopId && selectedShopId !== 'ALL' && accessibleShopIdSet.has(selectedShopId)
        ? selectedShopId
        : accessibleShops[0]?.id || '';
    setStoreShopId(defaultShop);
    setStoreFormError('');
    setIsStoreModalOpen(true);
  };

  const openEditStoreModal = (store: Store) => {
    setEditingStore(store);
    setStoreName(store.name);
    setStoreLocation(store.location || '');
    setStoreShopId(store.shopId);
    setStoreFormError('');
    setIsStoreModalOpen(true);
  };

  const handleSaveStore = (e: React.FormEvent) => {
    e.preventDefault();
    setStoreFormError('');

    if (!storeName.trim()) {
      setStoreFormError('Store name is required.');
      return;
    }
    if (!storeShopId) {
      setStoreFormError('Please assign this store to a shop.');
      return;
    }

    const res = editingStore
      ? StoreService.updateStore(
          editingStore.id,
          {
            name: storeName.trim(),
            location: storeLocation.trim(),
            shopId: storeShopId,
          },
          currentUser
        )
      : StoreService.createStore(
          {
            name: storeName.trim(),
            location: storeLocation.trim() || undefined,
            shopId: storeShopId,
          },
          currentUser
        );

    if (res.success) {
      const assignedShop = accessibleShops.find(s => s.id === storeShopId);
      addToast({
        type: 'success',
        title: editingStore ? 'Store Updated' : 'Store Created',
        description: editingStore
          ? `Store "${storeName.trim()}" updated.`
          : `Store "${storeName.trim()}" assigned to ${assignedShop?.name || 'shop'} and queued for sync.`,
      });
      setIsStoreModalOpen(false);
    } else {
      setStoreFormError(res.error || 'Failed to save store.');
    }
  };

  const handleToggleStoreStatus = (store: Store) => {
    const nextStatus = store.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    const res = StoreService.updateStore(store.id, { status: nextStatus }, currentUser);
    if (res.success) {
      addToast({
        type: 'info',
        title: `Store ${nextStatus === 'ACTIVE' ? 'Activated' : 'Deactivated'}`,
        description: `"${store.name}" is now ${nextStatus.toLowerCase()}.`,
      });
    } else {
      addToast({
        type: 'error',
        title: 'Update Failed',
        description: res.error || 'Could not update store status.',
      });
    }
  };

  const handleSourceStoreChange = (nextStoreId: string) => {
    setSourceStoreId(nextStoreId);
    const st = activeStores.find(s => s.id === nextStoreId);
    if (st) {
      setDestShopId(st.shopId);
    }
    setTransferProductId('');
    setTransferQty('');
    setTransferError('');
  };

  const availableQtyForSelected =
    selectedTransferProduct && selectedSourceStore
      ? getProductQtyInStore(selectedTransferProduct, selectedSourceStore)
      : Number(selectedTransferProduct?.storeStock || 0);

  const handleSubmitTransfer = (e: React.FormEvent) => {
    e.preventDefault();
    setTransferError('');

    if (!effectiveSourceStoreId) {
      setTransferError('Please select a source store.');
      return;
    }
    if (!transferProductId || !selectedTransferProduct) {
      setTransferError('Please select a product to transfer.');
      return;
    }

    const qty = Number(transferQty);
    const available = availableQtyForSelected;
    if (!Number.isFinite(qty) || qty <= 0) {
      setTransferError('Enter a valid quantity greater than 0.');
      return;
    }
    if (qty > available) {
      setTransferError(
        `Transfer quantity (${qty}) exceeds available store stock (${available} ${selectedTransferProduct.unit || 'pcs'}).`
      );
      return;
    }
    if (!effectiveDestShopId) {
      setTransferError('Please select a destination shop.');
      return;
    }

    const res = StoreService.transferStoreToShop(
      {
        storeId: effectiveSourceStoreId,
        productId: transferProductId,
        shopId: effectiveDestShopId,
        quantity: qty,
        notes: transferNotes.trim() || undefined,
      },
      currentUser
    );

    if (res.success) {
      const destShopName =
        accessibleShops.find(s => s.id === effectiveDestShopId)?.name || 'Shop Floor';
      addToast({
        type: 'success',
        title: 'Stock Transferred to Shop Floor',
        description: `Moved ${qty} ${selectedTransferProduct.unit || 'pcs'} of "${selectedTransferProduct.name}" to ${destShopName}.`,
      });
      setTransferQty('');
      setTransferNotes('');
      setTransferError('');
    } else {
      setTransferError(res.error || 'Transfer failed.');
    }
  };

  const parsedQty = Number(transferQty);
  const isQtyExceeding =
    Boolean(selectedTransferProduct) &&
    Number.isFinite(parsedQty) &&
    parsedQty > availableQtyForSelected;

  return (
    <div
      id="admin-stores-view"
      className="flex-1 p-3.5 sm:p-6 bg-slate-950 text-slate-100 overflow-y-auto pb-24 sm:pb-6"
    >
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 pb-4 border-b border-slate-800">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">
            Stores &amp; Transfers
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Manage warehouse stores assigned to shops and transfer stock onto the shop floor
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex bg-slate-900 border border-slate-800 rounded-xl p-1 text-xs overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveSubTab('stores')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-semibold transition whitespace-nowrap ${
                activeSubTab === 'stores'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Warehouse className="w-3.5 h-3.5" />
              <span>Stores ({accessibleStores.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveSubTab('inventory')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-semibold transition whitespace-nowrap ${
                activeSubTab === 'inventory'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Package className="w-3.5 h-3.5" />
              <span>Inventory</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveSubTab('transfer')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-semibold transition whitespace-nowrap ${
                activeSubTab === 'transfer'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
              <span>Transfer Stock</span>
            </button>
          </div>

          <button
            id="create-store-btn"
            type="button"
            onClick={openCreateStoreModal}
            className="flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-semibold text-xs transition"
          >
            <Plus className="w-4 h-4" />
            <span>Create Store</span>
          </button>
        </div>
      </div>

      {/* Overview Metrics Row */}
      <div className="grid grid-cols-3 gap-2.5 sm:gap-4 mb-5">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 sm:p-4">
          <div className="text-[11px] text-slate-400 font-medium">Active Stores</div>
          <div className="text-lg sm:text-2xl font-bold text-white font-mono tabular-nums mt-1">
            {activeStores.length}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            {accessibleShops.length} shop{accessibleShops.length === 1 ? '' : 's'}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 sm:p-4">
          <div className="text-[11px] text-slate-400 font-medium">Stocked SKUs</div>
          <div className="text-lg sm:text-2xl font-bold text-white font-mono tabular-nums mt-1">
            {productsInStoreCount}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">In warehouse</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 sm:p-4">
          <div className="text-[11px] text-slate-400 font-medium">Store Units</div>
          <div className="text-lg sm:text-2xl font-bold text-blue-400 font-mono tabular-nums mt-1">
            {totalStoreStockUnits.toLocaleString()}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">Ready to transfer</div>
        </div>
      </div>

      {/* SUB-TAB 1: STORES DIRECTORY */}
      {activeSubTab === 'stores' && (
        <div className="space-y-4">
          {/* Search & Shop filter */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={storeSearch}
                onChange={e => setStoreSearch(e.target.value)}
                placeholder="Search store name, location, or shop..."
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <select
              value={shopFilter}
              onChange={e => setShopFilter(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="ALL">
                {shopAdmin && !platformAdmin && accessibleShops.length === 1
                  ? accessibleShops[0].name
                  : 'All Assigned Shops'}
              </option>
              {(platformAdmin || accessibleShops.length > 1) &&
                accessibleShops.map(sh => (
                  <option key={sh.id} value={sh.id}>
                    {sh.name}
                  </option>
                ))}
            </select>
          </div>

          {filteredStores.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl py-14 px-4 text-center">
              <Warehouse className="w-10 h-10 mx-auto text-slate-600 mb-2.5" />
              <h3 className="text-sm font-semibold text-white">No Stores Created Yet</h3>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                Create warehouse stores and assign them to any shop. One shop can have multiple stores for separate storage locations.
              </p>
              <button
                type="button"
                onClick={openCreateStoreModal}
                className="mt-4 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition"
              >
                <Plus className="w-4 h-4" />
                <span>Create First Store</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredStores.map(store => {
                const shop = accessibleShops.find(s => s.id === store.shopId);
                const storeStockedProducts = accessibleProducts.filter(
                  p => p.shopId === store.shopId && getProductQtyInStore(p, store) > 0
                );
                const storeTotalUnits = storeStockedProducts.reduce(
                  (sum, p) => sum + getProductQtyInStore(p, store),
                  0
                );
                const isActive = store.status === 'ACTIVE';

                return (
                  <div
                    key={store.id}
                    className={`bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3 ${
                      !isActive ? 'opacity-65' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-slate-950 border border-slate-800 text-blue-400 flex items-center justify-center shrink-0">
                          <Warehouse className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <h3 className="text-sm font-bold text-white truncate">
                              {store.name}
                            </h3>
                            {store.isShopFloor && (
                              <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[9px] font-bold">
                                POS Floor
                              </span>
                            )}
                          </div>
                          <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-slate-400 mt-0.5">
                            <span className="inline-flex items-center gap-1 text-slate-300">
                              <StoreIcon className="w-3 h-3 text-slate-500" />
                              {shop?.name || 'Unknown Shop'}
                            </span>
                            {store.location && (
                              <span className="inline-flex items-center gap-1 text-slate-400">
                                <span>·</span>
                                <MapPin className="w-3 h-3 text-slate-500" />
                                {store.location}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <span
                        className={`text-[11px] font-semibold ${
                          isActive ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs bg-slate-950/70 border border-slate-800/80 rounded-lg p-2.5">
                      <div>
                        <div className="text-[10px] text-slate-500">Store SKUs</div>
                        <div className="font-mono font-semibold text-white tabular-nums mt-0.5">
                          {storeStockedProducts.length}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-500">Total Units</div>
                        <div className="font-mono font-semibold text-blue-400 tabular-nums mt-0.5">
                          {storeTotalUnits.toLocaleString()}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center flex-wrap gap-2 pt-1 border-t border-slate-800/80 text-xs">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedInventoryStoreId(store.id);
                          setInvStockedOnly(true);
                          setActiveSubTab('inventory');
                        }}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-emerald-600/15 hover:bg-emerald-600/25 text-emerald-300 font-semibold transition"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>View Inventory</span>
                      </button>
                      {isActive && !store.isShopFloor && (
                        <button
                          type="button"
                          onClick={() => {
                            handleSourceStoreChange(store.id);
                            setActiveSubTab('transfer');
                          }}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-blue-600/15 hover:bg-blue-600/25 text-blue-300 font-semibold transition"
                        >
                          <ArrowRightLeft className="w-3.5 h-3.5" />
                          <span>Transfer</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => openEditStoreModal(store)}
                        className="flex items-center justify-center gap-1 py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold transition"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Edit</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleStoreStatus(store)}
                        className={`flex items-center justify-center gap-1 py-2 px-3 rounded-lg font-semibold transition ${
                          isActive
                            ? 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-300'
                            : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300'
                        }`}
                      >
                        <Power className="w-3.5 h-3.5" />
                        <span>{isActive ? 'Off' : 'On'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 2: STORE INVENTORY BROWSER */}
      {activeSubTab === 'inventory' && (
        <div className="space-y-4">
          {/* Store Filter & Search */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-2.5 text-xs">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
              <div>
                <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-1">
                  Select Store View
                </label>
                <select
                  value={selectedInventoryStoreId}
                  onChange={e => setSelectedInventoryStoreId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="ALL_COMBINED">
                    All Stores Combined (Comparison)
                  </option>
                  {accessibleStores.map(st => {
                    const sh = accessibleShops.find(s => s.id === st.shopId);
                    return (
                      <option key={st.id} value={st.id}>
                        {st.name}
                        {st.isShopFloor ? ' (POS Floor)' : ''} — {sh?.name || 'Shop'}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-1">
                  Category Filter
                </label>
                <select
                  value={invCategoryFilter}
                  onChange={e => setInvCategoryFilter(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="ALL">All Categories</option>
                  {accessibleCategories.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-1">
                  Search Product / Variation / Custom Field
                </label>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={invSearch}
                    onChange={e => setInvSearch(e.target.value)}
                    placeholder="Name, SKU, variation, custom field..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            {selectedInventoryStore && (
              <div className="flex items-center justify-between pt-1 border-t border-slate-800/70">
                <span className="text-[11px] text-slate-400">
                  Viewing{' '}
                  <strong className="text-white">{selectedInventoryStore.name}</strong>
                  {selectedInventoryStore.isShopFloor ? ' (POS Sellable Floor)' : ' (Warehouse)'}
                </span>
                <button
                  type="button"
                  onClick={() => setInvStockedOnly(v => !v)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition ${
                    invStockedOnly
                      ? 'bg-blue-600/20 border-blue-500/40 text-blue-300'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  {invStockedOnly ? 'Stocked Here Only' : 'Show All Shop Items'}
                </button>
              </div>
            )}
          </div>

          {/* Store-Scoped Inventory KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
              <div className="text-[10px] text-slate-400 font-semibold uppercase">SKUs</div>
              <div className="text-base sm:text-lg font-bold text-white font-mono tabular-nums mt-0.5">
                {inventoryTotals.skuCount}
              </div>
              <div className="text-[10px] text-slate-500 font-mono tabular-nums">
                {inventoryTotals.totalUnits.toLocaleString()} units
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
              <div className="text-[10px] text-slate-400 font-semibold uppercase">Cost Value</div>
              <div className="text-sm sm:text-base font-bold text-purple-300 font-mono tabular-nums mt-0.5 truncate">
                {formatCurrency(inventoryTotals.totalCostValue, settings.currencySymbol)}
              </div>
              <div className="text-[10px] text-slate-500">Purchase basis</div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
              <div className="text-[10px] text-slate-400 font-semibold uppercase">Sale Value</div>
              <div className="text-sm sm:text-base font-bold text-blue-300 font-mono tabular-nums mt-0.5 truncate">
                {formatCurrency(inventoryTotals.totalSaleValue, settings.currencySymbol)}
              </div>
              <div className="text-[10px] text-slate-500">Retail basis</div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
              <div className="text-[10px] text-slate-400 font-semibold uppercase">Potential Profit</div>
              <div className="text-sm sm:text-base font-bold text-emerald-400 font-mono tabular-nums mt-0.5 truncate">
                {formatCurrency(inventoryTotals.potentialProfit, settings.currencySymbol)}
              </div>
              <div className="text-[10px] text-slate-500">Est. margin</div>
            </div>
          </div>

          {/* Inventory List */}
          {inventoryProducts.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl py-12 px-4 text-center">
              <Package className="w-10 h-10 mx-auto text-slate-600 mb-2" />
              <p className="text-sm font-semibold text-white">No Products Found</p>
              <p className="text-xs text-slate-400 mt-1">
                Try clearing search/category filters or importing store stock in Data Management.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {inventoryProducts.slice(0, 150).map(product => {
                const cat = accessibleCategories.find(c => c.id === product.categoryId);
                const shopStores = accessibleStores.filter(st => st.shopId === product.shopId);
                const storeQty = selectedInventoryStore
                  ? getProductQtyInStore(product, selectedInventoryStore)
                  : getProductTotalTrackedUnits(product);
                const detail = selectedInventoryStore
                  ? product.storeDetails?.[selectedInventoryStore.id]
                  : undefined;
                const costVal =
                  detail?.purchaseValue !== undefined
                    ? detail.purchaseValue
                    : storeQty * (product.purchasePrice || 0);
                const saleVal =
                  detail?.saleValue !== undefined
                    ? detail.saleValue
                    : storeQty * (product.sellingPrice || 0);

                const customEntries = product.customFields
                  ? [
                      product.customFields.field1 && `CF1: ${product.customFields.field1}`,
                      product.customFields.field2 && `CF2: ${product.customFields.field2}`,
                      product.customFields.field3 && `CF3: ${product.customFields.field3}`,
                      product.customFields.field4 && `CF4: ${product.customFields.field4}`,
                    ].filter(Boolean) as string[]
                  : [];

                const hasHistorical =
                  (product.historicalUnitsSold || 0) > 0 ||
                  (product.historicalUnitsTransferred || 0) > 0 ||
                  (product.historicalUnitsAdjusted || 0) > 0;

                return (
                  <div
                    key={product.id}
                    className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-2.5 text-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h4 className="font-bold text-white text-sm truncate">
                            {product.name}
                          </h4>
                          {product.variation && (
                            <span className="px-2 py-0.5 rounded bg-violet-500/15 border border-violet-500/30 text-violet-300 text-[10px] font-semibold inline-flex items-center gap-1">
                              <Layers className="w-3 h-3" />
                              {product.variation}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap text-[11px] text-slate-400 mt-1">
                          <span className="font-mono">SKU: {product.sku}</span>
                          {cat && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px]">
                              <Tag className="w-2.5 h-2.5" />
                              {cat.name}
                            </span>
                          )}
                          {customEntries.map((cf, idx) => (
                            <span
                              key={idx}
                              className="px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-400 text-[10px]"
                            >
                              {cf}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="text-[10px] text-slate-400">
                          {selectedInventoryStore ? selectedInventoryStore.name : 'All Stores'}
                        </div>
                        <div className="text-base font-bold font-mono tabular-nums text-blue-400">
                          {storeQty} {product.unit}
                        </div>
                      </div>
                    </div>

                    {/* Multi-Store Quantity Breakdown in Combined Mode */}
                    {!selectedInventoryStore && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {shopStores.map(st => {
                          const qtyHere = getProductQtyInStore(product, st);
                          return (
                            <button
                              key={st.id}
                              type="button"
                              onClick={() => {
                                setSelectedInventoryStoreId(st.id);
                                setInvStockedOnly(true);
                              }}
                              className={`px-2 py-1 rounded-lg border text-[10px] font-mono tabular-nums transition ${
                                qtyHere > 0
                                  ? st.isShopFloor
                                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20'
                                    : 'bg-blue-500/10 border-blue-500/30 text-blue-300 hover:bg-blue-500/20'
                                  : 'bg-slate-950 border-slate-800 text-slate-500'
                              }`}
                            >
                              {st.name}
                              {st.isShopFloor ? ' (Floor)' : ''}: <strong>{qtyHere}</strong>
                            </button>
                          );
                        })}
                        {shopStores.length === 0 && (
                          <span className="px-2 py-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 text-[10px] font-mono">
                            Floor: {product.currentStock} · Store: {product.storeStock || 0}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Prices & Valuations */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-950/60 border border-slate-800/80 rounded-lg p-2 text-[11px]">
                      <div>
                        <span className="text-slate-500 block text-[10px]">Buy Price</span>
                        <span className="font-mono text-slate-300">
                          {formatCurrency(product.purchasePrice, settings.currencySymbol)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[10px]">Sell Price</span>
                        <span className="font-mono font-semibold text-white">
                          {formatCurrency(product.sellingPrice, settings.currencySymbol)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[10px]">Cost Value</span>
                        <span className="font-mono text-purple-300">
                          {formatCurrency(costVal, settings.currencySymbol)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[10px]">Sale Value</span>
                        <span className="font-mono font-semibold text-emerald-400">
                          {formatCurrency(saleVal, settings.currencySymbol)}
                        </span>
                      </div>
                    </div>

                    {/* Isolated Historical Reference Metadata */}
                    {hasHistorical && (
                      <div className="flex items-center justify-between flex-wrap gap-2 px-2.5 py-1.5 rounded-lg bg-amber-950/20 border border-amber-500/20 text-[10px] text-amber-200/90">
                        <span className="inline-flex items-center gap-1 font-semibold">
                          <History className="w-3 h-3 text-amber-400" />
                          {product.historicalNote || 'Historical date unavailable'}
                        </span>
                        <span className="font-mono tabular-nums">
                          Sold: {product.historicalUnitsSold || 0} · Transferred:{' '}
                          {product.historicalUnitsTransferred || 0} · Adjusted:{' '}
                          {product.historicalUnitsAdjusted || 0}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
              {inventoryProducts.length > 150 && (
                <div className="text-center text-xs text-slate-500 py-2">
                  Showing first 150 of {inventoryProducts.length} matching products. Refine search or filter by store/category.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 3: TRANSFER STOCK (STORE -> SHOP FLOOR) */}
      {activeSubTab === 'transfer' && (
        <div className="space-y-5">
          {transferableStores.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl py-12 px-4 text-center">
              <Warehouse className="w-10 h-10 mx-auto text-slate-600 mb-2.5" />
              <h3 className="text-sm font-semibold text-white">No Active Warehouse Stores Available</h3>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                Create an active warehouse store (not a POS floor store) before transferring stock onto the shop floor.
              </p>
              <button
                type="button"
                onClick={openCreateStoreModal}
                className="mt-4 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition"
              >
                <Plus className="w-4 h-4" />
                <span>Create Store</span>
              </button>
            </div>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5">
              <div className="flex items-center gap-2 pb-3 border-b border-slate-800 mb-4">
                <ArrowRightLeft className="w-4 h-4 text-blue-400" />
                <h3 className="text-sm font-bold text-white">
                  Transfer Stock from Store to Shop Floor
                </h3>
              </div>

              {transferError && (
                <div className="mb-4 p-3 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{transferError}</span>
                </div>
              )}

              <form onSubmit={handleSubmitTransfer} className="space-y-4 text-xs">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {/* 1. Source Store */}
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      Select Store (Source) *
                    </label>
                    <select
                      value={effectiveSourceStoreId}
                      onChange={e => handleSourceStoreChange(e.target.value)}
                      required
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      {transferableStores.map(st => {
                        const sh = accessibleShops.find(s => s.id === st.shopId);
                        return (
                          <option key={st.id} value={st.id}>
                            {st.name} ({sh?.name || 'Shop'})
                            {st.location ? ` · ${st.location}` : ''}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  {/* 2. Destination Shop */}
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      Select Destination Shop *
                    </label>
                    <select
                      value={effectiveDestShopId}
                      onChange={e => setDestShopId(e.target.value)}
                      required
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      {accessibleShops.map(sh => (
                        <option key={sh.id} value={sh.id}>
                          {sh.name} ({sh.code || 'UNIT'})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* 3. Select Product (showing storeStock in selected store) */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="block text-slate-300 font-medium">
                      Select Product *
                    </label>
                    {selectedTransferProduct && (
                      <span className="text-[11px] font-mono tabular-nums text-blue-400">
                        Available in {selectedSourceStore?.name || 'Store'}: {availableQtyForSelected}{' '}
                        {selectedTransferProduct.unit || 'pcs'}
                      </span>
                    )}
                  </div>

                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      value={productSearch}
                      onChange={e => setProductSearch(e.target.value)}
                      placeholder="Filter products by name, variation, SKU, or barcode..."
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  <select
                    value={transferProductId}
                    onChange={e => {
                      setTransferProductId(e.target.value);
                      setTransferError('');
                    }}
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">Choose a product...</option>
                    {storeScopedProducts.map(p => {
                      const qtyHere = selectedSourceStore
                        ? getProductQtyInStore(p, selectedSourceStore)
                        : Number(p.storeStock || 0);
                      return (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {p.variation ? ` [${p.variation}]` : ''} ({p.sku}) — Store: {qtyHere}{' '}
                          {p.unit} · Floor: {p.currentStock} {p.unit}
                        </option>
                      );
                    })}
                  </select>

                  {selectedTransferProduct && availableQtyForSelected <= 0 && (
                    <p className="text-[11px] text-amber-400">
                      This product currently has 0 units in {selectedSourceStore?.name || 'this store'}. Record a purchase or import stock to this store first.
                    </p>
                  )}
                </div>

                {/* 4. Quantity + 5. Notes */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-slate-300 font-medium">
                        Quantity to Transfer *
                      </label>
                      {selectedTransferProduct && availableQtyForSelected > 0 && (
                        <button
                          type="button"
                          onClick={() => setTransferQty(String(availableQtyForSelected))}
                          className="text-[11px] font-semibold text-blue-400 hover:text-blue-300"
                        >
                          Max ({availableQtyForSelected})
                        </button>
                      )}
                    </div>
                    <input
                      type="number"
                      min="1"
                      max={availableQtyForSelected > 0 ? availableQtyForSelected : undefined}
                      inputMode="numeric"
                      required
                      value={transferQty}
                      onChange={e => {
                        setTransferQty(e.target.value);
                        setTransferError('');
                      }}
                      placeholder="0"
                      className={`w-full bg-slate-950 border rounded-lg px-3 py-2.5 text-white font-mono tabular-nums placeholder-slate-500 focus:outline-none focus:ring-1 ${
                        isQtyExceeding
                          ? 'border-rose-500 focus:ring-rose-500'
                          : 'border-slate-800 focus:ring-blue-500'
                      }`}
                    />
                    {isQtyExceeding && (
                      <p className="text-[11px] text-rose-400 mt-1">
                        Cannot exceed available store stock ({availableQtyForSelected}{' '}
                        {selectedTransferProduct?.unit || 'pcs'}).
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      Notes (Optional)
                    </label>
                    <input
                      type="text"
                      value={transferNotes}
                      onChange={e => setTransferNotes(e.target.value)}
                      placeholder="e.g. Shelf restock for weekend rush"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    type="submit"
                    disabled={
                      !effectiveSourceStoreId ||
                      !transferProductId ||
                      availableQtyForSelected <= 0 ||
                      isQtyExceeding
                    }
                    className="w-full sm:w-auto px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold transition disabled:opacity-45 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Transfer Stock to Shop Floor</span>
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Recent Store Transfers & Warehouse Movements */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-slate-400" />
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                  Recent Store Transfers &amp; Warehouse Logs
                </h3>
              </div>
              <span className="text-[11px] text-slate-500 font-mono tabular-nums">
                {transferMovements.length}
              </span>
            </div>

            {transferMovements.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-500">
                No store transfers or warehouse openings recorded yet.
              </div>
            ) : (
              <div className="divide-y divide-slate-800/80">
                {transferMovements.map(m => {
                  const store = m.storeId
                    ? (dbState.stores || []).find(s => s.id === m.storeId)
                    : undefined;
                  const isIncoming = m.changeQty > 0;
                  return (
                    <div
                      key={m.id}
                      className="px-4 py-3 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-white truncate">
                          {m.productName}
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                          {m.reason}
                          {store ? ` · ${store.name}` : ''}
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                          {formatDateTime(m.createdAt)} · {m.userName}
                        </div>
                      </div>
                      <div className="text-right shrink-0 font-mono tabular-nums">
                        <div
                          className={`font-bold ${
                            isIncoming ? 'text-emerald-400' : 'text-amber-400'
                          }`}
                        >
                          {isIncoming ? `+${m.changeQty}` : m.changeQty}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          Bal: {m.newQty}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create / Edit Store Modal */}
      {isStoreModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/80 backdrop-blur-sm sm:p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl max-w-md w-full p-4 sm:p-6 shadow-2xl max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2">
                <Warehouse className="w-5 h-5 text-blue-400" />
                <h3 className="text-base font-bold text-white">
                  {editingStore ? 'Edit Store' : 'Create Store'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsStoreModalOpen(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {storeFormError && (
              <div className="mb-4 p-3 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{storeFormError}</span>
              </div>
            )}

            <form onSubmit={handleSaveStore} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Shop Assignment *
                </label>
                <select
                  value={storeShopId}
                  onChange={e => setStoreShopId(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="" disabled>
                    Select shop...
                  </option>
                  {accessibleShops.map(sh => (
                    <option key={sh.id} value={sh.id}>
                      {sh.name} ({sh.code || 'UNIT'})
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500 mt-1">
                  A shop can have multiple stores (warehouses).
                </p>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Store Name *
                </label>
                <input
                  type="text"
                  required
                  value={storeName}
                  onChange={e => setStoreName(e.target.value)}
                  placeholder="e.g. Kariakoo Main Store"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Location (Optional)
                </label>
                <input
                  type="text"
                  value={storeLocation}
                  onChange={e => setStoreLocation(e.target.value)}
                  placeholder="e.g. Block C, Ground Floor"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsStoreModalOpen(false)}
                  className="px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={accessibleShops.length === 0}
                  className="px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold transition disabled:opacity-50"
                >
                  {editingStore ? 'Save Changes' : 'Create Store'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
