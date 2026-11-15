import { db } from '../db/storage';
import { Shop, User, ShopStatus } from '../types';
import { generateUUID } from '../utils/crypto';
import { ALL_SHOP_ADMIN_PERMISSIONS, canAccessShopAsAdmin, getShopAdminShopIds, isPlatformAdmin } from '../utils/permissions';

export interface ShopFilterOptions {
  status?: 'ALL' | ShopStatus;
  search?: string;
}

export class ShopService {
  public static getShops(options?: ShopFilterOptions | boolean): Shop[] {
    let all = db.getShops();

    if (typeof options === 'boolean') {
      return options ? all : all.filter(s => s.status === 'ACTIVE');
    }

    if (options) {
      if (options.status && options.status !== 'ALL') {
        all = all.filter(s => s.status === options.status);
      }
      if (options.search && options.search.trim()) {
        const q = options.search.trim().toLowerCase();
        all = all.filter(
          s =>
            s.name.toLowerCase().includes(q) ||
            (s.code && s.code.toLowerCase().includes(q)) ||
            (s.description && s.description.toLowerCase().includes(q))
        );
      }
    }

    return all;
  }

  public static getShopById(id: string): Shop | undefined {
    return db.getShops().find(s => s.id === id);
  }

  /**
   * Returns the designated active Shop Admin (from active shop sellers) for a given shop, if any.
   */
  public static getShopAdmin(shopId: string): User | undefined {
    return db.getUsers().find(
      u =>
        u.role === 'SELLER' &&
        u.status === 'ACTIVE' &&
        (u.assignedShopIds || []).includes(shopId) &&
        getShopAdminShopIds(u).includes(shopId)
    );
  }

