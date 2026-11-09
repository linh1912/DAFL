import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ShoppingBag, Sparkles, CheckCircle2, Clock,
  CreditCard, ShieldCheck, X, Plus, Minus,
  User as UserIcon, Bell, Star, Tag, LogOut, Check, RefreshCw, Package,
  MapPin, Calendar, RotateCcw, Receipt, ArrowLeft, Copy, AlertCircle, Truck, FileText, Layers, Store
} from 'lucide-react';
import * as signalR from '@microsoft/signalr';
import {
  Category, Product, ProductDetail, CartItem, Voucher,
  CheckoutResult, ApiResponse, User, NotificationItem, OrderHistory, AppRoute,
  AuthResult, ServerCartDto
} from '../../Shared/types';
import {
  FALLBACK_CATEGORIES, FALLBACK_PRODUCTS, FALLBACK_VOUCHERS, FALLBACK_NOTIFICATIONS
} from './mockData';
import { getProductDetailExtra } from './productDetailHelper';
import { Header } from './components/common/Header';
import { SiteFooter } from './components/common/SiteFooter';
import { CategoryFilter } from './components/product/CategoryFilter';
import { ProductCard } from './components/product/ProductCard';
import { ProductGallery } from './components/product/ProductGallery';
import { resolveGalleryImages } from './utils/images';
import { timeAgoVi } from './utils/shops';
import { CartDrawer } from './components/cart/CartDrawer';
import { AuthModal, RegisterFormValues, RegisterFieldErrors, PasswordRuleList } from '../../Shared/components/auth/AuthModal';
import { CheckoutFormValues } from './components/checkout/CheckoutForm';
import { PayOSGatewayView } from './components/checkout/PayOSGatewayView';
import { AddressBook } from './components/profile/AddressBook';
import { MembershipPage } from './components/membership/MembershipPage';
import {
  apiFetch, apiJson, getToken, setToken, clearToken,
  setSessionExpiredHandler, newIdempotencyKey, GUEST_CART_STORAGE_KEY,
} from '../../Shared/utils/api';

import {
  Routes,
  Route,
  useNavigate,
  useParams,
  useLocation,
  useMatch,
  Navigate
} from 'react-router-dom';
import { MockPayOSStandalonePage } from './components/checkout/MockPayOSStandalonePage';
import { PaymentSuccessPage } from './components/checkout/PaymentSuccessPage';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

/** Phí ship hiện hành của app (O1): 25.000đ, miễn phí khi tạm tính (trước giảm) ≥ 299.000đ. */
const SHIPPING_FEE = 25000;
const FREE_SHIPPING_THRESHOLD = 299000;
/** Số sản phẩm mỗi trang danh mục (CN-04). */
const CATALOG_PAGE_SIZE = 12;
/** Số đơn mỗi trang ở trang Đơn hàng. */
const ORDERS_PAGE_SIZE = 10;

/** Slide hero trang chủ DAFL — ít chữ, tự chạy 4s/slide, ảnh mỹ phẩm Unsplash.
 *  Cả 3 ảnh đều NGANG (đã kiểm chứng HTTP 200 + xem trực tiếp: son flat-lay
 *  cắt 2:1, bảng trang điểm 1.53, dầu gội/xả 1.5) nên banner dùng
 *  object-fit: cover để ảnh phủ kín, không còn khoảng hồng trống; chữ trong
 *  hộp tối mờ nhẹ, tiêu đề ngắn gọn 1 dòng. */
const HERO_FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=2000&h=1000&q=80';
const HERO_SLIDES = [
  {
    badge: 'FLASH SALE • GIẢM ĐẾN 50%',
    title: 'Mỹ phẩm chính hãng',
    sub: 'Son, serum, kem chống nắng chính hãng từ nhiều shop.',
    cta: 'Mua ngay',
    image: 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=2000&h=1000&q=80',
  },
  {
    badge: 'FREESHIP ĐƠN TỪ 299K',
    title: 'Freeship đơn từ 299K',
    sub: 'Giao nhanh 2–4 ngày, đổi trả trong 30 ngày.',
    cta: 'Xem deal freeship',
    image: 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=2000&q=80',
  },
  {
    badge: 'HỘI VIÊN DAFL',
    title: 'Tích điểm lên hạng',
    sub: 'Thường • Bạc • Vàng • Kim cương.',
    cta: 'Khám phá hội viên',
    image: 'https://images.unsplash.com/photo-1631729371254-42c2892f0e6e?auto=format&fit=crop&w=2000&q=80',
  },
];

/** Hàng icon danh mục mỹ phẩm (kiểu Cocolux) — slug khớp danh mục BE thì dùng tên
 *  danh mục thật, không khớp thì dùng nhãn hardcode; bấm vào lọc theo danh mục
 *  mỹ phẩm; BE đã seed đủ 6 danh mục này (DbInitializer: son-moi, cham-soc-da,
 *  trang-diem, nuoc-hoa, cham-soc-co-the, cham-soc-toc) nên bấm icon lọc đúng nhóm. */
const COSMETIC_ICON_CATEGORIES = [
  { slug: 'son-moi', label: 'Son môi', icon: '💄' },
  { slug: 'cham-soc-da', label: 'Chăm sóc da', icon: '🧴' },
  { slug: 'trang-diem', label: 'Trang điểm', icon: '💋' },
  { slug: 'nuoc-hoa', label: 'Nước hoa', icon: '🌸' },
  { slug: 'cham-soc-co-the', label: 'Chăm sóc cơ thể', icon: '🛁' },
  { slug: 'cham-soc-toc', label: 'Chăm sóc tóc', icon: '💇' },
];

/** Dải thương hiệu mỹ phẩm nổi bật (chữ/logo text, không cần ảnh). */
const FEATURED_BRANDS = ['La Roche-Posay', "L'Oréal", '3CE', 'Peripera', 'Clio', 'CeraVe'];

/** Gian hàng mỹ phẩm nổi bật (hiển thị — dữ liệu shop thật chờ BE có entity Shop). */
const FEATURED_SHOPS = [
  { slug: 'dafl-official', name: 'DAFL Official', tag: 'Chính hãng', rating: '4.9', sold: '12k đã bán' },
  { slug: 'lumiere-beauty', name: 'Lumière Beauty', tag: 'Chính hãng', rating: '4.8', sold: '8,5k đã bán' },
  { slug: 'pureskin-lab', name: 'PureSkin Lab', tag: 'Skincare', rating: '4.9', sold: '6k đã bán' },
  { slug: 'rose-botanica', name: 'Rose Botanica', tag: 'Thiên nhiên', rating: '4.7', sold: '4k đã bán' },
];

/** Các mốc vòng đời đơn theo tài liệu nghiệp vụ §4/§8 (dùng vẽ stepper ở chi tiết đơn). */
const ORDER_FLOW_STEPS = ['Đặt hàng', 'Thanh toán', 'Xác nhận', 'Đang giao', 'Đã giao', 'Hoàn tất'];
const ORDER_STEP_INDEX: Record<string, number> = {
  Pending: 0, Expired: 0, Paid: 1, Confirmed: 2, Preparing: 2, Shipping: 3, Delivered: 4, Completed: 5,
};

