import { db } from '../db/storage';
import { Product, ProductImage, ProductStatus, User } from '../types';
import { generateUUID } from '../utils/crypto';
import { normalizeProductImages } from '../utils/imageUtils';
import { CloudflareApi } from './cloudflareApi';
import { canAccessShopAsAdmin, getShopAdminShopIds, isPlatformAdmin, isShopAdmin } from '../utils/permissions';

// Helper to convert base64 to Blob
function base64ToBlob(dataUrl: string, mimeType: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      const base64 = dataUrl.split(',')[1];
      const binary = atob(base64);
      const array = new Uint8Array(binary.length);

      for (let i = 0; i < binary.length; i++) {
        array[i] = binary.charCodeAt(i);
      }

      resolve(new Blob([array], { type: mimeType }));
    } catch (error) {
      reject(error);
    }
  });
}

export class ProductService {
  public static getProducts(options?: {
    shopId?: string;
    categoryId?: string;
    search?: string;
    status?: ProductStatus | 'ALL';
    lowStockOnly?: boolean;
  }): Product[] {
    let products = db.getProducts();

    if (options?.shopId && options.shopId !== 'ALL') {
      products = products.filter(p => p.shopId === options.shopId);
    }

    if (options?.status && options.status !== 'ALL') {
      products = products.filter(p => p.status === options.status);
    }

    if (options?.categoryId && options.categoryId !== 'ALL') {
      products = products.filter(p => p.categoryId === options.categoryId);
    }

    if (options?.search) {
      const q = options.search.toLowerCase().trim();
      products = products.filter(
        p =>
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          p.barcode.toLowerCase().includes(q)
      );
    }

    if (options?.lowStockOnly) {
      products = products.filter(p => p.currentStock <= p.minStock);
    }

    return products;
  }

  public static getProductById(id: string): Product | undefined {
    return db.getProducts().find(p => p.id === id);
  }

  public static getProductByBarcode(barcode: string, shopId?: string): Product | undefined {
    return db.getProducts().find(p => {
      const match = p.barcode === barcode && p.status === 'ACTIVE';
      if (!match) return false;
      if (shopId && shopId !== 'ALL') return p.shopId === shopId;
      return true;
    });
  }

  /**
   * Upload product images to R2 and return updated images with URLs
   */
  private static async uploadImagesToR2(
    images: ProductImage[],
    productId: string
  ): Promise<ProductImage[]> {
    const uploadedImages: ProductImage[] = [];

    for (let i = 0; i < images.length; i++) {
      const img = images[i];

      // Skip if already synced with R2 URL
      if (
        img.syncStatus === 'SYNCED' &&
        (img.dataUrl.includes('m.gmeck.sonkosound.store') ||
          img.dataUrl.includes('m.diocres.jobsreport.online'))
      ) {
        uploadedImages.push(img);
        continue;
      }

      try {
        const online = await CloudflareApi.checkConnection();
        if (!online) {
          uploadedImages.push(img);
          continue;
        }

        const blob = await base64ToBlob(img.dataUrl, img.mimeType);
        const result = await CloudflareApi.uploadImage(blob, 'product', productId, i);

        if (result.success && result.url) {
          uploadedImages.push({
            ...img,
            dataUrl: result.url,
            thumbnailUrl: result.url,
            syncStatus: 'SYNCED',
          });
        } else {
          uploadedImages.push(img);
        }
      } catch (error) {
        console.log(`Image ${i} upload failed, keeping local:`, error);
        uploadedImages.push(img);
      }
    }

    return uploadedImages;
  }

