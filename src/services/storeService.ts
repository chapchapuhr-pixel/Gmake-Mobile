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

    const availableStoreStock = Number(product.storeStock || 0);
    if (qty > availableStoreStock) {
      return {
        success: false,
        error: `Not enough stock in store. Available: ${availableStoreStock} ${product.unit || 'pcs'}.`,
      };
    }

    const now = new Date().toISOString();
    const transferId = generateUUID();
    const currentShopStock = Number(product.currentStock || 0);
    const newShopStock = currentShopStock + qty;
    const newStoreStock = availableStoreStock - qty;

    products[prodIdx] = {
      ...product,
      currentStock: newShopStock,
      storeStock: newStoreStock,
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
      previousQty: availableStoreStock,
      changeQty: -qty,
      newQty: newStoreStock,
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
}
