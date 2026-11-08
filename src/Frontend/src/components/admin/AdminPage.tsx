import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { apiJson, clearToken } from '../../utils/api';
import type { NotificationItem } from '../../types';
import './AdminPage.css';

/**
 * Trang quản trị DAFL — dùng các endpoint /api/admin/* đã có ở backend
 * (Program.cs § Admin, Features/Admin/*). Mọi lỗi hiển thị nguyên văn
 * message backend trả về; field nào không chắc chắn thì đọc phòng thủ (?./fallback).
 */

// ---------- DTO (tên field theo đúng record C# — JSON camelCase) ----------
interface AdminProfile { id: string; email: string; fullName: string; phoneNumber?: string | null; address?: string | null; role: string; }
interface DashboardData {
  revenueToday?: number; revenueThisMonth?: number; pendingOrders?: number; newCustomers30d?: number;
  ordersByStatus?: Record<string, number>;
  lowStockProducts?: Array<{ id: string; name: string; stock: number }>;
  expiringVouchers?: Array<{ code: string; usedCount: number; maxUses?: number | null; expiryDate?: string | null }>;
}
/** Báo cáo doanh thu — đúng shape RevenueReportDto ở BE (AdminFeatures.cs):
 *  ByDay (date/revenue/orders), TopProducts (productId/productName/quantity/revenue),
 *  totalOrders, cancelledOrders, cancelRate (%), voucherOrders, voucherUsageRate (%).
 *  JSON trả về dạng camelCase như các DTO admin khác. */
interface DailyRevenue { date: string; revenue: number; orders: number; }
interface RevenueTopProduct { productId: string; productName: string; quantity: number; revenue: number; }
interface RevenueReport {
  byDay?: DailyRevenue[]; topProducts?: RevenueTopProduct[];
  totalOrders?: number; cancelledOrders?: number; cancelRate?: number;
  voucherOrders?: number; voucherUsageRate?: number;
}
interface AdminOrderRow {
  id: string; orderDisplayCode?: string | null; orderCode: number; customerName: string;
  customerEmail: string; customerPhone?: string; status: string; statusLabel?: string;
  paymentMethod: string; totalAmount: number; subTotal?: number; discountAmount?: number;
  voucherCode?: string | null; pointsUsed?: number; createdAt: string;
}
interface OrderItem { id: string; productId: string; productName: string; productImageUrl?: string | null; unitPrice: number; quantity: number; }
interface StatusHistory { status: string | number; note?: string | null; timestamp: string; }
interface OrderDetail {
  id: string; orderCode: number; orderDisplayCode?: string | null; customerName: string;
  customerEmail: string; customerPhone: string; shippingAddress?: string; subTotal: number;
  discountAmount?: number; voucherCode?: string | null; totalAmount: number; status: string;
  statusLabel?: string; createdAt: string; paymentMethod?: string; shippingFee?: number;
  cancelReason?: string | null; pointsUsed?: number; pointsDiscount?: number; pointsEarned?: number;
  freeShipVoucherCode?: string | null; trackingCode?: string | null; carrier?: string | null;
  deliveredAt?: string | null; completedAt?: string | null;
  shipProvinceName?: string | null; shipDistrictName?: string | null; shipWardName?: string | null;
  shipDetailAddress?: string | null; shipNote?: string | null;
  items?: OrderItem[]; statusHistories?: StatusHistory[];
}
interface AdminOrderDetailData { order: OrderDetail; internalNote?: string | null; userId?: string | null; }
interface PublicProduct {
  id: string; categoryId: string; categoryName?: string; name: string; slug?: string;
  description?: string; price: number; originalPrice?: number | null; availableStock?: number;
  imageUrl?: string; rating?: number; reviewCount?: number;
}
interface AdminCategory { id: string; name: string; slug?: string; description?: string | null; isActive: boolean; sortOrder?: number; productCount?: number; }
interface Promotion {
  id: string; code: string; description?: string; discountType: string; discountValue: number;
  minOrderAmount?: number; maxDiscountAmount?: number | null; startDate?: string | null;
  expiryDate?: string | null; maxUses?: number | null; usedCount?: number; maxUsesPerUser?: number | null;
  minTier?: string | null; scopeType?: string; status: string; isActive?: boolean;
  disabledReason?: string | null; createdAt?: string;
}
interface PromotionUsage { id: string; userId: string; userEmail: string; orderId: string; orderDisplayCode?: string | null; discountAmount: number; createdAt: string; }
interface Customer {
  id: string; email: string; fullName: string; phoneNumber?: string | null; role?: string;
  isLocked?: boolean; membershipTier?: string; totalSpent12m?: number; orderCount?: number;
  createdAt?: string; lastLoginAt?: string | null;
}
interface MembershipTier { tier: string; minSpent: number; spendPerPoint: number; maxPointsPercent: number; freeShipThreshold?: number | null; }
interface ReturnReq {
  id: string; orderId: string; orderDisplayCode?: string | null; productId: string; productName: string;
  quantity: number; reason: string; note?: string | null; status: string; adminNote?: string | null;
  refundAmount?: number; refundStatus?: string | null; createdAt: string;
}
interface AuditLog {
  id: string; actorEmail: string; action: string; entityType?: string | null; entityId?: string | null;
  oldValueJson?: string | null; newValueJson?: string | null; ipAddress?: string | null; createdAt: string;
}

// ---------- Hằng số ----------
// Palette admin: sidebar Dark Forest Green #051C12, điểm nhấn Lime Yellow #B4F105
// (cột biểu đồ doanh thu dùng lime; pill trạng thái giữ xanh lá/cam/đỏ theo ngữ nghĩa).
const LIME = '#b4f105';
const ORDER_STATUSES = ['Pending', 'Paid', 'Confirmed', 'Preparing', 'Shipping', 'Delivered', 'Completed', 'Cancelled', 'Expired'];
const ORDER_STATUS_LABELS: Record<string, string> = {
  Pending: 'Chờ xử lý', Paid: 'Đã thanh toán', Confirmed: 'Đã xác nhận', Preparing: 'Đang chuẩn bị',
  Shipping: 'Đang giao', Delivered: 'Đã giao', Completed: 'Hoàn tất', ReturnRequested: 'Yêu cầu trả hàng',
  Cancelled: 'Đã hủy', Expired: 'Đã hết hạn',
};
/** Máy trạng thái trong AdminGuard.OrderStateMachine (BE) — chỉ cho chọn đích hợp lệ. */
const ALLOWED_NEXT: Record<string, string[]> = {
  Pending: ['Paid', 'Confirmed', 'Expired'],
  Paid: ['Confirmed', 'Preparing'],
  Confirmed: ['Preparing', 'Shipping'],
  Preparing: ['Shipping'],
  Shipping: ['Delivered'],
  Delivered: ['Completed', 'ReturnRequested'],
  Completed: [], ReturnRequested: ['Delivered'], Cancelled: [], Expired: [],
};
/** Thứ tự enum OrderStatus ở BE (AppDbContext) — lịch sử trạng thái có thể trả status dạng số. */
const ORDER_STATUS_BY_INDEX = ['Pending', 'Paid', 'Cancelled', 'Expired', 'Preparing', 'Shipping', 'Delivered', 'Confirmed', 'Completed', 'ReturnRequested'];
const TIER_LABELS: Record<string, string> = { Member: 'Thường', Silver: 'Bạc', Gold: 'Vàng', Diamond: 'Kim cương' };

const fmtMoney = (n?: number | null) => `${(n ?? 0).toLocaleString('vi-VN')}đ`;
const fmtDate = (s?: string | null) => {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? String(s) : d.toLocaleString('vi-VN');
};
const statusName = (v: string | number | undefined | null): string => {
  if (v === undefined || v === null) return '';
  if (typeof v === 'number') return ORDER_STATUS_BY_INDEX[v] ?? String(v);
  return v;
};
const statusLabel = (v: string | number | undefined | null) => ORDER_STATUS_LABELS[statusName(v)] ?? statusName(v) ?? '—';
const apiErr = (body: { message?: string; errors?: string[] } | null, fallback: string) => {
  if (body?.errors?.length) return body.errors.join(' ');
  return body?.message || fallback;
};

// ---------- Helper giao diện Spark (không đổi hành vi) ----------
/** Màu nền avatar: hash tên → 1 trong 8 màu, ổn định theo tên. */
const AVATAR_COLORS = ['#051c12', '#0e7490', '#b45309', '#be185d', '#4d7c0f', '#1d4ed8', '#7c3aed', '#9f1239'];
const avatarColor = (name: string) => {
  let h = 0;
  for (const ch of (name || '?')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
};
const avatarInitial = (name: string) => (name?.trim()?.[0] ?? '?').toUpperCase();

/** Pill trạng thái đơn: xanh lá = đã thanh toán/hoàn tất, cam = đang xử lý,
 *  đỏ = đã hủy/hết hạn, tím = yêu cầu trả hàng. Nhãn lấy từ ORDER_STATUS_LABELS. */
const statusPillClass = (s: string | number | undefined | null) => {
  const n = statusName(s);
  if (['Paid', 'Delivered', 'Completed'].includes(n)) return 'sa-pill sa-pill-green';
  if (['Cancelled', 'Expired'].includes(n)) return 'sa-pill sa-pill-red';
  if (n === 'ReturnRequested') return 'sa-pill sa-pill-purple';
  if (n === 'Shipping') return 'sa-pill sa-pill-blue';
  return 'sa-pill sa-pill-amber';
};

const promoPillClass = (s: string) =>
  s === 'Active' ? 'sa-pill sa-pill-green'
  : s === 'Draft' ? 'sa-pill sa-pill-amber'
  : s === 'Disabled' ? 'sa-pill sa-pill-red' : 'sa-pill sa-pill-gray';
const returnPillClass = (s: string) =>
  s === 'Approved' ? 'sa-pill sa-pill-green'
  : s === 'Rejected' ? 'sa-pill sa-pill-red' : 'sa-pill sa-pill-amber';

/** Modal chi tiết dùng chung cho mọi mục (Spark): overlay + card trắng,
 *  header có tiêu đề + nút đóng X, footer có nút Đóng + nút thao tác chính.
 *  Đóng bằng nút X, nút Đóng hoặc bấm ra ngoài overlay. */
function SparkModal({ title, onClose, children, footer, testid }: {
  title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; testid?: string;
}) {
  return (
    <div className="sa-modal-overlay" onClick={onClose}>
      <div className="sa-modal" role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()} data-testid={testid}>
        <div className="sa-modal-head">
          <h3>{title}</h3>
          <button type="button" className="sa-modal-close" onClick={onClose} aria-label="Đóng">✕</button>
        </div>
        <div className="sa-modal-body">{children}</div>
        <div className="sa-modal-foot">
          <button type="button" className="sa-btn sa-btn-ghost" onClick={onClose}>Đóng</button>
          {footer}
        </div>
      </div>
    </div>
  );
}

/** 1 dòng label / giá trị trong modal chi tiết. */
const KvRow = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="sa-kv"><span>{label}</span><div>{value}</div></div>
);

