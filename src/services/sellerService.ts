import { db } from '../db/storage';
import { User, UserStatus, SellerPermissions } from '../types';
import { generateUUID, hashPassword } from '../utils/crypto';
import { getShopAdminShopIds, isPlatformAdmin, isShopAdmin } from '../utils/permissions';

export class SellerService {
  /**
   * Get all sellers with their performance statistics (Total sales, total revenue, status, assigned shops).
   */
  public static getSellers(): (User & { salesCount: number; totalRevenue: number; assignedShopNames: string[] })[] {
    const users = db.getUsers().filter(u => u.role === 'SELLER');
    const sales = db.getSales().filter(s => s.status === 'COMPLETED');
    const shops = db.getShops();

    return users.map(user => {
      const userSales = sales.filter(s => s.sellerId === user.id);
      const salesCount = userSales.length;
      const totalRevenue = userSales.reduce((sum, s) => sum + s.total, 0);

      const assignedShopNames = (user.assignedShopIds || [])
        .map(id => shops.find(sh => sh.id === id)?.name)
        .filter(Boolean) as string[];

      return {
        ...user,
        salesCount,
        totalRevenue: Number(totalRevenue.toFixed(2)),
        assignedShopNames,
      };
    });
  }

  /**
   * Admin or Seller with canManageSellers permission creates a new seller.
   */
  public static async createSeller(
    params: {
      name: string;
      username: string;
      password: string;
      color?: string;
      status?: UserStatus;
      assignedShopIds?: string[];
      permissions?: SellerPermissions;
    },
    currentUser: User
  ): Promise<{ success: boolean; seller?: User; error?: string }> {
    const platformAdmin = isPlatformAdmin(currentUser);
    const shopAdmin = isShopAdmin(currentUser);
    const managedShopIds = getShopAdminShopIds(currentUser);

    // Allow Platform Admin, Shop Admin, or Seller with canManageSellers permission
    if (!platformAdmin && !shopAdmin && !currentUser.permissions?.canManageSellers) {
      return {
        success: false,
        error: 'Permission Denied: Only Admin can create seller accounts.',
      };
    }

    if (!params.name?.trim() || !params.username?.trim() || !params.password) {
      return { success: false, error: 'Full name, username, and password are required.' };
    }

    const cleanUsername = params.username.trim().toLowerCase();
    const users = db.getUsers();

    if (users.some(u => u.username.toLowerCase() === cleanUsername)) {
      return { success: false, error: `Username '${cleanUsername}' is already taken.` };
    }

    // Scope shop assignments & permissions when created by a Shop Admin or delegated seller
    let finalAssignedShopIds: string[] =
      params.assignedShopIds && params.assignedShopIds.length > 0 ? [...params.assignedShopIds] : [];
    const finalPermissions: SellerPermissions = platformAdmin ? { ...(params.permissions || {}) } : {};

    if (!platformAdmin) {
      if (shopAdmin) {
        const scoped = finalAssignedShopIds.filter(id => managedShopIds.includes(id));
        finalAssignedShopIds = scoped.length > 0 ? scoped : managedShopIds;
      } else {
        const callerShops = currentUser.assignedShopIds || [];
        const scoped = finalAssignedShopIds.filter(id => callerShops.includes(id));
        finalAssignedShopIds = scoped.length > 0 ? scoped : callerShops;
      }
    }

    const passwordHash = await hashPassword(params.password);
    const newSeller: User = {
      id: generateUUID(),
      username: cleanUsername,
      name: params.name.trim(),
      role: 'SELLER',
      passwordHash,
      color: params.color || 'blue',
      status: params.status || 'ACTIVE',
      assignedShopIds: finalAssignedShopIds,
      avatarUrl: undefined,
      permissions: finalPermissions,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    db.saveUsers([...users, newSeller]);

    db.enqueueSync({
      id: generateUUID(),
      operation: 'CREATE_SELLER',
      entityType: 'SELLER',
      entityId: newSeller.id,
      payload: {
        id: newSeller.id,
        username: newSeller.username,
        name: newSeller.name,
        role: newSeller.role,
        passwordHash: newSeller.passwordHash,
        color: newSeller.color,
        status: newSeller.status,
        assignedShopIds: newSeller.assignedShopIds,
        avatarUrl: newSeller.avatarUrl || null,
        permissions: newSeller.permissions || {},
        createdAt: newSeller.createdAt,
        updatedAt: newSeller.updatedAt,
      },
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    });

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'CREATE_SELLER',
      details: `Created new seller account: ${newSeller.name} (@${newSeller.username}) with ${newSeller.assignedShopIds?.length || 0} assigned shops`,
      entityType: 'SELLER',
      entityId: newSeller.id,
      timestamp: new Date().toISOString(),
    });

