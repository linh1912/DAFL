import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { apiJson } from '../../utils/api';

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
const PINK = '#d81b60';
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

const inputStyle: React.CSSProperties = { fontSize: '1rem', padding: '0.55rem 0.7rem', border: '1px solid #d7d7d7', borderRadius: 8, width: '100%', boxSizing: 'border-box' };
const btnStyle: React.CSSProperties = { fontSize: '1rem', padding: '0.55rem 1rem', borderRadius: 8, border: `1px solid ${PINK}`, background: PINK, color: '#fff', cursor: 'pointer' };
const btnGhostStyle: React.CSSProperties = { ...btnStyle, background: '#fff', color: PINK };
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '0.6rem', borderBottom: `2px solid ${PINK}`, fontSize: '1rem' };
const tdStyle: React.CSSProperties = { padding: '0.6rem', borderBottom: '1px solid #eee', fontSize: '1rem', verticalAlign: 'top' };

type Tab = 'dashboard' | 'orders' | 'products' | 'categories' | 'promotions' | 'customers' | 'membership' | 'returns';
const NAV: Array<{ key: Tab; label: string; testid: string }> = [
  { key: 'dashboard', label: 'Tổng quan', testid: 'admin-nav-dashboard' },
  { key: 'orders', label: 'Đơn hàng', testid: 'admin-nav-orders' },
  { key: 'products', label: 'Sản phẩm', testid: 'admin-nav-products' },
  { key: 'categories', label: 'Danh mục', testid: 'admin-nav-categories' },
  { key: 'promotions', label: 'Khuyến mãi', testid: 'admin-nav-promotions' },
  { key: 'customers', label: 'Khách hàng', testid: 'admin-nav-customers' },
  { key: 'membership', label: 'Hội viên', testid: 'admin-nav-membership' },
  { key: 'returns', label: 'Trả hàng / Nhật ký', testid: 'admin-nav-returns' },
];