/** Xuất CSV client-side từ dữ liệu đang hiển thị (có BOM để Excel mở đúng UTF-8). */
const downloadCsv = (filename: string, header: string[], rows: Array<Array<string | number>>) => {
  const esc = (v: string | number) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = `﻿${[header, ...rows].map(r => r.map(esc).join(',')).join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
};

type Tab = 'dashboard' | 'orders' | 'products' | 'categories' | 'promotions' | 'customers' | 'membership' | 'returns';
const NAV: Array<{ key: Tab; label: string; testid: string; icon: string }> = [
  { key: 'dashboard', label: 'Tổng quan', testid: 'admin-nav-dashboard', icon: '▦' },
  { key: 'orders', label: 'Đơn hàng', testid: 'admin-nav-orders', icon: '🧾' },
  { key: 'products', label: 'Sản phẩm', testid: 'admin-nav-products', icon: '🛍️' },
  { key: 'categories', label: 'Danh mục', testid: 'admin-nav-categories', icon: '🗂️' },
  { key: 'promotions', label: 'Khuyến mãi', testid: 'admin-nav-promotions', icon: '🏷️' },
  { key: 'customers', label: 'Khách hàng', testid: 'admin-nav-customers', icon: '👥' },
  { key: 'membership', label: 'Hội viên', testid: 'admin-nav-membership', icon: '⭐' },
  { key: 'returns', label: 'Trả hàng / Nhật ký', testid: 'admin-nav-returns', icon: '↩️' },
];
/** Nhóm menu sidebar kiểu Spark: MENU / QUẢN LÝ / HỆ THỐNG. */
const NAV_GROUPS: Array<{ title: string; keys: Tab[] }> = [
  { title: 'MENU', keys: ['dashboard', 'orders'] },
  { title: 'QUẢN LÝ', keys: ['products', 'categories', 'promotions', 'customers', 'membership'] },
  { title: 'HỆ THỐNG', keys: ['returns'] },
];
const NAV_BY_KEY: Record<Tab, (typeof NAV)[number]> = Object.fromEntries(NAV.map(i => [i.key, i])) as Record<Tab, (typeof NAV)[number]>;
const TAB_META: Record<Tab, { title: string; desc: string }> = {
  dashboard: { title: 'Tổng quan', desc: 'Doanh thu, đơn hàng và hoạt động của sàn hôm nay.' },
  orders: { title: 'Đơn hàng', desc: 'Theo dõi và xử lý đơn hàng của khách.' },
  products: { title: 'Sản phẩm', desc: 'Danh sách sản phẩm đang bán trên sàn.' },
  categories: { title: 'Danh mục', desc: 'Quản lý danh mục sản phẩm.' },
  promotions: { title: 'Khuyến mãi', desc: 'Voucher và chương trình giảm giá.' },
  customers: { title: 'Khách hàng', desc: 'Tài khoản khách hàng và lịch sử mua hàng.' },
  membership: { title: 'Hội viên', desc: 'Cấu hình hạng hội viên và điều chỉnh điểm.' },
  returns: { title: 'Trả hàng / Nhật ký', desc: 'Yêu cầu trả hàng và nhật ký hệ thống.' },
};

export default function AdminPage() {
  const [gate, setGate] = useState<'checking' | 'ok' | 'forbidden' | 'no-admin' | 'unauthorized'>('checking');
  const [gateMsg, setGateMsg] = useState('');
  const [currentEmail, setCurrentEmail] = useState('');
  const navigate = useNavigate();
  const [profile, setProfile] = useState<AdminProfile | null>(null);
  const [tab, setTab] = useState<Tab>('dashboard');
  const [notice, setNotice] = useState<string | null>(null);
  const loadedRef = useRef<Set<Tab>>(new Set());

  // Giao diện Spark: sidebar thu gọn (desktop) / drawer (mobile), chuông, menu avatar.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  const [notifs, setNotifs] = useState<NotificationItem[]>([]);
  const [notifsLoaded, setNotifsLoaded] = useState(false);
  const [notifLoading, setNotifLoading] = useState(false);
  const unreadNotifCount = notifs.filter(n => !n.isRead).length;

  // Tổng quan
  const [dash, setDash] = useState<DashboardData | null>(null);
  const [dashLoading, setDashLoading] = useState(false);
  const [dashError, setDashError] = useState<string | null>(null);

  // Doanh thu (biểu đồ) — chỉ đọc GET /api/admin/reports/revenue
  const [revenue, setRevenue] = useState<RevenueReport | null>(null);
  const [revenueLoading, setRevenueLoading] = useState(false);
  const [revenueError, setRevenueError] = useState<string | null>(null);
  const [revenueRange, setRevenueRange] = useState<7 | 30>(7);

  // Đơn hàng
  const [orders, setOrders] = useState<AdminOrderRow[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [orderSearch, setOrderSearch] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<AdminOrderDetailData | null>(null);
  const [orderDetailLoading, setOrderDetailLoading] = useState(false);
  const [orderDetailError, setOrderDetailError] = useState<string | null>(null);
  const [nextStatus, setNextStatus] = useState('');
  const [shipCarrier, setShipCarrier] = useState('');
  const [shipTracking, setShipTracking] = useState('');
  const [statusNote, setStatusNote] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [orderBusy, setOrderBusy] = useState(false);

  // Sản phẩm + danh mục
  const [products, setProducts] = useState<PublicProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState('');
  const [productCatFilter, setProductCatFilter] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<PublicProduct | null>(null);
  const [productForm, setProductForm] = useState({ id: '', name: '', categoryId: '', price: '', originalPrice: '', stock: '', description: '', imageUrl: '', isActive: true });
  const [productFormOpen, setProductFormOpen] = useState(false);
  const [productFormError, setProductFormError] = useState<string | null>(null);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [catsLoading, setCatsLoading] = useState(false);
  const [catsError, setCatsError] = useState<string | null>(null);
  const [catSearch, setCatSearch] = useState('');
  const [catStatusFilter, setCatStatusFilter] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<AdminCategory | null>(null);
  const [catForm, setCatForm] = useState({ id: '', name: '', description: '', sortOrder: '0', isActive: true });
  const [catFormOpen, setCatFormOpen] = useState(false);
  const [catFormError, setCatFormError] = useState<string | null>(null);

  // Khuyến mãi
  const [promos, setPromos] = useState<Promotion[]>([]);
  const [promosLoading, setPromosLoading] = useState(false);
  const [promosError, setPromosError] = useState<string | null>(null);
  const [promoStatusFilter, setPromoStatusFilter] = useState('');
  const [promoSearch, setPromoSearch] = useState('');
  const [selectedPromo, setSelectedPromo] = useState<Promotion | null>(null);
  const [promoForm, setPromoForm] = useState({
    code: '', description: '', discountType: 'Percentage', discountValue: '', minOrderAmount: '0',
    maxDiscountAmount: '', startDate: '', expiryDate: '', maxUses: '', maxUsesPerUser: '1',
    minTier: '', scopeType: 'All', scopeCategoryId: '', scopeProductIds: '',
  });
  const [promoFormOpen, setPromoFormOpen] = useState(false);
  const [promoFormError, setPromoFormError] = useState<string | null>(null);
  const [promoUsage, setPromoUsage] = useState<PromotionUsage[] | null>(null);
  const [promoUsageFor, setPromoUsageFor] = useState('');
  const [disableReason, setDisableReason] = useState('');
  const [disableTarget, setDisableTarget] = useState<Promotion | null>(null);

  // Khách hàng
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [customersError, setCustomersError] = useState<string | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerTierFilter, setCustomerTierFilter] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<{ customer: Customer; recentOrders?: Array<{ orderCode: number; orderDisplayCode?: string | null; status?: string; totalAmount?: number; createdAt?: string }> } | null>(null);
  const [customerDetailLoading, setCustomerDetailLoading] = useState(false);

  // Hội viên
  const [tiers, setTiers] = useState<MembershipTier[]>([]);
  const [tiersLoading, setTiersLoading] = useState(false);
  const [tiersError, setTiersError] = useState<string | null>(null);
  const [tierDraft, setTierDraft] = useState<MembershipTier[]>([]);
  const [selectedTier, setSelectedTier] = useState<MembershipTier | null>(null);
  const [adjustId, setAdjustId] = useState('');
  const [adjustPointsValue, setAdjustPointsValue] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const [adjustBusy, setAdjustBusy] = useState(false);

  // Trả hàng + audit
  const [returnsList, setReturnsList] = useState<ReturnReq[]>([]);
  const [returnsLoading, setReturnsLoading] = useState(false);
  const [returnsError, setReturnsError] = useState<string | null>(null);
  const [returnStatusFilter, setReturnStatusFilter] = useState('');
  const [returnSearch, setReturnSearch] = useState('');
  const [returnNote, setReturnNote] = useState('');
  const [returnTarget, setReturnTarget] = useState<ReturnReq | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditSearch, setAuditSearch] = useState('');

  // ---------- Bảo vệ: xác định quyền admin ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { status, body } = await apiJson<AdminProfile>('/api/admin/profile', { skipAuthHandler: true });
      if (cancelled) return;
      if (status === 401) { setGate('unauthorized'); return; }
      if (status === 403) {
        setGateMsg(body?.message || 'Bạn không có quyền truy cập trang quản trị.');
        // Lấy email tài khoản đang đăng nhập để hiện trong trang 403 (phòng thủ:
        // /api/auth/me trả envelope { success, data: { email } } như App.tsx dùng).
        try {
          const me = await apiJson<{ email?: string }>('/api/auth/me', { skipAuthHandler: true });
          const email = me.body?.data?.email;
          if (typeof email === 'string' && email) setCurrentEmail(email);
        } catch { /* không lấy được email thì vẫn hiện trang 403 bình thường */ }
        setGate('forbidden');
        return;
      }
      if (body?.success && body.data && (body.data.role === 'SuperAdmin' || body.data.role === 'Admin')) {
        setProfile(body.data);
        setGate('ok');
        return;
      }
      // Lỗi khác (vd: token đúng nhưng tài khoản admin chưa tồn tại trong DB —
      // DbInitializer chỉ seed admin@dafl.vn khi Users trống).
      setGateMsg(apiErr(body, 'Không xác định được quyền quản trị.'));
      setGate('no-admin');
    })();
    return () => { cancelled = true; };
  }, []);

  // ---------- Loaders ----------
  const loadDashboard = useCallback(async () => {
    setDashLoading(true); setDashError(null);
    try {
      const { body } = await apiJson<DashboardData>('/api/admin/dashboard', { skipAuthHandler: true });
      if (body?.success && body.data) setDash(body.data);
      else setDashError(apiErr(body, 'Không tải được tổng quan.'));
    } catch { setDashError('Không thể kết nối đến máy chủ.'); }
    finally { setDashLoading(false); }
  }, []);

  /** Báo cáo doanh thu theo ngày — GET /api/admin/reports/revenue?from&to (BE tính
   *  theo trạng thái đơn có doanh thu: Paid/Confirmed/Preparing/Shipping/Delivered/
   *  Completed; mặc định BE lấy 30 ngày nếu không truyền from/to). */
  const loadRevenue = useCallback(async (range: 7 | 30) => {
    setRevenueLoading(true); setRevenueError(null);
    try {
      const to = new Date(); const from = new Date(); from.setDate(to.getDate() - (range - 1));
      const iso = (d: Date) => d.toISOString().slice(0, 10);
      const { body } = await apiJson<RevenueReport>(`/api/admin/reports/revenue?from=${iso(from)}&to=${iso(to)}`, { skipAuthHandler: true });
      if (body?.success && body.data) setRevenue(body.data);
      else setRevenueError(apiErr(body, 'Không tải được báo cáo doanh thu.'));
    } catch { setRevenueError('Không thể kết nối đến máy chủ.'); }
    finally { setRevenueLoading(false); }
  }, []);

  const loadCategories = useCallback(async () => {
    setCatsLoading(true); setCatsError(null);
    try {
      const { body } = await apiJson<AdminCategory[]>('/api/admin/categories', { skipAuthHandler: true });
      if (body?.success && Array.isArray(body.data)) setCategories(body.data);
      else setCatsError(apiErr(body, 'Không tải được danh mục.'));
    } catch { setCatsError('Không thể kết nối đến máy chủ.'); }
    finally { setCatsLoading(false); }
  }, []);

  const loadProducts = useCallback(async () => {
    setProductsLoading(true); setProductsError(null);
    try {
      // Không có endpoint list SP riêng cho admin → dùng GET /api/products công khai
      // (chỉ trả SP đang bán, chưa xóa). Thêm/sửa/xóa dùng endpoint admin.
      const { body } = await apiJson<PublicProduct[]>('/api/products?page=1&pageSize=100', { skipAuthHandler: true });
      if (body?.success && Array.isArray(body.data)) setProducts(body.data);
      else setProductsError(apiErr(body, 'Không tải được sản phẩm.'));
    } catch { setProductsError('Không thể kết nối đến máy chủ.'); }
    finally { setProductsLoading(false); }
  }, []);

  const loadOrders = useCallback(async () => {
    setOrdersLoading(true); setOrdersError(null);
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '20' });
      if (orderStatusFilter) params.set('status', orderStatusFilter);
      if (orderSearch.trim()) params.set('search', orderSearch.trim());
      const { body } = await apiJson<AdminOrderRow[]>(`/api/admin/orders?${params.toString()}`, { skipAuthHandler: true });
      if (body?.success && Array.isArray(body.data)) setOrders(body.data);
      else setOrdersError(apiErr(body, 'Không tải được đơn hàng.'));
    } catch { setOrdersError('Không thể kết nối đến máy chủ.'); }
    finally { setOrdersLoading(false); }
  }, [orderStatusFilter, orderSearch]);

  const loadPromos = useCallback(async () => {
    setPromosLoading(true); setPromosError(null);
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '20' });
      if (promoStatusFilter) params.set('status', promoStatusFilter);
      const { body } = await apiJson<Promotion[]>(`/api/admin/promotions?${params.toString()}`, { skipAuthHandler: true });
      if (body?.success && Array.isArray(body.data)) setPromos(body.data);
      else setPromosError(apiErr(body, 'Không tải được khuyến mãi.'));
    } catch { setPromosError('Không thể kết nối đến máy chủ.'); }
    finally { setPromosLoading(false); }
  }, [promoStatusFilter]);

  const loadCustomers = useCallback(async () => {
    setCustomersLoading(true); setCustomersError(null);
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '20' });
      if (customerTierFilter) params.set('tier', customerTierFilter);
      if (customerSearch.trim()) params.set('search', customerSearch.trim());
      const { body } = await apiJson<Customer[]>(`/api/admin/customers?${params.toString()}`, { skipAuthHandler: true });
      if (body?.success && Array.isArray(body.data)) setCustomers(body.data);
      else setCustomersError(apiErr(body, 'Không tải được khách hàng.'));
    } catch { setCustomersError('Không thể kết nối đến máy chủ.'); }
    finally { setCustomersLoading(false); }
  }, [customerTierFilter, customerSearch]);

  const loadTiers = useCallback(async () => {
    setTiersLoading(true); setTiersError(null);
    try {
      const { body } = await apiJson<MembershipTier[]>('/api/admin/membership/config', { skipAuthHandler: true });
      if (body?.success && Array.isArray(body.data)) { setTiers(body.data); setTierDraft(body.data); }
      else setTiersError(apiErr(body, 'Không tải được cấu hình hội viên.'));
    } catch { setTiersError('Không thể kết nối đến máy chủ.'); }
    finally { setTiersLoading(false); }
  }, []);

  const loadReturns = useCallback(async () => {
    setReturnsLoading(true); setReturnsError(null);
    try {
      const params = new URLSearchParams();
      if (returnStatusFilter) params.set('status', returnStatusFilter);
      const q = params.toString();
      const { body } = await apiJson<ReturnReq[]>(`/api/admin/returns${q ? `?${q}` : ''}`, { skipAuthHandler: true });
      if (body?.success && Array.isArray(body.data)) setReturnsList(body.data);
      else setReturnsError(apiErr(body, 'Không tải được yêu cầu trả hàng.'));
    } catch { setReturnsError('Không thể kết nối đến máy chủ.'); }
    finally { setReturnsLoading(false); }
  }, [returnStatusFilter]);

  const loadAudit = useCallback(async () => {
    setAuditLoading(true); setAuditError(null);
    try {
      const { body } = await apiJson<AuditLog[]>('/api/admin/audit-log?page=1&pageSize=20', { skipAuthHandler: true });
      if (body?.success && Array.isArray(body.data)) setAuditLogs(body.data);
      else setAuditError(apiErr(body, 'Không tải được nhật ký.'));
    } catch { setAuditError('Không thể kết nối đến máy chủ.'); }
    finally { setAuditLoading(false); }
  }, []);

  // Tải lười theo tab (mỗi tab 1 lần, có nút tải lại).
  useEffect(() => {
    if (gate !== 'ok') return;
    if (tab === 'dashboard' && !loadedRef.current.has('dashboard')) { loadedRef.current.add('dashboard'); void loadDashboard(); void loadRevenue(7); }
    if (tab === 'orders' && !loadedRef.current.has('orders')) { loadedRef.current.add('orders'); void loadOrders(); }
    if (tab === 'products' && !loadedRef.current.has('products')) { loadedRef.current.add('products'); void loadProducts(); void loadCategories(); }
    if (tab === 'categories' && !loadedRef.current.has('categories')) { loadedRef.current.add('categories'); void loadCategories(); }
    if (tab === 'promotions' && !loadedRef.current.has('promotions')) { loadedRef.current.add('promotions'); void loadPromos(); void loadCategories(); }
    if (tab === 'customers' && !loadedRef.current.has('customers')) { loadedRef.current.add('customers'); void loadCustomers(); }
    if (tab === 'membership' && !loadedRef.current.has('membership')) { loadedRef.current.add('membership'); void loadTiers(); }
    if (tab === 'returns' && !loadedRef.current.has('returns')) { loadedRef.current.add('returns'); void loadReturns(); void loadAudit(); }
  }, [tab, gate, loadDashboard, loadRevenue, loadOrders, loadProducts, loadCategories, loadPromos, loadCustomers, loadTiers, loadReturns, loadAudit]);

  // ---------- Gate ----------
  if (gate === 'checking') return <div className="spark-admin sa-gate-page" data-testid="admin-page"><div className="sa-checking">Đang kiểm tra quyền...</div></div>;
  if (gate === 'unauthorized') return <Navigate to="/login" replace />;
  if (gate === 'forbidden') {
    const sqlEmail = currentEmail || 'email-cua-ban';
    return (
      <div className="spark-admin sa-gate-page" data-testid="admin-forbidden">
        <div className="sa-gate-inner">
          <div className="sa-gate-card sa-gate-danger">
            <div className="sa-gate-icon" aria-hidden="true">🔒</div>
            <h1>Bạn không có quyền truy cập trang quản trị</h1>
            <p>{gateMsg || 'Chỉ tài khoản Super Admin mới được vào khu vực này.'}</p>
            {currentEmail && (
              <p>Tài khoản đang đăng nhập: <strong>{currentEmail}</strong> (vai trò Khách hàng).</p>
            )}
          </div>
          <div className="sa-gate-steps">
            <h2>Cách cấp quyền Super Admin</h2>
            <ol>
              <li>Mở PowerShell tại thư mục <code>C:\Users\Acer\DAFL</code>.</li>
              <li>Chạy lệnh SQL sau (đổi email thành email tài khoản của bạn):</li>
            </ol>
            <pre>
              {`docker compose exec postgres psql -U dafl -d dafl_db -c "UPDATE "Users" SET "Role"='SuperAdmin' WHERE "Email"='${sqlEmail}';"`}
            </pre>
            <ol start={3}>
              <li>Đăng xuất khỏi web rồi đăng nhập lại bằng đúng tài khoản đó.</li>
              <li>Mở lại địa chỉ <code>/admin</code>.</li>
            </ol>
            <div className="sa-gate-actions">
              <button type="button" onClick={() => navigate('/')} className="sa-btn">Về trang chủ</button>
              <button type="button" onClick={() => { clearToken(); navigate('/login'); }} className="sa-btn sa-btn-ghost">Đăng nhập tài khoản khác</button>
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (gate === 'no-admin') {
    return (
      <div className="spark-admin sa-gate-page" data-testid="admin-page">
        <div className="sa-gate-inner">
          <div className="sa-gate-card sa-gate-danger">
            <div className="sa-gate-icon" aria-hidden="true">🔒</div>
            <h1>Chưa có tài khoản Super Admin</h1>
            <p>{gateMsg}</p>
          </div>
          <div className="sa-gate-steps">
            <h2>Cách tạo Super Admin</h2>
            <p style={{ lineHeight: 1.8, margin: '0 0 0.75rem' }}>Đăng nhập bằng tài khoản của bạn rồi chạy SQL trong PowerShell tại <code>C:\Users\Acer\DAFL</code>:</p>
            <pre>
              {`docker compose exec postgres psql -U dafl -d dafl_db -c "UPDATE "Users" SET "Role"='SuperAdmin' WHERE "Email"='email-cua-ban';"}`}
            </pre>
            <p style={{ lineHeight: 1.8 }}>Sau đó đăng nhập lại rồi mở <code>/admin</code>.</p>
            <div className="sa-gate-actions">
              <button type="button" onClick={() => navigate('/')} className="sa-btn">Về trang chủ</button>
              <button type="button" onClick={() => { clearToken(); navigate('/login'); }} className="sa-btn sa-btn-ghost">Đăng nhập tài khoản khác</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const filteredProducts = products.filter(p =>
    (!productCatFilter || p.categoryId === productCatFilter) &&
    (!productSearch.trim() || p.name.toLowerCase().includes(productSearch.trim().toLowerCase()))
  );

  // Lọc client-side cho các bảng chưa có tham số search ở backend.
  const filteredCategories = categories.filter(c =>
    (!catStatusFilter || String(c.isActive) === catStatusFilter) &&
    (!catSearch.trim() || c.name.toLowerCase().includes(catSearch.trim().toLowerCase()) || (c.slug ?? '').toLowerCase().includes(catSearch.trim().toLowerCase()))
  );
  const filteredPromos = promos.filter(p =>
    !promoSearch.trim() || p.code.toLowerCase().includes(promoSearch.trim().toLowerCase()) || (p.description ?? '').toLowerCase().includes(promoSearch.trim().toLowerCase())
  );
  const filteredReturns = returnsList.filter(r =>
    !returnSearch.trim() ||
    (r.orderDisplayCode ?? r.orderId).toLowerCase().includes(returnSearch.trim().toLowerCase()) ||
    r.productName.toLowerCase().includes(returnSearch.trim().toLowerCase()) ||
    r.reason.toLowerCase().includes(returnSearch.trim().toLowerCase())
  );
  const filteredAudit = auditLogs.filter(a =>
    !auditSearch.trim() ||
    a.actorEmail.toLowerCase().includes(auditSearch.trim().toLowerCase()) ||
    a.action.toLowerCase().includes(auditSearch.trim().toLowerCase()) ||
    (a.entityType ?? '').toLowerCase().includes(auditSearch.trim().toLowerCase())
  );

  const openOrderDetail = async (id: string) => {
    setOrderDetailLoading(true); setOrderDetailError(null); setSelectedOrder(null);
    setNextStatus(''); setShipCarrier(''); setShipTracking(''); setStatusNote(''); setCancelReason('');
    try {
      const { body } = await apiJson<AdminOrderDetailData>(`/api/admin/orders/${id}`, { skipAuthHandler: true });
      if (body?.success && body.data?.order) setSelectedOrder(body.data);
      else setOrderDetailError(apiErr(body, 'Không tải được chi tiết đơn.'));
    } catch { setOrderDetailError('Không thể kết nối đến máy chủ.'); }
    finally { setOrderDetailLoading(false); }
  };

  const changeOrderStatus = async () => {
    if (!selectedOrder || !nextStatus) return;
    if (nextStatus === 'Shipping' && (shipCarrier.trim().length === 0 || shipTracking.trim().length < 6 || shipTracking.trim().length > 30)) {
      setOrderDetailError('Chuyển sang Đang giao bắt buộc có đơn vị vận chuyển và mã vận đơn 6–30 ký tự.');
      return;
    }
    setOrderBusy(true); setOrderDetailError(null);
    try {
      const { body } = await apiJson<string>(`/api/admin/orders/${selectedOrder.order.id}/status`, {
        method: 'POST', skipAuthHandler: true,
        body: JSON.stringify({ toStatus: nextStatus, carrier: shipCarrier.trim() || undefined, trackingCode: shipTracking.trim() || undefined, note: statusNote.trim() || undefined }),
      });
      if (body?.success) { setNotice(body.message || 'Đã đổi trạng thái đơn.'); await openOrderDetail(selectedOrder.order.id); await loadOrders(); }
      else setOrderDetailError(apiErr(body, 'Không đổi được trạng thái đơn.'));
    } catch { setOrderDetailError('Không thể kết nối đến máy chủ.'); }
    finally { setOrderBusy(false); }
  };

  const cancelOrder = async () => {
    if (!selectedOrder) return;
    if (!cancelReason.trim()) { setOrderDetailError('Hủy đơn bắt buộc phải nhập lý do.'); return; }
    setOrderBusy(true); setOrderDetailError(null);
    try {
      const { body } = await apiJson<string>(`/api/admin/orders/${selectedOrder.order.id}/cancel`, {
        method: 'POST', skipAuthHandler: true, body: JSON.stringify({ reason: cancelReason.trim() }),
      });
      if (body?.success) { setNotice(body.message || 'Đã hủy đơn hàng.'); await openOrderDetail(selectedOrder.order.id); await loadOrders(); }
      else setOrderDetailError(apiErr(body, 'Không hủy được đơn hàng.'));
    } catch { setOrderDetailError('Không thể kết nối đến máy chủ.'); }
    finally { setOrderBusy(false); }
  };

  const saveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setProductFormError(null);
    const name = productForm.name.trim();
    const price = Number(productForm.price);
    const originalPrice = productForm.originalPrice.trim() === '' ? null : Number(productForm.originalPrice);
    const stock = Number(productForm.stock);
    if (name.length < 3 || name.length > 120) { setProductFormError('Tên sản phẩm phải có từ 3 đến 120 ký tự.'); return; }
    if (!(price > 0)) { setProductFormError('Giá bán phải lớn hơn 0.'); return; }
    if (originalPrice !== null && !(originalPrice > price)) { setProductFormError('Giá gốc phải lớn hơn giá bán.'); return; }
    if (!Number.isInteger(stock) || stock < 0) { setProductFormError('Tồn kho phải là số nguyên ≥ 0.'); return; }
    if (!productForm.categoryId) { setProductFormError('Vui lòng chọn danh mục.'); return; }
    const payload = { name, categoryId: productForm.categoryId, price, originalPrice, stock, description: productForm.description, imageUrl: productForm.imageUrl };
    try {
      const { body } = productForm.id
        ? await apiJson<unknown>(`/api/admin/products/${productForm.id}`, { method: 'PUT', skipAuthHandler: true, body: JSON.stringify({ ...payload, isActive: productForm.isActive }) })
        : await apiJson<unknown>('/api/admin/products', { method: 'POST', skipAuthHandler: true, body: JSON.stringify(payload) });
      if (body?.success) { setNotice(body.message || 'Đã lưu sản phẩm.'); setProductFormOpen(false); await loadProducts(); }
      else setProductFormError(apiErr(body, 'Không lưu được sản phẩm.'));
    } catch { setProductFormError('Không thể kết nối đến máy chủ.'); }
  };

  const deleteProduct = async (p: PublicProduct) => {
    try {
      const { body } = await apiJson<string>(`/api/admin/products/${p.id}`, { method: 'DELETE', skipAuthHandler: true });
      if (body?.success) { setNotice(body.message || 'Đã xóa sản phẩm.'); await loadProducts(); }
      else { setProductsError(apiErr(body, 'Không xóa được sản phẩm.')); }
    } catch { setProductsError('Không thể kết nối đến máy chủ.'); }
  };

  const saveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    setCatFormError(null);
    const name = catForm.name.trim();
    if (name.length < 2 || name.length > 150) { setCatFormError('Tên danh mục phải có từ 2 đến 150 ký tự.'); return; }
    const sortOrder = Number(catForm.sortOrder) || 0;
    try {
      const { body } = catForm.id
        ? await apiJson<unknown>(`/api/admin/categories/${catForm.id}`, { method: 'PUT', skipAuthHandler: true, body: JSON.stringify({ name, description: catForm.description || null, isActive: catForm.isActive, sortOrder }) })
        : await apiJson<unknown>('/api/admin/categories', { method: 'POST', skipAuthHandler: true, body: JSON.stringify({ name, description: catForm.description || null, sortOrder }) });
      if (body?.success) { setNotice(body.message || 'Đã lưu danh mục.'); setCatFormOpen(false); await loadCategories(); }
      else setCatFormError(apiErr(body, 'Không lưu được danh mục.'));
    } catch { setCatFormError('Không thể kết nối đến máy chủ.'); }
  };

  const deleteCategory = async (c: AdminCategory) => {
    try {
      const { body } = await apiJson<string>(`/api/admin/categories/${c.id}`, { method: 'DELETE', skipAuthHandler: true });
      if (body?.success) { setNotice(body.message || 'Đã xóa danh mục.'); await loadCategories(); }
      else setCatsError(apiErr(body, 'Không xóa được danh mục.'));
    } catch { setCatsError('Không thể kết nối đến máy chủ.'); }
  };

  const savePromo = async (e: React.FormEvent) => {
    e.preventDefault();
    setPromoFormError(null);
    const code = promoForm.code.trim().toUpperCase();
    const discountValue = Number(promoForm.discountValue);
    if (!/^[A-Za-z0-9_-]{3,50}$/.test(code)) { setPromoFormError('Mã chỉ gồm chữ, số, gạch ngang/gạch dưới, từ 3 đến 50 ký tự.'); return; }
    if (!(discountValue > 0) || (promoForm.discountType === 'Percentage' && discountValue > 100)) { setPromoFormError('Giá trị giảm không hợp lệ (giảm % tối đa 100).'); return; }
    if (promoForm.scopeType === 'Category' && !promoForm.scopeCategoryId) { setPromoFormError('Voucher theo danh mục phải chọn danh mục.'); return; }
    if (promoForm.scopeType === 'Product' && !promoForm.scopeProductIds.trim()) { setPromoFormError('Voucher theo sản phẩm phải chọn ít nhất 1 sản phẩm (nhập ID, cách nhau bằng dấu phẩy).'); return; }
    const payload = {
      code, description: promoForm.description, discountType: promoForm.discountType, discountValue,
      minOrderAmount: Number(promoForm.minOrderAmount) || 0,
      maxDiscountAmount: promoForm.maxDiscountAmount.trim() === '' ? null : Number(promoForm.maxDiscountAmount),
      startDate: promoForm.startDate ? new Date(promoForm.startDate).toISOString() : null,
      expiryDate: promoForm.expiryDate ? new Date(promoForm.expiryDate).toISOString() : null,
      maxUses: promoForm.maxUses.trim() === '' ? null : Number(promoForm.maxUses),
      maxUsesPerUser: promoForm.maxUsesPerUser.trim() === '' ? null : Number(promoForm.maxUsesPerUser),
      minTier: promoForm.minTier || null, scopeType: promoForm.scopeType,
      scopeCategoryId: promoForm.scopeType === 'Category' ? promoForm.scopeCategoryId : null,
      scopeProductIds: promoForm.scopeType === 'Product' ? promoForm.scopeProductIds.trim() : null,
    };
    try {
      const { body } = await apiJson<unknown>('/api/admin/promotions', { method: 'POST', skipAuthHandler: true, body: JSON.stringify(payload) });
      if (body?.success) { setNotice(body.message || 'Đã tạo khuyến mãi.'); setPromoFormOpen(false); await loadPromos(); }
      else setPromoFormError(apiErr(body, 'Không tạo được khuyến mãi.'));
    } catch { setPromoFormError('Không thể kết nối đến máy chủ.'); }
  };

  const activatePromo = async (p: Promotion) => {
    try {
      const { body } = await apiJson<string>(`/api/admin/promotions/${p.id}/activate`, { method: 'POST', skipAuthHandler: true, body: JSON.stringify({}) });
      if (body?.success) { setNotice(body.message || 'Đã kích hoạt khuyến mãi.'); await loadPromos(); }
      else setPromosError(apiErr(body, 'Không kích hoạt được khuyến mãi.'));
    } catch { setPromosError('Không thể kết nối đến máy chủ.'); }
  };

  const disablePromo = async () => {
    if (!disableTarget) return;
    if (!disableReason.trim()) { setPromosError('Tắt khuyến mãi bắt buộc phải nhập lý do.'); return; }
    try {
      const { body } = await apiJson<string>(`/api/admin/promotions/${disableTarget.id}/disable`, { method: 'POST', skipAuthHandler: true, body: JSON.stringify({ reason: disableReason.trim() }) });
      if (body?.success) { setNotice(body.message || 'Đã tắt khuyến mãi.'); setDisableTarget(null); setDisableReason(''); await loadPromos(); }
      else setPromosError(apiErr(body, 'Không tắt được khuyến mãi.'));
    } catch { setPromosError('Không thể kết nối đến máy chủ.'); }
  };

  const viewPromoUsage = async (p: Promotion) => {
    setPromoUsage(null); setPromoUsageFor(p.code);
    try {
      const { body } = await apiJson<PromotionUsage[]>(`/api/admin/promotions/${p.id}/usage?page=1&pageSize=20`, { skipAuthHandler: true });
      if (body?.success && Array.isArray(body.data)) setPromoUsage(body.data);
      else setPromosError(apiErr(body, 'Không tải được lượt dùng.'));
    } catch { setPromosError('Không thể kết nối đến máy chủ.'); }
  };

  const openCustomerDetail = async (c: Customer) => {
    setCustomerDetailLoading(true); setSelectedCustomer(null);
    try {
      const { body } = await apiJson<{ customer: Customer; recentOrders?: Array<{ orderCode: number; orderDisplayCode?: string | null; status?: string; totalAmount?: number; createdAt?: string }> }>(`/api/admin/customers/${c.id}`, { skipAuthHandler: true });
      if (body?.success && body.data?.customer) setSelectedCustomer(body.data);
      else setCustomersError(apiErr(body, 'Không tải được chi tiết khách hàng.'));
    } catch { setCustomersError('Không thể kết nối đến máy chủ.'); }
    finally { setCustomerDetailLoading(false); }
  };

  const lockCustomer = async (c: Customer, lock: boolean) => {
    try {
      const { body } = lock
        ? await apiJson<string>(`/api/admin/customers/${c.id}/lock`, { method: 'POST', skipAuthHandler: true, body: JSON.stringify({ reason: 'Khóa bởi quản trị viên' }) })
        : await apiJson<string>(`/api/admin/customers/${c.id}/unlock`, { method: 'POST', skipAuthHandler: true, body: JSON.stringify({}) });
      if (body?.success) { setNotice(body.message || (lock ? 'Đã khóa tài khoản.' : 'Đã mở khóa tài khoản.')); await loadCustomers(); }
      else setCustomersError(apiErr(body, 'Không đổi được trạng thái tài khoản.'));
    } catch { setCustomersError('Không thể kết nối đến máy chủ.'); }
  };

  const saveTiers = async () => {
    try {
      const { body } = await apiJson<MembershipTier[]>('/api/admin/membership/config', {
        method: 'PUT', skipAuthHandler: true,
        body: JSON.stringify({ tiers: tierDraft.map(t => ({ tier: t.tier, minSpent: Number(t.minSpent) || 0, spendPerPoint: Number(t.spendPerPoint) || 1, maxPointsPercent: Number(t.maxPointsPercent) || 0, freeShipThreshold: t.freeShipThreshold === null || t.freeShipThreshold === undefined ? null : Number(t.freeShipThreshold) })) }),
      });
      if (body?.success && Array.isArray(body.data)) { setTiers(body.data); setTierDraft(body.data); setNotice(body.message || 'Đã cập nhật cấu hình hạng hội viên.'); }
      else setTiersError(apiErr(body, 'Không lưu được cấu hình hội viên.'));
    } catch { setTiersError('Không thể kết nối đến máy chủ.'); }
  };

  const adjustPoints = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdjustError(null);
    const points = Number(adjustPointsValue);
    if (!Number.isInteger(points) || points === 0 || Math.abs(points) > 1000) { setAdjustError('Số điểm điều chỉnh phải là số nguyên khác 0, tối đa 1000/lần.'); return; }
    if (!adjustReason.trim()) { setAdjustError('Điều chỉnh điểm bắt buộc phải có lý do.'); return; }
    const idInput = adjustId.trim();
    if (!idInput) { setAdjustError('Vui lòng nhập email hoặc ID khách hàng.'); return; }
    setAdjustBusy(true);
    try {
      let userId = idInput;
      if (idInput.includes('@')) {
        const { body } = await apiJson<Customer[]>(`/api/admin/customers?search=${encodeURIComponent(idInput)}&page=1&pageSize=5`, { skipAuthHandler: true });
        const found = body?.success && Array.isArray(body.data) ? body.data.find(c => c.email.toLowerCase() === idInput.toLowerCase()) ?? body.data[0] : undefined;
        if (!found) { setAdjustError('Không tìm thấy khách hàng với email này.'); setAdjustBusy(false); return; }
        userId = found.id;
      }
      const { body } = await apiJson<string>(`/api/admin/membership/${userId}/adjust-points`, {
        method: 'POST', skipAuthHandler: true, body: JSON.stringify({ points, reason: adjustReason.trim() }),
      });
      if (body?.success) { setNotice(body.message || 'Đã điều chỉnh điểm.'); setAdjustPointsValue(''); setAdjustReason(''); }
      else setAdjustError(apiErr(body, 'Không điều chỉnh được điểm.'));
    } catch { setAdjustError('Không thể kết nối đến máy chủ.'); }
    finally { setAdjustBusy(false); }
  };

  const resolveReturn = async (approve: boolean) => {
    if (!returnTarget) return;
    if (!approve && !returnNote.trim()) { setReturnsError('Từ chối yêu cầu trả hàng bắt buộc phải ghi lý do.'); return; }
    try {
      const { body } = await apiJson<string>(`/api/admin/returns/${returnTarget.id}/resolve`, {
        method: 'POST', skipAuthHandler: true, body: JSON.stringify({ approve, adminNote: returnNote.trim() || undefined }),
      });
      if (body?.success) { setNotice(body.message || 'Đã xử lý yêu cầu trả hàng.'); setReturnTarget(null); setReturnNote(''); await loadReturns(); }
      else setReturnsError(apiErr(body, 'Không xử lý được yêu cầu trả hàng.'));
    } catch { setReturnsError('Không thể kết nối đến máy chủ.'); }
  };

  // ---------- Chuông thông báo: nối API thật GET /api/notifications (App.tsx
  // fetchNotifications dùng cùng endpoint; ở đây lấy theo userId của admin).
  // Không có SignalR ở trang admin — bấm chuông mới tải 1 lần, không live.
  // (Hàm thường, KHÔNG useCallback: khối này nằm sau các early-return của
  // gate nên không được gọi thêm hook ở đây — lần render gate='checking'
  // return sớm, lần sau render đủ sẽ lệch số hook.)
  const loadNotifications = async () => {
    if (notifsLoaded) return;
    setNotifLoading(true);
    try {
      const q = profile?.id ? `?userId=${encodeURIComponent(profile.id)}` : '';
      const { body } = await apiJson<NotificationItem[]>(`/api/notifications${q}`, { skipAuthHandler: true });
      if (body?.success && Array.isArray(body.data)) setNotifs(body.data);
      setNotifsLoaded(true);
    } catch { setNotifsLoaded(true); }
    finally { setNotifLoading(false); }
  };

  const markAllNotifRead = async () => {
    setNotifs(prev => prev.map(n => ({ ...n, isRead: true })));
    try {
      await apiJson('/api/notifications/read-all', { method: 'PUT', skipAuthHandler: true });
    } catch { /* đánh dấu cục bộ đã xong; lỗi API không chặn giao diện */ }
  };

  // ---------- Export CSV client-side từ dữ liệu đang hiển thị ----------
  // Có nút Export ở các mục có bảng dữ liệu (Đơn hàng/Sản phẩm/Danh mục/
  // Khuyến mãi/Khách hàng/Trả hàng); Tổng quan và Hội viên không có nút này.
  const exportCurrentTab = () => {
    if (tab === 'orders') downloadCsv('don-hang.csv',
      ['Mã đơn', 'Khách hàng', 'Email', 'Trạng thái', 'Thanh toán', 'Tổng tiền', 'Ngày đặt'],
      orders.map(o => [o.orderDisplayCode ?? `#${o.orderCode}`, o.customerName, o.customerEmail, o.statusLabel ?? statusLabel(o.status), o.paymentMethod, o.totalAmount, fmtDate(o.createdAt)]));
    else if (tab === 'products') downloadCsv('san-pham.csv',
      ['Tên', 'Danh mục', 'Giá bán', 'Giá gốc', 'Tồn kho'],
      filteredProducts.map(p => [p.name, p.categoryName ?? '', p.price, p.originalPrice ?? '', p.availableStock ?? '']));
    else if (tab === 'categories') downloadCsv('danh-muc.csv',
      ['Tên', 'Slug', 'Số SP', 'Hiển thị'],
      categories.map(c => [c.name, c.slug ?? '', c.productCount ?? 0, c.isActive ? 'Có' : 'Không']));
    else if (tab === 'promotions') downloadCsv('khuyen-mai.csv',
      ['Mã', 'Loại giảm', 'Giá trị', 'Hạn', 'Lượt dùng', 'Trạng thái'],
      promos.map(p => [p.code, p.discountType, p.discountValue, p.expiryDate ? fmtDate(p.expiryDate) : '', `${p.usedCount ?? 0}${p.maxUses ? `/${p.maxUses}` : ''}`, p.status]));
    else if (tab === 'customers') downloadCsv('khach-hang.csv',
      ['Họ tên', 'Email', 'Hạng', 'Chi tiêu 12 tháng', 'Số đơn', 'Trạng thái'],
      customers.map(c => [c.fullName, c.email, TIER_LABELS[c.membershipTier ?? ''] ?? c.membershipTier ?? '', c.totalSpent12m ?? 0, c.orderCount ?? 0, c.isLocked ? 'Đã khóa' : 'Bình thường']));
    else if (tab === 'returns') downloadCsv('tra-hang.csv',
      ['Mã đơn', 'Sản phẩm', 'Số lượng', 'Lý do', 'Trạng thái', 'Hoàn tiền'],
      returnsList.map(r => [r.orderDisplayCode ?? r.orderId, r.productName, r.quantity, r.reason, r.status, r.refundAmount ?? '']));
  };
  const canExport = ['orders', 'products', 'categories', 'promotions', 'customers', 'returns'].includes(tab);

  // Nút "+ Tạo mới" ở topbar: chỉ 3 mục có form tạo (mở đúng form như nút trong mục).
  const openCreateForm = () => {
    if (tab === 'products') {
      setProductForm({ id: '', name: '', categoryId: categories[0]?.id ?? '', price: '', originalPrice: '', stock: '', description: '', imageUrl: '', isActive: true });
      setProductFormError(null); setProductFormOpen(true);
    } else if (tab === 'categories') {
      setCatForm({ id: '', name: '', description: '', sortOrder: '0', isActive: true });
      setCatFormError(null); setCatFormOpen(true);
    } else if (tab === 'promotions') {
      setPromoForm({ code: '', description: '', discountType: 'Percentage', discountValue: '', minOrderAmount: '0', maxDiscountAmount: '', startDate: '', expiryDate: '', maxUses: '', maxUsesPerUser: '1', minTier: '', scopeType: 'All', scopeCategoryId: '', scopeProductIds: '' });
      setPromoFormError(null); setPromoFormOpen(true);
    }
  };
  const canCreate = tab === 'products' || tab === 'categories' || tab === 'promotions';
  const createLabel = tab === 'products' ? 'Thêm sản phẩm' : tab === 'categories' ? 'Thêm danh mục' : 'Tạo khuyến mãi';

  // Ô search ở topbar nối vào ô tìm kiếm của mục đang mở (đơn hàng/sản phẩm/
  // khách hàng — cùng state nên đồng bộ với ô trong toolbar). Mục khác không
  // có search thì ô topbar bị vô hiệu (trang trí).
  const topSearchSupported = tab === 'orders' || tab === 'products' || tab === 'customers';
  const topSearchValue = tab === 'orders' ? orderSearch : tab === 'products' ? productSearch : tab === 'customers' ? customerSearch : '';
  const onTopSearchChange = (v: string) => {
    if (tab === 'orders') setOrderSearch(v);
    else if (tab === 'products') setProductSearch(v);
    else if (tab === 'customers') setCustomerSearch(v);
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.();
  };

  const byStatus = dash?.ordersByStatus ?? {};
  const statCards = [
    { label: 'Doanh thu hôm nay', value: fmtMoney(dash?.revenueToday) },
    { label: 'Doanh thu tháng này', value: fmtMoney(dash?.revenueThisMonth) },
    { label: 'Đơn chờ xử lý', value: String(dash?.pendingOrders ?? 0) },
    { label: 'Khách mới 30 ngày', value: String(dash?.newCustomers30d ?? 0) },
  ];

  const meta = TAB_META[tab];
  const profileName = profile?.fullName ?? profile?.email ?? '?';
  return (
    <div data-testid="admin-page" className={`spark-admin${sidebarCollapsed ? ' sa-collapsed' : ''}${sidebarOpen ? ' sa-drawer-open' : ''}`}>
      {/* ---------- Sidebar xanh đen đậm ---------- */}
      <aside className="sa-sidebar">
        <div className="sa-logo">
          <span className="sa-logo-star" aria-hidden="true">★</span>
          <span className="sa-logo-text">DAFL Admin</span>
        </div>
        <nav className="sa-nav" aria-label="Menu quản trị">
          {NAV_GROUPS.map(g => (
            <div key={g.title} className="sa-nav-group">
              <div className="sa-nav-group-title">{g.title}</div>
              {g.keys.map(key => {
                const item = NAV_BY_KEY[key];
                return (
                  <button
                    key={item.key}
                    type="button"
                    data-testid={item.testid}
                    onClick={() => { setTab(item.key); setNotice(null); setSidebarOpen(false); }}
                    className={`sa-nav-btn${tab === item.key ? ' sa-active' : ''}`}
                    aria-current={tab === item.key ? 'page' : undefined}
                  >
                    <span className="sa-nav-icon" aria-hidden="true">{item.icon}</span>
                    <span className="sa-nav-label">{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="sa-sidebar-user">
          <span className="sa-avatar" style={{ background: avatarColor(profileName) }}>{avatarInitial(profileName)}</span>
          <div className="sa-sidebar-user-info">
            <div className="sa-sidebar-user-name">{profile?.fullName ?? profile?.email}</div>
            <div className="sa-sidebar-user-email">{profile?.email}</div>
          </div>
        </div>
      </aside>
      {sidebarOpen && <div className="sa-overlay" onClick={() => setSidebarOpen(false)} aria-hidden="true" />}

      {/* ---------- Cột chính: topbar + nội dung ---------- */}
      <div className="sa-main">
        <header className="sa-topbar">
          <button
            type="button"
            className="sa-topbar-btn"
            onClick={() => {
              if (window.matchMedia('(max-width: 900px)').matches) setSidebarOpen(v => !v);
              else setSidebarCollapsed(v => !v);
            }}
            aria-label="Thu gọn / mở menu"
            title="Thu gọn / mở menu"
          >
            ☰
          </button>
          {canCreate && (
            <button type="button" className="sa-btn sa-btn-create" onClick={openCreateForm}>
              + Tạo mới
            </button>
          )}
          <label className="sa-topbar-search">
            <span aria-hidden="true">🔍</span>
            <input
              value={topSearchValue}
              onChange={e => onTopSearchChange(e.target.value)}
              placeholder={topSearchSupported ? `Tìm kiếm ${meta.title.toLowerCase()}...` : 'Tìm kiếm'}
              disabled={!topSearchSupported}
              aria-label="Tìm kiếm"
            />
          </label>
          <div className="sa-topbar-spacer" />
          <button type="button" className="sa-topbar-btn" onClick={toggleFullscreen} aria-label="Toàn màn hình" title="Toàn màn hình">
            ⛶
          </button>
          <div className="sa-popover-wrap">
            <button
              type="button"
              className="sa-topbar-btn"
              onClick={() => {
                const next = !notifOpen;
                setNotifOpen(next);
                setAvatarMenuOpen(false);
                if (next) void loadNotifications();
              }}
              aria-label="Thông báo"
              title="Thông báo"
            >
              🔔
              {unreadNotifCount > 0 && <span className="sa-notif-dot" aria-hidden="true" />}
            </button>
            {notifOpen && (
              <div className="sa-popover" role="dialog" aria-label="Thông báo">
                <div className="sa-popover-head">
                  <span>Thông báo</span>
                  {unreadNotifCount > 0 && (
                    <button type="button" onClick={() => void markAllNotifRead()}>Đánh dấu đã đọc</button>
                  )}
                </div>
                {notifLoading ? (
                  <div className="sa-popover-empty">Đang tải thông báo...</div>
                ) : notifs.length === 0 ? (
                  <div className="sa-popover-empty">Chưa có thông báo mới</div>
                ) : (
                  notifs.map(n => (
                    <div key={n.id} className={`sa-notif-item${n.isRead ? '' : ' sa-unread'}`}>
                      <div className="sa-notif-title">{n.title}</div>
                      <div className="sa-notif-msg">{n.message}</div>
                      <div className="sa-notif-time">{fmtDate(n.createdAt)}</div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
          <div className="sa-popover-wrap">
            <button
              type="button"
              className="sa-topbar-user"
              onClick={() => { setAvatarMenuOpen(v => !v); setNotifOpen(false); }}
              aria-label="Menu tài khoản"
            >
              <span className="sa-avatar sa-avatar-sm" style={{ background: avatarColor(profileName) }}>{avatarInitial(profileName)}</span>
              <span className="sa-topbar-user-name">{profile?.fullName ?? profile?.email}</span>
              <span aria-hidden="true">▾</span>
            </button>
            {avatarMenuOpen && (
              <div className="sa-popover" role="dialog" aria-label="Tài khoản">
                <div className="sa-notif-item">
                  <div className="sa-notif-title">{profile?.fullName ?? profile?.email}</div>
                  <div className="sa-notif-msg">{profile?.email}</div>
                  <div className="sa-notif-time">Vai trò: {profile?.role}</div>
                </div>
                <div style={{ padding: '10px 14px' }}>
                  <button type="button" className="sa-btn sa-btn-ghost" style={{ width: '100%' }} onClick={() => { clearToken(); navigate('/login'); }}>
                    Đăng xuất
                  </button>
                </div>
              </div>
            )}
          </div>
        </header>

        <div className="sa-content">
          <div className="sa-pagehead">
            <div>
              <h1>{meta.title}</h1>
              <p>{meta.desc}</p>
            </div>
            <nav className="sa-breadcrumb" aria-label="Breadcrumb">
              Trang chủ / Quản trị / <strong>{meta.title}</strong>
            </nav>
          </div>

          {notice && (
            <div className="sa-notice">
              {notice} <button type="button" onClick={() => setNotice(null)} aria-label="Đóng thông báo">✕</button>
            </div>
          )}

          <main>
            {tab === 'dashboard' && (
              <section>
                {dashLoading && <p>Đang tải tổng quan...</p>}
                {dashError && <p className="sa-error">{dashError}</p>}
                <div className="sa-stats">
                  {statCards.map(c => (
                    <div key={c.label} className="sa-stat">
                      <div className="sa-stat-label">{c.label}</div>
                      <div className="sa-stat-value">{c.value}</div>
                    </div>
                  ))}
                </div>
                <h3 className="sa-section-title">Doanh thu</h3>
                <div className="sa-range-btns">
                  <button type="button" data-testid="admin-revenue-range-7" onClick={() => { setRevenueRange(7); void loadRevenue(7); }} className={revenueRange === 7 ? 'sa-btn' : 'sa-btn sa-btn-ghost'}>7 ngày</button>
                  <button type="button" data-testid="admin-revenue-range-30" onClick={() => { setRevenueRange(30); void loadRevenue(30); }} className={revenueRange === 30 ? 'sa-btn' : 'sa-btn sa-btn-ghost'}>30 ngày</button>
                </div>
                {revenueLoading && <p>Đang tải báo cáo doanh thu...</p>}
                {revenueError && <p className="sa-error">{revenueError}</p>}
                {!revenueLoading && !revenueError && revenue && (
                  <>
                    {(revenue.totalOrders ?? 0) === 0 ? (
                      <p>Chưa có doanh thu trong khoảng thời gian này.</p>
                    ) : (
                      <div data-testid="admin-revenue-chart" className="sa-card">
                        {(() => {
                          // Lấp đủ ngày trong khoảng (ngày không có đơn → doanh thu 0).
                          const byDate = new Map((revenue.byDay ?? []).map(d => [String(d.date).slice(0, 10), d]));
                          const days: Array<{ label: string; revenue: number; orders: number }> = [];
                          for (let i = revenueRange - 1; i >= 0; i--) {
                            const d = new Date(); d.setDate(d.getDate() - i);
                            const found = byDate.get(d.toISOString().slice(0, 10));
                            days.push({ label: `${d.getDate()}/${d.getMonth() + 1}`, revenue: found?.revenue ?? 0, orders: found?.orders ?? 0 });
                          }
                          const max = Math.max(1, ...days.map(d => d.revenue));
                          const W = 720; const H = 220; const PAD = 28;
                          const bw = (W - PAD * 2) / days.length;
                          const labelEvery = Math.max(1, Math.ceil(days.length / 8));
                          return (
                            <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Biểu đồ doanh thu theo ngày">
                              {days.map((d, i) => {
                                const h = (d.revenue / max) * (H - PAD * 2 - 20);
                                const x = PAD + i * bw + bw * 0.18;
                                const y = H - PAD - h;
                                return (
                                  <g key={d.label}>
                                    <rect x={x} y={y} width={bw * 0.64} height={Math.max(h, d.revenue > 0 ? 2 : 0)} rx={4} fill={LIME}>
                                      <title>{d.label}: {fmtMoney(d.revenue)} ({d.orders} đơn)</title>
                                    </rect>
                                    {(i % labelEvery === 0 || i === days.length - 1) && (
                                      <text x={PAD + i * bw + bw / 2} y={H - 8} fontSize={11} textAnchor="middle" fill="#666">{d.label}</text>
                                    )}
                                  </g>
                                );
                              })}
                              <text x={PAD} y={16} fontSize={12} fill="#666">Cao nhất: {fmtMoney(max)}</text>
                            </svg>
                          );
                        })()}
                      </div>
                    )}
                    <div className="sa-stats">
                      <div className="sa-stat">
                        <div className="sa-stat-label">Tổng đơn</div>
                        <div className="sa-stat-value">{revenue.totalOrders ?? 0}</div>
                      </div>
                      <div className="sa-stat">
                        <div className="sa-stat-label">Tỉ lệ hủy đơn</div>
                        <div className="sa-stat-value">{revenue.cancelRate ?? 0}% ({revenue.cancelledOrders ?? 0} đơn)</div>
                      </div>
                      <div className="sa-stat">
                        <div className="sa-stat-label">Đơn dùng voucher</div>
                        <div className="sa-stat-value">{revenue.voucherOrders ?? 0} ({revenue.voucherUsageRate ?? 0}%)</div>
                      </div>
                    </div>
                    <h4 style={{ fontSize: '1.15rem', margin: '0 0 0.5rem' }}>Sản phẩm bán chạy</h4>
                    {(revenue.topProducts ?? []).length === 0 ? (
                      <p>Chưa có sản phẩm bán chạy trong khoảng này.</p>
                    ) : (
                      <div className="sa-table-wrap" style={{ marginBottom: '1rem' }}>
                        <table>
                          <thead><tr><th>Sản phẩm</th><th>Số lượng</th><th>Doanh thu</th></tr></thead>
                          <tbody>
                            {revenue.topProducts!.map(p => (
                              <tr key={p.productId}>
                                <td><strong>{p.productName}</strong></td>
                                <td>{p.quantity} SP</td>
                                <td><span className="sa-money">{fmtMoney(p.revenue)}</span></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
                <h3 className="sa-section-title">Đơn hàng theo trạng thái</h3>
                {Object.keys(byStatus).length === 0 && !dashLoading ? <p>Chưa có đơn hàng.</p> : (
                  <div className="sa-table-wrap">
                    <table>
                      <thead><tr><th>Trạng thái</th><th>Số đơn</th></tr></thead>
                      <tbody>
                        {Object.entries(byStatus).map(([s, n]) => (
                          <tr key={s}>
                            <td><span className={statusPillClass(s)}><span className="sa-dot" aria-hidden="true" />{statusLabel(s)}</span></td>
                            <td>{n}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <h3 className="sa-section-title">Sản phẩm sắp hết hàng</h3>
                {(dash?.lowStockProducts ?? []).length === 0 ? <p>Không có sản phẩm sắp hết hàng.</p> : (
                  <div className="sa-table-wrap">
                    <table>
                      <thead><tr><th>Sản phẩm</th><th>Tồn kho</th><th>Thao tác</th></tr></thead>
                      <tbody>
                        {dash!.lowStockProducts!.map(p => (
                          <tr key={p.id}>
                            <td><strong>{p.name}</strong></td>
                            <td><span className="sa-pill sa-pill-amber"><span className="sa-dot" aria-hidden="true" />còn {p.stock}</span></td>
                            <td className="sa-actions">
                              <button type="button" className="sa-icon-btn" title="Xem sản phẩm" aria-label={`Xem sản phẩm ${p.name}`} onClick={() => { setTab('products'); setProductSearch(p.name); setNotice(null); }}>👁</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <h3 className="sa-section-title">Voucher sắp hết lượt</h3>
                {(dash?.expiringVouchers ?? []).length === 0 ? <p>Không có voucher sắp hết lượt.</p> : (
                  <div className="sa-table-wrap">
                    <table>
                      <thead><tr><th>Mã</th><th>Đã dùng</th><th>Hết hạn</th><th>Thao tác</th></tr></thead>
                      <tbody>
                        {dash!.expiringVouchers!.map(v => (
                          <tr key={v.code}>
                            <td><span className="sa-code">{v.code}</span></td>
                            <td>{v.usedCount}{v.maxUses ? `/${v.maxUses}` : ''}</td>
                            <td>{v.expiryDate ? fmtDate(v.expiryDate) : '—'}</td>
                            <td className="sa-actions">
                              <button type="button" className="sa-icon-btn" title="Xem khuyến mãi" aria-label={`Xem khuyến mãi ${v.code}`} onClick={() => { setTab('promotions'); setPromoSearch(v.code); setNotice(null); }}>👁</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <button type="button" onClick={() => void loadDashboard()} className="sa-btn sa-btn-ghost" style={{ marginTop: '1rem' }}>Tải lại</button>
              </section>
            )}

            {tab === 'orders' && (
              <section>
                <div className="sa-toolbar">
                  <input className="sa-input" placeholder="Tìm mã đơn / tên khách / email" value={orderSearch} onChange={e => setOrderSearch(e.target.value)} data-testid="admin-order-search" />
                  <select className="sa-input" value={orderStatusFilter} onChange={e => setOrderStatusFilter(e.target.value)} data-testid="admin-order-status-filter" aria-label="Lọc trạng thái">
                    <option value="">Tất cả trạng thái</option>
                    {ORDER_STATUSES.map(s => <option key={s} value={s}>{ORDER_STATUS_LABELS[s]}</option>)}
                  </select>
                  <button type="button" onClick={() => void loadOrders()} className="sa-btn">Tìm</button>
                  <span className="sa-spacer" />
                  <button type="button" onClick={exportCurrentTab} className="sa-btn sa-btn-ghost">⬇ Export</button>
                </div>
                {ordersLoading && <p>Đang tải đơn hàng...</p>}
                {ordersError && <p className="sa-error">{ordersError}</p>}
                {!ordersLoading && orders.length === 0 && !ordersError && <p>Không có đơn hàng nào.</p>}
                {orders.length > 0 && (
                  <div className="sa-table-wrap">
                    <table>
                      <thead><tr><th>Mã đơn</th><th>Khách hàng</th><th>Trạng thái</th><th>Thanh toán</th><th>Tổng tiền</th><th>Ngày đặt</th><th>Thao tác</th></tr></thead>
                      <tbody>
                        {orders.map(o => (
                          <tr key={o.id} onClick={() => void openOrderDetail(o.id)} className="sa-clickable" data-testid={`admin-order-row-${o.id}`}>
                            <td><span className="sa-code">{o.orderDisplayCode ?? `#${o.orderCode}`}</span></td>
                            <td>
                              <span className="sa-user-cell">
                                <span className="sa-avatar sa-avatar-sm" style={{ background: avatarColor(o.customerName) }}>{avatarInitial(o.customerName)}</span>
                                <span className="sa-user-cell-names"><strong>{o.customerName}</strong><small>{o.customerEmail}</small></span>
                              </span>
                            </td>
                            <td><span className={statusPillClass(o.status)}><span className="sa-dot" aria-hidden="true" />{o.statusLabel ?? statusLabel(o.status)}</span></td>
                            <td>{o.paymentMethod}</td>
                            <td><span className="sa-money">{fmtMoney(o.totalAmount)}</span></td>
                            <td>{fmtDate(o.createdAt)}</td>
                            <td className="sa-actions">
                              <button
                                type="button"
                                className="sa-icon-btn"
                                title="Xem chi tiết đơn"
                                aria-label={`Xem chi tiết đơn ${o.orderDisplayCode ?? `#${o.orderCode}`}`}
                                onClick={e => { e.stopPropagation(); void openOrderDetail(o.id); }}
                              >
                                👁
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {orderDetailLoading && <p>Đang tải chi tiết đơn...</p>}
                {orderDetailError && <p className="sa-error">{orderDetailError}</p>}
                {selectedOrder && (
                  <SparkModal
                    title={`Đơn ${selectedOrder.order.orderDisplayCode ?? `#${selectedOrder.order.orderCode}`} — ${selectedOrder.order.statusLabel ?? statusLabel(selectedOrder.order.status)}`}
                    onClose={() => setSelectedOrder(null)}
                  >
                    <div data-testid="admin-order-detail">
                    <p>Khách: {selectedOrder.order.customerName} ({selectedOrder.order.customerEmail} — {selectedOrder.order.customerPhone})</p>
                    <p>Địa chỉ: {selectedOrder.order.shipDetailAddress
                      ? [selectedOrder.order.shipDetailAddress, selectedOrder.order.shipWardName, selectedOrder.order.shipDistrictName, selectedOrder.order.shipProvinceName].filter(Boolean).join(', ')
                      : (selectedOrder.order.shippingAddress ?? '—')}</p>
                    <p>Thanh toán: {selectedOrder.order.paymentMethod ?? '—'} — Phí ship: {fmtMoney(selectedOrder.order.shippingFee)} — Tổng: {fmtMoney(selectedOrder.order.totalAmount)}</p>
                    {selectedOrder.order.voucherCode && <p>Voucher: {selectedOrder.order.voucherCode} (giảm {fmtMoney(selectedOrder.order.discountAmount)})</p>}
                    {selectedOrder.order.pointsUsed ? <p>Điểm đã dùng: {selectedOrder.order.pointsUsed} (giảm {fmtMoney(selectedOrder.order.pointsDiscount)}) — Điểm nhận: {selectedOrder.order.pointsEarned ?? 0}</p> : null}
                    {selectedOrder.order.carrier && <p>Vận chuyển: {selectedOrder.order.carrier} — Mã vận đơn: {selectedOrder.order.trackingCode ?? '—'}</p>}
                    {selectedOrder.order.cancelReason && <p>Lý do hủy: {selectedOrder.order.cancelReason}</p>}
                    {selectedOrder.internalNote && <p>Ghi chú nội bộ: {selectedOrder.internalNote}</p>}
                    <h4>Sản phẩm</h4>
                    <ul className="sa-list">{(selectedOrder.order.items ?? []).map(i => <li key={i.id}>{i.productName} × {i.quantity} — {fmtMoney(i.unitPrice)}</li>)}</ul>
                    <h4>Lịch sử trạng thái</h4>
                    {(selectedOrder.order.statusHistories ?? []).length === 0 ? <p>Chưa có lịch sử trạng thái.</p> : (
                      <ul className="sa-list">{selectedOrder.order.statusHistories!.map((h, idx) => (
                        <li key={idx}>{statusLabel(h.status)} — {fmtDate(h.timestamp)}{h.note ? ` — ${h.note}` : ''}</li>
                      ))}</ul>
                    )}
                    <h4>Đổi trạng thái</h4>
                    {(() => {
                      const cur = statusName(selectedOrder.order.status);
                      const targets = (ALLOWED_NEXT[cur] ?? []).filter(s => s !== 'Cancelled');
                      if (targets.length === 0) return <p>Đơn ở trạng thái này không đổi được nữa.</p>;
                      return (
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                          <select className="sa-input" style={{ maxWidth: 260 }} value={nextStatus} onChange={e => setNextStatus(e.target.value)} data-testid="admin-order-status-select" aria-label="Trạng thái mới">
                            <option value="">— Chọn trạng thái đích —</option>
                            {targets.map(s => <option key={s} value={s}>{ORDER_STATUS_LABELS[s] ?? s}</option>)}
                          </select>
                          {nextStatus === 'Shipping' && (
                            <>
                              <input className="sa-input" style={{ maxWidth: 200 }} placeholder="Đơn vị vận chuyển" value={shipCarrier} onChange={e => setShipCarrier(e.target.value)} data-testid="admin-order-carrier-input" />
                              <input className="sa-input" style={{ maxWidth: 220 }} placeholder="Mã vận đơn (6–30 ký tự)" value={shipTracking} onChange={e => setShipTracking(e.target.value)} data-testid="admin-order-tracking-input" />
                            </>
                          )}
                          <input className="sa-input" style={{ maxWidth: 260 }} placeholder="Ghi chú (không bắt buộc)" value={statusNote} onChange={e => setStatusNote(e.target.value)} />
                          <button type="button" onClick={() => void changeOrderStatus()} disabled={!nextStatus || orderBusy} className="sa-btn">Đổi trạng thái</button>
                        </div>
                      );
                    })()}
                    {['Pending', 'Paid', 'Confirmed', 'Preparing'].includes(statusName(selectedOrder.order.status)) && (
                      <div style={{ marginTop: '1rem' }}>
                        <h4>Hủy đơn (bắt buộc lý do)</h4>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <input className="sa-input" style={{ maxWidth: 420 }} placeholder="Lý do hủy đơn" value={cancelReason} onChange={e => setCancelReason(e.target.value)} data-testid="admin-order-cancel-reason" />
                          <button type="button" onClick={() => void cancelOrder()} disabled={orderBusy} className="sa-btn sa-btn-danger" data-testid="admin-order-cancel-btn">Hủy đơn</button>
                        </div>
                      </div>
                    )}
                    </div>
                  </SparkModal>
                )}
              </section>
            )}

            {tab === 'products' && (
              <section>
                <p className="sa-muted-text">Danh sách lấy từ GET /api/products công khai (chỉ sản phẩm đang bán). Sản phẩm đã ẩn/xóa mềm không hiện ở đây vì backend chưa có endpoint list SP riêng cho admin.</p>
                <div className="sa-toolbar">
                  <input className="sa-input" placeholder="Tìm tên sản phẩm" value={productSearch} onChange={e => setProductSearch(e.target.value)} data-testid="admin-product-search" />
                  <select className="sa-input" value={productCatFilter} onChange={e => setProductCatFilter(e.target.value)} aria-label="Lọc danh mục">
                    <option value="">Tất cả danh mục</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <button type="button" onClick={() => { setProductForm({ id: '', name: '', categoryId: categories[0]?.id ?? '', price: '', originalPrice: '', stock: '', description: '', imageUrl: '', isActive: true }); setProductFormError(null); setProductFormOpen(true); }} className="sa-btn" data-testid="admin-product-add-btn">+ Thêm sản phẩm</button>
                  <button type="button" onClick={() => void loadProducts()} className="sa-btn sa-btn-ghost">Tải lại</button>
                  <span className="sa-spacer" />
                  <button type="button" onClick={exportCurrentTab} className="sa-btn sa-btn-ghost">⬇ Export</button>
                </div>
                {productsLoading && <p>Đang tải sản phẩm...</p>}
                {productsError && <p className="sa-error">{productsError}</p>}
                {productFormOpen && (
                  <form onSubmit={saveProduct} className="sa-card" data-testid="admin-product-form">
                    <h3>{productForm.id ? 'Sửa sản phẩm' : 'Thêm sản phẩm'}</h3>
                    {productFormError && <p className="sa-error">{productFormError}</p>}
                    <div className="sa-form-grid">
                      <label className="sa-field"><span>Tên sản phẩm (3–120 ký tự)</span>
                        <input className="sa-input" value={productForm.name} onChange={e => setProductForm({ ...productForm, name: e.target.value })} data-testid="admin-product-name-input" />
                      </label>
                      <label className="sa-field"><span>Danh mục</span>
                        <select className="sa-input" value={productForm.categoryId} onChange={e => setProductForm({ ...productForm, categoryId: e.target.value })} data-testid="admin-product-category-select" aria-label="Danh mục">
                          <option value="">— Chọn danh mục —</option>
                          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </label>
                      <label className="sa-field"><span>Giá bán (&gt; 0)</span>
                        <input className="sa-input" type="number" min={1} value={productForm.price} onChange={e => setProductForm({ ...productForm, price: e.target.value })} data-testid="admin-product-price-input" />
                      </label>
                      <label className="sa-field"><span>Giá gốc (lớn hơn giá bán, không bắt buộc)</span>
                        <input className="sa-input" type="number" min={0} value={productForm.originalPrice} onChange={e => setProductForm({ ...productForm, originalPrice: e.target.value })} />
                      </label>
                      <label className="sa-field"><span>Tồn kho (≥ 0)</span>
                        <input className="sa-input" type="number" min={0} value={productForm.stock} onChange={e => setProductForm({ ...productForm, stock: e.target.value })} data-testid="admin-product-stock-input" />
                      </label>
                      <label className="sa-field"><span>Ảnh URL</span>
                        <input className="sa-input" value={productForm.imageUrl} onChange={e => setProductForm({ ...productForm, imageUrl: e.target.value })} />
                      </label>
                      <label className="sa-field"><span>Mô tả</span>
                        <textarea className="sa-input" value={productForm.description} onChange={e => setProductForm({ ...productForm, description: e.target.value })} />
                      </label>
                      {productForm.id && (
                        <label className="sa-check"><input type="checkbox" checked={productForm.isActive} onChange={e => setProductForm({ ...productForm, isActive: e.target.checked })} /> Đang hiển thị</label>
                      )}
                    </div>
                    <div className="sa-form-actions">
                      <button type="submit" className="sa-btn" data-testid="admin-product-save-btn">Lưu</button>
                      <button type="button" onClick={() => setProductFormOpen(false)} className="sa-btn sa-btn-ghost">Đóng</button>
                    </div>
                  </form>
                )}
                {!productsLoading && filteredProducts.length === 0 && !productsError && <p>Không có sản phẩm nào.</p>}
                {filteredProducts.length > 0 && (
                  <div className="sa-table-wrap">
                    <table>
                      <thead><tr><th>Sản phẩm</th><th>Danh mục</th><th>Giá</th><th>Tồn kho</th><th>Đánh giá</th><th>Thao tác</th></tr></thead>
                      <tbody>
                        {filteredProducts.map(p => (
                          <tr key={p.id}>
                            <td>
                              <span className="sa-user-cell">
                                {p.imageUrl
                                  ? <img src={p.imageUrl} alt={p.name} className="sa-thumb" />
                                  : <span className="sa-thumb sa-thumb-ph" aria-hidden="true">🛍️</span>}
                                <span className="sa-user-cell-names"><strong>{p.name}</strong></span>
                              </span>
                            </td>
                            <td>{p.categoryName ?? '—'}</td>
                            <td><span className="sa-money">{fmtMoney(p.price)}</span>{p.originalPrice ? <><br /><small><s>{fmtMoney(p.originalPrice)}</s></small></> : null}</td>
                            <td>{p.availableStock ?? '—'}</td>
                            <td>{p.rating != null ? <>★ {p.rating} <small>({p.reviewCount ?? 0} đánh giá)</small></> : '—'}</td>
                            <td className="sa-actions">
                              <button type="button" className="sa-icon-btn" title="Xem chi tiết sản phẩm" aria-label={`Xem chi tiết sản phẩm ${p.name}`} onClick={() => setSelectedProduct(p)}>👁</button>
                              <button
                                type="button"
                                className="sa-icon-btn"
                                title="Sửa sản phẩm"
                                aria-label={`Sửa sản phẩm ${p.name}`}
                                onClick={() => {
                                  setProductForm({ id: p.id, name: p.name, categoryId: p.categoryId, price: String(p.price), originalPrice: p.originalPrice ? String(p.originalPrice) : '', stock: String(p.availableStock ?? 0), description: p.description ?? '', imageUrl: p.imageUrl ?? '', isActive: true });
                                  setProductFormError(null); setProductFormOpen(true);
                                }}
                              >
                                ✎
                              </button>
                              <button
                                type="button"
                                className="sa-icon-btn sa-icon-danger"
                                title="Xóa sản phẩm"
                                aria-label={`Xóa sản phẩm ${p.name}`}
                                onClick={() => void deleteProduct(p)}
                              >
                                🗑
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            {tab === 'categories' && (
              <section>
                <div className="sa-toolbar">
                  <input className="sa-input" placeholder="Tìm tên / slug danh mục" value={catSearch} onChange={e => setCatSearch(e.target.value)} aria-label="Tìm danh mục" />
                  <select className="sa-input" value={catStatusFilter} onChange={e => setCatStatusFilter(e.target.value)} aria-label="Lọc trạng thái danh mục">
                    <option value="">Tất cả trạng thái</option>
                    <option value="true">Đang hiển thị</option>
                    <option value="false">Đã ẩn</option>
                  </select>
                  <button type="button" onClick={() => { setCatForm({ id: '', name: '', description: '', sortOrder: '0', isActive: true }); setCatFormError(null); setCatFormOpen(true); }} className="sa-btn" data-testid="admin-category-add-btn">+ Thêm danh mục</button>
                  <button type="button" onClick={() => void loadCategories()} className="sa-btn sa-btn-ghost">Tải lại</button>
                  <span className="sa-spacer" />
                  <button type="button" onClick={exportCurrentTab} className="sa-btn sa-btn-ghost">⬇ Export</button>
                </div>
                {catsLoading && <p>Đang tải danh mục...</p>}
                {catsError && <p className="sa-error">{catsError}</p>}
                {catFormOpen && (
                  <form onSubmit={saveCategory} className="sa-card" data-testid="admin-category-form">
                    <h3>{catForm.id ? 'Sửa danh mục' : 'Thêm danh mục'}</h3>
                    {catFormError && <p className="sa-error">{catFormError}</p>}
                    <div className="sa-form-grid">
                      <label className="sa-field"><span>Tên danh mục (2–150 ký tự)</span>
                        <input className="sa-input" value={catForm.name} onChange={e => setCatForm({ ...catForm, name: e.target.value })} data-testid="admin-category-name-input" />
                      </label>
                      <label className="sa-field"><span>Mô tả</span>
                        <input className="sa-input" value={catForm.description} onChange={e => setCatForm({ ...catForm, description: e.target.value })} />
                      </label>
                      <label className="sa-field"><span>Thứ tự sắp xếp</span>
                        <input className="sa-input" type="number" value={catForm.sortOrder} onChange={e => setCatForm({ ...catForm, sortOrder: e.target.value })} />
                      </label>
                      {catForm.id && <label className="sa-check"><input type="checkbox" checked={catForm.isActive} onChange={e => setCatForm({ ...catForm, isActive: e.target.checked })} /> Đang hiển thị</label>}
                    </div>
                    <div className="sa-form-actions">
                      <button type="submit" className="sa-btn">Lưu</button>
                      <button type="button" onClick={() => setCatFormOpen(false)} className="sa-btn sa-btn-ghost">Đóng</button>
                    </div>
                  </form>
                )}
                {!catsLoading && filteredCategories.length === 0 && !catsError && <p>Chưa có danh mục.</p>}
                {filteredCategories.length > 0 && (
                  <div className="sa-table-wrap">
                    <table>
                      <thead><tr><th>Tên</th><th>Slug</th><th>Mô tả</th><th>Số SP</th><th>Thứ tự</th><th>Hiển thị</th><th>Thao tác</th></tr></thead>
                      <tbody>
                        {filteredCategories.map(c => (
                          <tr key={c.id}>
                            <td><strong>{c.name}</strong></td>
                            <td>{c.slug ?? '—'}</td>
                            <td>{c.description ?? '—'}</td>
                            <td>{c.productCount ?? 0}</td>
                            <td>{c.sortOrder ?? 0}</td>
                            <td>{c.isActive ? <span className="sa-pill sa-pill-green"><span className="sa-dot" aria-hidden="true" />Có</span> : <span className="sa-pill sa-pill-gray"><span className="sa-dot" aria-hidden="true" />Không</span>}</td>
                            <td className="sa-actions">
                              <button type="button" className="sa-icon-btn" title="Xem chi tiết danh mục" aria-label={`Xem chi tiết danh mục ${c.name}`} onClick={() => setSelectedCategory(c)}>👁</button>
                              <button type="button" className="sa-icon-btn" title="Sửa danh mục" aria-label={`Sửa danh mục ${c.name}`} onClick={() => { setCatForm({ id: c.id, name: c.name, description: c.description ?? '', sortOrder: String(c.sortOrder ?? 0), isActive: c.isActive }); setCatFormError(null); setCatFormOpen(true); }}>✎</button>
                              <button type="button" className="sa-icon-btn sa-icon-danger" title="Xóa danh mục" aria-label={`Xóa danh mục ${c.name}`} onClick={() => void deleteCategory(c)}>🗑</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            {tab === 'promotions' && (
              <section>
                <div className="sa-toolbar">
                  <input className="sa-input" placeholder="Tìm mã / mô tả khuyến mãi" value={promoSearch} onChange={e => setPromoSearch(e.target.value)} aria-label="Tìm khuyến mãi" />
                  <select className="sa-input" value={promoStatusFilter} onChange={e => setPromoStatusFilter(e.target.value)} aria-label="Lọc trạng thái voucher">
                    <option value="">Tất cả trạng thái</option>
                    <option value="Draft">Nháp</option>
                    <option value="Active">Đang chạy</option>
                    <option value="Disabled">Đã tắt</option>
                    <option value="Expired">Hết hạn</option>
                  </select>
                  <button type="button" onClick={() => void loadPromos()} className="sa-btn">Lọc</button>
                  <button type="button" onClick={() => { setPromoForm({ code: '', description: '', discountType: 'Percentage', discountValue: '', minOrderAmount: '0', maxDiscountAmount: '', startDate: '', expiryDate: '', maxUses: '', maxUsesPerUser: '1', minTier: '', scopeType: 'All', scopeCategoryId: '', scopeProductIds: '' }); setPromoFormError(null); setPromoFormOpen(true); }} className="sa-btn" data-testid="admin-promo-add-btn">+ Tạo khuyến mãi</button>
                  <span className="sa-spacer" />
                  <button type="button" onClick={exportCurrentTab} className="sa-btn sa-btn-ghost">⬇ Export</button>
                </div>
                {promosLoading && <p>Đang tải khuyến mãi...</p>}
                {promosError && <p className="sa-error">{promosError}</p>}
                {promoFormOpen && (
                  <form onSubmit={savePromo} className="sa-card" data-testid="admin-promo-form">
                    <h3>Tạo khuyến mãi mới (tạo ở trạng thái Nháp — bấm Kích hoạt để chạy)</h3>
                    {promoFormError && <p className="sa-error">{promoFormError}</p>}
                    <div className="sa-form-grid">
                      <label className="sa-field"><span>Mã (3–50 ký tự: chữ, số, -, _)</span>
                        <input className="sa-input" value={promoForm.code} onChange={e => setPromoForm({ ...promoForm, code: e.target.value })} data-testid="admin-promo-code-input" />
                      </label>
                      <label className="sa-field"><span>Mô tả</span>
                        <input className="sa-input" value={promoForm.description} onChange={e => setPromoForm({ ...promoForm, description: e.target.value })} />
                      </label>
                      <label className="sa-field"><span>Loại giảm</span>
                        <select className="sa-input" value={promoForm.discountType} onChange={e => setPromoForm({ ...promoForm, discountType: e.target.value })} aria-label="Loại giảm">
                          <option value="Percentage">Giảm theo %</option>
                          <option value="Fixed">Giảm tiền cố định</option>
                          <option value="FreeShip">Miễn phí vận chuyển</option>
                        </select>
                      </label>
                      <label className="sa-field"><span>Giá trị giảm</span>
                        <input className="sa-input" type="number" min={0} value={promoForm.discountValue} onChange={e => setPromoForm({ ...promoForm, discountValue: e.target.value })} />
                      </label>
                      <label className="sa-field"><span>Đơn tối thiểu</span>
                        <input className="sa-input" type="number" min={0} value={promoForm.minOrderAmount} onChange={e => setPromoForm({ ...promoForm, minOrderAmount: e.target.value })} />
                      </label>
                      <label className="sa-field"><span>Trần giảm (không bắt buộc)</span>
                        <input className="sa-input" type="number" min={0} value={promoForm.maxDiscountAmount} onChange={e => setPromoForm({ ...promoForm, maxDiscountAmount: e.target.value })} />
                      </label>
                      <label className="sa-field"><span>Ngày bắt đầu</span>
                        <input className="sa-input" type="datetime-local" value={promoForm.startDate} onChange={e => setPromoForm({ ...promoForm, startDate: e.target.value })} />
                      </label>
                      <label className="sa-field"><span>Ngày kết thúc</span>
                        <input className="sa-input" type="datetime-local" value={promoForm.expiryDate} onChange={e => setPromoForm({ ...promoForm, expiryDate: e.target.value })} />
                      </label>
                      <label className="sa-field"><span>Tổng lượt dùng (không bắt buộc)</span>
                        <input className="sa-input" type="number" min={1} value={promoForm.maxUses} onChange={e => setPromoForm({ ...promoForm, maxUses: e.target.value })} />
                      </label>
                      <label className="sa-field"><span>Lượt dùng / người</span>
                        <input className="sa-input" type="number" min={1} value={promoForm.maxUsesPerUser} onChange={e => setPromoForm({ ...promoForm, maxUsesPerUser: e.target.value })} />
                      </label>
                      <label className="sa-field"><span>Hạng tối thiểu</span>
                        <select className="sa-input" value={promoForm.minTier} onChange={e => setPromoForm({ ...promoForm, minTier: e.target.value })} aria-label="Hạng tối thiểu">
                          <option value="">Không giới hạn hạng</option>
                          <option value="Member">Thường</option>
                          <option value="Silver">Bạc</option>
                          <option value="Gold">Vàng</option>
                          <option value="Diamond">Kim cương</option>
                        </select>
                      </label>
                      <label className="sa-field"><span>Phạm vi áp dụng</span>
                        <select className="sa-input" value={promoForm.scopeType} onChange={e => setPromoForm({ ...promoForm, scopeType: e.target.value })} aria-label="Phạm vi áp dụng">
                          <option value="All">Toàn sàn</option>
                          <option value="Category">Theo danh mục</option>
                          <option value="Product">Theo sản phẩm</option>
                        </select>
                      </label>
                      {promoForm.scopeType === 'Category' && (
                        <label className="sa-field"><span>Danh mục áp dụng</span>
                          <select className="sa-input" value={promoForm.scopeCategoryId} onChange={e => setPromoForm({ ...promoForm, scopeCategoryId: e.target.value })} aria-label="Danh mục áp dụng">
                            <option value="">— Chọn danh mục —</option>
                            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </label>
                      )}
                      {promoForm.scopeType === 'Product' && (
                        <label className="sa-field"><span>ID sản phẩm, cách nhau bằng dấu phẩy</span>
                          <input className="sa-input" value={promoForm.scopeProductIds} onChange={e => setPromoForm({ ...promoForm, scopeProductIds: e.target.value })} />
                        </label>
                      )}
                    </div>
                    <div className="sa-form-actions">
                      <button type="submit" className="sa-btn">Tạo khuyến mãi</button>
                      <button type="button" onClick={() => setPromoFormOpen(false)} className="sa-btn sa-btn-ghost">Đóng</button>
                    </div>
                  </form>
                )}
                {disableTarget && (
                  <div className="sa-card">
                    <h3>Tắt khuyến mãi {disableTarget.code} — bắt buộc nhập lý do</h3>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <input className="sa-input" style={{ maxWidth: 420 }} placeholder="Lý do tắt khuyến mãi" value={disableReason} onChange={e => setDisableReason(e.target.value)} data-testid="admin-promo-disable-reason" />
                      <button type="button" onClick={() => void disablePromo()} className="sa-btn sa-btn-danger">Xác nhận tắt</button>
                      <button type="button" onClick={() => { setDisableTarget(null); setDisableReason(''); }} className="sa-btn sa-btn-ghost">Hủy</button>
                    </div>
                  </div>
                )}
                {!promosLoading && filteredPromos.length === 0 && !promosError && <p>Chưa có khuyến mãi.</p>}
                {filteredPromos.length > 0 && (
                  <div className="sa-table-wrap">
                    <table>
                      <thead><tr><th>Mã</th><th>Mô tả</th><th>Loại giảm</th><th>Giá trị</th><th>Đơn tối thiểu</th><th>Đã dùng</th><th>Hạn</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
                      <tbody>
                        {filteredPromos.map(p => (
                          <tr key={p.id}>
                            <td><span className="sa-code">{p.code}</span></td>
                            <td>{p.description ?? '—'}</td>
                            <td>{p.discountType}{p.minTier ? <><br /><small>Hạng {TIER_LABELS[p.minTier] ?? p.minTier}+</small></> : null}</td>
                            <td>{p.discountType === 'Percentage' ? `${p.discountValue}%` : p.discountType === 'FreeShip' ? 'Freeship' : fmtMoney(p.discountValue)}</td>
                            <td>{fmtMoney(p.minOrderAmount)}</td>
                            <td>{fmtDate(p.expiryDate)}</td>
                            <td>{p.usedCount ?? 0}{p.maxUses ? `/${p.maxUses}` : ''}</td>
                            <td><span className={promoPillClass(p.status)}><span className="sa-dot" aria-hidden="true" />{p.status}</span>{p.disabledReason ? <><br /><small>{p.disabledReason}</small></> : null}</td>
                            <td className="sa-actions">
                              <button type="button" className="sa-icon-btn" title="Xem chi tiết khuyến mãi" aria-label={`Xem chi tiết khuyến mãi ${p.code}`} onClick={() => { setSelectedPromo(p); void viewPromoUsage(p); }}>👁</button>
                              {p.status === 'Draft' && (
                                <button type="button" className="sa-icon-btn" title="Kích hoạt khuyến mãi" aria-label={`Kích hoạt khuyến mãi ${p.code}`} onClick={() => void activatePromo(p)}>▶</button>
                              )}
                              {(p.status === 'Active' || p.status === 'Draft') && (
                                <button type="button" className="sa-icon-btn sa-icon-danger" title="Tắt khuyến mãi" aria-label={`Tắt khuyến mãi ${p.code}`} onClick={() => { setDisableTarget(p); setDisableReason(''); }}>⏻</button>
                              )}
                              <button type="button" className="sa-btn sa-btn-ghost" style={{ padding: '0.4rem 0.8rem' }} onClick={() => void viewPromoUsage(p)}>Lượt dùng</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {promoUsageFor && (
                  <div style={{ marginTop: '1rem' }}>
                    <h3>Lượt dùng của {promoUsageFor}</h3>
                    {promoUsage === null ? <p>Đang tải...</p> : promoUsage.length === 0 ? <p>Chưa có lượt dùng nào.</p> : (
                      <div className="sa-table-wrap">
                        <table>
                          <thead><tr><th>Email</th><th>Mã đơn</th><th>Giảm</th><th>Ngày dùng</th></tr></thead>
                          <tbody>
                            {promoUsage.map(u => (
                              <tr key={u.id}>
                                <td>{u.userEmail}</td>
                                <td>{u.orderDisplayCode ?? u.orderId}</td>
                                <td><span className="sa-money">{fmtMoney(u.discountAmount)}</span></td>
                                <td>{fmtDate(u.createdAt)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}

            {tab === 'customers' && (
              <section>
                <div className="sa-toolbar">
                  <input className="sa-input" placeholder="Tìm email / tên / SĐT" value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} data-testid="admin-customer-search" />
                  <select className="sa-input" value={customerTierFilter} onChange={e => setCustomerTierFilter(e.target.value)} aria-label="Lọc hạng">
                    <option value="">Tất cả hạng</option>
                    <option value="Member">Thường</option>
                    <option value="Silver">Bạc</option>
                    <option value="Gold">Vàng</option>
                    <option value="Diamond">Kim cương</option>
                  </select>
                  <button type="button" onClick={() => void loadCustomers()} className="sa-btn">Tìm</button>
                  <span className="sa-spacer" />
                  <button type="button" onClick={exportCurrentTab} className="sa-btn sa-btn-ghost">⬇ Export</button>
                </div>
                {customersLoading && <p>Đang tải khách hàng...</p>}
                {customersError && <p className="sa-error">{customersError}</p>}
                {!customersLoading && customers.length === 0 && !customersError && <p>Không có khách hàng nào.</p>}
                {customers.length > 0 && (
                  <div className="sa-table-wrap">
                    <table>
                      <thead><tr><th>Khách hàng</th><th>Điện thoại</th><th>Hạng</th><th>Chi tiêu 12 tháng</th><th>Số đơn</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
                      <tbody>
                        {customers.map(c => (
                          <tr key={c.id}>
                            <td>
                              <span className="sa-user-cell">
                                <span className="sa-avatar sa-avatar-sm" style={{ background: avatarColor(c.fullName) }}>{avatarInitial(c.fullName)}</span>
                                <span className="sa-user-cell-names"><strong>{c.fullName}</strong><small>{c.email}</small></span>
                              </span>
                            </td>
                            <td>{c.phoneNumber ?? '—'}</td>
                            <td>{TIER_LABELS[c.membershipTier ?? ''] ?? c.membershipTier ?? '—'}</td>
                            <td><span className="sa-money">{fmtMoney(c.totalSpent12m)}</span></td>
                            <td>{c.orderCount ?? 0}</td>
                            <td>{c.isLocked
                              ? <span className="sa-pill sa-pill-red"><span className="sa-dot" aria-hidden="true" />Đã khóa</span>
                              : <span className="sa-pill sa-pill-green"><span className="sa-dot" aria-hidden="true" />Bình thường</span>}</td>
                            <td className="sa-actions">
                              <button type="button" className="sa-icon-btn" title="Xem chi tiết khách hàng" aria-label={`Xem khách hàng ${c.fullName}`} onClick={() => void openCustomerDetail(c)}>👁</button>
                              {c.isLocked
                                ? <button type="button" className="sa-icon-btn" title="Mở khóa tài khoản" aria-label={`Mở khóa tài khoản ${c.fullName}`} onClick={() => void lockCustomer(c, false)}>🔓</button>
                                : <button type="button" className="sa-icon-btn sa-icon-danger" title="Khóa tài khoản" aria-label={`Khóa tài khoản ${c.fullName}`} onClick={() => void lockCustomer(c, true)}>🔒</button>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {customerDetailLoading && <p>Đang tải chi tiết khách hàng...</p>}
                {selectedCustomer && (
                  <SparkModal
                    title={`${selectedCustomer.customer.fullName} — ${selectedCustomer.customer.email}`}
                    onClose={() => setSelectedCustomer(null)}
                    footer={selectedCustomer.customer.isLocked
                      ? <button type="button" className="sa-btn" onClick={() => { void lockCustomer(selectedCustomer.customer, false); setSelectedCustomer(null); }}>Mở khóa tài khoản</button>
                      : <button type="button" className="sa-btn sa-btn-danger" onClick={() => { void lockCustomer(selectedCustomer.customer, true); setSelectedCustomer(null); }}>Khóa tài khoản</button>}
                  >
                    <div data-testid="admin-customer-detail">
                    <p>SĐT: {selectedCustomer.customer.phoneNumber ?? '—'} — Hạng: {TIER_LABELS[selectedCustomer.customer.membershipTier ?? ''] ?? selectedCustomer.customer.membershipTier ?? '—'}</p>
                    <p>Ngày tạo: {fmtDate(selectedCustomer.customer.createdAt)} — Đăng nhập gần nhất: {fmtDate(selectedCustomer.customer.lastLoginAt)}</p>
                    <h4>Đơn gần nhất</h4>
                    {(selectedCustomer.recentOrders ?? []).length === 0 ? <p>Chưa có đơn hàng.</p> : (
                      <ul className="sa-list">{selectedCustomer.recentOrders!.map((o, i) => (
                        <li key={i}>{o.orderDisplayCode ?? `#${o.orderCode}`} — {statusLabel(typeof o.status === 'string' ? o.status : String(o.status ?? ''))} — {fmtMoney(o.totalAmount)} — {fmtDate(o.createdAt)}</li>
                      ))}</ul>
                    )}
                    </div>
                  </SparkModal>
                )}
              </section>
            )}

            {tab === 'membership' && (
              <section>
                {tiersLoading && <p>Đang tải cấu hình hội viên...</p>}
                {tiersError && <p className="sa-error">{tiersError}</p>}
                {tierDraft.length > 0 && (
                  <>
                    <div className="sa-table-wrap" style={{ marginBottom: '1rem' }}>
                      <table>
                        <thead><tr><th>Hạng</th><th>Ngưỡng chi tiêu</th><th>Chi tiêu / 1 điểm</th><th>Trần dùng điểm (%)</th><th>Ngưỡng freeship</th><th>Thao tác</th></tr></thead>
                        <tbody>
                          {tierDraft.map((t, i) => (
                            <tr key={t.tier}>
                              <td>{TIER_LABELS[t.tier] ?? t.tier} ({t.tier})</td>
                              <td><input className="sa-input" type="number" min={0} value={t.minSpent} onChange={e => setTierDraft(prev => prev.map((x, j) => j === i ? { ...x, minSpent: Number(e.target.value) || 0 } : x))} aria-label={`Ngưỡng ${t.tier}`} /></td>
                              <td><input className="sa-input" type="number" min={1} value={t.spendPerPoint} onChange={e => setTierDraft(prev => prev.map((x, j) => j === i ? { ...x, spendPerPoint: Number(e.target.value) || 1 } : x))} aria-label={`Tích điểm ${t.tier}`} /></td>
                              <td><input className="sa-input" type="number" min={0} max={100} value={t.maxPointsPercent} onChange={e => setTierDraft(prev => prev.map((x, j) => j === i ? { ...x, maxPointsPercent: Number(e.target.value) || 0 } : x))} aria-label={`Trần điểm ${t.tier}`} /></td>
                              <td><input className="sa-input" type="number" min={0} value={t.freeShipThreshold ?? ''} placeholder="Không đặt" onChange={e => setTierDraft(prev => prev.map((x, j) => j === i ? { ...x, freeShipThreshold: e.target.value === '' ? null : Number(e.target.value) } : x))} aria-label={`Freeship ${t.tier}`} /></td>
                              <td className="sa-actions">
                                <button type="button" className="sa-icon-btn" title="Xem chi tiết hạng" aria-label={`Xem chi tiết hạng ${TIER_LABELS[t.tier] ?? t.tier}`} onClick={() => setSelectedTier(t)}>👁</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="sa-muted-text">Lưu ý: ngưỡng chi tiêu phải tăng dần theo thứ tự Thường → Bạc → Vàng → Kim cương; thay đổi chỉ áp dụng cho đơn phát sinh sau thời điểm sửa.</p>
                    <button type="button" onClick={() => void saveTiers()} className="sa-btn">Lưu cấu hình hạng</button>
                  </>
                )}
                <h3 className="sa-section-title" style={{ marginTop: '2rem' }}>Điều chỉnh điểm cho 1 khách</h3>
                <form onSubmit={adjustPoints} className="sa-card" style={{ maxWidth: 560 }} data-testid="admin-adjust-points-form">
                  {adjustError && <p className="sa-error">{adjustError}</p>}
                  <div className="sa-form-grid">
                    <label className="sa-field"><span>Email hoặc ID khách hàng</span>
                      <input className="sa-input" value={adjustId} onChange={e => setAdjustId(e.target.value)} data-testid="admin-adjust-user-input" />
                    </label>
                    <label className="sa-field"><span>Số điểm (dương = cộng, âm = trừ; tối đa 1000/lần)</span>
                      <input className="sa-input" type="number" value={adjustPointsValue} onChange={e => setAdjustPointsValue(e.target.value)} data-testid="admin-adjust-points-input" />
                    </label>
                    <label className="sa-field"><span>Lý do (bắt buộc)</span>
                      <input className="sa-input" value={adjustReason} onChange={e => setAdjustReason(e.target.value)} data-testid="admin-adjust-reason-input" />
                    </label>
                  </div>
                  <div className="sa-form-actions">
                    <button type="submit" disabled={adjustBusy} className="sa-btn" data-testid="admin-adjust-points-btn">Điều chỉnh điểm</button>
                  </div>
                </form>
              </section>
            )}

            {tab === 'returns' && (
              <section>
                <div className="sa-toolbar">
                  <input className="sa-input" placeholder="Tìm mã đơn / sản phẩm / lý do" value={returnSearch} onChange={e => setReturnSearch(e.target.value)} aria-label="Tìm yêu cầu trả hàng" />
                  <select className="sa-input" value={returnStatusFilter} onChange={e => setReturnStatusFilter(e.target.value)} aria-label="Lọc trạng thái trả hàng">
                    <option value="">Tất cả trạng thái</option>
                    <option value="Pending">Chờ duyệt</option>
                    <option value="Approved">Đã duyệt</option>
                    <option value="Rejected">Đã từ chối</option>
                  </select>
                  <button type="button" onClick={() => void loadReturns()} className="sa-btn">Lọc</button>
                  <span className="sa-spacer" />
                  <button type="button" onClick={exportCurrentTab} className="sa-btn sa-btn-ghost">⬇ Export</button>
                </div>
                {returnsLoading && <p>Đang tải yêu cầu trả hàng...</p>}
                {returnsError && <p className="sa-error">{returnsError}</p>}
                {!returnsLoading && filteredReturns.length === 0 && !returnsError && <p>Không có yêu cầu trả hàng nào.</p>}
                {filteredReturns.length > 0 && (
                  <div className="sa-table-wrap">
                    <table>
                      <thead><tr><th>Mã đơn</th><th>Sản phẩm</th><th>SL</th><th>Lý do</th><th>Trạng thái</th><th>Hoàn tiền</th><th>Thao tác</th></tr></thead>
                      <tbody>
                        {filteredReturns.map(r => (
                          <tr key={r.id}>
                            <td><span className="sa-code">{r.orderDisplayCode ?? r.orderId}</span></td>
                            <td>{r.productName}</td>
                            <td>{r.quantity}</td>
                            <td>{r.reason}{r.note ? <><br /><small>{r.note}</small></> : null}</td>
                            <td><span className={returnPillClass(r.status)}><span className="sa-dot" aria-hidden="true" />{r.status}</span>{r.adminNote ? <><br /><small>{r.adminNote}</small></> : null}</td>
                            <td>{r.refundStatus ?? '—'}{r.refundAmount ? <><br /><small>{fmtMoney(r.refundAmount)}</small></> : null}</td>
                            <td className="sa-actions">
                              {r.status === 'Pending' && (
                                <button type="button" className="sa-btn sa-btn-ghost" style={{ padding: '0.4rem 0.8rem' }} onClick={() => { setReturnTarget(r); setReturnNote(''); }}>Duyệt / Từ chối</button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {returnTarget && (
                  <SparkModal
                    testid="admin-return-detail"
                    title={`Chi tiết trả hàng — ${returnTarget.orderDisplayCode ?? returnTarget.orderId}`}
                    onClose={() => { setReturnTarget(null); setReturnNote(''); }}
                  >
                    <div data-testid="admin-return-resolve">
                      <KvRow label="Sản phẩm" value={<strong>{returnTarget.productName} × {returnTarget.quantity}</strong>} />
                      <KvRow label="Mã đơn" value={returnTarget.orderDisplayCode ?? returnTarget.orderId} />
                      <KvRow label="Lý do khách" value={returnTarget.reason} />
                      {returnTarget.note && <KvRow label="Ghi chú khách" value={returnTarget.note} />}
                      <KvRow label="Số tiền hoàn" value={returnTarget.refundAmount ? fmtMoney(returnTarget.refundAmount) : '—'} />
                      <KvRow label="Trạng thái hoàn tiền" value={returnTarget.refundStatus ?? '—'} />
                      <KvRow label="Trạng thái" value={<span className={returnPillClass(returnTarget.status)}><span className="sa-dot" aria-hidden="true" />{returnTarget.status}</span>} />
                      {returnTarget.adminNote && <KvRow label="Ghi chú admin" value={returnTarget.adminNote} />}
                    <p className="sa-muted-text">Duyệt: hoàn kho + tạo bản ghi hoàn tiền “Chờ hoàn tiền”. Từ chối: bắt buộc ghi lý do, đơn quay về Đã giao.</p>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <input className="sa-input" style={{ maxWidth: 420 }} placeholder="Ghi chú admin (từ chối bắt buộc nhập lý do)" value={returnNote} onChange={e => setReturnNote(e.target.value)} data-testid="admin-return-note-input" />
                      <button type="button" onClick={() => void resolveReturn(true)} className="sa-btn">Duyệt</button>
                      <button type="button" onClick={() => void resolveReturn(false)} className="sa-btn sa-btn-danger">Từ chối</button>
                      <button type="button" onClick={() => { setReturnTarget(null); setReturnNote(''); }} className="sa-btn sa-btn-ghost">Hủy</button>
                    </div>
                    </div>
                  </SparkModal>
                )}
                <p className="sa-muted-text" style={{ marginTop: '1rem' }}>Ghi nhận đã hoàn tiền (POST /api/admin/refunds/{'{id}'}/record) cần ID bản ghi hoàn tiền — DTO yêu cầu trả hàng chỉ trả trạng thái/số tiền hoàn, không trả refundId nên mục này chưa gắn nút; admin ghi nhận sau khi có mã giao dịch hoàn qua API.</p>

                <h2 className="sa-section-title" style={{ marginTop: '2rem' }}>Nhật ký hệ thống (audit-log)</h2>
                <div className="sa-toolbar">
                  <input className="sa-input" placeholder="Tìm người thực hiện / hành động" value={auditSearch} onChange={e => setAuditSearch(e.target.value)} aria-label="Tìm nhật ký" />
                  <button type="button" onClick={() => void loadAudit()} className="sa-btn sa-btn-ghost">Tải lại nhật ký</button>
                </div>
                {auditLoading && <p>Đang tải nhật ký...</p>}
                {auditError && <p className="sa-error">{auditError}</p>}
                {!auditLoading && filteredAudit.length === 0 && !auditError && <p>Chưa có nhật ký.</p>}
                {filteredAudit.length > 0 && (
                  <div className="sa-table-wrap">
                    <table>
                      <thead><tr><th>Thời gian</th><th>Người thực hiện</th><th>Hành động</th><th>Đối tượng</th></tr></thead>
                      <tbody>
                        {filteredAudit.map(a => (
                          <tr key={a.id}>
                            <td>{fmtDate(a.createdAt)}</td>
                            <td>{a.actorEmail}</td>
                            <td>{a.action}</td>
                            <td>{a.entityType ?? '—'}{a.entityId ? ` (${String(a.entityId).slice(0, 8)}…)` : ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}
            {selectedProduct && (
              <SparkModal
                testid="admin-product-detail"
                title={selectedProduct.name}
                onClose={() => setSelectedProduct(null)}
                footer={(
                  <button
                    type="button"
                    className="sa-btn"
                    onClick={() => {
                      const p = selectedProduct;
                      setProductForm({ id: p.id, name: p.name, categoryId: p.categoryId, price: String(p.price), originalPrice: p.originalPrice ? String(p.originalPrice) : '', stock: String(p.availableStock ?? 0), description: p.description ?? '', imageUrl: p.imageUrl ?? '', isActive: true });
                      setProductFormError(null); setProductFormOpen(true); setSelectedProduct(null);
                    }}
                  >
                    Sửa sản phẩm
                  </button>
                )}
              >
                {selectedProduct.imageUrl && <img src={selectedProduct.imageUrl} alt={selectedProduct.name} className="sa-modal-img" />}
                <KvRow label="Danh mục" value={selectedProduct.categoryName ?? '—'} />
                <KvRow label="Giá bán" value={<span className="sa-money">{fmtMoney(selectedProduct.price)}</span>} />
                <KvRow label="Giá gốc" value={selectedProduct.originalPrice ? fmtMoney(selectedProduct.originalPrice) : '—'} />
                <KvRow label="Tồn kho" value={selectedProduct.availableStock ?? '—'} />
                <KvRow label="Đánh giá" value={selectedProduct.rating != null ? `★ ${selectedProduct.rating} (${selectedProduct.reviewCount ?? 0} đánh giá)` : '—'} />
                <KvRow label="Mô tả" value={selectedProduct.description ?? '—'} />
              </SparkModal>
            )}

            {selectedCategory && (
              <SparkModal
                testid="admin-category-detail"
                title={selectedCategory.name}
                onClose={() => setSelectedCategory(null)}
                footer={(
                  <button
                    type="button"
                    className="sa-btn"
                    onClick={() => {
                      const c = selectedCategory;
                      setCatForm({ id: c.id, name: c.name, description: c.description ?? '', sortOrder: String(c.sortOrder ?? 0), isActive: c.isActive });
                      setCatFormError(null); setCatFormOpen(true); setSelectedCategory(null);
                    }}
                  >
                    Sửa danh mục
                  </button>
                )}
              >
                <KvRow label="Slug" value={selectedCategory.slug ?? '—'} />
                <KvRow label="Mô tả" value={selectedCategory.description ?? '—'} />
                <KvRow label="Số sản phẩm" value={selectedCategory.productCount ?? 0} />
                <KvRow label="Thứ tự" value={selectedCategory.sortOrder ?? 0} />
                <KvRow label="Trạng thái" value={selectedCategory.isActive
                  ? <span className="sa-pill sa-pill-green"><span className="sa-dot" aria-hidden="true" />Đang hiển thị</span>
                  : <span className="sa-pill sa-pill-gray"><span className="sa-dot" aria-hidden="true" />Đã ẩn</span>} />
              </SparkModal>
            )}

            {selectedPromo && (
              <SparkModal
                testid="admin-promo-detail"
                title={`Khuyến mãi ${selectedPromo.code}`}
                onClose={() => setSelectedPromo(null)}
                footer={(
                  <>
                    {selectedPromo.status === 'Draft' && (
                      <button type="button" className="sa-btn" onClick={() => { void activatePromo(selectedPromo); setSelectedPromo(null); }}>Kích hoạt</button>
                    )}
                    {(selectedPromo.status === 'Active' || selectedPromo.status === 'Draft') && (
                      <button type="button" className="sa-btn sa-btn-danger" onClick={() => { setDisableTarget(selectedPromo); setDisableReason(''); setSelectedPromo(null); }}>Tắt khuyến mãi</button>
                    )}
                  </>
                )}
              >
                <KvRow label="Mô tả" value={selectedPromo.description ?? '—'} />
                <KvRow label="Loại giảm" value={selectedPromo.discountType} />
                <KvRow label="Giá trị" value={selectedPromo.discountType === 'Percentage' ? `${selectedPromo.discountValue}%` : selectedPromo.discountType === 'FreeShip' ? 'Freeship' : fmtMoney(selectedPromo.discountValue)} />
                <KvRow label="Đơn tối thiểu" value={fmtMoney(selectedPromo.minOrderAmount)} />
                <KvRow label="Giảm tối đa" value={selectedPromo.maxDiscountAmount != null ? fmtMoney(selectedPromo.maxDiscountAmount) : '—'} />
                <KvRow label="Đã dùng" value={`${selectedPromo.usedCount ?? 0}${selectedPromo.maxUses ? `/${selectedPromo.maxUses}` : ''}`} />
                <KvRow label="Ngày bắt đầu" value={selectedPromo.startDate ? fmtDate(selectedPromo.startDate) : '—'} />
                <KvRow label="Ngày hết hạn" value={selectedPromo.expiryDate ? fmtDate(selectedPromo.expiryDate) : '—'} />
                <KvRow label="Hạng áp dụng" value={selectedPromo.minTier ? `Hạng ${TIER_LABELS[selectedPromo.minTier] ?? selectedPromo.minTier} trở lên` : 'Mọi hạng'} />
                <KvRow label="Trạng thái" value={<span className={promoPillClass(selectedPromo.status)}><span className="sa-dot" aria-hidden="true" />{selectedPromo.status}</span>} />
                {selectedPromo.disabledReason && <KvRow label="Lý do tắt" value={selectedPromo.disabledReason} />}
                <h4>Lượt dùng</h4>
                {promoUsage === null ? <p>Đang tải...</p> : promoUsage.length === 0 ? <p>Chưa có lượt dùng nào.</p> : (
                  <div className="sa-table-wrap">
                    <table>
                      <thead><tr><th>Email</th><th>Mã đơn</th><th>Giảm</th><th>Ngày dùng</th></tr></thead>
                      <tbody>
                        {promoUsage.map(u => (
                          <tr key={u.id}>
                            <td>{u.userEmail}</td>
                            <td>{u.orderDisplayCode ?? u.orderId}</td>
                            <td><span className="sa-money">{fmtMoney(u.discountAmount)}</span></td>
                            <td>{fmtDate(u.createdAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </SparkModal>
            )}

            {selectedTier && (
              <SparkModal
                testid="admin-tier-detail"
                title={`Hạng ${TIER_LABELS[selectedTier.tier] ?? selectedTier.tier}`}
                onClose={() => setSelectedTier(null)}
              >
                <KvRow label="Mã hạng" value={selectedTier.tier} />
                <KvRow label="Ngưỡng chi tiêu" value={fmtMoney(selectedTier.minSpent)} />
                <KvRow label="Chi tiêu / 1 điểm" value={fmtMoney(selectedTier.spendPerPoint)} />
                <KvRow label="Trần dùng điểm" value={`${selectedTier.maxPointsPercent}%`} />
                <KvRow label="Ngưỡng freeship" value={selectedTier.freeShipThreshold != null ? fmtMoney(selectedTier.freeShipThreshold) : 'Không đặt'} />
                <p className="sa-muted-text">Ngưỡng chi tiêu tăng dần theo thứ tự Thường → Bạc → Vàng → Kim cương.</p>
              </SparkModal>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
