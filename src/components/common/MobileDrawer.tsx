import React from 'react';
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Receipt,
  History,
  Users,
  TrendingDown,
  Truck,
  BarChart3,
  Database,
  Settings,
  Boxes,
  Lock,
  Store,
  FileText,
  Bell,
  X,
  Shield,
  LogOut,
  RefreshCw,
  WifiOff,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { NotificationService } from '../../services/notificationService';
import { DebtService } from '../../services/debtService';
import { formatDate } from '../../utils/formatters';
import { getAdminManagedShops, getEffectiveSellerPermissions, getShopAdminShopIds, isPlatformAdmin, isShopAdmin } from '../../utils/permissions';

interface MobileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

interface NavItem {
  id: string;
  swahiliLabel: string;
  englishLabel: string;
  icon: React.ElementType;
  badge?: number | string;
  badgeColor?: 'red' | 'amber' | 'blue';
  category: 'core' | 'operations' | 'management' | 'system';
  requiresPermission?: keyof import('../../types').SellerPermissions;
  requiresAnyPermission?: (keyof import('../../types').SellerPermissions)[];
}

export const MobileDrawer: React.FC<MobileDrawerProps> = ({ isOpen, onClose }) => {
  const {
    currentUser,
    activeTab,
    setActiveTab,
    sellerColor,
    dbState,
    logout,
    syncStatus,
    triggerSync,
    selectedShopId,
    setSelectedShopId,
    availableShops,
    currentShop,
  } = useApp();

  if (!isOpen || !currentUser) return null;

  const isPlatformAdm = isPlatformAdmin(currentUser);
  const isShopAdm = isShopAdmin(currentUser);
  const showAdminMenu = isPlatformAdm || isShopAdm;
  const isSeller = currentUser.role === 'SELLER';
  const managedShopIds = getShopAdminShopIds(currentUser);
  const assignedShopIds = currentUser.assignedShopIds || [];
  const scopedShopIds = isPlatformAdm
    ? null
    : isShopAdm
    ? managedShopIds
    : assignedShopIds;
  const managedShops = getAdminManagedShops(currentUser, dbState.shops || []);
  const settings = dbState.settings;

  // Count low-stock items within accessible shop scope
  const lowStockCount = (dbState.products || []).filter(
    p =>
      p.status === 'ACTIVE' &&
      p.currentStock <= p.minStock &&
      (!scopedShopIds || scopedShopIds.length === 0 || scopedShopIds.includes(p.shopId))
  ).length;

  // Count unread notifications
  const unreadNotifsCount = NotificationService.getUnreadCount(currentUser);

  // Count pending/overdue debts within user scope
  const debts = DebtService.getAllDebts(currentUser);
  const overdueDebtsCount = debts.filter(d => d.status === 'OVERDUE').length;

  const sellerPermissions = getEffectiveSellerPermissions(currentUser);

  const hasPermission = (perm: keyof import('../../types').SellerPermissions): boolean => {
    if (showAdminMenu) return true;
    return !!sellerPermissions[perm];
  };

  const hasAnyPermission = (
    perms: (keyof import('../../types').SellerPermissions)[]
  ): boolean => {
    if (showAdminMenu) return true;
    return perms.some(perm => !!sellerPermissions[perm]);
  };

  const sellerNav: NavItem[] = [
    { id: 'dashboard', swahiliLabel: 'Muhtasari wa Mauzo', englishLabel: 'Dashboard', icon: LayoutDashboard, category: 'core' },
    { id: 'new_sale', swahiliLabel: 'Mauzo Mapya (POS)', englishLabel: 'New Sale (POS)', icon: ShoppingCart, category: 'core' },
    { id: 'products', swahiliLabel: 'Orodha ya Bidhaa', englishLabel: 'Product Catalog', icon: Package, badge: lowStockCount > 0 ? lowStockCount : undefined, category: 'operations' },
    { id: 'purchases', swahiliLabel: 'Manunuzi ya Mzigo', englishLabel: 'Purchases & Stock In', icon: Truck, category: 'operations' },
    { id: 'my_sales', swahiliLabel: 'Historia ya Mauzo Yangu', englishLabel: 'My Sales History', icon: History, category: 'operations' },
    { id: 'debts', swahiliLabel: 'Daftari la Madeni', englishLabel: 'Debt Management', icon: FileText, badge: overdueDebtsCount > 0 ? `${overdueDebtsCount} Overdue` : debts.filter(d => d.status !== 'PAID').length || undefined, badgeColor: overdueDebtsCount > 0 ? 'red' : 'amber', category: 'management' },
    { id: 'notifications', swahiliLabel: 'Taarifa na Vikumbusho', englishLabel: 'Notifications & Alerts', icon: Bell, badge: unreadNotifsCount > 0 ? unreadNotifsCount : undefined, badgeColor: 'red', category: 'management' },
    { id: 'receipts', swahiliLabel: 'Risiti za Mauzo', englishLabel: 'Receipts', icon: Receipt, category: 'management' },

    // Permission-gated admin modules granted to seller
    {
      id: 'sales',
      swahiliLabel: 'Mauzo Yote (Hariri)',
      englishLabel: 'All Sales History',
      icon: History,
      category: 'management',
      requiresAnyPermission: ['canEditSales', 'canDeleteSales'],
    },
    {
      id: 'inventory',
      swahiliLabel: 'Usimamizi wa Stoo',
      englishLabel: 'Inventory Management',
      icon: Boxes,
      badge: lowStockCount > 0 ? `${lowStockCount} Low` : undefined,
      category: 'management',
      requiresPermission: 'canManageInventory',
    },
    {
      id: 'expenses',
      swahiliLabel: 'Matumizi ya Duka',
      englishLabel: 'Expenses',
      icon: TrendingDown,
      category: 'management',
      requiresAnyPermission: ['canViewExpenses', 'canRecordExpenses'],
    },
    {
      id: 'reports',
      swahiliLabel: 'Ripoti za Kifedha',
      englishLabel: 'Reports & Analytics',
      icon: BarChart3,
      category: 'management',
      requiresPermission: 'canViewReports',
    },
    {
      id: 'shops',
      swahiliLabel: 'Maduka na Vitengo',
      englishLabel: 'Shops & Business Units',
      icon: Store,
      badge: (dbState.shops || []).length,
      category: 'management',
      requiresPermission: 'canManageShops',
    },
    {
      id: 'sellers',
      swahiliLabel: 'Wauzaji na Ruhusa',
      englishLabel: 'Sellers & Staff Accounts',
      icon: Users,
      category: 'management',
      requiresPermission: 'canManageSellers',
    },

    { id: 'settings', swahiliLabel: 'Mipangilio ya Akaunti', englishLabel: 'Seller Settings', icon: Settings, category: 'system' },
  ];

  const adminNav: NavItem[] = [
    { id: 'dashboard', swahiliLabel: isPlatformAdm ? 'Uchambuzi wa Kampuni' : 'Uchambuzi wa Duka', englishLabel: isPlatformAdm ? 'Executive Dashboard' : 'Shop Dashboard', icon: LayoutDashboard, category: 'core' },
    { id: 'new_sale', swahiliLabel: 'Mauzo Mapya (POS)', englishLabel: 'New Sale (POS Terminal)', icon: ShoppingCart, category: 'core' },
    { id: 'shops', swahiliLabel: 'Maduka na Vitengo', englishLabel: 'Shops & Business Units', icon: Store, badge: managedShops.length, category: 'core' },
    { id: 'sales', swahiliLabel: 'Mauzo', englishLabel: 'Sales Transactions', icon: History, category: 'operations' },
    { id: 'products', swahiliLabel: 'Bidhaa na Makundi', englishLabel: 'Products & Categories', icon: Package, category: 'operations' },
    { id: 'inventory', swahiliLabel: 'Stoo na Hesabu', englishLabel: 'Stock & Inventory', icon: Boxes, badge: lowStockCount > 0 ? `${lowStockCount} Low` : undefined, category: 'operations' },
    { id: 'purchases', swahiliLabel: 'Manunuzi ya Mzigo', englishLabel: 'Purchases & Stock-In', icon: Truck, category: 'operations' },
    { id: 'expenses', swahiliLabel: 'Matumizi ya Uendeshaji', englishLabel: 'Operational Expenses', icon: TrendingDown, category: 'operations' },
    { id: 'debts', swahiliLabel: 'Daftari la Madeni', englishLabel: 'Debt Management', icon: FileText, badge: overdueDebtsCount > 0 ? `${overdueDebtsCount} Overdue` : undefined, badgeColor: 'red', category: 'management' },
    { id: 'reports', swahiliLabel: 'Ripoti na Uchambuzi', englishLabel: 'Reports & Analytics', icon: BarChart3, category: 'management' },
    { id: 'sellers', swahiliLabel: 'Wauzaji na Wafanyakazi', englishLabel: 'Sellers & Staff Accounts', icon: Users, category: 'management' },
    { id: 'notifications', swahiliLabel: 'Kituo cha Taarifa', englishLabel: 'Notification Center', icon: Bell, badge: unreadNotifsCount > 0 ? unreadNotifsCount : undefined, badgeColor: 'red', category: 'management' },
    ...(isPlatformAdm ? [{ id: 'data_management', swahiliLabel: 'Hifadhi ya Data (CSV)', englishLabel: 'Data & CSV Backup', icon: Database, category: 'system' as const }] : []),
    { id: 'settings', swahiliLabel: isPlatformAdm ? 'Mipangilio ya Mfumo' : 'Mipangilio ya Akaunti', englishLabel: isPlatformAdm ? 'System Settings' : 'Account Settings', icon: Settings, category: 'system' },
  ];

  const items = (showAdminMenu ? adminNav : sellerNav).filter(item => {
    if (item.requiresPermission) {
      return hasPermission(item.requiresPermission);
    }
    if (item.requiresAnyPermission) {
      return hasAnyPermission(item.requiresAnyPermission);
    }
    return true;
  });

  const handleNavClick = (tabId: string) => {
    setActiveTab(tabId);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex lg:hidden animate-in fade-in duration-200">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer Panel */}
      <div className="relative w-[88vw] max-w-[360px] bg-slate-900 border-r border-slate-800 h-full flex flex-col justify-between shadow-2xl z-10 overflow-hidden">
        {/* Drawer Header */}
        <div className="p-4 border-b border-slate-800 bg-slate-950/80 safe-top">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white shadow-md"
                style={{ backgroundColor: isSeller ? sellerColor.primary : '#2563eb' }}
              >
                {showAdminMenu ? <Shield className="w-5 h-5" /> : currentUser.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-white truncate">{currentUser.name}</h3>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                    isPlatformAdm
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      : isShopAdm
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                  }`}
                >
                  {isPlatformAdm ? 'Administrator' : isShopAdm ? 'Shop Admin' : 'Seller'}
                </span>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Shop Switcher inside Drawer for Mobile */}
          <div className="mt-2 p-2.5 rounded-xl bg-slate-900 border border-slate-800">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
                <Store className="w-3.5 h-3.5 text-amber-400" />
                <span>Selected Shop Unit</span>
              </span>
              {currentShop && (
                <span className="text-[10px] text-emerald-400 font-mono">Active</span>
              )}
            </div>

            {isPlatformAdm || (isShopAdm && managedShops.length > 1) ? (
              <select
                id="drawer-admin-shop-select"
                value={selectedShopId}
                onChange={e => {
                  setSelectedShopId(e.target.value);
                }}
                className="w-full bg-slate-950 text-xs text-white font-medium py-2 px-2.5 rounded-lg border border-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="ALL">
                  {isPlatformAdm ? '🏢 All Shops (Overview)' : '🏢 All Managed Shops'}
                </option>
                {(isPlatformAdm ? availableShops : managedShops).map(sh => (
                  <option key={sh.id} value={sh.id}>
                    {sh.status === 'INACTIVE' ? `🚫 ${sh.name} (Inactive)` : `🏪 ${sh.name}`}
                  </option>
                ))}
              </select>
            ) : availableShops.length > 1 ? (
              <select
                id="drawer-seller-shop-select"
                value={selectedShopId}
                onChange={e => {
                  setSelectedShopId(e.target.value);
                }}
                className="w-full bg-slate-950 text-xs text-blue-300 font-medium py-2 px-2.5 rounded-lg border border-blue-700/60 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {availableShops.map(sh => (
                  <option key={sh.id} value={sh.id}>
                    🏪 {sh.name}
                  </option>
                ))}
              </select>
            ) : availableShops.length === 1 ? (
              <div className="text-xs font-semibold text-blue-300 py-1 px-1">
                🏪 {availableShops[0].name}
              </div>
            ) : (
              <div className="text-xs text-rose-400 py-1">
                ⚠️ No Assigned Shops
              </div>
            )}
          </div>
        </div>

        {/* Navigation Items List */}
        <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
          {items.map(item => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;

            return (
              <button
                key={item.id}
                id={`drawer-nav-${item.id}`}
                onClick={() => handleNavClick(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left font-medium transition-all ${
                  isActive
                    ? 'text-white shadow-md'
                    : 'text-slate-200 hover:text-white hover:bg-slate-800/70'
                }`}
                style={{
                  backgroundColor: isActive
                    ? isSeller
                      ? sellerColor.primary
                      : '#2563eb'
                    : undefined,
                }}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1 pr-2">
                  <div
                    className={`p-2 rounded-lg shrink-0 ${
                      isActive ? 'bg-white/20 text-white' : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[19px] leading-snug font-medium truncate">
                      {item.swahiliLabel}
                    </div>
                    <div
                      className={`text-[14px] leading-snug font-normal truncate ${
                        isActive ? 'text-white/85' : 'text-slate-400'
                      }`}
                    >
                      {item.englishLabel}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {item.badge !== undefined && (
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                        isActive
                          ? 'bg-white/30 text-white'
                          : item.badgeColor === 'red'
                          ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                          : item.badgeColor === 'blue'
                          ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                          : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                  <ChevronRight className={`w-3.5 h-3.5 ${isActive ? 'text-white/70' : 'text-slate-600'}`} />
                </div>
              </button>
            );
          })}
        </nav>

        {/* Drawer Footer with Sync, Offline & Logout */}
        <div className="p-3 border-t border-slate-800 bg-slate-950/90 safe-bottom space-y-2">
          {/* Sync status */}
          <div className="flex items-center justify-between text-xs px-1">
            <div className="flex items-center gap-1.5">
              <WifiOff className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-[11px] text-slate-300 font-medium">Offline Engine Ready</span>
            </div>
            <button
              onClick={triggerSync}
              className="text-[11px] text-blue-400 hover:text-blue-300 font-semibold flex items-center gap-1"
            >
              <RefreshCw className={`w-3 h-3 ${syncStatus.state === 'SYNCING' ? 'animate-spin' : ''}`} />
              <span>Sync</span>
            </button>
          </div>

          {/* Logout button */}
          <button
            onClick={() => {
              onClose();
              logout();
            }}
            className="w-full py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-rose-950/50 hover:text-rose-300 text-slate-300 border border-slate-700 text-xs font-semibold flex items-center justify-center gap-2 transition"
          >
            <LogOut className="w-4 h-4" />
            <span>Switch User / Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  );
};