/** Đọc giỏ khách (localStorage) — giỏ của khách chưa đăng nhập (CN-06.1). */
const readGuestCart = (): CartItem[] => {
  try {
    const raw = window.localStorage.getItem(GUEST_CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((i: any) => i && i.product && typeof i.product.id === 'string')
      .map((i: any) => ({
        product: i.product as Product,
        quantity: Math.max(1, Number(i.quantity) || 1),
      }));
  } catch {
    return [];
  }
};

const clearGuestCartStorage = () => {
  try {
    window.localStorage.removeItem(GUEST_CART_STORAGE_KEY);
  } catch {
    /* bỏ qua */
  }
};

/** Map giỏ server (CartDto của BE) sang CartItem của FE, giữ cờ giá thay đổi từ lần đồng bộ trước. */
const mapServerCart = (dto: ServerCartDto, prev: CartItem[]): CartItem[] =>
  (dto.items || []).map(si => {
    const prevItem = prev.find(p => p.product.id === si.productId);
    let priceChanged = false;
    let previousPrice: number | undefined;
    if (prevItem) {
      if (prevItem.priceChanged) {
        priceChanged = true;
        previousPrice = prevItem.previousPrice;
      } else if (prevItem.product.price !== si.unitPrice) {
        priceChanged = true;
        previousPrice = prevItem.product.price;
      }
    }
    return {
      product: {
        id: si.productId,
        categoryId: prevItem?.product.categoryId || '',
        categoryName: prevItem?.product.categoryName || '',
        name: si.productName,
        slug: prevItem?.product.slug || '',
        description: prevItem?.product.description || '',
        price: si.unitPrice,
        originalPrice: prevItem?.product.originalPrice,
        availableStock: si.availableStock,
        imageUrl: si.productImageUrl || prevItem?.product.imageUrl || '',
        rating: prevItem?.product.rating,
        reviewCount: prevItem?.product.reviewCount,
      },
      quantity: si.quantity,
      serverItemId: si.id,
      isAvailable: si.isAvailable,
      priceChanged,
      previousPrice,
    };
  });

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [authInitialized, setAuthInitialized] = useState(false);

  const productMatch = useMatch('/product/:id');
  const matchedProductId = productMatch?.params?.id;

  const paymentMatch = useMatch('/payment/:orderCode');
  const matchedPaymentOrderCode = paymentMatch?.params?.orderCode;

  const lastLoadedProductIdRef = useRef<string | null>(null);
  const pathnameRef = useRef(location.pathname);
  useEffect(() => {
    pathnameRef.current = location.pathname;
  }, [location.pathname]);

  // Navigation & Catalog (CN-04: phân trang server 12/trang + sort + khoảng giá)
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortOrder, setSortOrder] = useState<'newest' | 'price-asc' | 'price-desc'>('newest');
  const [priceFromText, setPriceFromText] = useState('');
  const [priceToText, setPriceToText] = useState('');
  const [priceRange, setPriceRange] = useState<{ from: number | null; to: number | null }>({ from: null, to: null });
  const [priceFilterError, setPriceFilterError] = useState<string | null>(null);
  // Khoảng giá có sẵn: bấm 1 chạm là lọc luôn (đơn vị đồng).
  const PRICE_PRESETS: { label: string; from: string; to: string }[] = [
    { label: 'Dưới 100K', from: '', to: '100000' },
    { label: '100K – 300K', from: '100000', to: '300000' },
    { label: '300K – 500K', from: '300000', to: '500000' },
    { label: '500K – 1 triệu', from: '500000', to: '1000000' },
    { label: 'Trên 1 triệu', from: '1000000', to: '' },
  ];
  const [activePricePreset, setActivePricePreset] = useState<number | null>(null);
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogHasNext, setCatalogHasNext] = useState(false);
  const [catalogKnownTotal, setCatalogKnownTotal] = useState<number | null>(null);
  const catalogRequestSeq = useRef(0);

  // Hero carousel trang chủ: tự chạy 4s/slide, có thể bấm dot / prev-next để đổi.
  const [heroSlide, setHeroSlide] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setHeroSlide(prev => (prev + 1) % HERO_SLIDES.length);
    }, 4000);
    return () => window.clearInterval(timer);
  }, []);

  // Flash Sale: đồng hồ đếm ngược tới 23:59:59 hôm nay, cập nhật mỗi giây;
  // hết giờ thì tự reset sang ngày hôm sau (đích luôn là cuối ngày hiện tại).
  const [flashNow, setFlashNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setFlashNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Product Detail State
  const [selectedProduct, setSelectedProduct] = useState<ProductDetail | null>(null);
  const [productDetailLoading, setProductDetailLoading] = useState(false);
  const [productNotFound, setProductNotFound] = useState(false);
  const [detailQuantity, setDetailQuantity] = useState(1);

  // Cart State — giỏ hiển thị: khách = localStorage, đã đăng nhập = giỏ server (CN-06)
  const [cart, setCart] = useState<CartItem[]>(() => readGuestCart());

  // Voucher State
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [voucherCodeInput, setVoucherCodeInput] = useState('');
  const [appliedVoucher, setAppliedVoucher] = useState<{ code: string; discountAmount: number } | null>(null);
  const [voucherMessage, setVoucherMessage] = useState<string | null>(null);

  // Checkout State
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [shippingAddress, setShippingAddress] = useState('');
  const [checkoutResult, setCheckoutResult] = useState<CheckoutResult | null>(null);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [showPriceChangedNotice, setShowPriceChangedNotice] = useState(false);
  const [ackedPriceSignature, setAckedPriceSignature] = useState('');
  const [lastOrderAddress, setLastOrderAddress] = useState('');
  const checkoutIdemKeyRef = useRef<string | null>(null);
  const [orderStatus, setOrderStatus] = useState<string>('Pending');
  const [timeLeft, setTimeLeft] = useState<number>(15 * 60);

  // Dedicated Embedded PayOS Modal for paying any pending order from order history
  const [embeddedPaymentModal, setEmbeddedPaymentModal] = useState<{
    orderCode: number;
    checkoutUrl: string;
    totalAmount: number;
  } | null>(null);

  // Orders State (CN-08: list phân trang + lọc theo StatusLabel + chi tiết + hủy)
  const [orderHistory, setOrderHistory] = useState<OrderHistory[]>([]);
  const [orderHistoryLoading, setOrderHistoryLoading] = useState(false);
  const [ordersList, setOrdersList] = useState<OrderHistory[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersPageNum, setOrdersPageNum] = useState(1);
  const [ordersHasNext, setOrdersHasNext] = useState(false);
  const [orderStatusFilter, setOrderStatusFilter] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<OrderHistory | null>(null);
  const [orderDetailLoading, setOrderDetailLoading] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<OrderHistory | null>(null);
  const [cancelReasonChoice, setCancelReasonChoice] = useState('Đổi ý, không muốn mua nữa');
  const [cancelReasonText, setCancelReasonText] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelSuccessCode, setCancelSuccessCode] = useState<string | null>(null);
  const ordersRequestSeq = useRef(0);

  // Profile State (CN-03)
  const [profileFullName, setProfileFullName] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [profileEmail, setProfileEmail] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileNameError, setProfileNameError] = useState<string | null>(null);
  const [profilePhoneError, setProfilePhoneError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState(false);

  // Đổi mật khẩu (CN-03.2)
  const [cpCurrent, setCpCurrent] = useState('');
  const [cpNew, setCpNew] = useState('');
  const [cpConfirm, setCpConfirm] = useState('');
  const [cpErrors, setCpErrors] = useState<{ current?: string; next?: string; confirm?: string }>({});
  const [cpSuccess, setCpSuccess] = useState(false);
  const [cpBusy, setCpBusy] = useState(false);

  // Đặt mật khẩu cho tài khoản chưa có mật khẩu (CN-03)
  const [setPasswordValue, setSetPasswordValue] = useState('');
  const [setPasswordConfirm, setSetPasswordConfirm] = useState('');
  const [setPasswordError, setSetPasswordError] = useState<string | null>(null);
  const [setPasswordDone, setSetPasswordDone] = useState(false);
  const [settingPassword, setSettingPassword] = useState(false);

  // Auth State (JWT — CN-02)
  const [user, setUser] = useState<User | null>(null);
  const [authTab, setAuthTab] = useState<'login' | 'register'>('login');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [registerName, setRegisterName] = useState('');
  const [registerEmail, setRegisterEmail] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [registerConfirmPassword, setRegisterConfirmPassword] = useState('');
  const [registerPhone, setRegisterPhone] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [loginEmailError, setLoginEmailError] = useState<string | null>(null);
  const [loginPasswordError, setLoginPasswordError] = useState<string | null>(null);
  const [registerFieldErrors, setRegisterFieldErrors] = useState<RegisterFieldErrors>({});
  const [registerSuccess, setRegisterSuccess] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);

  // User Account Dropdown Toggle State
  const [isAccountDropdownOpen, setIsAccountDropdownOpen] = useState(false);
  const accountDropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (accountDropdownRef.current && !accountDropdownRef.current.contains(event.target as Node)) {
        setIsAccountDropdownOpen(false);
      }
    };
    if (isAccountDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isAccountDropdownOpen]);

  // Theme State: 'light' or 'dark' (Defaulting to light, persisted in localStorage)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('dafl_theme');
    return (saved === 'dark' || saved === 'light') ? saved : 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('dafl_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'light' ? 'dark' : 'light'));
  };

  // Notifications State & SignalR
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [toastAlert, setToastAlert] = useState<{ title: string; message: string; type: string; testId?: string } | null>(null);
  const signalRConnection = useRef<signalR.HubConnection | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = useCallback((title: string, message: string, type: string, testId?: string) => {
    setToastAlert({ title, message, type, testId });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToastAlert(null);
    }, 5000);
  }, []);

  // Sync profile form when user session updates
  useEffect(() => {
    if (user) {
      setProfileFullName(user.fullName);
      if (user.phoneNumber) setProfilePhone(user.phoneNumber);
      if (user.email) setProfileEmail(user.email);
    } else {
      setProfileFullName('');
      setProfilePhone('');
      setProfileEmail('');
    }
  }, [user]);

  // Giỏ khách: persist xuống localStorage mỗi khi giỏ hiển thị thay đổi trong lúc chưa đăng nhập.
  useEffect(() => {
    if (!authInitialized || user) return;
    try {
      window.localStorage.setItem(GUEST_CART_STORAGE_KEY, JSON.stringify(cart));
    } catch {
      /* bỏ qua */
    }
  }, [cart, user, authInitialized]);

  // 401 handler (CN-02 E3): phiên hết hạn → đăng xuất cục bộ + về màn hình đăng nhập kèm thông báo.
  useEffect(() => {
    setSessionExpiredHandler(() => {
      setUser(null);
      setCart(readGuestCart());
      setSessionExpired(true);
      const path = pathnameRef.current;
      if (path.startsWith('/cart') || path.startsWith('/orders') || path.startsWith('/profile') || path.startsWith('/payment')) {
        sessionStorage.setItem('dafl_return_route', path);
      }
      navigate('/login');
    });
    return () => setSessionExpiredHandler(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 1. Initial Load: Categories, Vouchers, User Session (JWT)
  useEffect(() => {
    fetchCategories();
    fetchVouchers();
    fetchUserSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Thông báo phụ thuộc người dùng: tải lại khi đăng nhập/đăng xuất
  useEffect(() => {
    fetchNotifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Quyền admin cho Header: 1 lần gọi GET /api/admin/profile khi đã đăng nhập,
  // cache trong phiên (403 → ẩn link, không spam API mỗi lần render).
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    if (!user) {
      setIsAdmin(false);
      try {
        sessionStorage.removeItem('dafl_admin_checked');
        sessionStorage.removeItem('dafl_is_admin');
      } catch { /* bỏ qua */ }
      return;
    }
    try {
      if (sessionStorage.getItem('dafl_admin_checked') === '1') {
        setIsAdmin(sessionStorage.getItem('dafl_is_admin') === '1');
        return;
      }
    } catch { /* bỏ qua */ }
    let cancelled = false;
    (async () => {
      try {
        const { body } = await apiJson<{ role?: string }>('/api/admin/profile', { skipAuthHandler: true });
        const ok = !!body?.success && body.data != null && (body.data.role === 'SuperAdmin' || body.data.role === 'Admin');
        if (cancelled) return;
        setIsAdmin(ok);
        try {
          sessionStorage.setItem('dafl_admin_checked', '1');
          sessionStorage.setItem('dafl_is_admin', ok ? '1' : '0');
        } catch { /* bỏ qua */ }
      } catch {
        /* offline: ẩn link admin */
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Đơn hàng: tải lại trang danh sách khi đổi người dùng / bộ lọc / trang
  useEffect(() => {
    if (user) {
      fetchOrdersPage(ordersPageNum, orderStatusFilter);
      fetchOrderHistory();
    } else {
      setOrdersList([]);
      setSelectedOrder(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, ordersPageNum, orderStatusFilter]);

  useEffect(() => {
    setOrdersPageNum(1);
    setCancelSuccessCode(null);
  }, [orderStatusFilter]);

  // Debounce search query with 350ms delay
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Nút "Áp dụng" cho khoảng giá: áp dụng ngay cùng phép tính với debounce bên dưới.
  // Nhận giá trị truyền vào để nút khoảng giá có sẵn áp dụng ngay trong cùng 1 lần bấm
  // (setState là bất đồng bộ nên không đọc lại state vừa set).
  const applyPriceFilterNow = (fromText: string = priceFromText, toText: string = priceToText) => {
    const from = fromText.trim() === '' ? null : Number(fromText.replace(/[^\d]/g, ''));
    const to = toText.trim() === '' ? null : Number(toText.replace(/[^\d]/g, ''));
    if (from !== null && to !== null && from > to) {
      setPriceFilterError('Giá bắt đầu không được lớn hơn giá đến.');
      return;
    }
    setPriceFilterError(null);
    setPriceRange(prev => (prev.from === from && prev.to === to ? prev : { from, to }));
  };

  // Bấm 1 khoảng giá có sẵn: điền luôn vào 2 ô Từ/Đến rồi áp dụng ngay.
  const applyPricePreset = (index: number) => {
    const preset = PRICE_PRESETS[index];
    setPriceFromText(preset.from);
    setPriceToText(preset.to);
    setActivePricePreset(index);
    applyPriceFilterNow(preset.from, preset.to);
  };

  // Debounce khoảng giá: from > to → lỗi price-filter-error và KHÔNG áp dụng lọc (CN-04.2)
  useEffect(() => {
    const timer = setTimeout(() => {
      const from = priceFromText.trim() === '' ? null : Number(priceFromText.replace(/[^\d]/g, ''));
      const to = priceToText.trim() === '' ? null : Number(priceToText.replace(/[^\d]/g, ''));
      if (from !== null && to !== null && from > to) {
        setPriceFilterError('Giá bắt đầu không được lớn hơn giá đến.');
        return;
      }
      setPriceFilterError(null);
      // Chỉ đổi state khi giá trị thật sự khác — tránh reset phân trang oan lúc mount.
      setPriceRange(prev => (prev.from === from && prev.to === to ? prev : { from, to }));
    }, 500);
    return () => clearTimeout(timer);
  }, [priceFromText, priceToText]);

  // Đổi bộ lọc → quay về trang 1
  useEffect(() => {
    setCatalogPage(1);
  }, [selectedCategory, debouncedSearch, sortOrder, priceRange]);

  useEffect(() => {
    fetchProductsPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCategory, debouncedSearch, sortOrder, priceRange, catalogPage]);

  // Vào trang giỏ: đồng bộ lại giỏ (server nếu đã đăng nhập, giá/tồn mới nếu là khách)
  // + chuẩn bị Idempotency-Key cho phiên checkout (CN-07 E5).
  useEffect(() => {
    if (location.pathname !== '/cart') return;
    if (!checkoutIdemKeyRef.current) {
      checkoutIdemKeyRef.current = newIdempotencyKey();
    }
    if (user) {
      loadServerCart();
    } else if (authInitialized) {
      syncGuestCartFromServer();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, user?.id]);

  // 2. Setup SignalR Real-time WebSocket connection (JWT qua accessTokenFactory)
  useEffect(() => {
    const hubUrl = `${API_BASE || 'http://localhost:5000'}/hubs/notifications`;
    const connection = new signalR.HubConnectionBuilder()
      .withUrl(hubUrl, {
        accessTokenFactory: () => getToken() || '',
        transport: signalR.HttpTransportType.WebSockets | signalR.HttpTransportType.LongPolling
      })
      .withAutomaticReconnect()
      .configureLogging(signalR.LogLevel.Warning)
      .build();

    connection.on('ReceiveNotification', (notif: any) => {
      const newNotif: NotificationItem = {
        id: notif.id || 'notif-' + Date.now(),
        title: notif.title || 'Thông báo mới',
        message: notif.message || '',
        type: notif.type || 'System',
        isRead: false,
        createdAt: notif.createdAt || new Date().toISOString()
      };
      setNotifications(prev => [newNotif, ...prev]);
      showToast(newNotif.title, newNotif.message, newNotif.type);
    });

    connection.on('ReceiveOrderStatusUpdate', (code: number, status: string, message: string) => {
      if (checkoutResult && checkoutResult.orderCode === code) {
        setOrderStatus(status);
      }
      if (embeddedPaymentModal && embeddedPaymentModal.orderCode === code && status === 'Paid') {
        setEmbeddedPaymentModal(null);
      }
      if (checkoutResult?.orderCode === code || embeddedPaymentModal?.orderCode === code) {
        showToast(`Đơn hàng #${code} cập nhật`, message, 'Order');
      }
      if (user) fetchOrderHistory();
    });

    connection.start()
      .then(() => {
        signalRConnection.current = connection;
      })
      .catch(err => {
        console.warn('[SignalR] NotificationHub not reachable, continuing in local mode:', err);
      });

    return () => {
      connection.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkoutResult, embeddedPaymentModal, user?.id]);

  // 3. Timer countdown for PayOS stock reservation
  useEffect(() => {
    if (!checkoutResult || orderStatus === 'Paid') return;
    const interval = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          setOrderStatus('Expired');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [checkoutResult, orderStatus]);

  // 4. Poll order payment status
  useEffect(() => {
    if (!checkoutResult || orderStatus === 'Paid' || orderStatus === 'Expired') return;
    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/payments/status/${checkoutResult.orderCode}`);
        const json: ApiResponse<any> = await res.json();
        if (json.success && json.data.status === 'Paid') {
          setOrderStatus('Paid');
          fetchOrderHistory();
          clearInterval(pollInterval);
        }
      } catch (err) {
        console.error('Status poll error:', err);
      }
    }, 3000);
    return () => clearInterval(pollInterval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkoutResult, orderStatus]);

  // ------------------------------------------
  // Data Fetching Helpers
  // ------------------------------------------
  const fetchCategories = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/categories`);
      const json: ApiResponse<Category[]> = await res.json();
      if (json.success && json.data && json.data.length > 0) {
        setCategories(json.data);
      } else {
        setCategories(FALLBACK_CATEGORIES);
      }
    } catch {
      setCategories(FALLBACK_CATEGORIES);
    }
  };

  const fetchVouchers = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/vouchers`);
      const json: ApiResponse<Voucher[]> = await res.json();
      if (json.success && json.data && json.data.length > 0) {
        setVouchers(json.data);
      } else {
        setVouchers(FALLBACK_VOUCHERS);
      }
    } catch {
      setVouchers(FALLBACK_VOUCHERS);
    }
  };

  /** Danh mục CN-04: phân trang server 12/trang (xin 13 để thăm dò trang sau), giữ bộ lọc khi chuyển trang. */
  const fetchProductsPage = async () => {
    const seq = ++catalogRequestSeq.current;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('page', String(catalogPage));
      params.append('pageSize', String(CATALOG_PAGE_SIZE + 1));
      if (selectedCategory) params.append('categoryId', selectedCategory);
      if (debouncedSearch) params.append('search', debouncedSearch);
      if (priceRange.from !== null) params.append('priceFrom', String(priceRange.from));
      if (priceRange.to !== null) params.append('priceTo', String(priceRange.to));
      if (sortOrder !== 'newest') params.append('sort', sortOrder);

      const res = await fetch(`${API_BASE}/api/products?${params.toString()}`);
      const json: ApiResponse<Product[]> = await res.json();
      if (seq !== catalogRequestSeq.current) return;
      if (json.success && Array.isArray(json.data)) {
        setCatalogHasNext(json.data.length > CATALOG_PAGE_SIZE);
        setProducts(json.data.slice(0, CATALOG_PAGE_SIZE));
        setCatalogKnownTotal(null);
      } else {
        applyFallbackCatalog();
      }
    } catch {
      if (seq !== catalogRequestSeq.current) return;
      applyFallbackCatalog();
    } finally {
      if (seq === catalogRequestSeq.current) setLoading(false);
    }
  };

  /** Chế độ offline: lọc + phân trang client trên dữ liệu dự phòng để trang vẫn dùng được. */
  const applyFallbackCatalog = () => {
    let filtered = [...FALLBACK_PRODUCTS];
    if (selectedCategory) filtered = filtered.filter(p => p.categoryId === selectedCategory);
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.toLowerCase();
      filtered = filtered.filter(p => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q));
    }
    if (priceRange.from !== null) filtered = filtered.filter(p => p.price >= (priceRange.from as number));
    if (priceRange.to !== null) filtered = filtered.filter(p => p.price <= (priceRange.to as number));
    if (sortOrder === 'price-asc') filtered.sort((a, b) => a.price - b.price);
    if (sortOrder === 'price-desc') filtered.sort((a, b) => b.price - a.price);
    setCatalogKnownTotal(filtered.length);
    setCatalogHasNext(catalogPage * CATALOG_PAGE_SIZE < filtered.length);
    const start = (catalogPage - 1) * CATALOG_PAGE_SIZE;
    setProducts(filtered.slice(start, start + CATALOG_PAGE_SIZE));
  };

  const clearCatalogFilters = () => {
    setSearchQuery('');
    setSelectedCategory(null);
    setPriceFromText('');
    setPriceToText('');
    setPriceFilterError(null);
    setPriceRange({ from: null, to: null });
    setSortOrder('newest');
    setCatalogPage(1);
  };

  const applyAuthenticatedUser = (authUser: User) => {
    setUser(authUser);
    setCustomerName(authUser.fullName);
    setCustomerEmail(authUser.email);
    if (authUser.phoneNumber) setCustomerPhone(authUser.phoneNumber);
    if (authUser.address) setShippingAddress(authUser.address);
  };

  /** Khôi phục phiên từ JWT đã lưu: /me trả data=null khi token hết hạn/không hợp lệ → coi như hết phiên (E3). */
  const fetchUserSession = async () => {
    const token = getToken();
    if (!token) {
      setAuthInitialized(true);
      return;
    }
    try {
      const { body } = await apiJson<User>('/api/auth/me', { skipAuthHandler: true });
      if (body?.success && body.data) {
        applyAuthenticatedUser(body.data);
        await loadServerCart();
      } else if (body) {
        // Server phản hồi nhưng không còn phiên → token hết hạn.
        clearToken();
        setSessionExpired(true);
      }
      // body null (không parse được) → giữ token, thử lại ở lần tải sau.
    } catch {
      // Mất mạng: giữ token trong máy, không kết luận hết phiên.
      console.warn('Auth check offline');
    } finally {
      setAuthInitialized(true);
    }
  };

  const fetchNotifications = async () => {
    try {
      const query = user?.id ? `?userId=${encodeURIComponent(user.id)}` : '';
      const res = await fetch(`${API_BASE}/api/notifications${query}`);
      const json: ApiResponse<NotificationItem[]> = await res.json();
      if (json.success && json.data && json.data.length > 0) {
        setNotifications(json.data);
      } else {
        setNotifications(FALLBACK_NOTIFICATIONS);
      }
    } catch {
      setNotifications(FALLBACK_NOTIFICATIONS);
    }
  };

  // ------------------------------------------
  // Product Detail (CN-05)
  // ------------------------------------------
  const loadProductDetailById = async (productId: string) => {
    if (lastLoadedProductIdRef.current === productId && selectedProduct?.id === productId) {
      return;
    }
    lastLoadedProductIdRef.current = productId;
    setDetailQuantity(1);
    setProductDetailLoading(true);
    setProductNotFound(false);
    if (selectedProduct?.id !== productId) {
      setSelectedProduct(null);
    }
    try {
      const res = await fetch(`${API_BASE}/api/products/${productId}`);
      const json: ApiResponse<ProductDetail> = await res.json();
      if (json.success && json.data && typeof json.data === 'object' && 'id' in json.data) {
        setSelectedProduct({ ...json.data, evaluations: json.data.evaluations || [] });
      } else {
        // BE trả success=false cho sản phẩm không tồn tại/ngừng bán → trang 404 (CN-05.3).
        setSelectedProduct(null);
        setProductNotFound(true);
      }
    } catch {
      const found = (products.length ? products : FALLBACK_PRODUCTS).find(p => p.id === productId);
      if (found) {
        setSelectedProduct({ ...found, evaluations: [] });
      } else {
        setSelectedProduct(null);
        setProductNotFound(true);
      }
    } finally {
      setProductDetailLoading(false);
    }
  };

  const openProductDetail = (product: Product) => {
    navigateTo('product', product.id);
  };

  // ------------------------------------------
  // Cart Operations (CN-06: hai tầng khách/server)
  // ------------------------------------------
  const applyServerCart = useCallback((dto: ServerCartDto) => {
    setCart(prev => mapServerCart(dto, prev));
    if (dto.notice) {
      showToast('Số lượng đã được điều chỉnh', dto.notice, 'System');
    }
  }, [showToast]);

  const loadServerCart = useCallback(async () => {
    try {
      const { body } = await apiJson<ServerCartDto>('/api/cart');
      if (body?.success && body.data) {
        setCart(prev => mapServerCart(body.data as ServerCartDto, prev));
      }
    } catch {
      /* offline: giữ giỏ đang hiển thị */
    }
  }, []);

  /** Khách mở giỏ: đồng bộ giá/tồn mới nhất từ chi tiết sản phẩm; 404 → đánh dấu ngừng bán. */
  const syncGuestCartFromServer = async () => {
    const current = readGuestCart();
    if (current.length === 0) return;
    const synced = await Promise.all(current.map(async item => {
      try {
        const res = await fetch(`${API_BASE}/api/products/${item.product.id}`);
        const json: ApiResponse<ProductDetail> = await res.json();
        if (json.success && json.data && typeof json.data === 'object' && 'id' in json.data) {
          const fresh = json.data;
          const priceChanged = fresh.price !== item.product.price;
          return {
            ...item,
            product: { ...item.product, price: fresh.price, availableStock: fresh.availableStock, imageUrl: fresh.imageUrl || item.product.imageUrl, name: fresh.name },
            isAvailable: fresh.availableStock > 0 ? item.isAvailable : false,
            priceChanged: priceChanged || item.priceChanged,
            previousPrice: priceChanged ? item.product.price : item.previousPrice,
          } as CartItem;
        }
        return { ...item, isAvailable: false };
      } catch {
        return item;
      }
    }));
    setCart(synced);
  };

  const toastAddedToCart = (product: Product) => {
    showToast('Đã thêm vào giỏ hàng', `Đã thêm ${product.name} vào giỏ hàng.`, 'Cart', 'cart-added-toast');
  };

  /** Thêm vào giỏ của khách (localStorage): cộng dồn + kẹp theo tồn kho (CN-06.2). */
  const addToGuestCart = (product: Product, qty: number) => {
    const stock = product.availableStock;
    setCart(prev => {
      const existing = prev.find(item => item.product.id === product.id);
      if (existing) {
        const requested = existing.quantity + qty;
        const clamped = typeof stock === 'number' && stock >= 0 ? Math.min(requested, stock) : requested;
        if (clamped < requested) {
          showToast('Số lượng đã được điều chỉnh', `Chỉ còn ${stock} sản phẩm.`, 'System');
        }
        return prev.map(item =>
          item.product.id === product.id ? { ...item, quantity: Math.max(1, clamped) } : item
        );
      }
      const initialQty = typeof stock === 'number' && stock > 0 ? Math.min(qty, stock) : qty;
      if (initialQty < qty) {
        showToast('Số lượng đã được điều chỉnh', `Chỉ còn ${stock} sản phẩm.`, 'System');
      }
      return [...prev, { product, quantity: Math.max(1, initialQty) }];
    });
    toastAddedToCart(product);
  };

  const addToCart = async (product: Product, qty: number = 1) => {
    setCheckoutResult(null);
    setOrderStatus('Pending');
    if (!user) {
      // CN-06.2: KHÔNG còn cổng đăng nhập — ai cũng thêm giỏ được.
      addToGuestCart(product, qty);
      return;
    }
    try {
      const { body } = await apiJson<ServerCartDto>('/api/cart/items', {
        method: 'POST',
        body: JSON.stringify({ productId: product.id, quantity: qty }),
      });
      if (body?.success && body.data) {
        applyServerCart(body.data);
        if (!body.data.notice) toastAddedToCart(product);
      } else if (body) {
        showToast('Không thêm được vào giỏ', body.message || 'Vui lòng thử lại.', 'System');
      } else {
        addToGuestCart(product, qty);
      }
    } catch {
      showToast('Không thêm được vào giỏ', 'Không thể kết nối đến máy chủ. Vui lòng thử lại.', 'System');
    }
  };

  /** Mua ngay (CN-05.2): thêm vào giỏ rồi chuyển thẳng sang trang giỏ/checkout. */
  const handleBuyNow = async (product: Product, qty: number = 1) => {
    setCheckoutResult(null);
    setOrderStatus('Pending');
    if (!user) {
      addToGuestCart(product, qty);
      // CN-07 bước 1: chưa đăng nhập → qua đăng nhập rồi quay lại /cart để thanh toán (E4).
      sessionStorage.setItem('dafl_return_route', '/cart');
      navigate('/login');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    await addToCart(product, qty);
    navigateTo('cart');
  };

  const setCartQuantity = async (productId: string, nextQty: number) => {
    const item = cart.find(entry => entry.product.id === productId);
    if (!item || nextQty < 1) return;
    if (!user) {
      const stock = item.product.availableStock;
      const clamped = typeof stock === 'number' && stock >= 0 ? Math.min(nextQty, stock) : nextQty;
      if (clamped < nextQty) {
        showToast('Số lượng đã được điều chỉnh', `Chỉ còn ${stock} sản phẩm.`, 'System');
      }
      setCart(prev => prev.map(entry =>
        entry.product.id === productId ? { ...entry, quantity: Math.max(1, clamped) } : entry
      ));
      return;
    }
    if (!item.serverItemId) return;
    try {
      const { body } = await apiJson<ServerCartDto>(`/api/cart/items/${item.serverItemId}`, {
        method: 'PUT',
        body: JSON.stringify({ quantity: nextQty }),
      });
      if (body?.success && body.data) applyServerCart(body.data);
      else if (body) showToast('Không cập nhật được giỏ', body.message || 'Vui lòng thử lại.', 'System');
    } catch {
      showToast('Không cập nhật được giỏ', 'Không thể kết nối đến máy chủ.', 'System');
    }
  };

  const updateQuantity = (productId: string, delta: number) => {
    const item = cart.find(entry => entry.product.id === productId);
    if (!item) return;
    void setCartQuantity(productId, item.quantity + delta);
  };

  const removeCartItem = async (productId: string) => {
    const item = cart.find(entry => entry.product.id === productId);
    if (!item) return;
    if (!user) {
      setCart(prev => prev.filter(entry => entry.product.id !== productId));
      return;
    }
    if (!item.serverItemId) return;
    try {
      const { body } = await apiJson<ServerCartDto>(`/api/cart/items/${item.serverItemId}`, { method: 'DELETE' });
      if (body?.success && body.data) applyServerCart(body.data);
      else if (body) showToast('Không xóa được sản phẩm', body.message || 'Vui lòng thử lại.', 'System');
    } catch {
      showToast('Không xóa được sản phẩm', 'Không thể kết nối đến máy chủ.', 'System');
    }
  };

  // Tổng tiền chỉ tính các dòng còn đặt được (CN-06.5: dòng ngừng bán bị loại khỏi tổng).
  const orderableItems = cart.filter(item => item.isAvailable !== false);
  const rawSubTotal = orderableItems.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  const discountAmount = appliedVoucher ? appliedVoucher.discountAmount : 0;
  const shippingFeeEstimate = orderableItems.length === 0 || rawSubTotal >= FREE_SHIPPING_THRESHOLD || appliedVoucher?.code === 'FREESHIP'
    ? 0
    : SHIPPING_FEE;
  const finalTotal = Math.max(0, rawSubTotal - discountAmount) + shippingFeeEstimate;
  const totalItemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const handleApplyVoucher = async (codeToApply?: string) => {
    const code = (codeToApply || voucherCodeInput).trim().toUpperCase();
    if (!code) return;

    try {
      const res = await fetch(`${API_BASE}/api/vouchers/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, cartAmount: rawSubTotal })
      });
      const json = await res.json();

      if (json.success && json.data) {
        setAppliedVoucher({
          code: json.data.code,
          discountAmount: json.data.discountAmount
        });
        setVoucherMessage(json.data.message);
      } else if (json && json.message) {
        // BE từ chối (không tồn tại/hết hạn/chưa đạt tối thiểu...) → hiện nguyên văn, không tự tính ở FE.
        setAppliedVoucher(null);
        setVoucherMessage(json.message);
      } else {
        applyLocalVoucher(code);
      }
    } catch {
      applyLocalVoucher(code);
    }
  };

  const applyLocalVoucher = (code: string) => {
    const v = (vouchers.length ? vouchers : FALLBACK_VOUCHERS).find(x => x.code === code);
    if (!v) {
      setVoucherMessage('Mã giảm giá không hợp lệ.');
      return;
    }
    if (rawSubTotal < v.minOrderAmount) {
      setVoucherMessage(`Đơn hàng tối thiểu cần đạt ${formatPrice(v.minOrderAmount)} để áp dụng mã này.`);
      return;
    }
    let disc = 0;
    if (v.code === 'FORDEV') {
      disc = Math.max(0, rawSubTotal - 2000);
    } else if (v.discountType === 'Percentage') {
      disc = rawSubTotal * (v.discountValue / 100);
      if (v.maxDiscountAmount && disc > v.maxDiscountAmount) disc = v.maxDiscountAmount;
    } else {
      disc = v.discountValue;
    }
    setAppliedVoucher({ code: v.code, discountAmount: disc });
    setVoucherMessage(v.code === 'FORDEV'
      ? 'Áp dụng thành công mã FORDEV! Đơn hàng chỉ còn 2.000đ để test PayOS.'
      : `Áp dụng thành công mã ${v.code}! Giảm ${formatPrice(disc)}.`);
  };

  // ------------------------------------------
  // Checkout (CN-07)
  // ------------------------------------------
  const handleRequireAuth = () => {
    sessionStorage.setItem('dafl_return_route', '/cart');
    showToast('Yêu cầu đăng nhập', 'Vui lòng đăng nhập tài khoản để tiến hành thanh toán đơn hàng.', 'System');
    navigate('/login');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const priceChangeSignature = cart
    .filter(item => item.priceChanged)
    .map(item => item.product.id)
    .sort()
    .join(',');

  const handleCheckout = async (e: React.FormEvent, values?: CheckoutFormValues) => {
    e.preventDefault();
    if (!user) {
      handleRequireAuth();
      return;
    }
    if (orderableItems.length === 0) {
      setCheckoutError('Giỏ hàng không có sản phẩm khả dụng để đặt hàng.');
      return;
    }
    // CN-07 E2: giá đã thay đổi → thông báo và yêu cầu khách xác nhận lại, không tự đặt.
    if (priceChangeSignature && priceChangeSignature !== ackedPriceSignature) {
      setShowPriceChangedNotice(true);
      setAckedPriceSignature(priceChangeSignature);
      return;
    }
    setShowPriceChangedNotice(false);
    setCheckoutError(null);
    setIsCheckingOut(true);
    try {
      if (!checkoutIdemKeyRef.current) {
        checkoutIdemKeyRef.current = newIdempotencyKey();
      }
      const idemKey = checkoutIdemKeyRef.current;
      const shipping = values?.shipping;
      const payload = {
        customerName: shipping?.recipientName ?? values?.customerName ?? customerName,
        customerEmail: shipping?.email ?? values?.customerEmail ?? customerEmail,
        customerPhone: shipping?.phone ?? values?.customerPhone ?? customerPhone,
        shippingAddress: values?.shippingAddress ?? shippingAddress,
        voucherCode: appliedVoucher?.code,
        userId: user?.id,
        items: orderableItems.map(item => ({
          productId: item.product.id,
          quantity: item.quantity
        })),
        paymentMethod: values?.paymentMethod ?? 'COD',
        orderNote: shipping?.note,
        idempotencyKey: idemKey,
        // Khối giao hàng có cấu trúc — BE lưu snapshot vào đơn. Mã địa giới gửi dạng STRING theo DTO của BE.
        ...(shipping
          ? {
              shipping: {
                recipientName: shipping.recipientName,
                phone: shipping.phone,
                provinceCode: String(shipping.provinceCode),
                provinceName: shipping.provinceName,
                districtCode: String(shipping.districtCode),
                districtName: shipping.districtName,
                wardCode: String(shipping.wardCode),
                wardName: shipping.wardName,
                detailAddress: shipping.detailAddress,
                note: shipping.note,
                addressBookId: shipping.addressBookId,
              },
            }
          : {}),
      };

      const res = await apiFetch('/api/orders/checkout', {
        method: 'POST',
        headers: { 'Idempotency-Key': idemKey },
        body: JSON.stringify(payload)
      });

      const json: ApiResponse<CheckoutResult> = await res.json();
      if (json.success && json.data) {
        setCheckoutResult({
          ...json.data,
          paymentMethod: json.data.paymentMethod || values?.paymentMethod || 'COD',
        });
        setOrderStatus('Pending');
        setTimeLeft(15 * 60);
        setLastOrderAddress(values?.shippingAddress ?? shippingAddress);
        // Đặt thành công → phiên checkout kết thúc, lần vào sau dùng key mới (E5).
        checkoutIdemKeyRef.current = null;
        setAckedPriceSignature('');
        // BE đã xóa các sản phẩm đã đặt khỏi giỏ server → đồng bộ lại giỏ hiển thị.
        await loadServerCart();
        fetchOrderHistory();
        // Tick "Lưu làm địa chỉ mặc định": lưu vào sổ địa chỉ (field setAsDefault + mã dạng string theo BE).
        if (shipping?.saveAsDefault) {
          try {
            await apiFetch('/api/addresses', {
              method: 'POST',
              body: JSON.stringify({
                recipientName: shipping.recipientName,
                phone: shipping.phone,
                provinceCode: String(shipping.provinceCode),
                provinceName: shipping.provinceName,
                districtCode: String(shipping.districtCode),
                districtName: shipping.districtName,
                wardCode: String(shipping.wardCode),
                wardName: shipping.wardName,
                detailAddress: shipping.detailAddress,
                note: shipping.note,
                setAsDefault: true,
              }),
            });
          } catch (saveErr) {
            console.warn('Không lưu được địa chỉ vào sổ địa chỉ:', saveErr);
          }
        }
      } else {
        // Lỗi BE (voucher/hết hàng/giá) → hiện NGUYÊN VĂN thông điệp (CN-07 E1/E2 + Mục 11.2).
        const message = json.message || 'Không thể tạo đơn hàng.';
        setCheckoutError(message);
        if (message.includes('Mã giảm giá')) {
          setAppliedVoucher(null);
          setVoucherMessage(message);
        }
        if (/tồn kho|ngừng bán|chỉ còn|không đủ/i.test(message)) {
          await loadServerCart();
        }
      }
    } catch (err) {
      console.error('API checkout error:', err);
      setCheckoutError('Không thể kết nối đến máy chủ thanh toán. Vui lòng kiểm tra kết nối mạng và thử lại sau.');
    } finally {
      setIsCheckingOut(false);
    }
  };

  const handleSimulatePaymentSuccess = async () => {
    if (!checkoutResult) return;
    try {
      const res = await fetch(`${API_BASE}/api/payments/status/${checkoutResult.orderCode}`);
      const json: ApiResponse<any> = await res.json();
      if (json.success && json.data?.status === 'Paid') {
        setOrderStatus('Paid');
        fetchOrderHistory();
        showToast('Thanh toán thành công', `Đơn hàng #${checkoutResult.orderCode} đã xác nhận thanh toán qua PayOS!`, 'Payment');
      } else {
        showToast('Đang chờ thanh toán', `Đơn hàng #${checkoutResult.orderCode} đang chờ giao dịch chuyển khoản...`, 'Payment');
      }
    } catch (err) {
      console.warn('Status check offline:', err);
      showToast('Thông báo', 'Chưa thể kết nối tới máy chủ thanh toán. Vui lòng thử lại sau.', 'Payment');
    }
  };

  // ------------------------------------------
  // Auth Operations (CN-01, CN-02 — JWT)
  // ------------------------------------------
  const updateLoginEmail = (value: string) => {
    setLoginEmail(value);
    if (loginEmailError) setLoginEmailError(null);
  };

  const updateLoginPassword = (value: string) => {
    setLoginPassword(value);
    if (loginPasswordError) setLoginPasswordError(null);
  };

  const getResponseError = (json: ApiResponse<any>, fallback: string) => {
    if (json.errors && json.errors.length > 0) return json.errors.join(' ');
    return json.message || fallback;
  };

  const clearAuthErrors = () => {
    setAuthError(null);
    setLoginEmailError(null);
    setLoginPasswordError(null);
    setRegisterFieldErrors({});
    setRegisterSuccess(false);
  };

  /**
   * Hoàn tất đăng nhập (mật khẩu): lưu JWT, merge giỏ khách vào giỏ server
   * (CN-06.6) rồi quay lại trang đã lưu (E4) hoặc về trang chủ từ trang auth.
   */
  const completeAuthentication = async (
    auth: AuthResult,
    toastTitle = 'Đăng nhập thành công',
    toastMessage?: string
  ) => {
    setToken(auth.token);
    applyAuthenticatedUser(auth.user);
    clearAuthErrors();
    setSessionExpired(false);
    setRegisterSuccess(false);

    const guestItems = readGuestCart();
    if (guestItems.length > 0) {
      clearGuestCartStorage();
      try {
        const { body } = await apiJson<ServerCartDto>('/api/cart/merge', {
          method: 'POST',
          body: JSON.stringify({
            items: guestItems.map(i => ({ productId: i.product.id, quantity: i.quantity })),
          }),
        });
        if (body?.success && body.data) {
          applyServerCart(body.data);
        } else {
          await loadServerCart();
        }
      } catch {
        await loadServerCart();
      }
    } else {
      await loadServerCart();
    }

    fetchOrderHistory();
    showToast(toastTitle, toastMessage || `Xin chào mừng trở lại, ${auth.user.fullName}!`, 'System');

    const returnRoute = sessionStorage.getItem('dafl_return_route');
    if (returnRoute) {
      sessionStorage.removeItem('dafl_return_route');
      const clean = returnRoute.replace(/^#\/?/, '').replace(/^\/+/, '');
      const parts = clean.split('/');
      navigateTo((parts[0] || 'home') as AppRoute, parts[1]);
    } else if (pathnameRef.current === '/login' || pathnameRef.current === '/register') {
      navigateTo('home');
    }
  };

  const handleAuthClose = () => {
    sessionStorage.removeItem('dafl_return_route');
    if (pathnameRef.current === '/login' || pathnameRef.current === '/register') {
      navigateTo('home');
    }
  };

  const handleLogin = async (e: React.FormEvent, values?: { email: string; password: string }) => {
    e.preventDefault();
    clearAuthErrors();

    const rawEmail = (values?.email ?? loginEmail).trim().toLowerCase();
    const password = values?.password ?? loginPassword;
    if (rawEmail !== loginEmail) setLoginEmail(rawEmail);

    if (!rawEmail) {
      setLoginEmailError('Email không được để trống.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
      setLoginEmailError('Email không đúng định dạng.');
      return;
    }
    if (!password) {
      setLoginPasswordError('Mật khẩu không được để trống.');
      return;
    }

    setAuthLoading(true);
    try {
      const { body } = await apiJson<AuthResult>('/api/auth/login', {
        method: 'POST',
        skipAuthHandler: true,
        body: JSON.stringify({ email: rawEmail, password }),
      });
      if (body?.success && body.data && body.data.token && body.data.user) {
        await completeAuthentication(body.data);
      } else {
        // CN-02.3: một thông điệp chung, hiện dưới ô mật khẩu (một chỗ duy nhất).
        setLoginPasswordError(body ? getResponseError(body, 'Email hoặc mật khẩu không đúng') : 'Email hoặc mật khẩu không đúng');
      }
    } catch {
      setAuthError('Không thể kết nối đến máy chủ. Vui lòng kiểm tra mạng và thử lại sau.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent, values?: RegisterFormValues) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);
    setRegisterFieldErrors({});
    setRegisterSuccess(false);

    const fullName = values?.fullName ?? registerName.trim();
    const email = values?.email ?? registerEmail.trim().toLowerCase();
    const password = values?.password ?? registerPassword;
    const phoneNumber = values?.phoneNumber ?? registerPhone.trim();
    const confirmPassword = registerConfirmPassword;

    try {
      const { body } = await apiJson<AuthResult>('/api/auth/register', {
        method: 'POST',
        skipAuthHandler: true,
        body: JSON.stringify({
          fullName,
          email,
          password,
          confirmPassword,
          phoneNumber,
        }),
      });
      if (body?.success) {
        // CN-01.4: KHÔNG tự đăng nhập dù BE có trả token — bỏ token, chuyển sang tab Đăng nhập.
        setRegisterPassword('');
        setRegisterConfirmPassword('');
        setLoginEmail(email);
        setLoginPassword('');
        setRegisterSuccess(true);
        setAuthTab('login');
        if (pathnameRef.current === '/register') {
          navigate('/login');
        }
      } else {
        const message = body ? getResponseError(body, 'Không thể đăng ký tài khoản.') : 'Không thể đăng ký tài khoản.';
        // Gán lỗi về đúng ô theo câu chữ của BE (CN-01.3).
        if (message.includes('Email')) {
          setRegisterFieldErrors({ email: message });
        } else if (message.includes('Số điện thoại')) {
          setRegisterFieldErrors({ phone: message });
        } else if (message.includes('Họ tên')) {
          setRegisterFieldErrors({ name: message });
        } else if (message.includes('xác nhận')) {
          setRegisterFieldErrors({ confirmPassword: message });
        } else if (message.includes('Mật khẩu')) {
          setRegisterFieldErrors({ password: message });
        } else {
          setAuthError(message);
        }
      }
    } catch {
      setAuthError('Không thể kết nối đến máy chủ. Vui lòng thử lại sau.');
    } finally {
      setAuthLoading(false);
    }
  };

  // Đặt mật khẩu cho tài khoản chưa có mật khẩu (trang Hồ sơ, CN-03).
  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSetPasswordError(null);
    if (setPasswordValue.length < 8 || !/[A-Z]/.test(setPasswordValue) || !/\d/.test(setPasswordValue) || !/[^a-zA-Z0-9]/.test(setPasswordValue)) {
      setSetPasswordError('Mật khẩu chưa đáp ứng đủ các điều kiện bảo mật bên dưới.');
      return;
    }
    if (setPasswordValue !== setPasswordConfirm) {
      setSetPasswordError('Mật khẩu nhập lại không khớp.');
      return;
    }
    setSettingPassword(true);
    try {
      // BE SetPasswordRequest chỉ nhận { newPassword }.
      const { body } = await apiJson<any>('/api/auth/set-password', {
        method: 'POST',
        body: JSON.stringify({ newPassword: setPasswordValue }),
      });
      if (body?.success) {
        setUser(prev => (prev ? { ...prev, hasPassword: true } : prev));
        setSetPasswordValue('');
        setSetPasswordConfirm('');
        setSetPasswordDone(true);
        showToast('Đặt mật khẩu thành công', 'Từ nay bạn có thể đăng nhập bằng email và mật khẩu.', 'System');
      } else {
        setSetPasswordError(body ? getResponseError(body, 'Không thể đặt mật khẩu. Vui lòng thử lại.') : 'Không thể đặt mật khẩu. Vui lòng thử lại.');
      }
    } catch {
      setSetPasswordError('Không thể kết nối đến máy chủ. Vui lòng kiểm tra mạng và thử lại sau.');
    } finally {
      setSettingPassword(false);
    }
  };

  const handleLogout = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST', skipAuthHandler: true });
    } catch (err) {
      console.warn('Logout API offline:', err);
    } finally {
      clearToken();
      setUser(null);
      setProfileFullName('');
      setProfileEmail('');
      setProfilePhone('');
      setProfileNameError(null);
      setProfilePhoneError(null);
      setProfileSuccess(false);
      setCpCurrent('');
      setCpNew('');
      setCpConfirm('');
      setCpErrors({});
      setCpSuccess(false);
      setSetPasswordValue('');
      setSetPasswordConfirm('');
      setSetPasswordError(null);
      setSetPasswordDone(false);
      setCustomerName('');
      setCustomerEmail('');
      setCustomerPhone('');
      setShippingAddress('');
      setOrderHistory([]);
      setOrdersList([]);
      setSelectedOrder(null);
      setAppliedVoucher(null);
      setVoucherMessage(null);
      setCheckoutResult(null);
      // CN-06.7: đăng xuất → hiển thị lại giỏ khách; giỏ server giữ nguyên ở BE.
      setCart(readGuestCart());
      showToast('Đã đăng xuất', 'Hẹn gặp lại bạn!', 'System');
      navigateTo('home');
    }
  };

  // ------------------------------------------
  // Orders (CN-08)
  // ------------------------------------------
  const fetchOrderHistory = async () => {
    if (!getToken()) {
      setOrderHistory([]);
      return;
    }
    setOrderHistoryLoading(true);
    try {
      const { body } = await apiJson<OrderHistory[]>('/api/orders/history');
      if (body?.success && Array.isArray(body.data)) {
        setOrderHistory(body.data);
      } else if (body) {
        setOrderHistory([]);
      }
    } catch {
      setOrderHistory([]);
    } finally {
      setOrderHistoryLoading(false);
    }
  };

  const fetchOrdersPage = async (page: number, statusLabel: string) => {
    if (!getToken()) return;
    const seq = ++ordersRequestSeq.current;
    setOrdersLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('page', String(page));
      params.append('pageSize', String(ORDERS_PAGE_SIZE + 1));
      if (statusLabel) params.append('status', statusLabel);
      const { body } = await apiJson<OrderHistory[]>(`/api/orders?${params.toString()}`);
      if (seq !== ordersRequestSeq.current) return;
      if (body?.success && Array.isArray(body.data)) {
        setOrdersHasNext(body.data.length > ORDERS_PAGE_SIZE);
        setOrdersList(body.data.slice(0, ORDERS_PAGE_SIZE));
      }
    } finally {
      if (seq === ordersRequestSeq.current) setOrdersLoading(false);
    }
  };

  const openOrderDetail = async (order: OrderHistory) => {
    setSelectedOrder(order);
    setCancelSuccessCode(null);
    setOrderDetailLoading(true);
    try {
      const { body } = await apiJson<OrderHistory>(`/api/orders/${order.id}`);
      if (body?.success && body.data) {
        setSelectedOrder(body.data);
      }
    } catch {
      /* giữ bản tóm tắt từ danh sách */
    } finally {
      setOrderDetailLoading(false);
    }
  };

  const handleCancelOrder = async () => {
    if (!cancelTarget) return;
    const reason = cancelReasonChoice === 'Khác' ? cancelReasonText.trim() : cancelReasonChoice;
    if (!reason) {
      setCancelError('Vui lòng nhập lý do hủy đơn.');
      return;
    }
    setCancelBusy(true);
    setCancelError(null);
    try {
      const { body } = await apiJson<any>(`/api/orders/${cancelTarget.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      if (body?.success) {
        const code = cancelTarget.orderDisplayCode || `#${cancelTarget.orderCode}`;
        setCancelTarget(null);
        setCancelReasonText('');
        // Cập nhật lại chi tiết + danh sách sau khi hủy (openOrderDetail sẽ xóa banner cũ,
        // nên chỉ set thông báo thành công SAU khi tải lại chi tiết xong).
        await openOrderDetail(cancelTarget);
        setCancelSuccessCode(code);
        fetchOrdersPage(ordersPageNum, orderStatusFilter);
        fetchOrderHistory();
      } else {
        setCancelError(body?.message || 'Không thể hủy đơn hàng.');
        await openOrderDetail(cancelTarget);
      }
    } catch {
      setCancelError('Không thể kết nối đến máy chủ. Vui lòng thử lại.');
    } finally {
      setCancelBusy(false);
    }
  };

  const navigateTo = (route: AppRoute | string, param?: string | number, returnUrl?: string) => {
    if (returnUrl) {
      sessionStorage.setItem('dafl_return_route', returnUrl);
    }
    if (route === 'notifications') {
      setIsNotifOpen(true);
      return;
    }
    if ((route === 'orders' || route === 'profile' || route === 'membership') && !user) {
      sessionStorage.setItem('dafl_return_route', `/${route}`);
      showToast('Yêu cầu đăng nhập', 'Vui lòng đăng nhập để truy cập trang này.', 'System');
      navigate('/login');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    let newUrl = '/';
    if (route === 'home') {
      newUrl = '/';
    } else if (param) {
      newUrl = `/${route}/${param}`;
    } else {
      newUrl = `/${route}`;
    }

    navigate(newUrl);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // If user accesses /notifications path directly, open modal and keep URL clean at /
  useEffect(() => {
    if (location.pathname === '/notifications') {
      setIsNotifOpen(true);
      navigate('/', { replace: true });
    }
  }, [location.pathname, navigate]);

  // Automatically clean up and redirect any legacy URLs with hash (e.g. #/cart, #/orders) to clean pathname
  useEffect(() => {
    if (window.location.hash) {
      const cleanHash = window.location.hash.replace(/^#\/?/, '');
      if (cleanHash) {
        navigate('/' + cleanHash, { replace: true });
      }
    }
  }, [navigate]);

  // Sync product detail when route matches /product/:id
  useEffect(() => {
    if (matchedProductId) {
      loadProductDetailById(matchedProductId);
    } else {
      lastLoadedProductIdRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchedProductId]);

  // ------------------------------------------
  // Profile (CN-03.1) & Change Password (CN-03.2)
  // ------------------------------------------
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = profileFullName.trim();
    const phone = profilePhone.trim();
    const nameError = name.length < 2 || name.length > 50 ? 'Họ tên không hợp lệ' : null;
    const phoneError = phone && !/^0\d{9}$/.test(phone) ? 'Số điện thoại không hợp lệ' : null;
    setProfileNameError(nameError);
    setProfilePhoneError(phoneError);
    setProfileSuccess(false);
    if (nameError || phoneError) return;

    setSavingProfile(true);
    try {
      const { body } = await apiJson<User>('/api/auth/profile', {
        method: 'PUT',
        body: JSON.stringify({
          fullName: name,
          phoneNumber: phone,
          // Giữ nguyên địa chỉ legacy của user để không bị xóa khi BE gán đè.
          address: user?.address,
        }),
      });
      if (body?.success && body.data) {
        setUser(body.data);
        setProfileSuccess(true);
        showToast('Cập nhật thành công', 'Thông tin hồ sơ của bạn đã được lưu.', 'System');
      } else {
        const message = body ? getResponseError(body, 'Không thể cập nhật hồ sơ.') : 'Không thể cập nhật hồ sơ.';
        if (message.includes('Số điện thoại')) setProfilePhoneError(message);
        else if (message.includes('Họ tên')) setProfileNameError(message);
        else showToast('Không cập nhật được hồ sơ', message, 'System');
      }
    } catch {
      showToast('Không cập nhật được hồ sơ', 'Không thể kết nối đến máy chủ.', 'System');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors: { current?: string; next?: string; confirm?: string } = {};
    if (!cpCurrent) errors.current = 'Vui lòng nhập mật khẩu hiện tại.';
    if (!cpNew) {
      errors.next = 'Vui lòng nhập mật khẩu mới.';
    } else if (cpNew.length < 8 || !/[A-Z]/.test(cpNew) || !/\d/.test(cpNew) || !/[^a-zA-Z0-9]/.test(cpNew)) {
      errors.next = 'Mật khẩu chưa đáp ứng đủ các điều kiện bảo mật bên dưới.';
    } else if (cpCurrent && cpNew === cpCurrent) {
      errors.next = 'Mật khẩu mới không được trùng với mật khẩu cũ';
    }
    if (!cpConfirm) {
      errors.confirm = 'Vui lòng nhập lại mật khẩu mới.';
    } else if (cpConfirm !== cpNew) {
      errors.confirm = 'Mật khẩu xác nhận không khớp';
    }
    setCpErrors(errors);
    setCpSuccess(false);
    if (Object.values(errors).some(Boolean)) return;

    setCpBusy(true);
    try {
      const { body } = await apiJson<any>('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: cpCurrent, newPassword: cpNew, confirmNewPassword: cpConfirm }),
      });
      if (body?.success) {
        setCpCurrent('');
        setCpNew('');
        setCpConfirm('');
        setCpSuccess(true);
        showToast('Đổi mật khẩu thành công', body.message || 'Mật khẩu của bạn đã được cập nhật.', 'System');
      } else {
        const message = body ? getResponseError(body, 'Không thể đổi mật khẩu.') : 'Không thể đổi mật khẩu.';
        // Lỗi mật khẩu hiện tại sai → hiện dưới ô mật khẩu hiện tại.
        if (message.includes('hiện tại')) setCpErrors({ current: message });
        else if (message.includes('xác nhận')) setCpErrors({ confirm: message });
        else if (message.includes('trùng')) setCpErrors({ next: message });
        else setCpErrors({ current: message });
      }
    } catch {
      setCpErrors({ current: 'Không thể kết nối đến máy chủ. Vui lòng thử lại sau.' });
    } finally {
      setCpBusy(false);
    }
  };

  const handleReorder = async (order: OrderHistory) => {
    if (!order.items || order.items.length === 0) return;
    if (user) {
      for (const it of order.items) {
        await apiJson<ServerCartDto>('/api/cart/items', {
          method: 'POST',
          body: JSON.stringify({ productId: it.productId, quantity: it.quantity }),
        }).catch(() => null);
      }
      await loadServerCart();
    } else {
      const newItems: CartItem[] = order.items.map(it => {
        const existingProd = products.find(p => p.id === it.productId) || {
          id: it.productId,
          name: it.productName,
          slug: it.productName.toLowerCase().replace(/\s+/g, '-'),
          categoryId: 'cat-1',
          categoryName: 'Sản phẩm',
          description: `Sản phẩm từ đơn hàng #${order.orderCode}`,
          price: it.unitPrice,
          availableStock: 99,
          imageUrl: it.productImageUrl || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop&q=80'
        };
        return { product: existingProd, quantity: it.quantity };
      });
      setCart(prev => {
        const merged = [...prev];
        newItems.forEach(ni => {
          const ex = merged.find(m => m.product.id === ni.product.id);
          if (ex) ex.quantity += ni.quantity;
          else merged.push(ni);
        });
        return merged;
      });
    }
    navigate('/cart');
    showToast('Đã thêm vào giỏ', `Đã thêm ${order.items.length} món từ đơn ${order.orderDisplayCode || `#${order.orderCode}`} vào giỏ hàng!`, 'Promotion');
  };

  const handleSimulatePaymentForOrder = async (orderCode: number, _totalAmount?: number) => {
    try {
      const res = await fetch(`${API_BASE}/api/payments/status/${orderCode}`);
      const json: ApiResponse<any> = await res.json();
      if (json.success && json.data?.status === 'Paid') {
        if (checkoutResult && checkoutResult.orderCode === orderCode) {
          setOrderStatus('Paid');
        }
        if (embeddedPaymentModal && embeddedPaymentModal.orderCode === orderCode) {
          setEmbeddedPaymentModal(null);
        }
        fetchOrderHistory();
        showToast('Thanh toán thành công', `Đơn hàng #${orderCode} đã được ngân hàng xác nhận!`, 'Payment');
      } else {
        showToast('Đang chờ thanh toán', `Đơn hàng #${orderCode} đang chờ giao dịch chuyển khoản...`, 'Payment');
      }
    } catch (err) {
      console.warn('Payment check offline:', err);
      showToast('Thông báo', 'Chưa thể kết nối tới máy chủ thanh toán.', 'Payment');
    }
  };

  // ------------------------------------------
  // Notifications Handlers
  // ------------------------------------------
  const markNotificationAsRead = async (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
    try {
      await fetch(`${API_BASE}/api/notifications/${id}/read`, { method: 'PUT' });
    } catch (err) {
      console.warn('Mark read offline:', err);
    }
  };

  const markAllNotificationsAsRead = async () => {
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    try {
      await fetch(`${API_BASE}/api/notifications/read-all`, { method: 'PUT' });
    } catch (err) {
      console.warn('Mark all read offline:', err);
    }
  };

  const unreadCount = notifications.filter(n => !n.isRead).length;
  const formatPrice = (val: number) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(val);
  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const orderStatusLabelOf = (order: OrderHistory): string =>
    order.statusLabel || (order.status === 'Pending'
      ? (order.paymentMethod === 'PayOS' ? 'Chờ thanh toán' : 'Chờ xác nhận')
      : order.status === 'Paid' ? 'Chờ xác nhận'
      : order.status === 'Confirmed' ? 'Đã xác nhận'
      : order.status === 'Preparing' ? 'Đang chuẩn bị'
      : order.status === 'Shipping' ? 'Đang giao'
      : order.status === 'Delivered' ? 'Đã giao'
      : order.status === 'Completed' ? 'Hoàn tất'
      : order.status === 'ReturnRequested' ? 'Trả hàng'
      : order.status === 'Cancelled' ? 'Đã hủy'
      : order.status === 'Expired' ? 'Đã hết hạn' : order.status);

  const commonAuthProps = {
    authError,
    authLoading,
    loginEmail,
    setLoginEmail: updateLoginEmail,
    loginPassword,
    setLoginPassword: updateLoginPassword,
    loginEmailError,
    loginPasswordError,
    registerName,
    setRegisterName,
    registerEmail,
    setRegisterEmail,
    registerPassword,
    setRegisterPassword,
    registerConfirmPassword,
    setRegisterConfirmPassword,
    registerPhone,
    setRegisterPhone,
    registerFieldErrors,
    registerSuccess,
    sessionExpired,
    onLogin: handleLogin,
    onRegister: handleRegister,
    onClearAuthErrors: clearAuthErrors,
  };

  /** Lọc theo danh mục mỹ phẩm: khớp slug thì dùng id đó, không khớp thì về danh
   *  mục đầu tiên. Không hardcode id danh mục. */
  const resolveCosmeticCategoryId = (slug: string): string | null =>
    categories.find(c => c.slug === slug)?.id
    ?? categories[0]?.id
    ?? null;

  const goToCosmeticCategory = (slug: string) => {
    const id = resolveCosmeticCategoryId(slug);
    if (id) setSelectedCategory(id);
    document.getElementById('products-section')?.scrollIntoView({ behavior: 'smooth' });
  };

  /** Bán chạy: top sản phẩm theo rating rồi reviewCount (tối đa 8); còn lại là gợi ý. */
  const bestSellerProducts = [...products]
    .sort((a, b) => ((b.rating ?? 0) - (a.rating ?? 0)) || ((b.reviewCount ?? 0) - (a.reviewCount ?? 0)))
    .slice(0, 8);
  const bestSellerIds = new Set(bestSellerProducts.map(p => p.id));
  const suggestedProducts = products.filter(p => !bestSellerIds.has(p.id));

  /** Flash Sale: sản phẩm đang giảm giá mạnh nhất (OriginalPrice > Price), xếp theo
   *  % giảm, tối đa 8. Lấy từ danh sách sản phẩm đã tải ở trang chủ. */
  const flashSaleProducts = [...products]
    .filter(p => (p.originalPrice ?? 0) > p.price)
    .sort((a, b) => (((b.originalPrice ?? 0) - b.price) / (b.originalPrice ?? 1)) - (((a.originalPrice ?? 0) - a.price) / (a.originalPrice ?? 1)))
    .slice(0, 8);
  /** Thời gian còn lại tới 23:59:59 hôm nay (định dạng HH:MM:SS). */
  const flashSaleEnd = new Date(flashNow);
  flashSaleEnd.setHours(23, 59, 59, 999);
  const flashLeftMs = Math.max(0, flashSaleEnd.getTime() - flashNow.getTime());
  const flashCountdown = [
    Math.floor(flashLeftMs / 3600000),
    Math.floor((flashLeftMs % 3600000) / 60000),
    Math.floor((flashLeftMs % 60000) / 1000),
  ].map(n => String(n).padStart(2, '0')).join(':');

  /**
   * Thẻ sản phẩm trong mục Bán chạy/Gợi ý: cùng sản phẩm đã có ở lưới chính nên phải
   * dùng id hậu tố ('-best'/'-suggest') — nếu giữ nguyên id thì data-testid trùng nhau
   * (Testing Library yêu cầu testid duy nhất, các test CN-06/CN-04 dùng findByTestId sẽ
   * fail "Found multiple elements"). Chỉ testid đổi theo id; onAddToCart/onOpenDetail
   * vẫn map về sản phẩm gốc nên thêm giỏ/mở chi tiết hoàn toàn đúng. Không sửa ProductCard.
   */
  const renderSectionCard = (product: Product, suffix: string) => (
    <ProductCard
      key={`${product.id}${suffix}`}
      product={{ ...product, id: `${product.id}${suffix}` }}
      onOpenDetail={() => openProductDetail(product)}
      onAddToCart={() => addToCart(product)}
    />
  );

  const isStandalone = location.pathname.startsWith('/mock-payos') || location.pathname.startsWith('/payment-success');

  return (
    <div className="app-container">
      {/* Live Toast Notification Alert */}
      {!isStandalone && toastAlert && (
        <div className="toast-container">
          <div className="toast-alert" data-testid={toastAlert.testId}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Sparkles size={16} color="#d81b60" />
              <strong style={{ fontSize: '0.875rem', color: 'var(--text-main)' }}>{toastAlert.title}</strong>
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{toastAlert.message}</p>
          </div>
        </div>
      )}

      {/* Header */}
      {!isStandalone && (
        <Header
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          onNavigate={navigateTo}
          theme={theme}
          onToggleTheme={toggleTheme}
          unreadCount={unreadCount}
          onToggleNotif={() => setIsNotifOpen(prev => !prev)}
          user={user}
          profileFullName={profileFullName}
          isAccountDropdownOpen={isAccountDropdownOpen}
          setIsAccountDropdownOpen={setIsAccountDropdownOpen}
          accountDropdownRef={accountDropdownRef}
          onLogout={handleLogout}
          onOpenAuth={() => navigateTo('login')}
          totalItemCount={totalItemCount}
          onOpenCart={() => navigateTo('cart')}
          isAdmin={isAdmin}
        />
      )}

      <Routes>
        {/* Home Route View */}
        <Route
          path="/"
          element={
            <>
              {/* Hero carousel — ít chữ, tự chạy */}
              <section className="hero-carousel" data-testid="hero-carousel" aria-label="Ưu đãi nổi bật">
                {HERO_SLIDES.map((slide, i) => (
                  <div
                    key={slide.title}
                    className={`hero-slide ${i === heroSlide ? 'active' : ''}`}
                    data-testid={`hero-slide-${i}`}
                    aria-hidden={i !== heroSlide}
                  >
                    <img
                      className="hero-slide-img"
                      src={slide.image}
                      alt=""
                      aria-hidden="true"
                      loading={i === 0 ? 'eager' : 'lazy'}
                      onError={e => {
                        const img = e.currentTarget;
                        if (img.src !== HERO_FALLBACK_IMAGE) img.src = HERO_FALLBACK_IMAGE;
                      }}
                    />
                    <div className="hero-text-box">
                      <div className="hero-top-badge">
                        <Sparkles size={14} color="#ffd900" />
                        <span>{slide.badge}</span>
                      </div>
                      <h1 className="hero-title">{slide.title}</h1>
                      <p className="hero-subtitle">{slide.sub}</p>
                      <button
                        type="button"
                        className="hero-pdd-cta"
                        onClick={() => document.getElementById('products-section')?.scrollIntoView({ behavior: 'smooth' })}
                      >
                        {slide.cta} →
                      </button>
                    </div>
                  </div>
                ))}
                <div className="hero-dots" role="tablist" aria-label="Chọn slide">
                  {HERO_SLIDES.map((slide, i) => (
                    <button
                      key={slide.title}
                      type="button"
                      role="tab"
                      aria-selected={i === heroSlide}
                      aria-label={`Slide ${i + 1}: ${slide.badge}`}
                      className={`hero-dot ${i === heroSlide ? 'active' : ''}`}
                      data-testid={`hero-dot-${i}`}
                      onClick={() => setHeroSlide(i)}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  className="hero-nav-btn hero-prev-btn"
                  data-testid="hero-prev-btn"
                  aria-label="Slide trước"
                  onClick={() => setHeroSlide(prev => (prev - 1 + HERO_SLIDES.length) % HERO_SLIDES.length)}
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="hero-nav-btn hero-next-btn"
                  data-testid="hero-next-btn"
                  aria-label="Slide sau"
                  onClick={() => setHeroSlide(prev => (prev + 1) % HERO_SLIDES.length)}
                >
                  ›
                </button>
              </section>

              {/* Dải tin cậy — 4 ý ngắn */}
              <section className="trust-strip" aria-label="Cam kết mua sắm">
                <span><ShieldCheck size={16} /> Chính hãng 100%</span>
                <span><Truck size={16} /> Freeship đơn từ 299K</span>
                <span><RotateCcw size={16} /> Đổi trả 30 ngày</span>
                <span><CreditCard size={16} /> PayOS &amp; COD</span>
              </section>

              {/* Hàng icon danh mục mỹ phẩm (kiểu Cocolux) — ngay dưới banner */}
              <section className="category-icon-row" data-testid="category-icon-row" aria-label="Danh mục mỹ phẩm">
                {COSMETIC_ICON_CATEGORIES.map(item => {
                  const matched = categories.find(c => c.slug === item.slug);
                  return (
                    <button
                      key={item.slug}
                      type="button"
                      className="category-icon-btn"
                      data-testid={`category-icon-${item.slug}`}
                      onClick={() => goToCosmeticCategory(item.slug)}
                    >
                      <span className="category-icon-emoji" aria-hidden="true">{item.icon}</span>
                      <span>{matched?.name ?? item.label}</span>
                    </button>
                  );
                })}
              </section>

              {/* Dải thương hiệu mỹ phẩm nổi bật */}
              <section className="brand-strip" data-testid="brand-strip" aria-label="Thương hiệu nổi bật">
                <span className="brand-strip-label">Thương hiệu nổi bật</span>
                <ul className="brand-strip-list">
                  {FEATURED_BRANDS.map(brand => (
                    <li key={brand} className="brand-strip-item">{brand}</li>
                  ))}
                </ul>
              </section>

              {/* Categories Filter Bar */}
              <CategoryFilter
                categories={categories}
                selectedCategory={selectedCategory}
                onSelectCategory={setSelectedCategory}
              />

              <div className="shop-layout">
                <aside className="shop-sidebar" aria-label="Bộ lọc sản phẩm">
                  <div className="filter-panel">
                    <div className="filter-group">
                      <h3>Khoảng giá</h3>
                      <div className="price-presets" data-testid="price-presets">
                        {PRICE_PRESETS.map((preset, index) => (
                          <button
                            key={preset.label}
                            type="button"
                            className={`price-preset-btn${activePricePreset === index ? ' active' : ''}`}
                            onClick={() => applyPricePreset(index)}
                            data-testid={`price-preset-${index}`}
                            aria-pressed={activePricePreset === index}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                      <div className="price-range-inputs">
                        <input
                          className="form-input"
                          type="text"
                          inputMode="numeric"
                          placeholder="Từ (đ)"
                          value={priceFromText}
                          onChange={e => { setPriceFromText(e.target.value); setActivePricePreset(null); }}
                          data-testid="price-from-input"
                          aria-label="Giá từ"
                        />
                        <span className="price-range-sep">—</span>
                        <input
                          className="form-input"
                          type="text"
                          inputMode="numeric"
                          placeholder="Đến (đ)"
                          value={priceToText}
                          onChange={e => { setPriceToText(e.target.value); setActivePricePreset(null); }}
                          data-testid="price-to-input"
                          aria-label="Giá đến"
                        />
                      </div>
                      {priceFilterError && (
                        <div data-testid="price-filter-error" className="filter-error">
                          {priceFilterError}
                        </div>
                      )}
                      <button
                        type="button"
                        className="btn btn-secondary price-apply-btn"
                        onClick={() => applyPriceFilterNow()}
                        data-testid="price-apply-btn"
                      >
                        Áp dụng
                      </button>
                    </div>

                    <div className="filter-group">
                      <h3>Loại sản phẩm</h3>
                      <button
                        type="button"
                        className={`filter-link ${selectedCategory === null ? 'active' : ''}`}
                        onClick={() => setSelectedCategory(null)}
                      >
                        Tất cả sản phẩm
                      </button>
                      {categories.map(category => (
                        <button
                          key={category.id}
                          type="button"
                          className={`filter-link ${selectedCategory === category.id ? 'active' : ''}`}
                          onClick={() => setSelectedCategory(category.id)}
                        >
                          {category.name}
                        </button>
                      ))}
                    </div>
                  </div>
                </aside>

                {/* Products Grid */}
                <section id="products-section" className="shop-main">
                  <div className="shop-section-header">
                    <h2>
                      {selectedCategory ? (categories.find(c => c.id === selectedCategory)?.name || 'Danh mục sản phẩm') : 'Tất cả sản phẩm'}
                    </h2>
                    <div className="catalog-toolbar">
                      <span className="product-count-badge" data-testid="catalog-result-count">
                        <Package size={14} color="var(--primary)" />
                        <span>
                          {catalogKnownTotal !== null
                            ? `Hiển thị ${products.length} / ${catalogKnownTotal} sản phẩm`
                            : `Hiển thị ${products.length} sản phẩm`}
                          {catalogPage > 1 ? ` • Trang ${catalogPage}` : ''}
                        </span>
                      </span>
                      <label className="sort-label">
                        Sắp xếp:
                        <select
                          className="form-input sort-select"
                          value={sortOrder}
                          onChange={e => setSortOrder(e.target.value as typeof sortOrder)}
                          data-testid="sort-select"
                        >
                          <option value="newest">Mới nhất</option>
                          <option value="price-asc">Giá tăng dần</option>
                          <option value="price-desc">Giá giảm dần</option>
                        </select>
                      </label>
                    </div>
                  </div>

                  {loading ? (
                    <div className="products-skeleton" data-testid="catalog-skeleton" aria-label="Đang tải sản phẩm">
                      {Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} className="skeleton-card">
                          <div className="skeleton-img" />
                          <div className="skeleton-line short" />
                          <div className="skeleton-line" />
                          <div className="skeleton-line price" />
                        </div>
                      ))}
                    </div>
                  ) : products.length === 0 ? (
                    <div className="shop-empty-state" data-testid="catalog-empty-state">
                      <p>Không tìm thấy sản phẩm phù hợp</p>
                      <button type="button" className="btn btn-primary" onClick={clearCatalogFilters} data-testid="clear-filters-btn">
                        Xóa bộ lọc
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="products-grid">
                        {products.map(product => (
                          <ProductCard
                            key={product.id}
                            product={product}
                            onOpenDetail={openProductDetail}
                            onAddToCart={addToCart}
                          />
                        ))}
                      </div>

                      {/* Phân trang server 12/trang (CN-04.4) — giữ nguyên bộ lọc khi chuyển trang */}
                      <nav className="catalog-pagination" data-testid="catalog-pagination" aria-label="Phân trang sản phẩm">
                        <button
                          type="button"
                          className="btn btn-secondary pagination-btn"
                          disabled={catalogPage <= 1}
                          onClick={() => setCatalogPage(p => Math.max(1, p - 1))}
                          data-testid="pagination-prev-btn"
                        >
                          ← Trang trước
                        </button>
                        {Array.from({ length: catalogPage }, (_, i) => i + 1).map(n => (
                          <button
                            key={n}
                            type="button"
                            className={`btn pagination-page-btn ${n === catalogPage ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => setCatalogPage(n)}
                            data-testid={`pagination-page-${n}`}
                          >
                            {n}
                          </button>
                        ))}
                        {catalogHasNext && (
                          <button
                            type="button"
                            className="btn btn-secondary pagination-page-btn"
                            onClick={() => setCatalogPage(catalogPage + 1)}
                            data-testid={`pagination-page-${catalogPage + 1}`}
                          >
                            {catalogPage + 1}
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-secondary pagination-btn"
                          disabled={!catalogHasNext}
                          onClick={() => setCatalogPage(p => p + 1)}
                          data-testid="pagination-next-btn"
                        >
                          Trang sau →
                        </button>
                      </nav>
                    </>
                  )}
                </section>
              </div>

              {/* Flash Sale — ngay dưới banner, trước mục Bán chạy; chỉ khi có SP đang giảm giá */}
              {selectedCategory === null && flashSaleProducts.length > 0 && (
                <section className="flash-sale-section" data-testid="flash-sale-section" aria-label="Flash Sale">
                  <div className="shop-strip-header">
                    <h2>⚡ Flash Sale</h2>
                    <span>
                      Kết thúc trong&nbsp;
                      <strong data-testid="flash-sale-countdown" style={{ color: '#d81b60', fontSize: '1.15rem' }}>{flashCountdown}</strong>
                    </span>
                  </div>
                  <div className="products-grid">
                    {flashSaleProducts.map(product => (
                      <div key={product.id} data-testid={`flash-sale-item-${product.id}`}>
                        {renderSectionCard(product, '-flash')}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Bán chạy + Gợi ý cho bạn — chỉ khi xem tất cả sản phẩm */}
              {selectedCategory === null && products.length > 0 && (
                <>
                  <section className="best-seller-section" data-testid="best-seller-section" aria-label="Bán chạy">
                    <div className="shop-strip-header">
                      <h2>Bán chạy</h2>
                      <span>Được mua nhiều nhất tuần này</span>
                    </div>
                    <div className="products-grid">
                      {bestSellerProducts.map(product => renderSectionCard(product, '-best'))}
                    </div>
                  </section>
                  {suggestedProducts.length > 0 && (
                    <section className="suggested-section" data-testid="suggested-section" aria-label="Gợi ý cho bạn">
                      <div className="shop-strip-header">
                        <h2>Gợi ý cho bạn</h2>
                        <span>Có thể bạn sẽ thích</span>
                      </div>
                      <div className="products-grid">
                        {suggestedProducts.map(product => renderSectionCard(product, '-suggest'))}
                      </div>
                    </section>
                  )}
                </>
              )}

              {/* Gian hàng mỹ phẩm nổi bật */}
              <section className="shop-strip" aria-label="Gian hàng nổi bật">
                <div className="shop-strip-header">
                  <h2>Gian hàng nổi bật</h2>
                  <span>Nhiều shop mỹ phẩm chính hãng trên một sàn</span>
                </div>
                <div className="shop-strip-row">
                  {FEATURED_SHOPS.map(shop => (
                    <button
                      key={shop.slug}
                      type="button"
                      className="shop-card"
                      data-testid={`shop-card-${shop.slug}`}
                      onClick={() => {
                        // Gian hàng nổi bật → hiện tất cả mỹ phẩm (bỏ lọc danh mục).
                        setSelectedCategory(null);
                        document.getElementById('products-section')?.scrollIntoView({ behavior: 'smooth' });
                      }}
                    >
                      <span className="shop-card-icon"><Store size={20} /></span>
                      <strong>{shop.name}</strong>
                      <span className="shop-card-meta">
                        <Star size={12} fill="#f5a623" color="#f5a623" /> {shop.rating} • {shop.sold}
                      </span>
                      <span className="shop-card-tag">{shop.tag}</span>
                    </button>
                  ))}
                </div>
              </section>
            </>
          }
        />

        {/* ============================================================== */}
        {/* ROUTE VIEW: ORDERS & ORDER HISTORY (/orders) — CN-08 */}
        {/* ============================================================== */}
        <Route
          path="/orders"
          element={
            authInitialized && !user ? (
              <Navigate to="/login" replace />
            ) : (
              <section className="orders-page">
                <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 14 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: '8px 14px', fontSize: '0.85rem' }}
                        onClick={() => navigateTo('home')}
                      >
                        <ArrowLeft size={16} /> Tiếp tục mua sắm
                      </button>
                      <h1 className="page-title" style={{ margin: 0 }}>
                        <Package size={26} color="var(--primary)" /> Đơn hàng của tôi
                      </h1>
                    </div>
                    <p className="page-subtitle" style={{ marginTop: 6 }}>
                      Theo dõi đơn theo trạng thái, xem chi tiết và hủy đơn khi còn chờ xác nhận.
                    </p>
                  </div>

                  <div style={{ display: 'flex', gap: 10 }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => { fetchOrdersPage(ordersPageNum, orderStatusFilter); fetchOrderHistory(); }}
                      disabled={ordersLoading}
                      style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                      <RefreshCw size={15} className={ordersLoading ? 'spin' : ''} />
                      Làm mới danh sách
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => navigateTo('profile')}
                      style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                      <MapPin size={15} color="#d81b60" /> Sổ địa chỉ giao hàng
                    </button>
                  </div>
                </div>

                {/* Bộ lọc theo trạng thái — tab theo máy trạng thái §4/§8 của tài liệu nghiệp vụ.
                    Số lượng mỗi tab tính từ lịch sử đơn đã tải (/api/orders/history). */}
                <div className="order-filter-tabs" data-testid="order-status-filter" role="tablist" aria-label="Lọc đơn theo trạng thái">
                  {[
                    { value: '', label: 'Tất cả' },
                    { value: 'Chờ xác nhận', label: 'Chờ xác nhận' },
                    { value: 'Chờ thanh toán', label: 'Chờ thanh toán' },
                    { value: 'Đã xác nhận', label: 'Đã xác nhận' },
                    { value: 'Đang giao', label: 'Đang giao' },
                    { value: 'Đã giao', label: 'Đã giao' },
                    { value: 'Hoàn tất', label: 'Hoàn tất' },
                    { value: 'Trả hàng', label: 'Trả hàng' },
                    { value: 'Đã hủy', label: 'Đã hủy' },
                  ].map(tab => {
                    const tabCount = tab.value === ''
                      ? orderHistory.length
                      : orderHistory.filter(o => o.statusLabel === tab.value).length;
                    return (
                    <button
                      key={tab.value || 'all'}
                      type="button"
                      role="tab"
                      aria-selected={orderStatusFilter === tab.value}
                      className={`order-filter-btn ${orderStatusFilter === tab.value ? 'active' : ''}`}
                      data-testid={`order-status-tab-${tab.value || 'all'}`}
                      onClick={() => setOrderStatusFilter(tab.value)}
                    >
                      {tab.label}
                      {tabCount > 0 ? ` (${tabCount})` : ''}
                    </button>
                    );
                  })}
                </div>

                {cancelSuccessCode && (
                  <div className="cancel-success-banner" data-testid="cancel-success-msg">
                    <CheckCircle2 size={16} color="#16a34a" /> Hủy đơn thành công
                  </div>
                )}

                {/* Orders List */}
                {ordersLoading && ordersList.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
                    <RefreshCw size={36} className="spin" style={{ margin: '0 auto 12px', color: 'var(--primary)' }} />
                    <p>Đang tải danh sách đơn hàng từ máy chủ...</p>
                  </div>
                ) : ordersList.length === 0 ? (
                  <div className="empty-state-card" data-testid="orders-empty-state">
                    <Package size={56} style={{ margin: '0 auto 14px', opacity: 0.3, color: 'var(--text-muted)' }} />
                    <h3 style={{ fontSize: '1.2rem', marginBottom: 8 }}>Bạn chưa có đơn hàng nào</h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: 20 }}>
                      Khám phá deal mỹ phẩm nổi bật trên DAFL!
                    </p>
                    <button type="button" className="btn btn-primary" onClick={() => navigateTo('home')}>
                      <ShoppingBag size={16} /> Mua sắm ngay
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="orders-list-container" data-testid="orders-list">
                      {ordersList.map(order => {
                        const label = orderStatusLabelOf(order);
                        const displayCode = order.orderDisplayCode || `#${order.orderCode}`;
                        return (
                          <div key={order.id} className="order-card" data-testid={`order-item-${displayCode}`}>
                            <div className="order-card-header">
                              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                <span style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--text-main)' }}>
                                  Mã đơn: {displayCode}
                                </span>
                                <span className={`order-status-badge ${order.status.toLowerCase()}`}>
                                  {label}
                                </span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <Calendar size={14} /> {new Date(order.createdAt).toLocaleString('vi-VN')}
                                </span>
                              </div>
                            </div>

                            <div className="order-items-list">
                              {order.items && order.items.slice(0, 3).map(item => (
                                <div key={item.id} className="order-item-row">
                                  <img
                                    src={item.productImageUrl || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop&q=80'}
                                    alt={item.productName}
                                    className="order-item-img"
                                  />
                                  <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: 4 }}>
                                      {item.productName}
                                    </div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                      Số lượng: x{item.quantity} • Đơn giá: {formatPrice(item.unitPrice)}
                                    </div>
                                  </div>
                                  <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-main)' }}>
                                    {formatPrice(item.unitPrice * item.quantity)}
                                  </div>
                                </div>
                              ))}
                              {order.items && order.items.length > 3 && (
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', padding: '4px 0' }}>
                                  … và {order.items.length - 3} sản phẩm khác
                                </div>
                              )}
                            </div>

                            <div className="order-footer-actions">
                              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                Tổng giá trị đơn: <strong style={{ color: '#d81b60', fontSize: '1.15rem' }}>{formatPrice(order.totalAmount)}</strong>
                              </div>
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                {label === 'Chờ thanh toán' && (
                                  <button
                                    type="button"
                                    className="btn btn-primary"
                                    style={{ padding: '8px 16px', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                                    onClick={() => navigate(`/payment/${order.orderCode}`)}
                                  >
                                    <CreditCard size={15} /> Thanh toán ngay
                                  </button>
                                )}
                                {(order.status === 'Paid' || order.status === 'Delivered' || order.status === 'Completed' || order.status === 'Cancelled') && (
                                  <button
                                    type="button"
                                    className="btn btn-secondary"
                                    style={{ padding: '8px 16px', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                                    onClick={() => handleReorder(order)}
                                  >
                                    <RotateCcw size={14} /> Mua lại
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  style={{ padding: '8px 16px', fontSize: '0.85rem' }}
                                  onClick={() => openOrderDetail(order)}
                                  data-testid={`order-detail-btn-${displayCode}`}
                                >
                                  Xem chi tiết
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Phân trang đơn hàng */}
                    <nav className="catalog-pagination" data-testid="orders-pagination" aria-label="Phân trang đơn hàng">
                      <button
                        type="button"
                        className="btn btn-secondary pagination-btn"
                        disabled={ordersPageNum <= 1}
                        onClick={() => setOrdersPageNum(p => Math.max(1, p - 1))}
                        data-testid="orders-prev-btn"
                      >
                        ← Trang trước
                      </button>
                      <span className="pagination-current">Trang {ordersPageNum}</span>
                      <button
                        type="button"
                        className="btn btn-secondary pagination-btn"
                        disabled={!ordersHasNext}
                        onClick={() => setOrdersPageNum(p => p + 1)}
                        data-testid="orders-next-btn"
                      >
                        Trang sau →
                      </button>
                    </nav>
                  </>
                )}

                {/* Chi tiết đơn hàng (CN-08.2) */}
                {selectedOrder && (
                  <div className="order-detail-card" data-testid="order-detail-view">
                    <div className="order-detail-header">
                      <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800 }}>
                        Chi tiết đơn {selectedOrder.orderDisplayCode || `#${selectedOrder.orderCode}`}
                      </h3>
                      <span className={`order-status-badge ${selectedOrder.status.toLowerCase()}`} data-testid="order-detail-status">
                        {orderStatusLabelOf(selectedOrder)}
                      </span>
                    </div>

                    <div
                      data-testid="order-shipping-info"
                      style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 14px', background: 'var(--bg-subtle)', borderRadius: 8, marginBottom: 14, fontSize: '0.85rem' }}
                    >
                      <MapPin size={16} color="var(--primary)" style={{ flexShrink: 0, marginTop: 2 }} />
                      <div>
                        <strong>{selectedOrder.customerName}</strong> ({selectedOrder.customerPhone}) —{' '}
                        <span style={{ color: 'var(--text-muted)' }}>
                          {selectedOrder.shippingAddress ||
                            [selectedOrder.shipDetailAddress, selectedOrder.shipWardName, selectedOrder.shipDistrictName, selectedOrder.shipProvinceName]
                              .filter(Boolean)
                              .join(', ')}
                        </span>
                        {selectedOrder.shipNote && (
                          <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>
                            Ghi chú giao hàng: {selectedOrder.shipNote}
                          </div>
                        )}
                        <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>
                          Phương thức thanh toán: {selectedOrder.paymentMethod === 'PayOS' ? 'PayOS (thanh toán trực tuyến)' : 'Thanh toán khi nhận hàng (COD)'}
                        </div>
                      </div>
                    </div>

                    <div className="order-items-list">
                      {selectedOrder.items && selectedOrder.items.map(item => (
                        <div key={item.id} className="order-item-row">
                          <img
                            src={item.productImageUrl || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop&q=80'}
                            alt={item.productName}
                            className="order-item-img"
                          />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: 4 }}>{item.productName}</div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                              Số lượng: x{item.quantity} • Đơn giá: {formatPrice(item.unitPrice)}
                            </div>
                          </div>
                          <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-main)' }}>
                            {formatPrice(item.unitPrice * item.quantity)}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="order-detail-totals">
                      <div><span>Tạm tính:</span><span>{formatPrice(selectedOrder.subTotal)}</span></div>
                      {(selectedOrder.shippingFee ?? 0) > 0 && (
                        <div><span>Phí vận chuyển:</span><span>{formatPrice(selectedOrder.shippingFee || 0)}</span></div>
                      )}
                      {(selectedOrder.shippingFee ?? 0) === 0 && (
                        <div><span>Phí vận chuyển:</span><span>Miễn phí</span></div>
                      )}
                      {selectedOrder.discountAmount > 0 && (
                        <div><span>Giảm giá{selectedOrder.voucherCode ? ` (${selectedOrder.voucherCode})` : ''}:</span><span>-{formatPrice(selectedOrder.discountAmount)}</span></div>
                      )}
                      <div className="order-detail-grand-total"><span>Tổng cộng:</span><span>{formatPrice(selectedOrder.totalAmount)}</span></div>
                    </div>

                    {/* Stepper vòng đời đơn (§4/§8) + lịch sử trạng thái chi tiết */}
                    <div className="order-timeline-box" data-testid="order-timeline">
                      <div className="order-stepper" aria-label="Tiến trình đơn hàng">
                        {ORDER_FLOW_STEPS.map((step, i) => {
                          const currentIdx = ORDER_STEP_INDEX[selectedOrder.status] ?? 0;
                          const cancelled = selectedOrder.status === 'Cancelled';
                          const done = !cancelled && i <= currentIdx;
                          const isCurrent = !cancelled && i === currentIdx;
                          return (
                            <div key={step} className={`order-step ${done ? 'done' : ''} ${isCurrent ? 'current' : ''}`}>
                              <span className="order-step-dot">{done ? <Check size={11} /> : i + 1}</span>
                              <span className="order-step-label">{step}</span>
                              {i < ORDER_FLOW_STEPS.length - 1 && <span className="order-step-line" />}
                            </div>
                          );
                        })}
                      </div>
                      {selectedOrder.status === 'Cancelled' && (
                        <div style={{ fontSize: '0.8rem', color: '#ef4444', marginTop: 8 }}>Đơn đã hủy — không đi tiếp các bước sau.</div>
                      )}
                      {selectedOrder.statusHistories && selectedOrder.statusHistories.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10 }}>
                          {selectedOrder.statusHistories.map((h, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem' }}>
                              <CheckCircle2 size={12} color="#10b981" />
                              <span>{new Date(h.timestamp).toLocaleString('vi-VN')}</span>
                              <span style={{ fontWeight: 600 }}>{h.note || 'Cập nhật trạng thái'}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {orderStatusLabelOf(selectedOrder) === 'Đã hủy' && selectedOrder.cancelReason && (
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 10 }}>
                        Lý do hủy: <strong style={{ color: 'var(--text-main)' }}>{selectedOrder.cancelReason}</strong>
                      </p>
                    )}

                    <div className="order-detail-actions">
                      {orderStatusLabelOf(selectedOrder) === 'Chờ xác nhận' ? (
                        <button
                          type="button"
                          className="btn btn-danger-outline"
                          onClick={() => {
                            setCancelTarget(selectedOrder);
                            setCancelReasonChoice('Đổi ý, không muốn mua nữa');
                            setCancelReasonText('');
                            setCancelError(null);
                          }}
                          data-testid="cancel-order-btn"
                        >
                          Hủy đơn hàng
                        </button>
                      ) : (orderStatusLabelOf(selectedOrder) === 'Đang chuẩn bị' || orderStatusLabelOf(selectedOrder) === 'Đang giao') ? (
                        <p className="order-support-note" data-testid="order-support-note">
                          Đơn hàng đang được xử lý/vận chuyển nên không thể hủy trực tuyến. Vui lòng liên hệ hỗ trợ
                        </p>
                      ) : null}
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => setSelectedOrder(null)}
                      >
                        Đóng chi tiết
                      </button>
                    </div>
                    {orderDetailLoading && (
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 8 }}>Đang tải chi tiết mới nhất…</p>
                    )}
                  </div>
                )}

                {/* Hộp xác nhận hủy đơn (CN-08.3) */}
                {cancelTarget && (
                  <div className="modal-overlay" onClick={() => !cancelBusy && setCancelTarget(null)}>
                    <div className="modal-content cancel-dialog" onClick={e => e.stopPropagation()} data-testid="cancel-order-dialog">
                      <div className="modal-header">
                        <h2 className="modal-title" style={{ margin: 0 }}>
                          Hủy đơn {cancelTarget.orderDisplayCode || `#${cancelTarget.orderCode}`}?
                        </h2>
                        <button className="close-btn" onClick={() => setCancelTarget(null)} disabled={cancelBusy} title="Đóng">
                          <X size={20} />
                        </button>
                      </div>
                      <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 14 }}>
                        Đơn hàng sẽ bị hủy và số lượng sản phẩm được hoàn về kho. Thao tác này không thể hoàn tác.
                      </p>
                      <div className="form-group">
                        <label className="form-label" htmlFor="cancel-reason-select">Lý do hủy đơn</label>
                        <select
                          id="cancel-reason-select"
                          className="form-input"
                          value={cancelReasonChoice}
                          onChange={e => setCancelReasonChoice(e.target.value)}
                          data-testid="cancel-reason-select"
                        >
                          <option value="Đổi ý, không muốn mua nữa">Đổi ý, không muốn mua nữa</option>
                          <option value="Đặt nhầm sản phẩm">Đặt nhầm sản phẩm</option>
                          <option value="Tìm được giá tốt hơn">Tìm được giá tốt hơn</option>
                          <option value="Thời gian giao hàng quá lâu">Thời gian giao hàng quá lâu</option>
                          <option value="Khác">Khác</option>
                        </select>
                      </div>
                      {cancelReasonChoice === 'Khác' && (
                        <div className="form-group">
                          <label className="form-label" htmlFor="cancel-reason-input">Nhập lý do của bạn</label>
                          <input
                            id="cancel-reason-input"
                            className="form-input"
                            value={cancelReasonText}
                            onChange={e => setCancelReasonText(e.target.value)}
                            placeholder="Ví dụ: Tôi muốn đổi sang sản phẩm khác"
                            data-testid="cancel-reason-input"
                          />
                        </div>
                      )}
                      {cancelError && (
                        <div style={{ color: '#d81b60', fontSize: '0.85rem', marginBottom: 12 }}>{cancelError}</div>
                      )}
                      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => setCancelTarget(null)}
                          disabled={cancelBusy}
                          data-testid="cancel-cancel-btn"
                        >
                          Không hủy nữa
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={handleCancelOrder}
                          disabled={cancelBusy}
                          data-testid="cancel-confirm-btn"
                        >
                          {cancelBusy ? 'Đang hủy đơn...' : 'Xác nhận hủy đơn'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </section>
            )
          }
        />

        {/* ============================================================== */}
        {/* ROUTE VIEW: MEMBERSHIP (/membership) — đợt 13, mục 2 */}
        {/* ============================================================== */}
        <Route
          path="/membership"
          element={
            authInitialized && !user ? (
              <Navigate to="/login" replace />
            ) : (
              <MembershipPage onBack={() => navigateTo('home')} />
            )
          }
        />

        {/* ============================================================== */}
        {/* ROUTE VIEW: PROFILE (/profile) — CN-03 */}
        {/* ============================================================== */}
        <Route
          path="/profile"
          element={
            authInitialized && !user ? (
              <Navigate to="/login" replace />
            ) : (
              <section className="profile-page">
                <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                        onClick={() => navigateTo('home')}
                      >
                        <ArrowLeft size={16} /> Trang chủ
                      </button>
                      <h1 className="page-title" style={{ margin: 0 }}>
                        <UserIcon size={26} color="var(--primary)" /> Tài khoản của tôi
                      </h1>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => navigateTo('orders')}
                    style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    <Package size={15} /> Xem đơn hàng của tôi ({orderHistory.length})
                  </button>
                </div>

                <div className="profile-card">
                  {/* User Avatar & Session Info */}
                  <div className="profile-avatar-banner">
                    <div className="profile-avatar-circle">
                      {(profileFullName || user?.fullName || 'U').charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <h3 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0 }}>
                          {profileFullName || user?.fullName || 'Thông tin tài khoản'}
                        </h3>
                        <span className="brand-badge" style={{ fontSize: '0.75rem' }}>
                          {user?.role || 'Khách hàng'}
                        </span>
                      </div>
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '4px 0 0' }}>
                        {profileEmail || user?.email || 'Chưa liên kết email'} • Hồ sơ, mật khẩu & sổ địa chỉ
                      </p>
                    </div>

                    {user && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ color: '#f87171', borderColor: 'rgba(244, 63, 94, 0.3)', fontSize: '0.8rem', padding: '6px 12px' }}
                        onClick={handleLogout}
                      >
                        <LogOut size={14} /> Đăng xuất
                      </button>
                    )}
                  </div>

                  {/* Form hồ sơ (CN-03.1) */}
                  <form onSubmit={handleSaveProfile} noValidate data-testid="profile-form">
                    <h3 className="profile-section-title">Thông tin cá nhân</h3>
                    <div className="address-form-grid">
                      <div className="form-group">
                        <label className="form-label" htmlFor="profile-name">Họ và tên</label>
                        <input
                          id="profile-name"
                          className="form-input"
                          data-testid="profile-name-input"
                          value={profileFullName}
                          onChange={e => {
                            setProfileFullName(e.target.value);
                            setProfileNameError(null);
                            setProfileSuccess(false);
                          }}
                          placeholder="Nguyễn Văn A"
                          style={profileNameError ? { borderColor: '#d81b60' } : {}}
                        />
                        {profileNameError && (
                          <div data-testid="profile-name-error" style={{ color: '#d81b60', fontSize: '0.8rem', marginTop: 6 }}>
                            {profileNameError}
                          </div>
                        )}
                      </div>

                      <div className="form-group">
                        <label className="form-label" htmlFor="profile-phone">Số điện thoại</label>
                        <input
                          id="profile-phone"
                          className="form-input"
                          data-testid="profile-phone-input"
                          value={profilePhone}
                          onChange={e => {
                            setProfilePhone(e.target.value);
                            setProfilePhoneError(null);
                            setProfileSuccess(false);
                          }}
                          placeholder="0987654321"
                          style={profilePhoneError ? { borderColor: '#d81b60' } : {}}
                        />
                        {profilePhoneError && (
                          <div data-testid="profile-phone-error" style={{ color: '#d81b60', fontSize: '0.8rem', marginTop: 6 }}>
                            {profilePhoneError}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="form-group">
                      <label className="form-label" htmlFor="profile-email">Email đăng nhập (không thể thay đổi)</label>
                      <input
                        id="profile-email"
                        className="form-input"
                        type="email"
                        data-testid="profile-email-input"
                        value={profileEmail}
                        disabled
                        readOnly
                      />
                    </div>

                    {profileSuccess && (
                      <div
                        data-testid="profile-success-msg"
                        style={{ background: 'rgba(22, 163, 74, 0.1)', border: '1px solid #16a34a', borderRadius: 8, padding: '10px 14px', fontSize: '0.87rem', marginTop: 6 }}
                      >
                        Cập nhật thành công
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 24, paddingTop: 18, borderTop: '1px solid var(--border-subtle)' }}>
                      <button
                        type="submit"
                        className="btn btn-primary"
                        style={{ padding: '12px 28px', display: 'flex', alignItems: 'center', gap: 8 }}
                        disabled={savingProfile}
                        data-testid="profile-save-btn"
                      >
                        <Check size={16} /> {savingProfile ? 'Đang lưu...' : 'Lưu thay đổi'}
                      </button>
                    </div>
                  </form>

                  {/* Đổi mật khẩu (CN-03.2) — chỉ khi tài khoản có mật khẩu */}
                  {user && user.hasPassword !== false && (
                    <form
                      onSubmit={handleChangePassword}
                      noValidate
                      data-testid="change-password-form"
                      style={{ marginTop: 26, paddingTop: 22, borderTop: '1px solid var(--border-subtle)' }}
                    >
                      <h3 className="profile-section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <ShieldCheck size={17} color="var(--primary)" /> Đổi mật khẩu
                      </h3>
                      <div className="form-group">
                        <label className="form-label" htmlFor="cp-current">Mật khẩu hiện tại</label>
                        <input
                          id="cp-current"
                          className="form-input"
                          type="password"
                          data-testid="change-password-current-input"
                          value={cpCurrent}
                          onChange={e => {
                            setCpCurrent(e.target.value);
                            setCpErrors(prev => ({ ...prev, current: undefined }));
                            setCpSuccess(false);
                          }}
                          style={cpErrors.current ? { borderColor: '#d81b60' } : {}}
                        />
                        {cpErrors.current && (
                          <div data-testid="change-password-current-error" style={{ color: '#d81b60', fontSize: '0.8rem', marginTop: 6 }}>
                            {cpErrors.current}
                          </div>
                        )}
                      </div>
                      <div className="address-form-grid">
                        <div className="form-group">
                          <label className="form-label" htmlFor="cp-new">Mật khẩu mới</label>
                          <input
                            id="cp-new"
                            className="form-input"
                            type="password"
                            data-testid="change-password-new-input"
                            value={cpNew}
                            onChange={e => {
                              setCpNew(e.target.value);
                              setCpErrors(prev => ({ ...prev, next: undefined }));
                              setCpSuccess(false);
                            }}
                            placeholder="Tối thiểu 8 ký tự, gồm chữ hoa & ký tự đặc biệt"
                            style={cpErrors.next ? { borderColor: '#d81b60' } : {}}
                          />
                          <PasswordRuleList password={cpNew} testIdPrefix="change-password" />
                          {cpErrors.next && (
                            <div data-testid="change-password-new-error" style={{ color: '#d81b60', fontSize: '0.8rem', marginTop: 6 }}>
                              {cpErrors.next}
                            </div>
                          )}
                        </div>
                        <div className="form-group">
                          <label className="form-label" htmlFor="cp-confirm">Nhập lại mật khẩu mới</label>
                          <input
                            id="cp-confirm"
                            className="form-input"
                            type="password"
                            data-testid="change-password-confirm-input"
                            value={cpConfirm}
                            onChange={e => {
                              setCpConfirm(e.target.value);
                              setCpErrors(prev => ({ ...prev, confirm: undefined }));
                              setCpSuccess(false);
                            }}
                            placeholder="Nhập lại mật khẩu mới để xác nhận"
                            style={cpErrors.confirm ? { borderColor: '#d81b60' } : {}}
                          />
                          {cpErrors.confirm && (
                            <div data-testid="change-password-confirm-error" style={{ color: '#d81b60', fontSize: '0.8rem', marginTop: 6 }}>
                              {cpErrors.confirm}
                            </div>
                          )}
                        </div>
                      </div>
                      {cpSuccess && (
                        <div
                          data-testid="change-password-success"
                          style={{ background: 'rgba(22, 163, 74, 0.1)', border: '1px solid #16a34a', borderRadius: 8, padding: '10px 14px', fontSize: '0.87rem', marginTop: 6 }}
                        >
                          Đổi mật khẩu thành công
                        </div>
                      )}
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                        <button
                          type="submit"
                          className="btn btn-primary"
                          style={{ padding: '11px 24px', display: 'flex', alignItems: 'center', gap: 8 }}
                          disabled={cpBusy}
                          data-testid="change-password-submit-btn"
                        >
                          <Check size={16} /> {cpBusy ? 'Đang đổi mật khẩu...' : 'Đổi mật khẩu'}
                        </button>
                      </div>
                    </form>
                  )}

                  {/* Đặt mật khẩu — chỉ hiện khi tài khoản chưa có mật khẩu */}
                  {user && !setPasswordDone && (user.hasPassword === false || (user.hasPassword === undefined && !!user.authProvider)) && (
                    <form
                      onSubmit={handleSetPassword}
                      noValidate
                      data-testid="set-password-form"
                      style={{ marginTop: 26, paddingTop: 22, borderTop: '1px solid var(--border-subtle)' }}
                    >
                      <h3 className="profile-section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <ShieldCheck size={17} color="var(--primary)" /> Đặt mật khẩu
                      </h3>
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0 0 16px', lineHeight: 1.5 }}>
                        Tài khoản của bạn được tạo bằng {user.authProvider || 'mạng xã hội'} và chưa có mật khẩu.
                        Đặt mật khẩu để có thể đăng nhập bằng cả hai cách.
                      </p>
                      <div className="address-form-grid">
                        <div className="form-group">
                          <label className="form-label">Mật khẩu mới</label>
                          <input
                            className="form-input"
                            type="password"
                            data-testid="set-password-input"
                            value={setPasswordValue}
                            onChange={e => {
                              setSetPasswordValue(e.target.value);
                              if (setPasswordError) setSetPasswordError(null);
                            }}
                            placeholder="Tối thiểu 8 ký tự, gồm chữ hoa & ký tự đặc biệt"
                          />
                          <PasswordRuleList password={setPasswordValue} testIdPrefix="set-password" />
                        </div>
                        <div className="form-group">
                          <label className="form-label">Nhập lại mật khẩu</label>
                          <input
                            className="form-input"
                            type="password"
                            data-testid="set-password-confirm-input"
                            value={setPasswordConfirm}
                            onChange={e => {
                              setSetPasswordConfirm(e.target.value);
                              if (setPasswordError) setSetPasswordError(null);
                            }}
                            placeholder="Nhập lại mật khẩu để xác nhận"
                          />
                        </div>
                      </div>
                      {setPasswordError && (
                        <div data-testid="set-password-error" style={{ color: '#d81b60', fontSize: '0.82rem', marginTop: 8 }}>
                          {setPasswordError}
                        </div>
                      )}
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                        <button
                          type="submit"
                          className="btn btn-primary"
                          style={{ padding: '11px 24px', display: 'flex', alignItems: 'center', gap: 8 }}
                          disabled={settingPassword}
                          data-testid="set-password-submit-btn"
                        >
                          <Check size={16} /> {settingPassword ? 'Đang đặt mật khẩu...' : 'Đặt mật khẩu'}
                        </button>
                      </div>
                    </form>
                  )}
                  {user && setPasswordDone && (
                    <div
                      data-testid="set-password-success"
                      style={{ marginTop: 26, padding: '12px 14px', border: '1px solid #10b981', background: 'rgba(16, 185, 129, 0.1)', borderRadius: 10, fontSize: '0.87rem' }}
                    >
                      Đã đặt mật khẩu thành công — từ nay bạn đăng nhập được bằng email + mật khẩu hoặc {user.authProvider || 'mạng xã hội'}.
                    </div>
                  )}

                  {/* Sổ địa chỉ (CN-03.3) */}
                  {user && (
                    <div style={{ marginTop: 26, paddingTop: 22, borderTop: '1px solid var(--border-subtle)' }}>
                      <AddressBook />
                    </div>
                  )}
                </div>
              </section>
            )
          }
        />

        {/* ============================================================== */}
        {/* ROUTE VIEW: PRODUCT DETAIL (/product/:id) — CN-05 */}
        {/* ============================================================== */}
        <Route
          path="/product/:id"
          element={
            <section className="product-detail-page" data-testid="product-detail-page">
              <div className="product-detail-page-card">
                <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: '6px 14px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 6 }}
                    onClick={() => navigateTo('home')}
                    data-testid="product-detail-back-btn"
                  >
                    <ArrowLeft size={16} /> Tiếp tục mua sắm
                  </button>
                  {selectedProduct && (
                    <span className="product-category-badge" style={{ position: 'static' }}>
                      {selectedProduct.categoryName}
                    </span>
                  )}
                </div>

                {productDetailLoading ? (
                  <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
                    <RefreshCw size={32} className="spin" style={{ margin: '0 auto 12px', color: 'var(--primary)' }} />
                    <p>Đang tải thông tin chi tiết sản phẩm...</p>
                  </div>
                ) : productNotFound || !selectedProduct ? (
                  <div style={{ textAlign: 'center', padding: '60px 0' }} data-testid="product-not-found-page">
                    <Package size={48} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
                    <h3 style={{ fontSize: '1.2rem', marginBottom: 8 }}>404 - Không tìm thấy sản phẩm</h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                      Sản phẩm không tồn tại hoặc đã ngừng bán.
                    </p>
                    <button type="button" className="btn btn-primary" onClick={() => navigateTo('home')} style={{ marginTop: 12 }}>
                      Quay lại trang chủ
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="product-detail-layout">
                      <div>
                        <ProductGallery
                          images={resolveGalleryImages(selectedProduct.imageUrl, selectedProduct.images)}
                          alt={selectedProduct.name}
                        />
                        <div className="product-trust-badges">
                          <div className="product-trust-badge">
                            <Check size={14} color="#10b981" /> Hàng chính hãng 100%
                          </div>
                          <div className="product-trust-badge">
                            <Clock size={14} color="#6366f1" /> Đổi trả trong 7 ngày
                          </div>
                          <div className="product-trust-badge">
                            <ShieldCheck size={14} color="#d81b60" /> Bảo hành 12 tháng
                          </div>
                          <div className="product-trust-badge">
                            <Truck size={14} color="#f59e0b" /> Giao hàng toàn quốc
                          </div>
                        </div>
                      </div>

                      <div>
                        <h2 style={{ fontSize: '1.6rem', fontWeight: 800, marginBottom: 8, color: 'var(--text-main)' }}>{selectedProduct.name}</h2>

                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
                          <span style={{ fontSize: '1.3rem', fontWeight: 800, color: '#d81b60' }}>
                            {formatPrice(selectedProduct.price)}
                          </span>
                          {selectedProduct.originalPrice && (
                            <span style={{ fontSize: '1rem', color: '#6b7280', textDecoration: 'line-through' }}>
                              {formatPrice(selectedProduct.originalPrice)}
                            </span>
                          )}
                          {selectedProduct.originalPrice && selectedProduct.originalPrice > selectedProduct.price && (
                            <span style={{ fontSize: '0.8rem', background: 'rgba(228, 0, 70, 0.1)', color: '#d81b60', padding: '2px 8px', borderRadius: 8, fontWeight: 700 }}>
                              Tiết kiệm {formatPrice(selectedProduct.originalPrice - selectedProduct.price)}
                            </span>
                          )}
                        </div>

                        <div className="product-detail-desc" style={{ marginBottom: 20 }}>
                          {selectedProduct.description}
                        </div>

                        {/* Biến thể: BE hiện có một biến thể duy nhất cho mỗi sản phẩm (chính sản phẩm). */}
                        <div style={{ marginBottom: 18 }}>
                          <span style={{ fontSize: '0.9rem', fontWeight: 600, display: 'block', marginBottom: 8 }}>Biến thể:</span>
                          <button
                            type="button"
                            className="variant-option active"
                            data-testid={`variant-option-${selectedProduct.id}`}
                            disabled={selectedProduct.availableStock <= 0}
                          >
                            Mặc định
                          </button>
                        </div>

                        {selectedProduct.availableStock <= 0 ? (
                          <div
                            data-testid="detail-out-of-stock-notice"
                            style={{ background: 'rgba(228, 0, 70, 0.08)', border: '1px solid rgba(228, 0, 70, 0.3)', color: '#b91c1c', borderRadius: 12, padding: '10px 14px', fontSize: '0.88rem', marginBottom: 20 }}
                          >
                            Sản phẩm đã hết hàng — hiện không thể thêm vào giỏ hoặc mua ngay.
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
                            <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Số lượng:</span>
                            <div className="cart-item-actions">
                              <button
                                type="button"
                                className="qty-btn"
                                onClick={() => setDetailQuantity(q => Math.max(1, q - 1))}
                                disabled={detailQuantity <= 1}
                                data-testid="detail-qty-minus"
                                title="Giảm số lượng"
                              >
                                <Minus size={14} />
                              </button>
                              <span style={{ minWidth: 24, textAlign: 'center', fontWeight: 700 }} data-testid="detail-qty-value">
                                {detailQuantity}
                              </span>
                              <button
                                type="button"
                                className="qty-btn"
                                onClick={() => setDetailQuantity(q => Math.min(selectedProduct.availableStock, q + 1))}
                                disabled={detailQuantity >= selectedProduct.availableStock}
                                data-testid="detail-qty-plus"
                                title="Tăng số lượng"
                              >
                                <Plus size={14} />
                              </button>
                            </div>
                            <span style={{ fontSize: '0.85rem', color: '#9ca3af' }}>
                              (Còn {selectedProduct.availableStock} sản phẩm có sẵn)
                            </span>
                          </div>
                        )}

                        <div style={{ display: 'flex', gap: 12 }}>
                          <button
                            className="btn btn-secondary"
                            style={{ flex: 1, padding: '12px' }}
                            onClick={() => {
                              addToCart(selectedProduct, detailQuantity);
                            }}
                            disabled={selectedProduct.availableStock <= 0}
                            data-testid="detail-add-to-cart-btn"
                          >
                            <Plus size={16} /> Thêm vào giỏ hàng
                          </button>
                          <button
                            className="btn btn-primary"
                            style={{ flex: 1, padding: '12px' }}
                            onClick={() => {
                              handleBuyNow(selectedProduct, detailQuantity);
                            }}
                            disabled={selectedProduct.availableStock <= 0}
                            data-testid="buy-now-btn"
                          >
                            Mua ngay
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Mô tả & thông số chi tiết; mục đánh giá ở ngay dưới (đọc từ ProductDetailDto.Evaluations) */}
                    {(() => {
                      const extra = getProductDetailExtra(selectedProduct);
                      return (
                        <div className="product-detail-expanded" style={{ marginTop: 24 }}>
                          <div className="detail-section">
                            <h4 className="detail-section-title">
                              <Sparkles size={18} color="var(--primary)" /> Đặc điểm nổi bật
                            </h4>
                            <ul style={{ paddingLeft: 20, margin: 0, lineHeight: 1.8 }}>
                              {extra.highlights.map((h, idx) => (
                                <li key={idx} style={{ color: 'var(--text-main)', fontSize: '0.9rem', marginBottom: 6 }}>
                                  {h}
                                </li>
                              ))}
                            </ul>
                          </div>

                          <div className="detail-section">
                            <h4 className="detail-section-title">
                              <Layers size={18} color="var(--primary)" /> Thông số kỹ thuật & Thông tin chi tiết
                            </h4>
                            <table className="specs-table">
                              <tbody>
                                {extra.specs.map((item, idx) => (
                                  <tr key={idx}>
                                    <td className="specs-label">{item.label}</td>
                                    <td className="specs-value">{item.value}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          <div className="detail-section">
                            <h4 className="detail-section-title">
                              <FileText size={18} color="var(--primary)" /> Bài viết giới thiệu chi tiết sản phẩm
                            </h4>
                            <div style={{ background: 'var(--bg-subtle)', padding: 18, borderRadius: 12, border: '1px solid var(--border-subtle)' }}>
                              {extra.detailedArticle.map((para, idx) => (
                                <p key={idx} className="detail-article-p" style={{ marginBottom: idx === extra.detailedArticle.length - 1 ? 0 : 12 }}>
                                  {para}
                                </p>
                              ))}
                            </div>
                          </div>

                          <div className="detail-section">
                            <h4 className="detail-section-title">
                              <ShieldCheck size={18} color="var(--primary)" /> Ưu điểm vượt trội & Cam kết chất lượng
                            </h4>
                            <div className="features-grid">
                              {extra.features.map((feat, idx) => (
                                <div key={idx} className="feature-box">
                                  <div className="feature-box-title">✓ {feat.title}</div>
                                  <div className="feature-box-desc">{feat.desc}</div>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="detail-section">
                            <h4 className="detail-section-title">
                              <CheckCircle2 size={18} color="#10b981" /> Hướng dẫn sử dụng & Bảo quản đúng cách
                            </h4>
                            <div style={{ background: 'var(--bg-subtle)', padding: 16, borderRadius: 12, border: '1px solid var(--border-subtle)' }}>
                              <ol style={{ paddingLeft: 20, margin: 0, lineHeight: 1.8 }}>
                                {extra.usageGuide.map((g, idx) => (
                                  <li key={idx} style={{ color: 'var(--text-main)', fontSize: '0.875rem', marginBottom: 4 }}>
                                    {g}
                                  </li>
                                ))}
                              </ol>
                            </div>
                          </div>

                          <div className="detail-section" style={{ marginBottom: 10 }}>
                            <h4 className="detail-section-title">
                              <Truck size={18} color="var(--primary)" /> Chính sách bán hàng & Dịch vụ khách hàng DAFL
                            </h4>
                            <div className="guarantees-grid">
                              {extra.guarantees.map((g, idx) => (
                                <div key={idx} className="guarantee-card">
                                  <div>
                                    <div className="guarantee-title">{g.title}</div>
                                    <div className="guarantee-desc">{g.desc}</div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Đánh giá của khách hàng — chỉ HIỂN THỊ dữ liệu BE đã trả trong
                     *  ProductDetailDto.Evaluations (Id, UserName, Rating 1-5, Comment,
                     *  CreatedAt); không có form gửi đánh giá mới (BE chưa có API tạo). */}
                    {(() => {
                      const evals = selectedProduct.evaluations ?? [];
                      const avg = evals.length > 0
                        ? evals.reduce((s, e) => s + (e.rating || 0), 0) / evals.length
                        : (selectedProduct.rating ?? 0);
                      const total = evals.length > 0 ? evals.length : (selectedProduct.reviewCount ?? 0);
                      const dist = [5, 4, 3, 2, 1].map(star => ({
                        star,
                        count: evals.filter(e => e.rating === star).length,
                      }));
                      const maxCount = Math.max(1, ...dist.map(d => d.count));
                      return (
                        <section className="detail-section" data-testid="product-reviews-section" style={{ marginTop: 24 }}>
                          <h4 className="detail-section-title">
                            <Star size={18} color="var(--primary)" /> Đánh giá của khách hàng
                          </h4>
                          {evals.length === 0 ? (
                            <p style={{ color: 'var(--text-muted)', fontSize: '1rem', margin: 0 }}>
                              Chưa có đánh giá nào — hãy là người đầu tiên đánh giá sản phẩm này.
                            </p>
                          ) : (
                            <>
                              <div
                                data-testid="product-rating-summary"
                                style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap', background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 18, marginBottom: 16 }}
                              >
                                <div style={{ textAlign: 'center' }}>
                                  <div style={{ fontSize: '2.2rem', fontWeight: 800, color: 'var(--primary)', lineHeight: 1 }}>{avg.toFixed(1)}</div>
                                  <div style={{ display: 'flex', gap: 2, justifyContent: 'center', margin: '6px 0' }}>
                                    {[1, 2, 3, 4, 5].map(i => (
                                      <Star key={i} size={18} fill={i <= Math.round(avg) ? '#f5a623' : 'none'} color="#f5a623" />
                                    ))}
                                  </div>
                                  <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>{total} đánh giá</div>
                                </div>
                                <div style={{ flex: 1, minWidth: 220 }}>
                                  {dist.map(d => (
                                    <div key={d.star} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontSize: '0.9rem' }}>
                                      <span style={{ width: 28 }}>{d.star} ★</span>
                                      <div style={{ flex: 1, height: 8, background: '#f0f0f0', borderRadius: 999, overflow: 'hidden' }}>
                                        <div style={{ width: `${(d.count / maxCount) * 100}%`, height: '100%', background: '#d81b60', borderRadius: 999 }} />
                                      </div>
                                      <span style={{ width: 24, textAlign: 'right', color: 'var(--text-muted)' }}>{d.count}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                                {evals.map(ev => (
                                  <li key={ev.id} data-testid="product-review-item" style={{ borderBottom: '1px solid var(--border-subtle)', padding: '12px 0' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                                      <span style={{ width: 36, height: 36, borderRadius: '50%', background: '#ffe8f0', color: '#d81b60', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, flexShrink: 0 }}>
                                        {(ev.userName || 'K').charAt(0).toUpperCase()}
                                      </span>
                                      <div>
                                        <div style={{ fontWeight: 700, fontSize: '1rem' }}>{ev.userName}</div>
                                        <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                                          {[1, 2, 3, 4, 5].map(i => (
                                            <Star key={i} size={14} fill={i <= ev.rating ? '#f5a623' : 'none'} color="#f5a623" />
                                          ))}
                                          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginLeft: 6 }}>
                                            {new Date(ev.createdAt).toLocaleDateString('vi-VN')}
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                    <p style={{ margin: 0, fontSize: '1rem', lineHeight: 1.6 }}>{ev.comment}</p>
                                  </li>
                                ))}
                              </ul>
                            </>
                          )}
                        </section>
                      );
                    })()}
                  </>
                )}
              </div>
            </section>
          }
        />

        {/* ============================================================== */}
        {/* ROUTE VIEW: CART & CHECKOUT (/cart) */}
        {/* ============================================================== */}
        <Route
          path="/cart"
          element={
            <CartDrawer
              isOpen={true}
              isModal={false}
              onClose={() => navigateTo('home')}
              cart={cart}
              vouchers={vouchers}
              voucherCodeInput={voucherCodeInput}
              setVoucherCodeInput={setVoucherCodeInput}
              appliedVoucher={appliedVoucher}
              voucherMessage={voucherMessage}
              rawSubTotal={rawSubTotal}
              shippingFee={shippingFeeEstimate}
              finalTotal={finalTotal}
              totalItemCount={totalItemCount}
              customerName={customerName}
              setCustomerName={setCustomerName}
              customerEmail={customerEmail}
              setCustomerEmail={setCustomerEmail}
              customerPhone={customerPhone}
              setCustomerPhone={setCustomerPhone}
              shippingAddress={shippingAddress}
              setShippingAddress={setShippingAddress}
              checkoutResult={checkoutResult}
              isCheckingOut={isCheckingOut}
              orderStatus={orderStatus}
              timeLeft={timeLeft}
              checkoutError={checkoutError}
              priceChangedPending={showPriceChangedNotice}
              lastOrderAddress={lastOrderAddress}
              onUpdateQuantity={updateQuantity}
              onSetQuantity={(productId, qty) => { void setCartQuantity(productId, qty); }}
              onRemoveItem={(productId) => { void removeCartItem(productId); }}
              onApplyVoucher={handleApplyVoucher}
              onRemoveVoucher={() => { setAppliedVoucher(null); setVoucherMessage(null); }}
              onCheckout={handleCheckout}
              onSimulateSuccess={handleSimulatePaymentSuccess}
              onResetCheckout={() => setCheckoutResult(null)}
              onNavigateToOrders={() => { setCheckoutResult(null); navigateTo('orders'); }}
              onNavigateToHome={() => { setCheckoutResult(null); navigateTo('home'); }}
              onCopyOrderCode={(code) => {
                navigator.clipboard?.writeText(String(code));
                showToast('Đã chép mã', `Mã đơn #${code}`, 'System');
              }}
              user={user}
              onRequireAuth={handleRequireAuth}
            />
          }
        />

        <Route path="/checkout" element={<Navigate to="/cart" replace />} />

        {/* ============================================================== */}
        {/* ROUTE VIEW: AUTH (LOGIN / REGISTER) (/login & /register) */}
        {/* ============================================================== */}
        <Route
          path="/login"
          element={
            <AuthModal
              {...commonAuthProps}
              isOpen={true}
              isModal={false}
              onClose={handleAuthClose}
              authTab="login"
              setAuthTab={(tab) => {
                setAuthTab(tab);
                clearAuthErrors();
                navigateTo(tab);
              }}
            />
          }
        />
        <Route
          path="/register"
          element={
            <AuthModal
              {...commonAuthProps}
              isOpen={true}
              isModal={false}
              onClose={handleAuthClose}
              authTab="register"
              setAuthTab={(tab) => {
                setAuthTab(tab);
                clearAuthErrors();
                navigateTo(tab);
              }}
            />
          }
        />

        {/* ============================================================== */}
        {/* ROUTE VIEW: NOTIFICATIONS (Redirects to / and opens modal) */}
        {/* ============================================================== */}
        <Route
          path="/notifications"
          element={<Navigate to="/" replace />}
        />

        {/* ============================================================== */}
        {/* ROUTE VIEW: STANDALONE PAYOS PAYMENT (/payment/:orderCode) */}
        {/* ============================================================== */}
        <Route
          path="/payment/:orderCode"
          element={
            authInitialized && !user ? (
              <Navigate to="/login" replace />
            ) : (
              <section className="payment-page" data-testid="payment-page">
                <div className="payment-page-card">
                  <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: '6px 14px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 6 }}
                      onClick={() => navigateTo('orders')}
                    >
                      <ArrowLeft size={16} /> Quay lại danh sách đơn hàng
                    </button>
                    <h1 className="page-title" style={{ margin: 0 }}>
                      <CreditCard size={24} color="var(--primary)" /> Thanh toán đơn hàng PayOS
                    </h1>
                  </div>

                  {(() => {
                    const orderCodeNum = Number(matchedPaymentOrderCode || 0);
                    const order = orderHistory.find(o => o.orderCode === orderCodeNum);
                    const totalAmt = order ? order.totalAmount : 0;
                    const checkoutUrl = order?.checkoutUrl || '';

                    return (
                      <div className="payos-embedded-card" style={{ marginTop: 0 }}>
                        <div className="payos-summary-bar">
                          <div>
                            <span style={{ fontSize: '0.95rem', color: 'var(--text-muted)' }}>Mã đơn: </span>
                            <strong style={{ fontSize: '1.1rem' }}>{order?.orderDisplayCode || `#${orderCodeNum}`}</strong>
                            <span style={{ margin: '0 8px', color: 'var(--border-subtle)' }}>|</span>
                            <span style={{ fontSize: '0.95rem', color: 'var(--text-muted)' }}>Tổng thanh toán: </span>
                            <strong style={{ color: '#d81b60', fontSize: '1.25rem' }}>{formatPrice(totalAmt)}</strong>
                          </div>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                            onClick={() => {
                              navigator.clipboard?.writeText(String(orderCodeNum));
                              showToast('Sao chép', `Đã chép mã đơn #${orderCodeNum}`, 'System');
                            }}
                          >
                            <Copy size={13} /> Copy mã đơn
                          </button>
                        </div>

                        <PayOSGatewayView
                          orderCode={orderCodeNum}
                          totalAmount={totalAmt}
                          checkoutUrl={checkoutUrl}
                          onSimulateSuccess={() => handleSimulatePaymentForOrder(orderCodeNum, totalAmt)}
                          onCopyOrderCode={() => {
                            navigator.clipboard?.writeText(String(orderCodeNum));
                            showToast('Sao chép', `Đã chép mã đơn #${orderCodeNum}`, 'System');
                          }}
                        />

                        <div className="payos-sync-footer">
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.825rem', color: 'var(--text-muted)' }}>
                              <RefreshCw size={14} className="spin" color="#10b981" />
                              <span>Lắng nghe kết quả thanh toán từ VietQR / PayOS qua SignalR...</span>
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                              <button
                                type="button"
                                className="btn btn-primary"
                                style={{ fontSize: '0.8rem', padding: '8px 16px' }}
                                onClick={() => handleSimulatePaymentForOrder(orderCodeNum, totalAmt)}
                              >
                                Kiểm tra trạng thái
                              </button>
                              <button
                                type="button"
                                className="btn btn-secondary"
                                style={{ fontSize: '0.8rem', padding: '8px 16px' }}
                                onClick={() => navigateTo('orders')}
                              >
                                Xong
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </section>
            )
          }
        />

        {/* Standalone simulated payment and success pages */}
        <Route path="/mock-payos" element={<MockPayOSStandalonePage />} />
        <Route path="/payment-success" element={<PaymentSuccessPage />} />
        {/* Trang 404: đường dẫn không tồn tại (không tự chuyển về trang chủ nữa) */}
        <Route
          path="*"
          element={
            <div style={{ padding: '3rem 1rem', maxWidth: 720, margin: '0 auto', textAlign: 'center' }} data-testid="not-found-page">
              <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }} aria-hidden="true">🔍</div>
              <h1 style={{ fontSize: '1.9rem', color: '#d81b60', margin: '0 0 0.5rem' }}>Không tìm thấy trang</h1>
              <p style={{ color: '#555', margin: '0 0 1.5rem' }}>Trang bạn vừa mở không tồn tại hoặc đã được chuyển đi nơi khác.</p>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                <button type="button" className="btn btn-primary" onClick={() => navigate('/')}>Về trang chủ</button>
                <button type="button" className="btn btn-secondary" onClick={() => navigate(-1)}>Quay lại</button>
              </div>
            </div>
          }
        />
      </Routes>

      {!isStandalone && <SiteFooter />}

      {/* ============================================================== */}
      {/* MODAL: NOTIFICATIONS MODAL */}
      {/* ============================================================== */}
      {isNotifOpen && (
        <div className="modal-overlay" onClick={() => setIsNotifOpen(false)} data-testid="notifications-modal">
          <div className="modal-content notif-modal" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 520 }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Bell size={20} color="var(--primary)" />
                <h2 className="modal-title">Thông báo</h2>
                {unreadCount > 0 && (
                  <span className="badge-count" style={{ position: 'static' }}>{unreadCount} mới</span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button
                  type="button"
                  className="notif-mark-all-btn"
                  onClick={markAllNotificationsAsRead}
                  data-testid="mark-all-read-btn"
                >
                  Đánh dấu đã đọc tất cả
                </button>
                <button
                  type="button"
                  className="close-btn"
                  onClick={() => setIsNotifOpen(false)}
                  data-testid="close-notif-btn"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            <div className="notif-list" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
              {notifications.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '30px 0' }}>
                  <Bell size={40} style={{ margin: '0 auto 8px', opacity: 0.3 }} />
                  <p>Chưa có thông báo</p>
                </div>
              ) : (
                notifications.map(n => {
                  const NotifIcon = n.type === 'Payment' ? CreditCard : n.type === 'Order' ? Package : n.type === 'Promotion' ? Tag : Bell;
                  return (
                  <div
                    key={n.id}
                    className={`notification-item notif-compact ${!n.isRead ? 'unread' : ''}`}
                    onClick={() => markNotificationAsRead(n.id)}
                    style={{ cursor: 'pointer' }}
                    data-testid={`notification-item-${n.id}`}
                  >
                    <span className="notif-icon">
                      <NotifIcon size={16} />
                    </span>
                    <span className="notif-body">
                      <span className="notif-title-row">
                        <strong>{n.title}</strong>
                        <span className="notif-time">{timeAgoVi(n.createdAt)}</span>
                      </span>
                      <span className="notif-message">{n.message}</span>
                    </span>
                    {!n.isRead && <span className="unread-dot" />}
                  </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
