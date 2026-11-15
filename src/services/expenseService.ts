import { db } from '../db/storage';
import { Expense, ExpenseCategory, PaymentMethod, User } from '../types';
import { generateUUID } from '../utils/crypto';
import { getShopAdminShopIds, isPlatformAdmin, isShopAdmin } from '../utils/permissions';

export class ExpenseService {
  /**
   * Record operational expense (Shop-specific or General Company).
   * Admin OR Seller with canRecordExpenses permission.
   */
  public static recordExpense(
    params: {
      shopId?: string | null;
      isCompanyExpense?: boolean;
      category: ExpenseCategory | string;
      description?: string;
      title?: string;
      amount: number;
      paymentMethod: PaymentMethod;
      date?: string;
      reference?: string;
      notes?: string;
    },
    currentUser: User
  ): { success: boolean; expense?: Expense; error?: string } {
    const platformAdmin = isPlatformAdmin(currentUser);
    const shopAdmin = isShopAdmin(currentUser);
    const managedShopIds = getShopAdminShopIds(currentUser);

    // Allow Platform Admin, Shop Admin, or Seller with canRecordExpenses permission
    if (!platformAdmin && !shopAdmin && !currentUser.permissions?.canRecordExpenses) {
      return {
        success: false,
        error: 'Permission Denied: You do not have permission to record expenses.',
      };
    }

    const desc = params.title || params.description;
    if (!desc?.trim()) {
      return { success: false, error: 'Description is required.' };
    }

    if (params.amount <= 0) {
      return { success: false, error: 'Amount must be greater than zero.' };
    }

    let shopName: string | undefined = undefined;
    let finalShopId: string | null = null;
    const requestedShopId = params.shopId && params.shopId !== 'GENERAL' ? params.shopId : undefined;

    let isCompany = params.isCompanyExpense || !requestedShopId;

    if (!platformAdmin && shopAdmin) {
      const resolvedShopId = requestedShopId || (managedShopIds.length === 1 ? managedShopIds[0] : undefined);
      if (params.isCompanyExpense || params.shopId === 'GENERAL' || !resolvedShopId) {
        return {
          success: false,
          error: 'Shop Admin must assign expenses to a specific managed shop (company-wide general expenses are Platform Admin only).',
        };
      }
      if (!managedShopIds.includes(resolvedShopId)) {
        return {
          success: false,
          error: 'Permission Denied: You can only record expenses for your managed shop.',
        };
      }
      isCompany = false;
      const shop = db.getShops().find(s => s.id === resolvedShopId);
      if (!shop) {
        return { success: false, error: 'Selected shop does not exist.' };
      }
      shopName = shop.name;
      finalShopId = shop.id;
    } else if (!isCompany && requestedShopId) {
      const shop = db.getShops().find(s => s.id === requestedShopId);
      if (!shop) {
        return { success: false, error: 'Selected shop does not exist.' };
      }
      shopName = shop.name;
      finalShopId = shop.id;
    } else {
      shopName = 'General Company';
      finalShopId = null;
    }

    const newExpense: Expense = {
      id: generateUUID(),
      shopId: finalShopId,
      shopName,
      isCompanyExpense: isCompany,
      category: params.category || 'OTHER',
      description: desc.trim(),
      title: desc.trim(),
      amount: Number(params.amount.toFixed(2)),
      paymentMethod: params.paymentMethod || 'CASH',
      date: params.date || new Date().toISOString().slice(0, 10),
      reference: params.reference?.trim(),
      notes: params.notes?.trim(),
      createdByUserId: currentUser.id,
      createdByName: currentUser.name,
      createdAt: new Date().toISOString(),
    };

    db.saveExpenses([newExpense, ...db.getExpenses()]);

    db.enqueueSync({
      id: generateUUID(),
      operation: 'CREATE_EXPENSE',
      entityType: 'EXPENSE',
      entityId: newExpense.id,
      payload: newExpense,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    });

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'CREATE_EXPENSE',
      details: `Recorded ${newExpense.category} expense: ${newExpense.amount.toFixed(2)} (${newExpense.description}) [${shopName}]`,
      entityType: 'EXPENSE',
      entityId: newExpense.id,
      timestamp: new Date().toISOString(),
    });

    return { success: true, expense: newExpense };
  }

  public static createExpense(
    params: {
      shopId?: string | null;
      isCompanyExpense?: boolean;
      category: ExpenseCategory | string;
      title: string;
      amount: number;
      paymentMethod: PaymentMethod;
      reference?: string;
      notes?: string;
    },
    currentUser: User
  ) {
    return ExpenseService.recordExpense(params, currentUser);
  }

  /**
   * Update an existing expense.
   * Admin can edit any; Seller with canRecordExpenses can edit only their own.
   */
  public static updateExpense(
    expenseId: string,
    updates: {
      shopId?: string | null;
      title?: string;
      category?: ExpenseCategory | string;
      amount?: number;
      paymentMethod?: PaymentMethod;
      reference?: string;
      notes?: string;
      date?: string;
    },
    currentUser: User
  ): { success: boolean; expense?: Expense; error?: string } {
    const expenses = db.getExpenses();
    const index = expenses.findIndex(e => e.id === expenseId);

    if (index === -1) {
      return { success: false, error: 'Expense not found.' };
    }

    const current = expenses[index];
    const platformAdmin = isPlatformAdmin(currentUser);
    const shopAdmin = isShopAdmin(currentUser);
    const managedShopIds = getShopAdminShopIds(currentUser);

    if (!platformAdmin) {
      if (shopAdmin) {
        if (!current.shopId || !managedShopIds.includes(current.shopId)) {
          return {
            success: false,
            error: 'Permission Denied: You can only edit expenses belonging to your managed shop.',
          };
        }
      } else {
        if (!currentUser.permissions?.canRecordExpenses) {
          return {
            success: false,
            error: 'Permission Denied: You do not have permission to edit expenses.',
          };
        }
        if (current.createdByUserId !== currentUser.id) {
          return {
            success: false,
            error: 'Permission Denied: You can only edit expenses you created.',
          };
        }
      }
    }

    if (updates.amount !== undefined && updates.amount <= 0) {
      return { success: false, error: 'Amount must be greater than zero.' };
    }

    let nextShopId = current.shopId;
    let nextShopName = current.shopName;
    let nextIsCompany = current.isCompanyExpense;

    if (updates.shopId !== undefined) {
      if (updates.shopId === 'GENERAL' || updates.shopId === null || updates.shopId === '') {
        if (!platformAdmin) {
          return {
            success: false,
            error: 'Permission Denied: Only Platform Admin can move an expense to General Company.',
          };
        }
        nextShopId = null;
        nextShopName = 'General Company';
        nextIsCompany = true;
      } else {
        if (!platformAdmin && shopAdmin && !managedShopIds.includes(updates.shopId)) {
          return {
            success: false,
            error: 'Permission Denied: Target shop is outside your managed shops.',
          };
        }
        const shop = db.getShops().find(s => s.id === updates.shopId);
        if (!shop) {
          return { success: false, error: 'Selected shop does not exist.' };
        }
        nextShopId = shop.id;
        nextShopName = shop.name;
        nextIsCompany = false;
      }
    }

    const finalTitle = updates.title?.trim() || current.title || current.description;

    const updatedExpense: Expense = {
      ...current,
      shopId: nextShopId,
      shopName: nextShopName,
      isCompanyExpense: nextIsCompany,
      title: finalTitle,
      description: finalTitle,
      category: updates.category || current.category,
      amount: updates.amount !== undefined ? Number(updates.amount.toFixed(2)) : current.amount,
      paymentMethod: updates.paymentMethod || current.paymentMethod,
      reference: updates.reference?.trim() || undefined,
      notes: updates.notes?.trim() || undefined,
      date: updates.date || current.date,
    };

    expenses[index] = updatedExpense;
    db.saveExpenses(expenses);

    db.enqueueSync({
      id: generateUUID(),
      operation: 'UPDATE_EXPENSE',
      entityType: 'EXPENSE',
      entityId: expenseId,
      payload: updatedExpense,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    });

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'UPDATE_EXPENSE',
      details: `Updated expense: ${updatedExpense.title} (${updatedExpense.category}, ${updatedExpense.amount})`,
      entityType: 'EXPENSE',
      entityId: expenseId,
      timestamp: new Date().toISOString(),
    });

    return { success: true, expense: updatedExpense };
  }

  /**
   * Delete an expense permanently.
   * Admin only (safer for financial records).
   */
  public static deleteExpense(
    expenseId: string,
    currentUser: User
  ): { success: boolean; error?: string } {
    const platformAdmin = isPlatformAdmin(currentUser);
    const shopAdmin = isShopAdmin(currentUser);
    const managedShopIds = getShopAdminShopIds(currentUser);

    if (!platformAdmin && !shopAdmin) {
      return { success: false, error: 'Permission Denied: Only Admin can delete expenses.' };
    }

    const expenses = db.getExpenses();
    const expense = expenses.find(e => e.id === expenseId);

    if (!expense) {
      return { success: false, error: 'Expense not found.' };
    }

    if (!platformAdmin && (!expense.shopId || !managedShopIds.includes(expense.shopId))) {
      return {
        success: false,
        error: 'Permission Denied: You can only delete expenses belonging to your managed shop.',
      };
    }

    const updatedExpenses = expenses.filter(e => e.id !== expenseId);
    db.saveExpenses(updatedExpenses);

    db.enqueueSync({
      id: generateUUID(),
      operation: 'DELETE_EXPENSE',
      entityType: 'EXPENSE',
      entityId: expenseId,
      payload: { id: expenseId },
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    });

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'DELETE_EXPENSE',
      details: `Deleted expense: ${expense.title} (${expense.category}, ${expense.amount})`,
      entityType: 'EXPENSE',
      entityId: expenseId,
      timestamp: new Date().toISOString(),
    });

    return { success: true };
  }

  /**
   * Get expenses - Platform Admin sees all, Shop Admin sees managed shops' expenses,
   * Seller with canViewExpenses/canRecordExpenses sees expenses.
   */
  public static getExpenses(
    filter?: {
      shopId?: string;
      category?: ExpenseCategory | string;
      search?: string;
      startDate?: string;
      endDate?: string;
    },
    currentUser?: User
  ): Expense[] {
    if (currentUser) {
      if (
        !isPlatformAdmin(currentUser) &&
        !isShopAdmin(currentUser) &&
        !currentUser.permissions?.canViewExpenses &&
        !currentUser.permissions?.canRecordExpenses
      ) {
        return []; // No permission to view expenses
      }
    }

    let list = db.getExpenses();

    if (currentUser && !isPlatformAdmin(currentUser) && isShopAdmin(currentUser)) {
      const managedShopIds = getShopAdminShopIds(currentUser);
      list = list.filter(e => !!e.shopId && managedShopIds.includes(e.shopId));
    }

    if (filter?.shopId && filter.shopId !== 'ALL') {
      if (filter.shopId === 'GENERAL') {
        list = list.filter(e => e.isCompanyExpense || !e.shopId);
      } else {
        list = list.filter(e => e.shopId === filter.shopId);
      }
    }

    if (filter?.category && filter.category !== 'ALL') {
      list = list.filter(e => e.category === filter.category);
    }

    if (filter?.search?.trim()) {
      const q = filter.search.trim().toLowerCase();
      list = list.filter(
        e =>
          (e.description && e.description.toLowerCase().includes(q)) ||
          (e.title && e.title.toLowerCase().includes(q)) ||
          (e.reference && e.reference.toLowerCase().includes(q)) ||
          (e.notes && e.notes.toLowerCase().includes(q)) ||
          (e.shopName && e.shopName.toLowerCase().includes(q))
      );
    }

    if (filter?.startDate) {
      list = list.filter(e => e.date >= filter.startDate!);
    }

    if (filter?.endDate) {
      list = list.filter(e => e.date <= filter.endDate!);
    }

    return list;
  }
}