  /**
   * Platform Admin assigns or removes a designated Shop Admin for a specific shop.
   * The Shop Admin must be an active seller currently assigned to that shop,
   * and receives full admin permissions scoped strictly to their managed shop(s).
   */
  public static setShopAdmin(
    shopId: string,
    sellerId: string | null,
    currentUser: User
  ): { success: boolean; error?: string } {
    if (!isPlatformAdmin(currentUser)) {
      return { success: false, error: 'Permission Denied: Only Platform Admin can assign a Shop Admin.' };
    }

    const shops = db.getShops();
    const shop = shops.find(s => s.id === shopId);
    if (!shop) {
      return { success: false, error: 'Shop not found.' };
    }

    const users = db.getUsers();
    let targetSeller: User | undefined;

    if (sellerId) {
      targetSeller = users.find(u => u.id === sellerId && u.role === 'SELLER');
      if (!targetSeller) {
        return { success: false, error: 'Selected seller was not found.' };
      }
      if (targetSeller.status !== 'ACTIVE') {
        return { success: false, error: 'Only an active seller can be appointed as Shop Admin.' };
      }
      if (!(targetSeller.assignedShopIds || []).includes(shopId)) {
        return {
          success: false,
          error: `Seller must already be assigned to ${shop.name} before becoming its Shop Admin.`,
        };
      }
    }

    const now = new Date().toISOString();
    const changedUsers: User[] = [];

    const updatedUsers = users.map(u => {
      if (u.role !== 'SELLER') return u;

      const currentManagedIds = getShopAdminShopIds(u);
      const isCurrentlyAdminOfShop = currentManagedIds.includes(shopId);

      // Selected target seller: grant/retain Shop Admin for this shop
      if (targetSeller && u.id === targetSeller.id) {
        const nextManagedIds = Array.from(new Set([...currentManagedIds, shopId]));
        const nextPermissions = {
          ...(u.permissions || {}),
          ...ALL_SHOP_ADMIN_PERMISSIONS,
          shopAdminShopIds: nextManagedIds,
        };
        const updatedUser: User = {
          ...u,
          permissions: nextPermissions,
          updatedAt: now,
        };
        changedUsers.push(updatedUser);
        return updatedUser;
      }

      // Any previous Shop Admin of this shop: demote from this shop
      if (isCurrentlyAdminOfShop) {
        const remainingIds = currentManagedIds.filter(id => id !== shopId);
        const nextPermissions =
          remainingIds.length > 0
            ? {
                ...(u.permissions || {}),
                ...ALL_SHOP_ADMIN_PERMISSIONS,
                shopAdminShopIds: remainingIds,
              }
            : {};

        const updatedUser: User = {
          ...u,
          permissions: nextPermissions,
          updatedAt: now,
        };
        changedUsers.push(updatedUser);
        return updatedUser;
      }

      return u;
    });

    db.saveUsers(updatedUsers);

    // Enqueue cloud sync for every affected seller so D1 permissions stay in sync
    for (const u of changedUsers) {
      db.enqueueSync({
        id: generateUUID(),
        operation: 'UPDATE_SELLER',
        entityType: 'SELLER',
        entityId: u.id,
        payload: {
          id: u.id,
          username: u.username,
          name: u.name,
          role: u.role,
          passwordHash: u.passwordHash,
          color: u.color,
          status: u.status,
          assignedShopIds: u.assignedShopIds,
          avatarUrl: u.avatarUrl || null,
          permissions: u.permissions || {},
          createdAt: u.createdAt,
          updatedAt: u.updatedAt,
        },
        status: 'PENDING',
        createdAt: now,
      });
    }

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: targetSeller ? 'SET_SHOP_ADMIN' : 'REMOVE_SHOP_ADMIN',
      details: targetSeller
        ? `Appointed ${targetSeller.name} (@${targetSeller.username}) as Shop Admin for "${shop.name}"`
        : `Removed Shop Admin assignment from "${shop.name}"`,
      entityType: 'SHOP',
      entityId: shop.id,
      timestamp: now,
    });

    return { success: true };
  }

  public static createShop(
    shopData: Omit<Shop, 'id' | 'createdAt' | 'updatedAt'>,
    createdBy: User
  ): { success: boolean; shop?: Shop; error?: string } {
    try {
      const shops = db.getShops();

      const normalizedName = shopData.name.trim();
      if (!normalizedName) {
        return { success: false, error: 'Shop name is required.' };
      }

      const existing = shops.find(
        s => s.name.toLowerCase() === normalizedName.toLowerCase()
      );
      if (existing) {
        return {
          success: false,
          error: `A shop with the name "${normalizedName}" already exists.`,
        };
      }

      const id = `shop-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .substring(2, 6)}`;
      const now = new Date().toISOString();

      const newShop: Shop = {
        ...shopData,
        id,
        name: normalizedName,
        code: shopData.code
          ? shopData.code.trim().toUpperCase()
          : normalizedName.substring(0, 4).toUpperCase(),
        status: shopData.status || 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      };

      const updatedShops = [...shops, newShop];
      db.saveShops(updatedShops);

      // Auto-assign this shop to Admin accounts
      const users = db.getUsers();
      const updatedUsers = users.map(u => {
        if (u.role === 'ADMIN') {
          const assigned = u.assignedShopIds || [];
          if (!assigned.includes(id)) {
            return { ...u, assignedShopIds: [...assigned, id] };
          }
        }
        return u;
      });
      db.saveUsers(updatedUsers);

      // Audit log
      db.addAuditLog({
        id: `audit-${Date.now()}`,
        userId: createdBy.id,
        userName: createdBy.name,
        action: 'CREATE_SHOP',
        details: `Created shop unit "${newShop.name}" (${
          newShop.code || 'NO-CODE'
        }) with status ${newShop.status}`,
        entityType: 'SHOP',
        entityId: newShop.id,
        timestamp: now,
      });

      // Enqueue sync item
      db.enqueueSync({
        id: `sync-${Date.now()}`,
        operation: 'CREATE_SHOP',
        entityType: 'SHOP',
        entityId: newShop.id,
        payload: newShop,
        status: 'PENDING',
        createdAt: now,
      });

      return { success: true, shop: newShop };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to create shop' };
    }
  }

  public static updateShop(
    id: string,
    updates: Partial<Omit<Shop, 'id' | 'createdAt' | 'updatedAt'>>,
    updatedBy: User
  ): { success: boolean; shop?: Shop; error?: string } {
    try {
      if (!canAccessShopAsAdmin(updatedBy, id)) {
        return { success: false, error: 'Permission Denied: You cannot edit this shop.' };
      }

      const shops = db.getShops();
      const index = shops.findIndex(s => s.id === id);
      if (index === -1) {
        return { success: false, error: 'Shop not found.' };
      }

      const current = shops[index];

      if (updates.name) {
        const normalizedName = updates.name.trim();
        const existing = shops.find(
          s => s.id !== id && s.name.toLowerCase() === normalizedName.toLowerCase()
        );
        if (existing) {
          return {
            success: false,
            error: `Another shop with the name "${normalizedName}" already exists.`,
          };
        }
        updates.name = normalizedName;
      }

      const now = new Date().toISOString();
      const updatedShop: Shop = {
        ...current,
        ...updates,
        updatedAt: now,
      };

      shops[index] = updatedShop;
      db.saveShops([...shops]);

      // Audit log
      db.addAuditLog({
        id: `audit-${Date.now()}`,
        userId: updatedBy.id,
        userName: updatedBy.name,
        action: 'UPDATE_SHOP',
        details: `Updated shop unit "${updatedShop.name}" details`,
        entityType: 'SHOP',
        entityId: updatedShop.id,
        timestamp: now,
      });

      db.enqueueSync({
        id: `sync-${Date.now()}`,
        operation: 'UPDATE_SHOP',
        entityType: 'SHOP',
        entityId: updatedShop.id,
        payload: updatedShop,
        status: 'PENDING',
        createdAt: now,
      });

      return { success: true, shop: updatedShop };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to update shop' };
    }
  }

  public static toggleShopStatus(
    id: string,
    newStatus: ShopStatus,
    updatedBy: User
  ): { success: boolean; shop?: Shop; error?: string } {
    try {
      if (!canAccessShopAsAdmin(updatedBy, id)) {
        return { success: false, error: 'Permission Denied: You cannot change this shop status.' };
      }

      const shops = db.getShops();
      const index = shops.findIndex(s => s.id === id);
      if (index === -1) {
        return { success: false, error: 'Shop not found.' };
      }

      const current = shops[index];
      const now = new Date().toISOString();

      const updatedShop: Shop = {
        ...current,
        status: newStatus,
        updatedAt: now,
      };

      shops[index] = updatedShop;
      db.saveShops([...shops]);

      db.addAuditLog({
        id: `audit-${Date.now()}`,
        userId: updatedBy.id,
        userName: updatedBy.name,
        action: 'TOGGLE_SHOP_STATUS',
        details: `Changed shop "${updatedShop.name}" status from ${current.status} to ${newStatus}`,
        entityType: 'SHOP',
        entityId: updatedShop.id,
        timestamp: now,
      });

      db.enqueueSync({
        id: `sync-${Date.now()}`,
        operation: 'TOGGLE_SHOP_STATUS',
        entityType: 'SHOP',
        entityId: updatedShop.id,
        payload: { id, status: newStatus },
        status: 'PENDING',
        createdAt: now,
      });

      return { success: true, shop: updatedShop };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to toggle shop status' };
    }
  }

  /**
   * Admin deletes a shop permanently.
   * This also removes the shop from all users' assignedShopIds,
   * deletes all products in the shop, and deletes all categories for the shop.
   */
  public static deleteShop(
    shopId: string,
    currentUser: User
  ): { success: boolean; error?: string } {
    if (currentUser.role !== 'ADMIN') {
      return { success: false, error: 'Permission Denied: Only Admin can delete shops.' };
    }

    const shops = db.getShops();
    const shop = shops.find(s => s.id === shopId);

    if (!shop) {
      return { success: false, error: 'Shop not found.' };
    }

    // Remove shop from shops list
    const updatedShops = shops.filter(s => s.id !== shopId);
    db.saveShops(updatedShops);

    // Remove shopId from all users' assignedShopIds and shopAdminShopIds
    const now = new Date().toISOString();
    const users = db.getUsers();
    const updatedUsers = users.map(u => {
      const nextAssigned = (u.assignedShopIds || []).filter(id => id !== shopId);
      const currentAdminShops = getShopAdminShopIds(u);
      if (!currentAdminShops.includes(shopId)) {
        return { ...u, assignedShopIds: nextAssigned };
      }
      const remainingAdminShops = currentAdminShops.filter(id => id !== shopId);
      const nextPermissions =
        remainingAdminShops.length > 0
          ? { ...(u.permissions || {}), ...ALL_SHOP_ADMIN_PERMISSIONS, shopAdminShopIds: remainingAdminShops }
          : {};
      const updatedUser: User = {
        ...u,
        assignedShopIds: nextAssigned,
        permissions: nextPermissions,
        updatedAt: now,
      };
      db.enqueueSync({
        id: generateUUID(),
        operation: 'UPDATE_SELLER',
        entityType: 'SELLER',
        entityId: u.id,
        payload: {
          id: updatedUser.id,
          username: updatedUser.username,
          name: updatedUser.name,
          role: updatedUser.role,
          passwordHash: updatedUser.passwordHash,
          color: updatedUser.color,
          status: updatedUser.status,
          assignedShopIds: updatedUser.assignedShopIds,
          avatarUrl: updatedUser.avatarUrl || null,
          permissions: updatedUser.permissions || {},
          createdAt: updatedUser.createdAt,
          updatedAt: updatedUser.updatedAt,
        },
        status: 'PENDING',
        createdAt: now,
      });
      return updatedUser;
    });
    db.saveUsers(updatedUsers);

    // Remove products in this shop
    const products = db.getProducts();
    const updatedProducts = products.filter(p => p.shopId !== shopId);
    db.saveProducts(updatedProducts);

    // Remove categories in this shop
    const categories = db.getCategories?.() || [];
    const updatedCategories = categories.filter(c => c.shopId !== shopId);
    if (db.saveCategories) {
      db.saveCategories(updatedCategories);
    }

    // Sync to cloud
    db.enqueueSync({
      id: `sync-${Date.now()}`,
      operation: 'DELETE_SHOP',
      entityType: 'SHOP',
      entityId: shopId,
      payload: { id: shopId },
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    });

    // Audit log
    db.addAuditLog({
      id: `audit-${Date.now()}`,
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'DELETE_SHOP',
      details: `Deleted shop: ${shop.name} (${shop.code || 'NO-CODE'})`,
      entityType: 'SHOP',
      entityId: shopId,
      timestamp: new Date().toISOString(),
    });

    return { success: true };
  }
}