export default function AdminPage() {
  const [gate, setGate] = useState<'checking' | 'ok' | 'forbidden' | 'no-admin' | 'unauthorized'>('checking');
  const [gateMsg, setGateMsg] = useState('');
  const [profile, setProfile] = useState<AdminProfile | null>(null);
  const [tab, setTab] = useState<Tab>('dashboard');
  const [notice, setNotice] = useState<string | null>(null);
  const loadedRef = useRef<Set<Tab>>(new Set());

  // Tổng quan
  const [dash, setDash] = useState<DashboardData | null>(null);
  const [dashLoading, setDashLoading] = useState(false);
  const [dashError, setDashError] = useState<string | null>(null);

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
  const [productForm, setProductForm] = useState({ id: '', name: '', categoryId: '', price: '', originalPrice: '', stock: '', description: '', imageUrl: '', isActive: true });
  const [productFormOpen, setProductFormOpen] = useState(false);
  const [productFormError, setProductFormError] = useState<string | null>(null);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [catsLoading, setCatsLoading] = useState(false);
  const [catsError, setCatsError] = useState<string | null>(null);
  const [catForm, setCatForm] = useState({ id: '', name: '', description: '', sortOrder: '0', isActive: true });
  const [catFormOpen, setCatFormOpen] = useState(false);
  const [catFormError, setCatFormError] = useState<string | null>(null);

  // Khuyến mãi
  const [promos, setPromos] = useState<Promotion[]>([]);
  const [promosLoading, setPromosLoading] = useState(false);
  const [promosError, setPromosError] = useState<string | null>(null);
  const [promoStatusFilter, setPromoStatusFilter] = useState('');
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
  const [returnNote, setReturnNote] = useState('');
  const [returnTarget, setReturnTarget] = useState<ReturnReq | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);

  // ---------- Bảo vệ: xác định quyền admin ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { status, body } = await apiJson<AdminProfile>('/api/admin/profile', { skipAuthHandler: true });
      if (cancelled) return;
      if (status === 401) { setGate('unauthorized'); return; }
      if (status === 403) { setGateMsg(body?.message || 'Bạn không có quyền truy cập trang quản trị.'); setGate('forbidden'); return; }
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
    if (tab === 'dashboard' && !loadedRef.current.has('dashboard')) { loadedRef.current.add('dashboard'); void loadDashboard(); }
    if (tab === 'orders' && !loadedRef.current.has('orders')) { loadedRef.current.add('orders'); void loadOrders(); }
    if (tab === 'products' && !loadedRef.current.has('products')) { loadedRef.current.add('products'); void loadProducts(); void loadCategories(); }
    if (tab === 'categories' && !loadedRef.current.has('categories')) { loadedRef.current.add('categories'); void loadCategories(); }
    if (tab === 'promotions' && !loadedRef.current.has('promotions')) { loadedRef.current.add('promotions'); void loadPromos(); void loadCategories(); }
    if (tab === 'customers' && !loadedRef.current.has('customers')) { loadedRef.current.add('customers'); void loadCustomers(); }
    if (tab === 'membership' && !loadedRef.current.has('membership')) { loadedRef.current.add('membership'); void loadTiers(); }
    if (tab === 'returns' && !loadedRef.current.has('returns')) { loadedRef.current.add('returns'); void loadReturns(); void loadAudit(); }
  }, [tab, gate, loadDashboard, loadOrders, loadProducts, loadCategories, loadPromos, loadCustomers, loadTiers, loadReturns, loadAudit]);

  // ---------- Gate ----------
  if (gate === 'checking') return <div style={{ padding: '2rem', fontSize: '1.1rem' }} data-testid="admin-page">Đang kiểm tra quyền...</div>;
  if (gate === 'unauthorized') return <Navigate to="/login" replace />;
  if (gate === 'forbidden') {
    return (
      <div style={{ padding: '2rem', fontSize: '1.1rem' }} data-testid="admin-forbidden">
        <h1 style={{ fontSize: '2.2rem', color: PINK }}>Bạn không có quyền truy cập trang quản trị</h1>
        <p>{gateMsg || 'Chỉ tài khoản Super Admin mới được vào khu vực này.'}</p>
        <a href="/" style={{ color: PINK }}>Về trang chủ</a>
      </div>
    );
  }
  if (gate === 'no-admin') {
    return (
      <div style={{ padding: '2rem', fontSize: '1.1rem' }} data-testid="admin-page">
        <h1 style={{ fontSize: '2.2rem', color: PINK }}>Chưa có tài khoản Super Admin</h1>
        <p>{gateMsg}</p>
        <p>Đăng nhập bằng tài khoản của bạn rồi chạy SQL:</p>
        <pre style={{ background: '#f5f5f5', padding: '1rem', overflowX: 'auto' }}>
          {`UPDATE "Users" SET "Role"='SuperAdmin' WHERE "Email"='email-cua-ban';`}
        </pre>
        <p>Sau đó đăng nhập lại.</p>
        <a href="/" style={{ color: PINK }}>Về trang chủ</a>
      </div>
    );
  }

  const filteredProducts = products.filter(p =>
    (!productCatFilter || p.categoryId === productCatFilter) &&
    (!productSearch.trim() || p.name.toLowerCase().includes(productSearch.trim().toLowerCase()))
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

  const byStatus = dash?.ordersByStatus ?? {};
  const statCards = [
    { label: 'Doanh thu hôm nay', value: fmtMoney(dash?.revenueToday) },
    { label: 'Doanh thu tháng này', value: fmtMoney(dash?.revenueThisMonth) },
    { label: 'Đơn chờ xử lý', value: String(dash?.pendingOrders ?? 0) },
    { label: 'Khách mới 30 ngày', value: String(dash?.newCustomers30d ?? 0) },
  ];

  return (
    <div data-testid="admin-page" style={{ fontSize: '1.05rem', padding: '1.5rem', maxWidth: 1200, margin: '0 auto' }}>
      <h1 style={{ fontSize: '2.2rem', color: PINK, margin: '0 0 0.25rem' }}>Trang quản trị DAFL</h1>
      <p style={{ margin: '0 0 1.5rem', color: '#555' }}>
        Xin chào, {profile?.fullName ?? profile?.email} ({profile?.email}) — vai trò {profile?.role}
      </p>
      {notice && (
        <div style={{ background: '#e8f5e9', border: '1px solid #a5d6a7', padding: '0.75rem 1rem', borderRadius: 8, marginBottom: '1rem' }}>
          {notice} <button type="button" onClick={() => setNotice(null)} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
        </div>
      )}
      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>
        <nav aria-label="Menu quản trị" style={{ minWidth: 220, border: `1px solid ${PINK}`, borderRadius: 12, padding: '0.75rem', position: 'sticky', top: 16 }}>
          {NAV.map(item => (
            <button
              key={item.key}
              type="button"
              data-testid={item.testid}
              onClick={() => { setTab(item.key); setNotice(null); }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', fontSize: '1.05rem', padding: '0.7rem 0.9rem',
                marginBottom: 4, borderRadius: 8, cursor: 'pointer',
                border: 'none', background: tab === item.key ? PINK : 'transparent',
                color: tab === item.key ? '#fff' : '#222', fontWeight: tab === item.key ? 700 : 400,
              }}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <main style={{ flex: 1, minWidth: 0 }}>
          {tab === 'dashboard' && (
            <section>
              <h2 style={{ fontSize: '1.6rem' }}>Tổng quan</h2>
              {dashLoading && <p>Đang tải tổng quan...</p>}
              {dashError && <p style={{ color: '#c62828' }}>{dashError}</p>}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                {statCards.map(c => (
                  <div key={c.label} style={{ border: '1px solid #eee', borderRadius: 12, padding: '1rem', background: '#fff' }}>
                    <div style={{ color: '#666', fontSize: '1rem' }}>{c.label}</div>
                    <div style={{ fontSize: '1.6rem', fontWeight: 700, color: PINK }}>{c.value}</div>
                  </div>
                ))}
              </div>
              <h3 style={{ fontSize: '1.3rem' }}>Đơn hàng theo trạng thái</h3>
              {Object.keys(byStatus).length === 0 && !dashLoading ? <p>Chưa có đơn hàng.</p> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    {Object.entries(byStatus).map(([s, n]) => (
                      <tr key={s}><td style={tdStyle}>{statusLabel(s)}</td><td style={tdStyle}>{n}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
              <h3 style={{ fontSize: '1.3rem' }}>Sản phẩm sắp hết hàng</h3>
              {(dash?.lowStockProducts ?? []).length === 0 ? <p>Không có sản phẩm sắp hết hàng.</p> : (
                <ul>{dash!.lowStockProducts!.map(p => <li key={p.id}>{p.name} — còn {p.stock}</li>)}</ul>
              )}
              <h3 style={{ fontSize: '1.3rem' }}>Voucher sắp hết lượt</h3>
              {(dash?.expiringVouchers ?? []).length === 0 ? <p>Không có voucher sắp hết lượt.</p> : (
                <ul>{dash!.expiringVouchers!.map(v => (
                  <li key={v.code}>{v.code} — đã dùng {v.usedCount}{v.maxUses ? `/${v.maxUses}` : ''}{v.expiryDate ? `, hết hạn ${fmtDate(v.expiryDate)}` : ''}</li>
                ))}</ul>
              )}
              <button type="button" onClick={() => void loadDashboard()} style={{ ...btnGhostStyle, marginTop: '1rem' }}>Tải lại</button>
            </section>
          )}

          {tab === 'orders' && (
            <section>
              <h2 style={{ fontSize: '1.6rem' }}>Đơn hàng</h2>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                <input style={{ ...inputStyle, maxWidth: 320 }} placeholder="Tìm mã đơn / tên khách / email" value={orderSearch} onChange={e => setOrderSearch(e.target.value)} data-testid="admin-order-search" />
                <select style={{ ...inputStyle, maxWidth: 220 }} value={orderStatusFilter} onChange={e => setOrderStatusFilter(e.target.value)} data-testid="admin-order-status-filter" aria-label="Lọc trạng thái">
                  <option value="">Tất cả trạng thái</option>
                  {ORDER_STATUSES.map(s => <option key={s} value={s}>{ORDER_STATUS_LABELS[s]}</option>)}
                </select>
                <button type="button" onClick={() => void loadOrders()} style={btnStyle}>Tìm</button>
              </div>
              {ordersLoading && <p>Đang tải đơn hàng...</p>}
              {ordersError && <p style={{ color: '#c62828' }}>{ordersError}</p>}
              {!ordersLoading && orders.length === 0 && !ordersError && <p>Không có đơn hàng nào.</p>}
              {orders.length > 0 && (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={thStyle}>Mã đơn</th><th style={thStyle}>Khách hàng</th><th style={thStyle}>Trạng thái</th><th style={thStyle}>Thanh toán</th><th style={thStyle}>Tổng tiền</th><th style={thStyle}>Ngày đặt</th></tr></thead>
                  <tbody>
                    {orders.map(o => (
                      <tr key={o.id} onClick={() => void openOrderDetail(o.id)} style={{ cursor: 'pointer' }} data-testid={`admin-order-row-${o.id}`}>
                        <td style={tdStyle}>{o.orderDisplayCode ?? `#${o.orderCode}`}</td>
                        <td style={tdStyle}>{o.customerName}<br /><small>{o.customerEmail}</small></td>
                        <td style={tdStyle}>{o.statusLabel ?? statusLabel(o.status)}</td>
                        <td style={tdStyle}>{o.paymentMethod}</td>
                        <td style={tdStyle}>{fmtMoney(o.totalAmount)}</td>
                        <td style={tdStyle}>{fmtDate(o.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {orderDetailLoading && <p>Đang tải chi tiết đơn...</p>}
              {orderDetailError && <p style={{ color: '#c62828' }}>{orderDetailError}</p>}
              {selectedOrder && (
                <div style={{ border: `1px solid ${PINK}`, borderRadius: 12, padding: '1rem', marginTop: '1rem' }} data-testid="admin-order-detail">
                  <h3 style={{ fontSize: '1.3rem', marginTop: 0 }}>
                    Đơn {selectedOrder.order.orderDisplayCode ?? `#${selectedOrder.order.orderCode}`} — {selectedOrder.order.statusLabel ?? statusLabel(selectedOrder.order.status)}
                  </h3>
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
                  <ul>{(selectedOrder.order.items ?? []).map(i => <li key={i.id}>{i.productName} × {i.quantity} — {fmtMoney(i.unitPrice)}</li>)}</ul>
                  <h4>Lịch sử trạng thái</h4>
                  {(selectedOrder.order.statusHistories ?? []).length === 0 ? <p>Chưa có lịch sử trạng thái.</p> : (
                    <ul>{selectedOrder.order.statusHistories!.map((h, idx) => (
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
                        <select style={{ ...inputStyle, maxWidth: 260 }} value={nextStatus} onChange={e => setNextStatus(e.target.value)} data-testid="admin-order-status-select" aria-label="Trạng thái mới">
                          <option value="">— Chọn trạng thái đích —</option>
                          {targets.map(s => <option key={s} value={s}>{ORDER_STATUS_LABELS[s] ?? s}</option>)}
                        </select>
                        {nextStatus === 'Shipping' && (
                          <>
                            <input style={{ ...inputStyle, maxWidth: 200 }} placeholder="Đơn vị vận chuyển" value={shipCarrier} onChange={e => setShipCarrier(e.target.value)} data-testid="admin-order-carrier-input" />
                            <input style={{ ...inputStyle, maxWidth: 220 }} placeholder="Mã vận đơn (6–30 ký tự)" value={shipTracking} onChange={e => setShipTracking(e.target.value)} data-testid="admin-order-tracking-input" />
                          </>
                        )}
                        <input style={{ ...inputStyle, maxWidth: 260 }} placeholder="Ghi chú (không bắt buộc)" value={statusNote} onChange={e => setStatusNote(e.target.value)} />
                        <button type="button" onClick={() => void changeOrderStatus()} disabled={!nextStatus || orderBusy} style={btnStyle}>Đổi trạng thái</button>
                      </div>
                    );
                  })()}
                  {['Pending', 'Paid', 'Confirmed', 'Preparing'].includes(statusName(selectedOrder.order.status)) && (
                    <div style={{ marginTop: '1rem' }}>
                      <h4>Hủy đơn (bắt buộc lý do)</h4>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <input style={{ ...inputStyle, maxWidth: 420 }} placeholder="Lý do hủy đơn" value={cancelReason} onChange={e => setCancelReason(e.target.value)} data-testid="admin-order-cancel-reason" />
                        <button type="button" onClick={() => void cancelOrder()} disabled={orderBusy} style={{ ...btnStyle, background: '#c62828', borderColor: '#c62828' }} data-testid="admin-order-cancel-btn">Hủy đơn</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {tab === 'products' && (
            <section>
              <h2 style={{ fontSize: '1.6rem' }}>Sản phẩm</h2>
              <p style={{ color: '#666' }}>Danh sách lấy từ GET /api/products công khai (chỉ sản phẩm đang bán). Sản phẩm đã ẩn/xóa mềm không hiện ở đây vì backend chưa có endpoint list SP riêng cho admin.</p>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                <input style={{ ...inputStyle, maxWidth: 320 }} placeholder="Tìm tên sản phẩm" value={productSearch} onChange={e => setProductSearch(e.target.value)} data-testid="admin-product-search" />
                <select style={{ ...inputStyle, maxWidth: 240 }} value={productCatFilter} onChange={e => setProductCatFilter(e.target.value)} aria-label="Lọc danh mục">
                  <option value="">Tất cả danh mục</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button type="button" onClick={() => { setProductForm({ id: '', name: '', categoryId: categories[0]?.id ?? '', price: '', originalPrice: '', stock: '', description: '', imageUrl: '', isActive: true }); setProductFormError(null); setProductFormOpen(true); }} style={btnStyle} data-testid="admin-product-add-btn">+ Thêm sản phẩm</button>
                <button type="button" onClick={() => void loadProducts()} style={btnGhostStyle}>Tải lại</button>
              </div>
              {productsLoading && <p>Đang tải sản phẩm...</p>}
              {productsError && <p style={{ color: '#c62828' }}>{productsError}</p>}
              {productFormOpen && (
                <form onSubmit={saveProduct} style={{ border: `1px solid ${PINK}`, borderRadius: 12, padding: '1rem', marginBottom: '1rem' }} data-testid="admin-product-form">
                  <h3 style={{ marginTop: 0 }}>{productForm.id ? 'Sửa sản phẩm' : 'Thêm sản phẩm'}</h3>
                  {productFormError && <p style={{ color: '#c62828' }}>{productFormError}</p>}
                  <div style={{ display: 'grid', gap: '0.6rem' }}>
                    <input style={inputStyle} placeholder="Tên sản phẩm (3–120 ký tự)" value={productForm.name} onChange={e => setProductForm({ ...productForm, name: e.target.value })} data-testid="admin-product-name-input" />
                    <select style={inputStyle} value={productForm.categoryId} onChange={e => setProductForm({ ...productForm, categoryId: e.target.value })} data-testid="admin-product-category-select" aria-label="Danh mục">
                      <option value="">— Chọn danh mục —</option>
                      {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <input style={inputStyle} type="number" min={1} placeholder="Giá bán (> 0)" value={productForm.price} onChange={e => setProductForm({ ...productForm, price: e.target.value })} data-testid="admin-product-price-input" />
                    <input style={inputStyle} type="number" min={0} placeholder="Giá gốc (lớn hơn giá bán, không bắt buộc)" value={productForm.originalPrice} onChange={e => setProductForm({ ...productForm, originalPrice: e.target.value })} />
                    <input style={inputStyle} type="number" min={0} placeholder="Tồn kho (≥ 0)" value={productForm.stock} onChange={e => setProductForm({ ...productForm, stock: e.target.value })} data-testid="admin-product-stock-input" />
                    <input style={inputStyle} placeholder="Ảnh URL" value={productForm.imageUrl} onChange={e => setProductForm({ ...productForm, imageUrl: e.target.value })} />
                    <textarea style={inputStyle} placeholder="Mô tả" value={productForm.description} onChange={e => setProductForm({ ...productForm, description: e.target.value })} />
                    {productForm.id && (
                      <label><input type="checkbox" checked={productForm.isActive} onChange={e => setProductForm({ ...productForm, isActive: e.target.checked })} /> Đang hiển thị</label>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                    <button type="submit" style={btnStyle} data-testid="admin-product-save-btn">Lưu</button>
                    <button type="button" onClick={() => setProductFormOpen(false)} style={btnGhostStyle}>Đóng</button>
                  </div>
                </form>
              )}
              {!productsLoading && filteredProducts.length === 0 && !productsError && <p>Không có sản phẩm nào.</p>}
              {filteredProducts.length > 0 && (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={thStyle}>Tên</th><th style={thStyle}>Danh mục</th><th style={thStyle}>Giá</th><th style={thStyle}>Tồn kho</th><th style={thStyle}>Thao tác</th></tr></thead>
                  <tbody>
                    {filteredProducts.map(p => (
                      <tr key={p.id}>
                        <td style={tdStyle}>{p.name}</td>
                        <td style={tdStyle}>{p.categoryName ?? '—'}</td>
                        <td style={tdStyle}>{fmtMoney(p.price)}{p.originalPrice ? <><br /><small><s>{fmtMoney(p.originalPrice)}</s></small></> : null}</td>
                        <td style={tdStyle}>{p.availableStock ?? '—'}</td>
                        <td style={tdStyle}>
                          <button type="button" style={{ ...btnGhostStyle, marginRight: 6 }} onClick={() => {
                            setProductForm({ id: p.id, name: p.name, categoryId: p.categoryId, price: String(p.price), originalPrice: p.originalPrice ? String(p.originalPrice) : '', stock: String(p.availableStock ?? 0), description: p.description ?? '', imageUrl: p.imageUrl ?? '', isActive: true });
                            setProductFormError(null); setProductFormOpen(true);
                          }}>Sửa</button>
                          <button type="button" style={{ ...btnStyle, background: '#c62828', borderColor: '#c62828' }} onClick={() => void deleteProduct(p)}>Xóa</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          )}

          {tab === 'categories' && (
            <section>
              <h2 style={{ fontSize: '1.6rem' }}>Danh mục</h2>
              <button type="button" onClick={() => { setCatForm({ id: '', name: '', description: '', sortOrder: '0', isActive: true }); setCatFormError(null); setCatFormOpen(true); }} style={{ ...btnStyle, marginBottom: '1rem' }} data-testid="admin-category-add-btn">+ Thêm danh mục</button>
              <button type="button" onClick={() => void loadCategories()} style={{ ...btnGhostStyle, marginBottom: '1rem', marginLeft: '0.5rem' }}>Tải lại</button>
              {catsLoading && <p>Đang tải danh mục...</p>}
              {catsError && <p style={{ color: '#c62828' }}>{catsError}</p>}
              {catFormOpen && (
                <form onSubmit={saveCategory} style={{ border: `1px solid ${PINK}`, borderRadius: 12, padding: '1rem', marginBottom: '1rem' }} data-testid="admin-category-form">
                  <h3 style={{ marginTop: 0 }}>{catForm.id ? 'Sửa danh mục' : 'Thêm danh mục'}</h3>
                  {catFormError && <p style={{ color: '#c62828' }}>{catFormError}</p>}
                  <div style={{ display: 'grid', gap: '0.6rem' }}>
                    <input style={inputStyle} placeholder="Tên danh mục (2–150 ký tự)" value={catForm.name} onChange={e => setCatForm({ ...catForm, name: e.target.value })} data-testid="admin-category-name-input" />
                    <input style={inputStyle} placeholder="Mô tả" value={catForm.description} onChange={e => setCatForm({ ...catForm, description: e.target.value })} />
                    <input style={inputStyle} type="number" placeholder="Thứ tự sắp xếp" value={catForm.sortOrder} onChange={e => setCatForm({ ...catForm, sortOrder: e.target.value })} />
                    {catForm.id && <label><input type="checkbox" checked={catForm.isActive} onChange={e => setCatForm({ ...catForm, isActive: e.target.checked })} /> Đang hiển thị</label>}
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                    <button type="submit" style={btnStyle}>Lưu</button>
                    <button type="button" onClick={() => setCatFormOpen(false)} style={btnGhostStyle}>Đóng</button>
                  </div>
                </form>
              )}
              {!catsLoading && categories.length === 0 && !catsError && <p>Chưa có danh mục.</p>}
              {categories.length > 0 && (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={thStyle}>Tên</th><th style={thStyle}>Slug</th><th style={thStyle}>Số SP</th><th style={thStyle}>Hiển thị</th><th style={thStyle}>Thao tác</th></tr></thead>
                  <tbody>
                    {categories.map(c => (
                      <tr key={c.id}>
                        <td style={tdStyle}>{c.name}</td>
                        <td style={tdStyle}>{c.slug ?? '—'}</td>
                        <td style={tdStyle}>{c.productCount ?? 0}</td>
                        <td style={tdStyle}>{c.isActive ? 'Có' : 'Không'}</td>
                        <td style={tdStyle}>
                          <button type="button" style={{ ...btnGhostStyle, marginRight: 6 }} onClick={() => { setCatForm({ id: c.id, name: c.name, description: c.description ?? '', sortOrder: String(c.sortOrder ?? 0), isActive: c.isActive }); setCatFormError(null); setCatFormOpen(true); }}>Sửa</button>
                          <button type="button" style={{ ...btnStyle, background: '#c62828', borderColor: '#c62828' }} onClick={() => void deleteCategory(c)}>Xóa</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          )}

          {tab === 'promotions' && (
            <section>
              <h2 style={{ fontSize: '1.6rem' }}>Khuyến mãi</h2>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                <select style={{ ...inputStyle, maxWidth: 220 }} value={promoStatusFilter} onChange={e => setPromoStatusFilter(e.target.value)} aria-label="Lọc trạng thái voucher">
                  <option value="">Tất cả trạng thái</option>
                  <option value="Draft">Nháp</option>
                  <option value="Active">Đang chạy</option>
                  <option value="Disabled">Đã tắt</option>
                  <option value="Expired">Hết hạn</option>
                </select>
                <button type="button" onClick={() => void loadPromos()} style={btnStyle}>Lọc</button>
                <button type="button" onClick={() => { setPromoForm({ code: '', description: '', discountType: 'Percentage', discountValue: '', minOrderAmount: '0', maxDiscountAmount: '', startDate: '', expiryDate: '', maxUses: '', maxUsesPerUser: '1', minTier: '', scopeType: 'All', scopeCategoryId: '', scopeProductIds: '' }); setPromoFormError(null); setPromoFormOpen(true); }} style={btnStyle} data-testid="admin-promo-add-btn">+ Tạo khuyến mãi</button>
              </div>
              {promosLoading && <p>Đang tải khuyến mãi...</p>}
              {promosError && <p style={{ color: '#c62828' }}>{promosError}</p>}
              {promoFormOpen && (
                <form onSubmit={savePromo} style={{ border: `1px solid ${PINK}`, borderRadius: 12, padding: '1rem', marginBottom: '1rem' }} data-testid="admin-promo-form">
                  <h3 style={{ marginTop: 0 }}>Tạo khuyến mãi mới (tạo ở trạng thái Nháp — bấm Kích hoạt để chạy)</h3>
                  {promoFormError && <p style={{ color: '#c62828' }}>{promoFormError}</p>}
                  <div style={{ display: 'grid', gap: '0.6rem' }}>
                    <input style={inputStyle} placeholder="Mã (3–50 ký tự: chữ, số, -, _)" value={promoForm.code} onChange={e => setPromoForm({ ...promoForm, code: e.target.value })} data-testid="admin-promo-code-input" />
                    <input style={inputStyle} placeholder="Mô tả" value={promoForm.description} onChange={e => setPromoForm({ ...promoForm, description: e.target.value })} />
                    <select style={inputStyle} value={promoForm.discountType} onChange={e => setPromoForm({ ...promoForm, discountType: e.target.value })} aria-label="Loại giảm">
                      <option value="Percentage">Giảm theo %</option>
                      <option value="Fixed">Giảm tiền cố định</option>
                      <option value="FreeShip">Miễn phí vận chuyển</option>
                    </select>
                    <input style={inputStyle} type="number" min={0} placeholder="Giá trị giảm" value={promoForm.discountValue} onChange={e => setPromoForm({ ...promoForm, discountValue: e.target.value })} />
                    <input style={inputStyle} type="number" min={0} placeholder="Đơn tối thiểu" value={promoForm.minOrderAmount} onChange={e => setPromoForm({ ...promoForm, minOrderAmount: e.target.value })} />
                    <input style={inputStyle} type="number" min={0} placeholder="Trần giảm (không bắt buộc)" value={promoForm.maxDiscountAmount} onChange={e => setPromoForm({ ...promoForm, maxDiscountAmount: e.target.value })} />
                    <label>Ngày bắt đầu <input style={inputStyle} type="datetime-local" value={promoForm.startDate} onChange={e => setPromoForm({ ...promoForm, startDate: e.target.value })} /></label>
                    <label>Ngày kết thúc <input style={inputStyle} type="datetime-local" value={promoForm.expiryDate} onChange={e => setPromoForm({ ...promoForm, expiryDate: e.target.value })} /></label>
                    <input style={inputStyle} type="number" min={1} placeholder="Tổng lượt dùng (không bắt buộc)" value={promoForm.maxUses} onChange={e => setPromoForm({ ...promoForm, maxUses: e.target.value })} />
                    <input style={inputStyle} type="number" min={1} placeholder="Lượt dùng / người" value={promoForm.maxUsesPerUser} onChange={e => setPromoForm({ ...promoForm, maxUsesPerUser: e.target.value })} />
                    <select style={inputStyle} value={promoForm.minTier} onChange={e => setPromoForm({ ...promoForm, minTier: e.target.value })} aria-label="Hạng tối thiểu">
                      <option value="">Không giới hạn hạng</option>
                      <option value="Member">Thường</option>
                      <option value="Silver">Bạc</option>
                      <option value="Gold">Vàng</option>
                      <option value="Diamond">Kim cương</option>
                    </select>
                    <select style={inputStyle} value={promoForm.scopeType} onChange={e => setPromoForm({ ...promoForm, scopeType: e.target.value })} aria-label="Phạm vi áp dụng">
                      <option value="All">Toàn sàn</option>
                      <option value="Category">Theo danh mục</option>
                      <option value="Product">Theo sản phẩm</option>
                    </select>
                    {promoForm.scopeType === 'Category' && (
                      <select style={inputStyle} value={promoForm.scopeCategoryId} onChange={e => setPromoForm({ ...promoForm, scopeCategoryId: e.target.value })} aria-label="Danh mục áp dụng">
                        <option value="">— Chọn danh mục —</option>
                        {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    )}
                    {promoForm.scopeType === 'Product' && (
                      <input style={inputStyle} placeholder="ID sản phẩm, cách nhau bằng dấu phẩy" value={promoForm.scopeProductIds} onChange={e => setPromoForm({ ...promoForm, scopeProductIds: e.target.value })} />
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                    <button type="submit" style={btnStyle}>Tạo khuyến mãi</button>
                    <button type="button" onClick={() => setPromoFormOpen(false)} style={btnGhostStyle}>Đóng</button>
                  </div>
                </form>
              )}
              {disableTarget && (
                <div style={{ border: '1px solid #c62828', borderRadius: 12, padding: '1rem', marginBottom: '1rem' }}>
                  <h3 style={{ marginTop: 0 }}>Tắt khuyến mãi {disableTarget.code} — bắt buộc nhập lý do</h3>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input style={{ ...inputStyle, maxWidth: 420 }} placeholder="Lý do tắt khuyến mãi" value={disableReason} onChange={e => setDisableReason(e.target.value)} data-testid="admin-promo-disable-reason" />
                    <button type="button" onClick={() => void disablePromo()} style={{ ...btnStyle, background: '#c62828', borderColor: '#c62828' }}>Xác nhận tắt</button>
                    <button type="button" onClick={() => { setDisableTarget(null); setDisableReason(''); }} style={btnGhostStyle}>Hủy</button>
                  </div>
                </div>
              )}
              {!promosLoading && promos.length === 0 && !promosError && <p>Chưa có khuyến mãi.</p>}
              {promos.length > 0 && (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={thStyle}>Mã</th><th style={thStyle}>Loại giảm</th><th style={thStyle}>Giá trị</th><th style={thStyle}>Hạn</th><th style={thStyle}>Lượt dùng</th><th style={thStyle}>Trạng thái</th><th style={thStyle}>Thao tác</th></tr></thead>
                  <tbody>
                    {promos.map(p => (
                      <tr key={p.id}>
                        <td style={tdStyle}><strong>{p.code}</strong><br /><small>{p.description ?? ''}</small></td>
                        <td style={tdStyle}>{p.discountType}{p.minTier ? <><br /><small>Hạng {TIER_LABELS[p.minTier] ?? p.minTier}+</small></> : null}</td>
                        <td style={tdStyle}>{p.discountType === 'Percentage' ? `${p.discountValue}%` : p.discountType === 'FreeShip' ? 'Freeship' : fmtMoney(p.discountValue)}</td>
                        <td style={tdStyle}>{fmtDate(p.expiryDate)}</td>
                        <td style={tdStyle}>{p.usedCount ?? 0}{p.maxUses ? `/${p.maxUses}` : ''}</td>
                        <td style={tdStyle}>{p.status}{p.disabledReason ? <><br /><small>{p.disabledReason}</small></> : null}</td>
                        <td style={tdStyle}>
                          {p.status === 'Draft' && <button type="button" style={{ ...btnGhostStyle, marginRight: 6 }} onClick={() => void activatePromo(p)}>Kích hoạt</button>}
                          {(p.status === 'Active' || p.status === 'Draft') && <button type="button" style={{ ...btnStyle, background: '#c62828', borderColor: '#c62828', marginRight: 6 }} onClick={() => { setDisableTarget(p); setDisableReason(''); }}>Tắt</button>}
                          <button type="button" style={btnGhostStyle} onClick={() => void viewPromoUsage(p)}>Lượt dùng</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {promoUsageFor && (
                <div style={{ marginTop: '1rem' }}>
                  <h3>Lượt dùng của {promoUsageFor}</h3>
                  {promoUsage === null ? <p>Đang tải...</p> : promoUsage.length === 0 ? <p>Chưa có lượt dùng nào.</p> : (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr><th style={thStyle}>Email</th><th style={thStyle}>Mã đơn</th><th style={thStyle}>Giảm</th><th style={thStyle}>Ngày dùng</th></tr></thead>
                      <tbody>
                        {promoUsage.map(u => (
                          <tr key={u.id}>
                            <td style={tdStyle}>{u.userEmail}</td>
                            <td style={tdStyle}>{u.orderDisplayCode ?? u.orderId}</td>
                            <td style={tdStyle}>{fmtMoney(u.discountAmount)}</td>
                            <td style={tdStyle}>{fmtDate(u.createdAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </section>
          )}

          {tab === 'customers' && (
            <section>
              <h2 style={{ fontSize: '1.6rem' }}>Khách hàng</h2>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                <input style={{ ...inputStyle, maxWidth: 320 }} placeholder="Tìm email / tên / SĐT" value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} data-testid="admin-customer-search" />
                <select style={{ ...inputStyle, maxWidth: 200 }} value={customerTierFilter} onChange={e => setCustomerTierFilter(e.target.value)} aria-label="Lọc hạng">
                  <option value="">Tất cả hạng</option>
                  <option value="Member">Thường</option>
                  <option value="Silver">Bạc</option>
                  <option value="Gold">Vàng</option>
                  <option value="Diamond">Kim cương</option>
                </select>
                <button type="button" onClick={() => void loadCustomers()} style={btnStyle}>Tìm</button>
              </div>
              {customersLoading && <p>Đang tải khách hàng...</p>}
              {customersError && <p style={{ color: '#c62828' }}>{customersError}</p>}
              {!customersLoading && customers.length === 0 && !customersError && <p>Không có khách hàng nào.</p>}
              {customers.length > 0 && (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={thStyle}>Họ tên</th><th style={thStyle}>Email</th><th style={thStyle}>Hạng</th><th style={thStyle}>Chi tiêu 12 tháng</th><th style={thStyle}>Số đơn</th><th style={thStyle}>Trạng thái</th><th style={thStyle}>Thao tác</th></tr></thead>
                  <tbody>
                    {customers.map(c => (
                      <tr key={c.id}>
                        <td style={tdStyle}>{c.fullName}</td>
                        <td style={tdStyle}>{c.email}</td>
                        <td style={tdStyle}>{TIER_LABELS[c.membershipTier ?? ''] ?? c.membershipTier ?? '—'}</td>
                        <td style={tdStyle}>{fmtMoney(c.totalSpent12m)}</td>
                        <td style={tdStyle}>{c.orderCount ?? 0}</td>
                        <td style={tdStyle}>{c.isLocked ? 'Đã khóa' : 'Bình thường'}</td>
                        <td style={tdStyle}>
                          <button type="button" style={{ ...btnGhostStyle, marginRight: 6 }} onClick={() => void openCustomerDetail(c)}>Xem</button>
                          {c.isLocked
                            ? <button type="button" style={btnStyle} onClick={() => void lockCustomer(c, false)}>Mở khóa</button>
                            : <button type="button" style={{ ...btnStyle, background: '#c62828', borderColor: '#c62828' }} onClick={() => void lockCustomer(c, true)}>Khóa</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {customerDetailLoading && <p>Đang tải chi tiết khách hàng...</p>}
              {selectedCustomer && (
                <div style={{ border: `1px solid ${PINK}`, borderRadius: 12, padding: '1rem', marginTop: '1rem' }} data-testid="admin-customer-detail">
                  <h3 style={{ marginTop: 0 }}>{selectedCustomer.customer.fullName} — {selectedCustomer.customer.email}</h3>
                  <p>SĐT: {selectedCustomer.customer.phoneNumber ?? '—'} — Hạng: {TIER_LABELS[selectedCustomer.customer.membershipTier ?? ''] ?? selectedCustomer.customer.membershipTier ?? '—'}</p>
                  <p>Ngày tạo: {fmtDate(selectedCustomer.customer.createdAt)} — Đăng nhập gần nhất: {fmtDate(selectedCustomer.customer.lastLoginAt)}</p>
                  <h4>Đơn gần nhất</h4>
                  {(selectedCustomer.recentOrders ?? []).length === 0 ? <p>Chưa có đơn hàng.</p> : (
                    <ul>{selectedCustomer.recentOrders!.map((o, i) => (
                      <li key={i}>{o.orderDisplayCode ?? `#${o.orderCode}`} — {statusLabel(typeof o.status === 'string' ? o.status : String(o.status ?? ''))} — {fmtMoney(o.totalAmount)} — {fmtDate(o.createdAt)}</li>
                    ))}</ul>
                  )}
                </div>
              )}
            </section>
          )}

          {tab === 'membership' && (
            <section>
              <h2 style={{ fontSize: '1.6rem' }}>Hội viên</h2>
              {tiersLoading && <p>Đang tải cấu hình hội viên...</p>}
              {tiersError && <p style={{ color: '#c62828' }}>{tiersError}</p>}
              {tierDraft.length > 0 && (
                <>
                  <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1rem' }}>
                    <thead><tr><th style={thStyle}>Hạng</th><th style={thStyle}>Ngưỡng chi tiêu</th><th style={thStyle}>Chi tiêu / 1 điểm</th><th style={thStyle}>Trần dùng điểm (%)</th><th style={thStyle}>Ngưỡng freeship</th></tr></thead>
                    <tbody>
                      {tierDraft.map((t, i) => (
                        <tr key={t.tier}>
                          <td style={tdStyle}>{TIER_LABELS[t.tier] ?? t.tier} ({t.tier})</td>
                          <td style={tdStyle}><input style={inputStyle} type="number" min={0} value={t.minSpent} onChange={e => setTierDraft(prev => prev.map((x, j) => j === i ? { ...x, minSpent: Number(e.target.value) || 0 } : x))} aria-label={`Ngưỡng ${t.tier}`} /></td>
                          <td style={tdStyle}><input style={inputStyle} type="number" min={1} value={t.spendPerPoint} onChange={e => setTierDraft(prev => prev.map((x, j) => j === i ? { ...x, spendPerPoint: Number(e.target.value) || 1 } : x))} aria-label={`Tích điểm ${t.tier}`} /></td>
                          <td style={tdStyle}><input style={inputStyle} type="number" min={0} max={100} value={t.maxPointsPercent} onChange={e => setTierDraft(prev => prev.map((x, j) => j === i ? { ...x, maxPointsPercent: Number(e.target.value) || 0 } : x))} aria-label={`Trần điểm ${t.tier}`} /></td>
                          <td style={tdStyle}><input style={inputStyle} type="number" min={0} value={t.freeShipThreshold ?? ''} placeholder="Không đặt" onChange={e => setTierDraft(prev => prev.map((x, j) => j === i ? { ...x, freeShipThreshold: e.target.value === '' ? null : Number(e.target.value) } : x))} aria-label={`Freeship ${t.tier}`} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p style={{ color: '#666' }}>Lưu ý: ngưỡng chi tiêu phải tăng dần theo thứ tự Thường → Bạc → Vàng → Kim cương; thay đổi chỉ áp dụng cho đơn phát sinh sau thời điểm sửa.</p>
                  <button type="button" onClick={() => void saveTiers()} style={btnStyle}>Lưu cấu hình hạng</button>
                </>
              )}
              <h3 style={{ fontSize: '1.3rem', marginTop: '2rem' }}>Điều chỉnh điểm cho 1 khách</h3>
              <form onSubmit={adjustPoints} style={{ border: `1px solid ${PINK}`, borderRadius: 12, padding: '1rem', maxWidth: 560 }} data-testid="admin-adjust-points-form">
                {adjustError && <p style={{ color: '#c62828' }}>{adjustError}</p>}
                <div style={{ display: 'grid', gap: '0.6rem' }}>
                  <input style={inputStyle} placeholder="Email hoặc ID khách hàng" value={adjustId} onChange={e => setAdjustId(e.target.value)} data-testid="admin-adjust-user-input" />
                  <input style={inputStyle} type="number" placeholder="Số điểm (dương = cộng, âm = trừ; tối đa 1000/lần)" value={adjustPointsValue} onChange={e => setAdjustPointsValue(e.target.value)} data-testid="admin-adjust-points-input" />
                  <input style={inputStyle} placeholder="Lý do (bắt buộc)" value={adjustReason} onChange={e => setAdjustReason(e.target.value)} data-testid="admin-adjust-reason-input" />
                </div>
                <button type="submit" disabled={adjustBusy} style={{ ...btnStyle, marginTop: '0.75rem' }} data-testid="admin-adjust-points-btn">Điều chỉnh điểm</button>
              </form>
            </section>
          )}

          {tab === 'returns' && (
            <section>
              <h2 style={{ fontSize: '1.6rem' }}>Trả hàng</h2>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                <select style={{ ...inputStyle, maxWidth: 220 }} value={returnStatusFilter} onChange={e => setReturnStatusFilter(e.target.value)} aria-label="Lọc trạng thái trả hàng">
                  <option value="">Tất cả trạng thái</option>
                  <option value="Pending">Chờ duyệt</option>
                  <option value="Approved">Đã duyệt</option>
                  <option value="Rejected">Đã từ chối</option>
                </select>
                <button type="button" onClick={() => void loadReturns()} style={btnStyle}>Lọc</button>
              </div>
              {returnsLoading && <p>Đang tải yêu cầu trả hàng...</p>}
              {returnsError && <p style={{ color: '#c62828' }}>{returnsError}</p>}
              {!returnsLoading && returnsList.length === 0 && !returnsError && <p>Không có yêu cầu trả hàng nào.</p>}
              {returnsList.length > 0 && (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={thStyle}>Mã đơn</th><th style={thStyle}>Sản phẩm</th><th style={thStyle}>SL</th><th style={thStyle}>Lý do</th><th style={thStyle}>Trạng thái</th><th style={thStyle}>Hoàn tiền</th><th style={thStyle}>Thao tác</th></tr></thead>
                  <tbody>
                    {returnsList.map(r => (
                      <tr key={r.id}>
                        <td style={tdStyle}>{r.orderDisplayCode ?? r.orderId}</td>
                        <td style={tdStyle}>{r.productName}</td>
                        <td style={tdStyle}>{r.quantity}</td>
                        <td style={tdStyle}>{r.reason}{r.note ? <><br /><small>{r.note}</small></> : null}</td>
                        <td style={tdStyle}>{r.status}{r.adminNote ? <><br /><small>{r.adminNote}</small></> : null}</td>
                        <td style={tdStyle}>{r.refundStatus ?? '—'}{r.refundAmount ? <><br /><small>{fmtMoney(r.refundAmount)}</small></> : null}</td>
                        <td style={tdStyle}>
                          {r.status === 'Pending' && (
                            <button type="button" style={btnGhostStyle} onClick={() => { setReturnTarget(r); setReturnNote(''); }}>Duyệt / Từ chối</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {returnTarget && (
                <div style={{ border: `1px solid ${PINK}`, borderRadius: 12, padding: '1rem', marginTop: '1rem' }} data-testid="admin-return-resolve">
                  <h3 style={{ marginTop: 0 }}>Xử lý trả hàng: {returnTarget.productName} × {returnTarget.quantity}</h3>
                  <p>Lý do khách: {returnTarget.reason}{returnTarget.note ? ` — ${returnTarget.note}` : ''}</p>
                  <p style={{ color: '#666' }}>Duyệt: hoàn kho + tạo bản ghi hoàn tiền “Chờ hoàn tiền”. Từ chối: bắt buộc ghi lý do, đơn quay về Đã giao.</p>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <input style={{ ...inputStyle, maxWidth: 420 }} placeholder="Ghi chú admin (từ chối bắt buộc nhập lý do)" value={returnNote} onChange={e => setReturnNote(e.target.value)} data-testid="admin-return-note-input" />
                    <button type="button" onClick={() => void resolveReturn(true)} style={btnStyle}>Duyệt</button>
                    <button type="button" onClick={() => void resolveReturn(false)} style={{ ...btnStyle, background: '#c62828', borderColor: '#c62828' }}>Từ chối</button>
                    <button type="button" onClick={() => { setReturnTarget(null); setReturnNote(''); }} style={btnGhostStyle}>Hủy</button>
                  </div>
                </div>
              )}
              <p style={{ color: '#666', marginTop: '1rem' }}>Ghi nhận đã hoàn tiền (POST /api/admin/refunds/{'{id}'}/record) cần ID bản ghi hoàn tiền — DTO yêu cầu trả hàng chỉ trả trạng thái/số tiền hoàn, không trả refundId nên mục này chưa gắn nút; admin ghi nhận sau khi có mã giao dịch hoàn qua API.</p>

              <h2 style={{ fontSize: '1.6rem', marginTop: '2rem' }}>Nhật ký hệ thống (audit-log)</h2>
              <button type="button" onClick={() => void loadAudit()} style={{ ...btnGhostStyle, marginBottom: '1rem' }}>Tải lại nhật ký</button>
              {auditLoading && <p>Đang tải nhật ký...</p>}
              {auditError && <p style={{ color: '#c62828' }}>{auditError}</p>}
              {!auditLoading && auditLogs.length === 0 && !auditError && <p>Chưa có nhật ký.</p>}
              {auditLogs.length > 0 && (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={thStyle}>Thời gian</th><th style={thStyle}>Người thực hiện</th><th style={thStyle}>Hành động</th><th style={thStyle}>Đối tượng</th></tr></thead>
                  <tbody>
                    {auditLogs.map(a => (
                      <tr key={a.id}>
                        <td style={tdStyle}>{fmtDate(a.createdAt)}</td>
                        <td style={tdStyle}>{a.actorEmail}</td>
                        <td style={tdStyle}>{a.action}</td>
                        <td style={tdStyle}>{a.entityType ?? '—'}{a.entityId ? ` (${String(a.entityId).slice(0, 8)}…)` : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
