import { db } from '../db/storage';
import { InventoryMovement, Store, StoreStatus, User } from '../types';
import { generateUUID } from '../utils/crypto';
import {
  canAccessShopAsAdmin,
  getShopAdminShopIds,
  hasAdminAccess,
  isPlatformAdmin,
  isShopAdmin,
} from '../utils/permissions';

export class StoreService {
  public static getStores(
    options?: {
      shopId?: string;
      status?: StoreStatus | 'ALL';
    },
    currentUser?: User
  ): Store[] {
    let stores = db.getStores();

    if (currentUser && !isPlatformAdmin(currentUser)) {
      if (isShopAdmin(currentUser)) {
        const managedIds = getShopAdminShopIds(currentUser);
        stores = stores.filter(s => managedIds.includes(s.shopId));
      } else {
        const assigned = currentUser.assignedShopIds || [];
        if (assigned.length > 0) {
          stores = stores.filter(s => assigned.includes(s.shopId));
        }
      }
    }

    if (options?.shopId && options.shopId !== 'ALL') {
      stores = stores.filter(s => s.shopId === options.shopId);
    }

    if (options?.status && options.status !== 'ALL') {
      stores = stores.filter(s => s.status === options.status);
    }

    return stores;
  }

  public static getStoreById(id: string): Store | undefined {
    return db.getStores().find(s => s.id === id);
  }