    return { success: true, seller: newSeller };
  }

  /**
   * Admin or Seller with canManageSellers permission updates a seller.
   */
  public static updateSeller(
    sellerId: string,
    params: {
      name?: string;
      color?: string;
      status?: UserStatus;
      assignedShopIds?: string[];
      permissions?: SellerPermissions;
    },
    currentUser: User
  ): { success: boolean; seller?: User; error?: string } {
    const platformAdmin = isPlatformAdmin(currentUser);
    const shopAdmin = isShopAdmin(currentUser);
    const managedShopIds = getShopAdminShopIds(currentUser);

    if (!platformAdmin && !shopAdmin && !currentUser.permissions?.canManageSellers) {
      return {
        success: false,
        error: 'Permission Denied: Only Admin can manage seller profiles.',
      };
    }

    const users = db.getUsers();
    const index = users.findIndex(u => u.id === sellerId && u.role === 'SELLER');
    if (index === -1) {
      return { success: false, error: 'Seller account not found.' };
    }

    const seller = { ...users[index] };

    if (!platformAdmin) {
      const allowedScope = shopAdmin ? managedShopIds : (currentUser.assignedShopIds || []);
      const sharesManagedShop = (seller.assignedShopIds || []).some(id => allowedScope.includes(id));
      if (!sharesManagedShop) {
        return {
          success: false,
          error: 'Permission Denied: You can only manage sellers assigned to your shop.',
        };
      }
      if (isShopAdmin(seller) && seller.id !== currentUser.id && params.status === 'INACTIVE') {
        return {
          success: false,
          error: 'Only Platform Admin can deactivate another Shop Admin.',
        };
      }
    }

    if (params.name?.trim()) {
      seller.name = params.name.trim();
    }

    if (params.color) {
      seller.color = params.color;
    }

    if (params.status) {
      seller.status = params.status;
    }

    if (params.assignedShopIds !== undefined) {
      if (platformAdmin) {
        seller.assignedShopIds = params.assignedShopIds;
      } else {
        const allowedScope = shopAdmin ? managedShopIds : (currentUser.assignedShopIds || []);
        const externalShopIds = (seller.assignedShopIds || []).filter(id => !allowedScope.includes(id));
        const nextManagedIds = params.assignedShopIds.filter(id => allowedScope.includes(id));
        const mergedShopIds = Array.from(new Set([...externalShopIds, ...nextManagedIds]));
        if (mergedShopIds.length === 0) {
          return {
            success: false,
            error: 'A seller must remain assigned to at least one shop.',
          };
        }
        seller.assignedShopIds = mergedShopIds;
      }
    }

    if (platformAdmin && params.permissions !== undefined) {
      const preservedShopAdminIds = getShopAdminShopIds(seller);
      const nextPerms: SellerPermissions = { ...params.permissions };
      if (preservedShopAdminIds.length > 0) {
        nextPerms.shopAdminShopIds = preservedShopAdminIds;
      } else {
        delete nextPerms.shopAdminShopIds;
      }
      seller.permissions = nextPerms;
    }

    seller.updatedAt = new Date().toISOString();
    users[index] = seller;
    db.saveUsers(users);

    db.enqueueSync({
      id: generateUUID(),
      operation: 'UPDATE_SELLER',
      entityType: 'SELLER',
      entityId: seller.id,
      payload: {
        id: seller.id,
        username: seller.username,
        name: seller.name,
        role: seller.role,
        passwordHash: seller.passwordHash,
        color: seller.color,
        status: seller.status,
        assignedShopIds: seller.assignedShopIds,
        avatarUrl: seller.avatarUrl || null,
        permissions: seller.permissions || {},
        createdAt: seller.createdAt,
        updatedAt: seller.updatedAt,
      },
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    });

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'UPDATE_SELLER',
      details: `Updated seller ${seller.name} (Status: ${seller.status}, Color: ${seller.color}, Assigned Shops: ${seller.assignedShopIds?.length || 0})`,
      entityType: 'SELLER',
      entityId: seller.id,
      timestamp: new Date().toISOString(),
    });

    return { success: true, seller };
  }

  public static toggleSellerStatus(
    sellerId: string,
    status: UserStatus,
    currentUser: User
  ): { success: boolean; error?: string } {
    return SellerService.updateSeller(sellerId, { status }, currentUser);
  }

  /**
   * Admin or Seller with canManageSellers permission deletes a seller.
   */
  public static deleteSeller(
    sellerId: string,
    currentUser: User
  ): { success: boolean; error?: string } {
    const platformAdmin = isPlatformAdmin(currentUser);
    const shopAdmin = isShopAdmin(currentUser);
    const managedShopIds = getShopAdminShopIds(currentUser);

    if (!platformAdmin && !shopAdmin && !currentUser.permissions?.canManageSellers) {
      return {
        success: false,
        error: 'Permission Denied: Only Admin can delete sellers.',
      };
    }

    const users = db.getUsers();
    const seller = users.find(u => u.id === sellerId && u.role === 'SELLER');

    if (!seller) {
      return { success: false, error: 'Seller not found.' };
    }

    if (!platformAdmin) {
      if (seller.id === currentUser.id) {
        return { success: false, error: 'You cannot delete your own account.' };
      }
      if (isShopAdmin(seller)) {
        return {
          success: false,
          error: 'Only Platform Admin can remove a Shop Admin account.',
        };
      }
      const allowedScope = shopAdmin ? managedShopIds : (currentUser.assignedShopIds || []);
      const sellerShops = seller.assignedShopIds || [];
      if (!sellerShops.some(id => allowedScope.includes(id))) {
        return {
          success: false,
          error: 'Permission Denied: This seller does not belong to your managed shop.',
        };
      }
      if (sellerShops.some(id => !allowedScope.includes(id))) {
        return {
          success: false,
          error: 'This seller also works at other shops. Unassign them from your shop or contact Platform Admin.',
        };
      }
    }

    // Remove seller from users
    const updatedUsers = users.filter(u => u.id !== sellerId);
    db.saveUsers(updatedUsers);

    // Sync to cloud
    db.enqueueSync({
      id: generateUUID(),
      operation: 'DELETE_SELLER',
      entityType: 'SELLER',
      entityId: sellerId,
      payload: { id: sellerId },
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    });

    // Audit log
    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'DELETE_SELLER',
      details: `Deleted seller account: ${seller.name} (@${seller.username})`,
      entityType: 'SELLER',
      entityId: sellerId,
      timestamp: new Date().toISOString(),
    });

    return { success: true };
  }

  /**
   * Seller or Admin updates the seller's account color.
   */
  public static updateSellerColor(
    sellerId: string,
    color: string,
    currentUser: User
  ): { success: boolean; error?: string } {
    if (currentUser.role !== 'ADMIN' && currentUser.id !== sellerId) {
      return {
        success: false,
        error: 'Permission Denied: You cannot modify another user color.',
      };
    }

    const users = db.getUsers();
    const user = users.find(u => u.id === sellerId);
    if (!user) return { success: false, error: 'User not found.' };

    user.color = color;
    user.updatedAt = new Date().toISOString();
    db.saveUsers(users);

    db.enqueueSync({
      id: generateUUID(),
      operation: 'UPDATE_SELLER',
      entityType: 'SELLER',
      entityId: user.id,
      payload: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        passwordHash: user.passwordHash,
        color: user.color,
        status: user.status,
        assignedShopIds: user.assignedShopIds,
        avatarUrl: user.avatarUrl || null,
        permissions: user.permissions || {},
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    });

    return { success: true };
  }
}