  /**
   * Seller or Admin can create a new product.
   * Associated with the target shop.
   */
  public static async createProduct(
    data: {
      shopId: string;
      storeId?: string;
      name: string;
      sku?: string;
      barcode?: string;
      categoryId: string;
      sellingPrice: number;
      purchasePrice?: number;
      currentStock: number;
      minStock?: number;
      unit?: string;
      status?: ProductStatus;
      images?: ProductImage[];
      imageUrl?: string;
    },
    currentUser: User
  ): Promise<{ success: boolean; product?: Product; error?: string }> {
    // Shop Admins & Sellers can only create products for their allowed shops
    if (!isPlatformAdmin(currentUser)) {
      if (isShopAdmin(currentUser)) {
        const managedIds = getShopAdminShopIds(currentUser);
        if (!managedIds.includes(data.shopId)) {
          return {
            success: false,
            error: 'Permission Denied: You can only add products to your managed shop.',
          };
        }
      } else {
        const assigned = currentUser.assignedShopIds || [];
        if (assigned.length > 0 && !assigned.includes(data.shopId)) {
          return {
            success: false,
            error: 'Permission Denied: You are not assigned to this shop.',
          };
        }
      }
    }

    if (!data.name?.trim()) {
      return { success: false, error: 'Product name is required.' };
    }

    if (!data.shopId) {
      return { success: false, error: 'Shop assignment is required for the product.' };
    }

    const shop = db.getShops().find(s => s.id === data.shopId);
    if (!shop) {
      return { success: false, error: 'Selected shop does not exist.' };
    }

    const targetStore = data.storeId
      ? db.getStores().find(st => st.id === data.storeId)
      : undefined;
    if (data.storeId) {
      if (!targetStore) {
        return { success: false, error: 'Selected destination store does not exist.' };
      }
      if (targetStore.shopId !== data.shopId) {
        return { success: false, error: 'Selected store does not belong to this shop.' };
      }
      if (targetStore.status !== 'ACTIVE') {
        return { success: false, error: `Store '${targetStore.name}' is inactive.` };
      }
    }

    if (data.sellingPrice === undefined || data.sellingPrice < 0) {
      return { success: false, error: 'Valid selling price is required.' };
    }

    const products = db.getProducts();
    const cleanSku = data.sku?.trim() || `SKU-${Date.now().toString().slice(-6)}`;
    const cleanBarcode =
      data.barcode?.trim() || `${Math.floor(100000000000 + Math.random() * 900000000000)}`;

    // SKU uniqueness within the shop
    const duplicateSku = products.find(
      p => p.shopId === data.shopId && p.sku.toLowerCase() === cleanSku.toLowerCase()
    );
    if (duplicateSku) {
      return { success: false, error: `SKU '${cleanSku}' already exists in this shop.` };
    }

    const productId = generateUUID();

    // Normalize images first
    let normalizedImages =
      data.images && data.images.length > 0
        ? normalizeProductImages(data.images.map(img => ({ ...img, productId })))
        : undefined;

    // Upload images to R2
    if (normalizedImages && normalizedImages.length > 0) {
      normalizedImages = await this.uploadImagesToR2(normalizedImages, productId);
    }

    const mainImageUrl =
      normalizedImages && normalizedImages.length > 0
        ? normalizedImages[0].thumbnailUrl || normalizedImages[0].dataUrl
        : data.imageUrl;

    const initialQty = Math.max(0, Number(data.currentStock || 0));
    const isSentToStore = Boolean(data.storeId && targetStore);

    const newProduct: Product = {
      id: productId,
      shopId: data.shopId,
      storeId: isSentToStore ? data.storeId : undefined,
      name: data.name.trim(),
      sku: cleanSku,
      barcode: cleanBarcode,
      categoryId: data.categoryId || 'cat-supplies',
      sellingPrice: Number(data.sellingPrice),
      purchasePrice: Number(data.purchasePrice || 0),
      currentStock: isSentToStore ? 0 : initialQty,
      storeStock: isSentToStore ? initialQty : 0,
      minStock: Number(data.minStock ?? 5),
      unit: data.unit?.trim() || 'pcs',
      status: data.status || 'ACTIVE',
      images: normalizedImages,
      imageUrl: mainImageUrl,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const updated = [newProduct, ...products];
    db.saveProducts(updated);

    // Record initial inventory movement (shop floor vs store warehouse)
    if (initialQty > 0) {
      db.saveMovements([
        {
          id: generateUUID(),
          shopId: newProduct.shopId,
          shopName: shop.name,
          storeId: isSentToStore ? data.storeId : undefined,
          productId: newProduct.id,
          productName: newProduct.name,
          previousQty: 0,
          changeQty: initialQty,
          newQty: initialQty,
          type: isSentToStore ? 'INITIAL_STOCK' : 'ADJUSTMENT',
          reason: isSentToStore
            ? `Initial stock opening in store '${targetStore!.name}' [${shop.name}] by ${currentUser.name}`
            : `Initial stock opening in ${shop.name} by ${currentUser.name}`,
          userId: currentUser.id,
          userName: currentUser.name,
          createdAt: new Date().toISOString(),
        },
        ...db.getMovements(),
      ]);
    }

    // Sync queue item — push.ts routes currentStock to store_stock when storeId is set
    db.enqueueSync({
      id: generateUUID(),
      operation: 'CREATE_PRODUCT',
      entityType: 'PRODUCT',
      entityId: newProduct.id,
      payload: isSentToStore
        ? {
            ...newProduct,
            storeId: data.storeId,
            currentStock: initialQty,
            createdByUserId: currentUser.id,
          }
        : newProduct,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    });

    // Audit log
    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'CREATE_PRODUCT',
      details: isSentToStore
        ? `Created product '${newProduct.name}' in [${shop.name}] -> Store '${targetStore!.name}' (SKU: ${newProduct.sku}, Store Stock: ${initialQty})`
        : `Created product '${newProduct.name}' in [${shop.name}] (SKU: ${newProduct.sku}, Stock: ${newProduct.currentStock})`,
      entityType: 'PRODUCT',
      entityId: newProduct.id,
      timestamp: new Date().toISOString(),
    });