  public static createStore(
    params: {
      shopId: string;
      name: string;
      location?: string;
      status?: StoreStatus;
    },
    currentUser: User
  ): { success: boolean; store?: Store; error?: string } {
    if (!hasAdminAccess(currentUser)) {
      return {
        success: false,
        error: 'Permission Denied: Only Admins or Shop Admins can create stores.',
      };
    }

    const cleanName = params.name?.trim();
    if (!cleanName) {
      return { success: false, error: 'Store name is required.' };
    }

    if (!params.shopId) {
      return { success: false, error: 'Please select a shop to assign this store to.' };
    }

    if (!isPlatformAdmin(currentUser) && !canAccessShopAsAdmin(currentUser, params.shopId)) {
      return {
        success: false,
        error: 'Permission Denied: You can only create stores for your managed shop.',
      };
    }

    const shop = db.getShops().find(s => s.id === params.shopId);
    if (!shop) {
      return { success: false, error: 'Selected shop does not exist.' };
    }

    const existingStores = db.getStores();
    const duplicate = existingStores.find(
      s => s.shopId === params.shopId && s.name.trim().toLowerCase() === cleanName.toLowerCase()
    );
    if (duplicate) {
      return {
        success: false,
        error: `A store named "${cleanName}" already exists under ${shop.name}.`,
      };
    }

    const now = new Date().toISOString();
    const newStore: Store = {
      id: generateUUID(),
      shopId: params.shopId,
      name: cleanName,
      location: params.location?.trim() || undefined,
      status: params.status || 'ACTIVE',
      isShopFloor: Boolean((params as any).isShopFloor),
      createdAt: now,
      updatedAt: now,
    };

    db.saveStores([newStore, ...existingStores]);

    db.enqueueSync({
      id: generateUUID(),
      operation: 'CREATE_STORE',
      entityType: 'STORE',
      entityId: newStore.id,
      payload: newStore,
      status: 'PENDING',
      createdAt: now,
    });

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'CREATE_STORE',
      details: `Created store "${newStore.name}"${newStore.location ? ` (${newStore.location})` : ''} assigned to [${shop.name}]`,
      entityType: 'STORE',
      entityId: newStore.id,
      shopId: shop.id,
      timestamp: now,
    });

    return { success: true, store: newStore };
  }

  public static updateStore(
    id: string,
    updates: {
      name?: string;
      location?: string;
      shopId?: string;
      status?: StoreStatus;
    },
    currentUser: User
  ): { success: boolean; store?: Store; error?: string } {
    if (!hasAdminAccess(currentUser)) {
      return {
        success: false,
        error: 'Permission Denied: Only Admins or Shop Admins can update stores.',
      };
    }

    const stores = db.getStores();
    const idx = stores.findIndex(s => s.id === id);
    if (idx === -1) {
      return { success: false, error: 'Store not found.' };
    }

    const current = stores[idx];
    const targetShopId = updates.shopId || current.shopId;

    if (
      !isPlatformAdmin(currentUser) &&
      (!canAccessShopAsAdmin(currentUser, current.shopId) ||
        !canAccessShopAsAdmin(currentUser, targetShopId))
    ) {
      return {
        success: false,
        error: 'Permission Denied: You can only manage stores in your assigned shop.',
      };
    }

    const cleanName = updates.name !== undefined ? updates.name.trim() : current.name;
    if (!cleanName) {
      return { success: false, error: 'Store name cannot be empty.' };
    }

    const duplicate = stores.find(
      s =>
        s.id !== id &&
        s.shopId === targetShopId &&
        s.name.trim().toLowerCase() === cleanName.toLowerCase()
    );
    if (duplicate) {
      return {
        success: false,
        error: `Another store named "${cleanName}" already exists in this shop.`,
      };
    }

    const now = new Date().toISOString();
    const updatedStore: Store = {
      ...current,
      name: cleanName,
      shopId: targetShopId,
      location:
        updates.location !== undefined ? updates.location.trim() || undefined : current.location,
      status: updates.status || current.status,
      isShopFloor:
        (updates as any).isShopFloor !== undefined
          ? Boolean((updates as any).isShopFloor)
          : current.isShopFloor,
      updatedAt: now,
    };

    const nextStores = [...stores];
    nextStores[idx] = updatedStore;
    db.saveStores(nextStores);

    db.enqueueSync({
      id: generateUUID(),
      operation: 'UPDATE_STORE',
      entityType: 'STORE',
      entityId: updatedStore.id,
      payload: updatedStore,
      status: 'PENDING',
      createdAt: now,
    });

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'UPDATE_STORE',
      details: `Updated store "${updatedStore.name}" (${updatedStore.status})`,
      entityType: 'STORE',
      entityId: updatedStore.id,
      shopId: updatedStore.shopId,
      timestamp: now,
    });

    return { success: true, store: updatedStore };
  }

  public static deleteStore(
    id: string,
    currentUser: User
  ): { success: boolean; store?: Store; error?: string } {
    if (!hasAdminAccess(currentUser)) {
      return {
        success: false,
        error: 'Permission Denied: Only Admins or Shop Admins can delete stores.',
      };
    }

    const stores = db.getStores();
    const store = stores.find(s => s.id === id);
    if (!store) {
      return { success: false, error: 'Store not found.' };
    }

    if (!isPlatformAdmin(currentUser) && !canAccessShopAsAdmin(currentUser, store.shopId)) {
      return {
        success: false,
        error: 'Permission Denied: You can only delete stores in your managed shop.',
      };
    }

    const now = new Date().toISOString();
    const remainingStores = stores.filter(s => s.id !== id);
    const floorStoreIds = new Set(
      remainingStores
        .filter(s => s.shopId === store.shopId && s.isShopFloor)
        .map(s => s.id)
    );
    const remainingWarehouseInShop = remainingStores.filter(
      s => s.shopId === store.shopId && !s.isShopFloor && s.status === 'ACTIVE'
    );

    // Clean up deleted store's entries from products in that shop
    const products = [...db.getProducts()];
    let productsChanged = false;
    const updatedProducts = products.map(p => {
      if (p.shopId !== store.shopId) return p;

      const hadStoreStockEntry = Boolean(p.storeStocks && id in p.storeStocks);
      const hadStoreDetailEntry = Boolean(p.storeDetails && id in p.storeDetails);
      const wasLegacySingleWarehouse =
        !store.isShopFloor &&
        (!p.storeStocks || Object.keys(p.storeStocks).length === 0) &&
        remainingWarehouseInShop.length === 0 &&
        Number(p.storeStock || 0) > 0;

      if (!hadStoreStockEntry && !hadStoreDetailEntry && !wasLegacySingleWarehouse) {
        return p;
      }

      productsChanged = true;
      const nextStoreStocks = p.storeStocks ? { ...p.storeStocks } : undefined;
      if (nextStoreStocks) {
        delete nextStoreStocks[id];
      }

      const nextStoreDetails = p.storeDetails ? { ...p.storeDetails } : undefined;
      if (nextStoreDetails) {
        delete nextStoreDetails[id];
      }

      let nextWarehouseStock = Number(p.storeStock || 0);
      if (wasLegacySingleWarehouse) {
        nextWarehouseStock = 0;
      } else if (nextStoreStocks) {
        nextWarehouseStock = Object.entries(nextStoreStocks).reduce((sum, [sid, qty]) => {
          return floorStoreIds.has(sid) ? sum : sum + Math.max(0, Number(qty || 0));
        }, 0);
      }

      const updatedProd = {
        ...p,
        storeStock: nextWarehouseStock,
        ...(nextStoreStocks !== undefined ? { storeStocks: nextStoreStocks } : {}),
        ...(nextStoreDetails !== undefined ? { storeDetails: nextStoreDetails } : {}),
        updatedAt: now,
      };

      db.enqueueSync({
        id: generateUUID(),
        operation: 'UPDATE_PRODUCT',
        entityType: 'PRODUCT',
        entityId: updatedProd.id,
        payload: { ...updatedProd, storeId: undefined },
        status: 'PENDING',
        createdAt: now,
      });

      return updatedProd;
    });

    if (productsChanged) {
      db.saveProducts(updatedProducts);
    }

    db.saveStores(remainingStores);

    db.enqueueSync({
      id: generateUUID(),
      operation: 'DELETE_STORE',
      entityType: 'STORE',
      entityId: id,
      payload: { id, shopId: store.shopId },
      status: 'PENDING',
      createdAt: now,
    });

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'DELETE_STORE',
      details: `Deleted store "${store.name}"${store.location ? ` (${store.location})` : ''}`,
      entityType: 'STORE',
      entityId: store.id,
      shopId: store.shopId,
      timestamp: now,
    });

    return { success: true, store };
  }

  public static transferStoreToShop(
    params: {
      storeId: string;
      productId: string;
      shopId: string;
      quantity: number;
      notes?: string;
    },
    currentUser: User
  ): { success: boolean; transferId?: string; error?: string } {
    if (!hasAdminAccess(currentUser)) {
      return {
        success: false,
        error: 'Permission Denied: Only Admins and Shop Admins can transfer stock from stores.',
      };
    }

    const store = db.getStores().find(s => s.id === params.storeId);
    if (!store) {
      return { success: false, error: 'Selected source store does not exist.' };
    }

    if (store.status !== 'ACTIVE') {
      return { success: false, error: `Store "${store.name}" is inactive.` };
    }

    const destShop = db.getShops().find(s => s.id === params.shopId);
    if (!destShop) {
      return { success: false, error: 'Selected destination shop does not exist.' };
    }

    if (!isPlatformAdmin(currentUser)) {
      if (
        !canAccessShopAsAdmin(currentUser, store.shopId) ||
        !canAccessShopAsAdmin(currentUser, destShop.id)
      ) {
        return {
          success: false,
          error: 'Permission Denied: You can only transfer stock within your managed shop.',
        };
      }
    }

    const products = [...db.getProducts()];
    const prodIdx = products.findIndex(p => p.id === params.productId);
    if (prodIdx === -1) {
      return { success: false, error: 'Selected product was not found.' };
    }

    const product = products[prodIdx];
    const qty = Number(params.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      return { success: false, error: 'Transfer quantity must be greater than 0.' };
    }

    if (store.isShopFloor) {
      return {
        success: false,
        error: `"${store.name}" is already designated as the POS Shop Floor. Select a warehouse store to transfer from.`,
      };
    }

    const availableInThisStore =
      product.storeStocks && product.storeStocks[store.id] !== undefined
        ? Number(product.storeStocks[store.id] || 0)
        : Number(product.storeStock || 0);

    if (qty > availableInThisStore) {
      return {
        success: false,
        error: `Not enough stock in ${store.name}. Available: ${availableInThisStore} ${product.unit || 'pcs'}.`,
      };
    }

    const now = new Date().toISOString();
    const transferId = generateUUID();
    const currentShopStock = Number(product.currentStock || 0);
    const totalWarehouseBefore = Number(product.storeStock || 0);
    const newShopStock = currentShopStock + qty;

    // Update per-store stock breakdown cleanly if tracked
    const allStores = db.getStores();
    const floorStore = allStores.find(
      s => s.shopId === destShop.id && s.isShopFloor && s.status === 'ACTIVE'
    );
    const nextStoreStocks = product.storeStocks ? { ...product.storeStocks } : undefined;
    const nextStoreDetails = product.storeDetails ? { ...product.storeDetails } : undefined;

    let newWarehouseTotal = Math.max(0, totalWarehouseBefore - qty);
    let newStoreBalForLog = Math.max(0, availableInThisStore - qty);

    if (nextStoreStocks) {
      const currentInSource =
        nextStoreStocks[store.id] !== undefined
          ? Number(nextStoreStocks[store.id] || 0)
          : availableInThisStore;
      newStoreBalForLog = Math.max(0, currentInSource - qty);
      nextStoreStocks[store.id] = newStoreBalForLog;

      if (nextStoreDetails && nextStoreDetails[store.id]) {
        nextStoreDetails[store.id] = {
          ...nextStoreDetails[store.id],
          quantity: newStoreBalForLog,
        };
      }

      if (floorStore) {
        nextStoreStocks[floorStore.id] = newShopStock;
        if (nextStoreDetails) {
          nextStoreDetails[floorStore.id] = {
            ...(nextStoreDetails[floorStore.id] || {
              storeId: floorStore.id,
              storeName: floorStore.name,
              unitPurchasePrice: product.purchasePrice || 0,
              unitSellingPrice: product.sellingPrice || 0,
            }),
            storeId: floorStore.id,
            storeName: floorStore.name,
            quantity: newShopStock,
          };
        }
      }

      // Recompute warehouse total from all non-floor stores
      const floorStoreIds = new Set(
        allStores.filter(s => s.isShopFloor).map(s => s.id)
      );
      newWarehouseTotal = Object.entries(nextStoreStocks).reduce((sum, [sid, q]) => {
        return floorStoreIds.has(sid) ? sum : sum + Math.max(0, Number(q || 0));
      }, 0);
    }

    products[prodIdx] = {
      ...product,
      currentStock: newShopStock,
      storeStock: newWarehouseTotal,
      ...(nextStoreStocks ? { storeStocks: nextStoreStocks } : {}),
      ...(nextStoreDetails ? { storeDetails: nextStoreDetails } : {}),
      updatedAt: now,
    };
    db.saveProducts(products);

    const noteSuffix = params.notes?.trim() ? ` — ${params.notes.trim()}` : '';
    const inMovement: InventoryMovement = {
      id: generateUUID(),
      shopId: destShop.id,
      shopName: destShop.name,
      storeId: store.id,
      productId: product.id,
      productName: product.name,
      previousQty: currentShopStock,
      changeQty: qty,
      newQty: newShopStock,
      type: 'STORE_TRANSFER',
      reason: `Transferred IN from ${store.name}${noteSuffix}`,
      referenceId: transferId,
      userId: currentUser.id,
      userName: currentUser.name,
      createdAt: now,
    };

    const outMovement: InventoryMovement = {
      id: generateUUID(),
      shopId: destShop.id,
      shopName: destShop.name,
      storeId: store.id,
      productId: product.id,
      productName: product.name,
      previousQty: availableInThisStore,
      changeQty: -qty,
      newQty: newStoreBalForLog,
      type: 'STORE_TRANSFER',
      reason: `Transferred OUT to ${destShop.name}${noteSuffix}`,
      referenceId: transferId,
      userId: currentUser.id,
      userName: currentUser.name,
      createdAt: now,
    };

    db.saveMovements([inMovement, outMovement, ...db.getMovements()]);

    db.enqueueSync({
      id: generateUUID(),
      operation: 'TRANSFER_STORE_TO_SHOP',
      entityType: 'STORE',
      entityId: transferId,
      payload: {
        transferId,
        productId: product.id,
        storeId: store.id,
        storeName: store.name,
        shopId: destShop.id,
        shopName: destShop.name,
        quantity: qty,
        transferredById: currentUser.id,
        transferredByName: currentUser.name,
        notes: params.notes?.trim() || undefined,
      },
      status: 'PENDING',
      createdAt: now,
    });

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'TRANSFER_STORE_TO_SHOP',
      details: `Transferred ${qty} ${product.unit || 'pcs'} of "${product.name}" from store "${store.name}" to [${destShop.name}]${noteSuffix}`,
      entityType: 'STORE',
      entityId: transferId,
      shopId: destShop.id,
      timestamp: now,
    });

    return { success: true, transferId };
  }

  /**
   * Synchronize a product's shop-floor quantity into its `storeStocks` / `storeDetails`
   * map when a store in that shop is designated as `isShopFloor` (e.g. SONKO SOUND SHOP).
   */
  public static applyFloorStockDeltaToProduct<T extends { shopId: string; storeStocks?: Record<string, number>; storeDetails?: Record<string, any> }>(
    product: T,
    newFloorQty: number
  ): T {
    if (!product.storeStocks) return product;
    const floorStore = db
      .getStores()
      .find(s => s.shopId === product.shopId && s.isShopFloor && s.status === 'ACTIVE');
    if (!floorStore) return product;

    const nextStoreStocks = {
      ...product.storeStocks,
      [floorStore.id]: Math.max(0, newFloorQty),
    };
    const nextStoreDetails = product.storeDetails
      ? {
          ...product.storeDetails,
          ...(product.storeDetails[floorStore.id]
            ? {
                [floorStore.id]: {
                  ...product.storeDetails[floorStore.id],
                  quantity: Math.max(0, newFloorQty),
                },
              }
            : {}),
        }
      : undefined;

    return {
      ...product,
      storeStocks: nextStoreStocks,
      ...(nextStoreDetails ? { storeDetails: nextStoreDetails } : {}),
    };
  }
}