    return { success: true, product: newProduct };
  }

  /**
   * Admin or Seller with canEditProducts permission can edit existing products.
   */
  public static async updateProduct(
    id: string,
    updates: Partial<Omit<Product, 'id' | 'createdAt'>>,
    currentUser: User
  ): Promise<{ success: boolean; product?: Product; error?: string }> {
    const platformAdmin = isPlatformAdmin(currentUser);
    const shopAdmin = isShopAdmin(currentUser);
    if (!platformAdmin && !shopAdmin && !currentUser.permissions?.canEditProducts) {
      return {
        success: false,
        error: 'Permission Denied: You do not have permission to edit products.',
      };
    }

    const products = db.getProducts();
    const index = products.findIndex(p => p.id === id);
    if (index === -1) {
      return { success: false, error: 'Product not found.' };
    }

    const current = products[index];
    const targetShopId = updates.shopId || current.shopId;

    if (!platformAdmin && shopAdmin) {
      if (!canAccessShopAsAdmin(currentUser, current.shopId) || !canAccessShopAsAdmin(currentUser, targetShopId)) {
        return {
          success: false,
          error: 'Permission Denied: You can only edit products belonging to your managed shop.',
        };
      }
    }

    // If SKU changed, check uniqueness within shop
    if (updates.sku && updates.sku !== current.sku) {
      const dup = products.find(
        p =>
          p.id !== id &&
          p.shopId === targetShopId &&
          p.sku.toLowerCase() === updates.sku!.toLowerCase()
      );
      if (dup) {
        return { success: false, error: `SKU '${updates.sku}' is already assigned in this shop.` };
      }
    }

    let finalImages = updates.images !== undefined ? updates.images : current.images;
    if (finalImages && finalImages.length > 0) {
      finalImages = normalizeProductImages(finalImages.map(img => ({ ...img, productId: id })));
      // Upload images to R2
      finalImages = await this.uploadImagesToR2(finalImages, id);
    } else {
      finalImages = undefined;
    }

    const finalImageUrl =
      finalImages && finalImages.length > 0
        ? finalImages[0].thumbnailUrl || finalImages[0].dataUrl
        : updates.imageUrl !== undefined
        ? updates.imageUrl
        : finalImages
        ? undefined
        : current.imageUrl;

    const updatedProduct: Product = {
      ...current,
      ...updates,
      storeStock: updates.storeStock !== undefined ? updates.storeStock : (current.storeStock ?? 0),
      images: finalImages,
      imageUrl: finalImageUrl,
      updatedAt: new Date().toISOString(),
    };

    products[index] = updatedProduct;
    db.saveProducts(products);

    // Sync queue
    db.enqueueSync({
      id: generateUUID(),
      operation: 'UPDATE_PRODUCT',
      entityType: 'PRODUCT',
      entityId: id,
      payload: {
        ...updatedProduct,
        storeId: undefined,
      },
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    });

    // Audit log
    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'UPDATE_PRODUCT',
      details: `Updated product '${updatedProduct.name}' (Price: ${updatedProduct.sellingPrice})`,
      entityType: 'PRODUCT',
      entityId: id,
      timestamp: new Date().toISOString(),
    });

    return { success: true, product: updatedProduct };
  }

  /**
   * Toggle Product Active/Inactive status.
   * Admin or Seller with canEditProducts permission.
   */
  public static toggleProductStatus(
    id: string,
    newStatus: ProductStatus,
    currentUser: User
  ): { success: boolean; error?: string } {
    if (!isPlatformAdmin(currentUser) && !isShopAdmin(currentUser) && !currentUser.permissions?.canEditProducts) {
      return {
        success: false,
        error: 'Permission Denied: You do not have permission to change product status.',
      };
    }

    return this.updateProduct(id, { status: newStatus }, currentUser) as any;
  }

  /**
   * Delete a product permanently.
   * Admin or Seller with canDeleteProducts permission.
   */
  public static deleteProduct(
    productId: string,
    currentUser: User
  ): { success: boolean; error?: string } {
    const platformAdmin = isPlatformAdmin(currentUser);
    const shopAdmin = isShopAdmin(currentUser);
    if (!platformAdmin && !shopAdmin && !currentUser.permissions?.canDeleteProducts) {
      return {
        success: false,
        error: 'Permission Denied: You do not have permission to delete products.',
      };
    }

    const products = db.getProducts();
    const product = products.find(p => p.id === productId);

    if (!product) {
      return { success: false, error: 'Product not found.' };
    }

    if (!platformAdmin && shopAdmin && !canAccessShopAsAdmin(currentUser, product.shopId)) {
      return {
        success: false,
        error: 'Permission Denied: You can only delete products from your managed shop.',
      };
    }

    // Remove product
    const updatedProducts = products.filter(p => p.id !== productId);
    db.saveProducts(updatedProducts);

    // Sync to cloud
    db.enqueueSync({
      id: generateUUID(),
      operation: 'DELETE_PRODUCT',
      entityType: 'PRODUCT',
      entityId: productId,
      payload: { id: productId },
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    });

    // Audit log
    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'DELETE_PRODUCT',
      details: `Deleted product: ${product.name} (${product.sku})`,
      entityType: 'PRODUCT',
      entityId: productId,
      timestamp: new Date().toISOString(),
    });

    return { success: true };
  }
}
