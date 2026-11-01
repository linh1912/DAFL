import React, { useState, useEffect, useRef } from 'react';
import {
  ShoppingBag, Search, Sparkles, CheckCircle2, Clock,
  CreditCard, ShieldCheck, Zap, X, Plus, Minus, ArrowRight,
  User as UserIcon, Bell, Star, Tag, LogOut, Check, RefreshCw, Send, Package,
  Sun, Moon, Smartphone, FileText, Truck, Layers,
  MapPin, ExternalLink, Calendar, RotateCcw, Receipt, ArrowLeft, Copy, CheckCheck, AlertCircle, ChevronDown
} from 'lucide-react';
import * as signalR from '@microsoft/signalr';
import {
  Category, Product, ProductDetail, CartItem, Voucher,
  CheckoutResult, ApiResponse, User, NotificationItem, OrderHistory, Evaluation, AppRoute
} from './types';
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
import { CartDrawer } from './components/cart/CartDrawer';
import { AuthModal } from './components/auth/AuthModal';
import { PayOSGatewayView } from './components/checkout/PayOSGatewayView';

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
const UNVERIFIED_LOGIN_MESSAGE = 'Tài khoản chưa được xác thực. Vui lòng nhập mã đã gửi về email của bạn.';

interface PendingAdd {
  product: Product;
  qty: number;
  buyNow: boolean;
}

interface RegisterVerificationResult {
  email: string;
  requiresVerification: boolean;
}

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [authInitialized, setAuthInitialized] = useState(false);

  const productMatch = useMatch('/product/:id');
  const matchedProductId = productMatch?.params?.id;

  const paymentMatch = useMatch('/payment/:orderCode');
  const matchedPaymentOrderCode = paymentMatch?.params?.orderCode;

  const lastLoadedProductIdRef = useRef<string | null>(null);

  // Navigation & Catalogs
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [homePriceRange, setHomePriceRange] = useState<'all' | 'under-500' | '500-2000' | 'over-2000'>('all');
  const [homeInStockOnly, setHomeInStockOnly] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  // Lazy Loading / Infinite Scroll on Products
  const [visibleCount, setVisibleCount] = useState(16);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);

  // Home sidebar filters (price range / in-stock) — single predicate shared by
  // the rendered grid and the lazy-loading logic so both count the same list.
  const matchesHomeFilters = (product: Product) => {
    if (homeInStockOnly && product.availableStock <= 0) return false;
    if (homePriceRange === 'under-500') return product.price < 500000;
    if (homePriceRange === '500-2000') return product.price >= 500000 && product.price <= 2000000;
    if (homePriceRange === 'over-2000') return product.price > 2000000;
    return true;
  };
  const filteredProductCount = products.filter(matchesHomeFilters).length;

  // Product Detail Modal State
  const [selectedProduct, setSelectedProduct] = useState<ProductDetail | null>(null);
  const [productDetailLoading, setProductDetailLoading] = useState(false);
  const [detailQuantity, setDetailQuantity] = useState(1);
  const [modalTab, setModalTab] = useState<'description' | 'reviews'>('description');
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewAuthor, setReviewAuthor] = useState('');
  const [reviewComment, setReviewComment] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);

  // Cart State
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);

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
  const [orderStatus, setOrderStatus] = useState<string>('Pending');
  const [timeLeft, setTimeLeft] = useState<number>(15 * 60);

  // Dedicated Embedded PayOS Modal for paying any pending order from order history
  const [embeddedPaymentModal, setEmbeddedPaymentModal] = useState<{
    orderCode: number;
    checkoutUrl: string;
    totalAmount: number;
  } | null>(null);

  // Orders Filter State
  const [orderFilter, setOrderFilter] = useState<'all' | 'Pending' | 'Paid' | 'Shipping' | 'Completed' | 'Cancelled'>('all');

  // Profile & Address Configuration State
  const [profileFullName, setProfileFullName] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [profileEmail, setProfileEmail] = useState('');
  const [profileAddress, setProfileAddress] = useState('');
  const [profileNotes, setProfileNotes] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // Auth State
  const [user, setUser] = useState<User | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authTab, setAuthTab] = useState<'login' | 'register'>('login');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [registerName, setRegisterName] = useState('');
  const [registerEmail, setRegisterEmail] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [registerConfirmPassword, setRegisterConfirmPassword] = useState('');
  const [registerPhone, setRegisterPhone] = useState('');
  const [registerAddress, setRegisterAddress] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [pendingAdd, setPendingAdd] = useState<PendingAdd | null>(null);
  const [authGateNotice, setAuthGateNotice] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState('');
  const [verificationNotice, setVerificationNotice] = useState<string | null>(null);
  const [loginEmailError, setLoginEmailError] = useState<string | null>(null);
  const [loginPasswordError, setLoginPasswordError] = useState<string | null>(null);
  const [loginFailureCount, setLoginFailureCount] = useState(0);

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

  // Profile & Order History Drawer
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [orderHistory, setOrderHistory] = useState<OrderHistory[]>([]);
  const [orderHistoryLoading, setOrderHistoryLoading] = useState(false);

  // Notifications State & SignalR
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [toastAlert, setToastAlert] = useState<{ title: string; message: string; type: string } | null>(null);
  const signalRConnection = useRef<signalR.HubConnection | null>(null);

  // Sync profile form when user session updates
  useEffect(() => {
    if (user) {
      setProfileFullName(user.fullName);
      if (user.phoneNumber) setProfilePhone(user.phoneNumber);
      if (user.address) setProfileAddress(user.address);
      if (user.email) setProfileEmail(user.email);
    } else {
      setProfileFullName('');
      setProfilePhone('');
      setProfileAddress('');
      setProfileEmail('');
      setProfileNotes('');
    }
  }, [user]);

  // 1. Initial Load: Categories, Products, Vouchers, User Session, Notifications, Orders
  useEffect(() => {
    fetchCategories();
    fetchVouchers();
    fetchUserSession();
    fetchOrderHistory();
  }, []);

  // Thông báo phụ thuộc người dùng: tải lại khi đăng nhập/đăng xuất để không lẫn thông báo của người khác
  useEffect(() => {
    fetchNotifications();
  }, [user?.id]);

  // Debounce search query with 350ms delay
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    fetchProducts(selectedCategory, debouncedSearch);
  }, [selectedCategory, debouncedSearch]);

  // Sidebar filters are client-side only: restart lazy loading from page one,
  // mirroring the visibleCount reset fetchProducts does for category/search.
  useEffect(() => {
    setVisibleCount(16);
  }, [homePriceRange, homeInStockOnly]);

  // Scroll-based lazy loading with IntersectionObserver
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    if (visibleCount >= filteredProductCount) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0] && entries[0].isIntersecting && !isLoadingMore) {
          setIsLoadingMore(true);
          setTimeout(() => {
            setVisibleCount(prev => Math.min(prev + 16, filteredProductCount));
            setIsLoadingMore(false);
          }, 300);
        }
      },
      { rootMargin: '150px', threshold: 0.1 }
    );

    const el = loadMoreSentinelRef.current;
    if (el) observer.observe(el);

    return () => {
      if (el) observer.unobserve(el);
      observer.disconnect();
    };
  }, [visibleCount, filteredProductCount, isLoadingMore]);

  const handleLoadMore = () => {
    if (visibleCount >= filteredProductCount || isLoadingMore) return;
    setIsLoadingMore(true);
    setTimeout(() => {
      setVisibleCount(prev => Math.min(prev + 16, filteredProductCount));
      setIsLoadingMore(false);
    }, 250);
  };

  // 2. Setup SignalR Real-time WebSocket connection
  useEffect(() => {
    const hubUrl = `${API_BASE || 'http://localhost:5000'}/hubs/notifications`;
    const connection = new signalR.HubConnectionBuilder()
      .withUrl(hubUrl, {
        withCredentials: true,
        transport: signalR.HttpTransportType.WebSockets | signalR.HttpTransportType.LongPolling
      })
      .withAutomaticReconnect()
      .configureLogging(signalR.LogLevel.Warning)
      .build();

    // Tham gia nhóm thông báo riêng bằng session hợp lệ; mất khi kết nối lại nên phải gọi lại
    const joinUserGroup = () => {
      if (!user?.sessionId) return;
      connection.invoke('JoinUserGroup', user.sessionId)
        .catch(err => console.warn('[SignalR] JoinUserGroup failed:', err));
    };
    connection.onreconnected(joinUserGroup);

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
        if (status === 'Paid') setCart([]);
      }
      if (embeddedPaymentModal && embeddedPaymentModal.orderCode === code && status === 'Paid') {
        setEmbeddedPaymentModal(null);
      }
      // Chỉ hiện toast cho đơn hàng đang theo dõi trên màn hình này (sự kiện được phát cho mọi client)
      if (checkoutResult?.orderCode === code || embeddedPaymentModal?.orderCode === code) {
        showToast(`Đơn hàng #${code} cập nhật`, message, 'Order');
      }
      fetchOrderHistory();
    });

    connection.start()
      .then(() => {
        console.log('[SignalR] Connected successfully to NotificationHub');
        signalRConnection.current = connection;
        joinUserGroup();
      })
      .catch(err => {
        console.warn('[SignalR] NotificationHub not reachable, continuing in local mode:', err);
      });

    return () => {
      connection.stop();
    };
  }, [checkoutResult, embeddedPaymentModal, user?.sessionId]);

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
          setCart([]);
          fetchOrderHistory();
          clearInterval(pollInterval);
        }
      } catch (err) {
        console.error('Status poll error:', err);
      }
    }, 3000);
    return () => clearInterval(pollInterval);
  }, [checkoutResult, orderStatus]);

  const showToast = (title: string, message: string, type: string) => {
    setToastAlert({ title, message, type });
    setTimeout(() => {
      setToastAlert(null);
    }, 5000);
  };

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

  const fetchProducts = async (catId: string | null, search: string) => {
    setLoading(true);
    setVisibleCount(16);
    try {
      const params = new URLSearchParams();
      if (catId) params.append('categoryId', catId);
      if (search) params.append('search', search);

      const res = await fetch(`${API_BASE}/api/products?${params.toString()}`);
      const json: ApiResponse<Product[]> = await res.json();
      if (json.success && json.data && json.data.length > 0) {
        setProducts(json.data);
      } else {
        applyFallbackFilter(catId, search);
      }
    } catch {
      applyFallbackFilter(catId, search);
    } finally {
      setLoading(false);
    }
  };

  const applyFallbackFilter = (catId: string | null, search: string) => {
    let filtered = [...FALLBACK_PRODUCTS];
    if (catId) filtered = filtered.filter(p => p.categoryId === catId);
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter(p => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q));
    }
    setProducts(filtered);
    setVisibleCount(16);
  };

  const fetchUserSession = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/me`, { credentials: 'include' });
      const json: ApiResponse<User> = await res.json();
      if (json.success && json.data) {
        setUser(json.data);
        setCustomerName(json.data.fullName);
        setCustomerEmail(json.data.email);
        if (json.data.phoneNumber) setCustomerPhone(json.data.phoneNumber);
        if (json.data.address) setShippingAddress(json.data.address);
      }
    } catch (err) {
      console.warn('Auth check offline:', err);
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
  // Product Detail & Review Operations
  // ------------------------------------------
  const loadProductDetailById = async (productId: string) => {
    if (lastLoadedProductIdRef.current === productId && selectedProduct?.id === productId) {
      return;
    }
    lastLoadedProductIdRef.current = productId;
    setDetailQuantity(1);
    setProductDetailLoading(true);
    if (selectedProduct?.id !== productId) {
      setSelectedProduct(null);
    }
    setModalTab('description');
    setReviewAuthor(user?.fullName || '');
    try {
      const res = await fetch(`${API_BASE}/api/products/${productId}`);
      const json: ApiResponse<ProductDetail> = await res.json();
      if (json.success && json.data) {
        setSelectedProduct(json.data);
      } else {
        const found = (products.length ? products : FALLBACK_PRODUCTS).find(p => p.id === productId);
        if (found) {
          setSelectedProduct({
            ...found,
            evaluations: [
              {
                id: 'eval-1',
                productId: found.id,
                userName: 'Trần Hoàng Nam',
                rating: 5,
                comment: 'Sản phẩm hoàn thiện rất cao cấp, dùng thực tế ưng ý hơn hình ảnh chụp!',
                createdAt: new Date(Date.now() - 86400000).toISOString()
              }
            ]
          });
        }
      }
    } catch {
      const found = (products.length ? products : FALLBACK_PRODUCTS).find(p => p.id === productId);
      if (found) {
        setSelectedProduct({
          ...found,
          evaluations: [
            {
              id: 'eval-1',
              productId: found.id,
              userName: 'Khách hàng DAFL',
              rating: 5,
              comment: 'Sản phẩm chất lượng cao, đóng gói cẩn thận và giao nhanh.',
              createdAt: new Date().toISOString()
            }
          ]
        });
      }
    } finally {
      setProductDetailLoading(false);
    }
  };

  const openProductDetail = (product: Product) => {
    navigateTo('product', product.id);
  };

  const handleAddReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProduct || !reviewComment.trim()) return;

    setSubmittingReview(true);
    const author = reviewAuthor.trim() || user?.fullName || 'Khách hàng DAFL';

    try {
      const res = await fetch(`${API_BASE}/api/products/${selectedProduct.id}/evaluations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: selectedProduct.id,
          userId: user?.id,
          userName: author,
          rating: reviewRating,
          comment: reviewComment.trim()
        })
      });

      const json: ApiResponse<Evaluation> = await res.json();
      const newReview: Evaluation = json.success && json.data ? json.data : {
        id: 'eval-' + Date.now(),
        productId: selectedProduct.id,
        userName: author,
        rating: reviewRating,
        comment: reviewComment.trim(),
        createdAt: new Date().toISOString()
      };

      setSelectedProduct(prev => prev ? ({
        ...prev,
        evaluations: [newReview, ...prev.evaluations],
        reviewCount: (prev.reviewCount || 0) + 1
      }) : null);

      setReviewComment('');
      showToast('Đánh giá sản phẩm', 'Cảm ơn bạn đã gửi đánh giá cho sản phẩm!', 'System');
    } catch (err) {
      console.warn('API review offline, updating locally:', err);
      const mockEval: Evaluation = {
        id: 'eval-' + Date.now(),
        productId: selectedProduct.id,
        userName: author,
        rating: reviewRating,
        comment: reviewComment.trim(),
        createdAt: new Date().toISOString()
      };
      setSelectedProduct(prev => prev ? ({
        ...prev,
        evaluations: [mockEval, ...prev.evaluations],
        reviewCount: (prev.reviewCount || 0) + 1
      }) : null);
      setReviewComment('');
    } finally {
      setSubmittingReview(false);
    }
  };

  // ------------------------------------------
  // Cart & Voucher Operations
  // ------------------------------------------
  const openAuthGate = (pending?: PendingAdd) => {
    if (pending) setPendingAdd(pending);
    setAuthGateNotice(true);
    setAuthTab('login');
    setAuthError(null);
    setIsAuthModalOpen(true);
  };

  const mergeProductIntoCart = (product: Product, qty: number) => {
    setCart(prev => {
      const existing = prev.find(item => item.product.id === product.id);
      if (existing) {
        return prev.map(item =>
          item.product.id === product.id ? { ...item, quantity: item.quantity + qty } : item
        );
      }
      return [...prev, { product, quantity: qty }];
    });
  };

  const executePendingAdd = (pending: PendingAdd) => {
    setCheckoutResult(null);
    setOrderStatus('Pending');
    if (pending.buyNow) {
      setCart([{ product: pending.product, quantity: pending.qty }]);
      setSelectedProduct(null);
    } else {
      mergeProductIntoCart(pending.product, pending.qty);
    }
    navigateTo('cart');
    showToast('Đã thêm vào giỏ', `Đã thêm ${pending.product.name} vào giỏ hàng.`, 'System');
  };

  const addToCart = (product: Product, qty: number = 1) => {
    if (!user) {
      openAuthGate({ product, qty, buyNow: false });
      return;
    }
    setCheckoutResult(null);
    setOrderStatus('Pending');
    mergeProductIntoCart(product, qty);
    navigateTo('cart');
  };

  const handleBuyNow = (product: Product, qty: number = 1) => {
    if (!user) {
      openAuthGate({ product, qty, buyNow: true });
      return;
    }
    setCheckoutResult(null);
    setOrderStatus('Pending');
    setCart([{ product, quantity: qty }]);
    setSelectedProduct(null);
    navigateTo('cart');
  };

  const updateQuantity = (productId: string, delta: number) => {
    setCart(prev => prev
      .map(item => item.product.id === productId ? { ...item, quantity: item.quantity + delta } : item)
      .filter(item => item.quantity > 0)
    );
  };

  const rawSubTotal = cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  const discountAmount = appliedVoucher ? appliedVoucher.discountAmount : 0;
  const finalTotal = Math.max(0, rawSubTotal - discountAmount);
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
      } else {
        // Fallback local voucher calculation
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
  // Checkout & PayOS
  // ------------------------------------------
  const handleRequireAuth = () => {
    sessionStorage.setItem('dafl_return_route', '/cart');
    showToast('Yêu cầu đăng nhập', 'Vui lòng đăng nhập tài khoản để tiến hành thanh toán đơn hàng.', 'System');
    openAuthGate();
  };

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      handleRequireAuth();
      return;
    }
    if (cart.length === 0) return;

    setIsCheckingOut(true);
    try {
      const payload = {
        customerName,
        customerEmail,
        customerPhone,
        shippingAddress,
        voucherCode: appliedVoucher?.code,
        userId: user?.id,
        items: cart.map(item => ({
          productId: item.product.id,
          quantity: item.quantity
        }))
      };

      const res = await fetch(`${API_BASE}/api/orders/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const json: ApiResponse<CheckoutResult> = await res.json();
      if (json.success && json.data) {
        setCheckoutResult(json.data);
        setOrderStatus('Pending');
        setTimeLeft(15 * 60);
      } else {
        alert(json.message || 'Không thể tạo đơn hàng.');
      }
    } catch (err) {
      console.error('API checkout error:', err);
      alert('Không thể kết nối đến máy chủ thanh toán. Vui lòng kiểm tra kết nối mạng và thử lại sau.');
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
        setCart([]);
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
  // Auth Operations: Login, Register, Logout
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

  const applyAuthenticatedUser = (authUser: User) => {
    setUser(authUser);
    setCustomerName(authUser.fullName);
    setCustomerEmail(authUser.email);
    if (authUser.phoneNumber) setCustomerPhone(authUser.phoneNumber);
    if (authUser.address) setShippingAddress(authUser.address);
  };

  const completeAuthentication = (
    authUser: User,
    toastTitle = 'Đăng nhập thành công',
    toastMessage = `Xin chào mừng trở lại, ${authUser.fullName}!`
  ) => {
    const wasModalOpen = isAuthModalOpen;
    const pending = pendingAdd;

    applyAuthenticatedUser(authUser);
    setAuthError(null);
    setLoginEmailError(null);
    setLoginPasswordError(null);
    setLoginFailureCount(0);
    setVerificationEmail('');
    setVerificationNotice(null);
    setAuthGateNotice(false);
    setIsAuthModalOpen(false);
    setPendingAdd(null);

    if (pending) {
      executePendingAdd(pending);
      return;
    }

    showToast(toastTitle, toastMessage, 'System');

    const returnRoute = sessionStorage.getItem('dafl_return_route');
    if (returnRoute) {
      sessionStorage.removeItem('dafl_return_route');
      const clean = returnRoute.replace(/^#\/?/, '').replace(/^\/+/, '');
      const parts = clean.split('/');
      navigateTo((parts[0] || 'home') as AppRoute, parts[1]);
    } else if (!wasModalOpen) {
      navigateTo('home');
    }
  };

  const handleAuthClose = () => {
    setPendingAdd(null);
    setAuthGateNotice(false);
    setVerificationEmail('');
    setVerificationNotice(null);
    setIsAuthModalOpen(false);
    sessionStorage.removeItem('dafl_return_route');
    if (location.pathname === '/login' || location.pathname === '/register') {
      navigateTo('home');
    }
  };

  const handleVerifyEmail = async (code: string): Promise<string | null> => {
    if (!verificationEmail) return 'Không tìm thấy email cần xác thực.';
    setAuthLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/verify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: verificationEmail, code })
      });
      const json: ApiResponse<User> = await res.json();
      if (json.success && json.data) {
        completeAuthentication(json.data, 'Xác thực thành công', `Chào mừng ${json.data.fullName} đến với DAFL Store!`);
        return null;
      }
      return getResponseError(json, 'Mã xác nhận không đúng.');
    } catch {
      return 'Không thể kết nối đến máy chủ. Vui lòng kiểm tra mạng và thử lại sau.';
    } finally {
      setAuthLoading(false);
    }
  };

  const handleResendVerification = async (): Promise<string | null> => {
    if (!verificationEmail) return 'Không tìm thấy email cần xác thực.';
    setAuthLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/resend-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: verificationEmail })
      });
      const json: ApiResponse<any> = await res.json();
      // debugCode (nếu môi trường dev/test trả về) được bỏ qua có chủ đích:
      // FE không tự điền và không hiển thị mã xác thực.
      if (json.success) return null;
      return getResponseError(json, 'Không thể gửi lại mã xác thực.');
    } catch {
      return 'Không thể kết nối đến máy chủ. Vui lòng kiểm tra mạng và thử lại sau.';
    } finally {
      setAuthLoading(false);
    }
  };

  const handleOtpLoginRequest = async (email: string): Promise<string | null> => {
    setAuthLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/otp-login/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email })
      });
      const json: ApiResponse<any> = await res.json();
      if (json.success) return null;
      return getResponseError(json, 'Không thể gửi mã OTP.');
    } catch {
      return 'Không thể kết nối đến máy chủ. Vui lòng kiểm tra mạng và thử lại sau.';
    } finally {
      setAuthLoading(false);
    }
  };

  const handleOtpLoginVerify = async (email: string, code: string): Promise<string | null> => {
    setAuthLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/otp-login/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, code })
      });
      const json: ApiResponse<User> = await res.json();
      if (json.success && json.data) {
        completeAuthentication(json.data);
        return null;
      }
      return getResponseError(json, 'Mã xác nhận không đúng.');
    } catch {
      return 'Không thể kết nối đến máy chủ. Vui lòng kiểm tra mạng và thử lại sau.';
    } finally {
      setAuthLoading(false);
    }
  };

  const handleForgotPasswordRequest = async (email: string): Promise<string | null> => {
    setAuthLoading(true);
    try {
      await fetch(`${API_BASE}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email })
      });
      // Endpoint luôn trả phản hồi generic để không lộ email có tồn tại hay không.
      return null;
    } catch {
      // Vẫn giữ phản hồi generic ở UI theo đúng luồng quên mật khẩu.
      return null;
    } finally {
      setAuthLoading(false);
    }
  };

  const handleResetPassword = async (email: string, code: string, newPassword: string): Promise<string | null> => {
    setAuthLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, code, newPassword })
      });
      const json: ApiResponse<any> = await res.json();
      if (json.success) return null;
      return getResponseError(json, 'Không thể đặt lại mật khẩu.');
    } catch {
      return 'Không thể kết nối đến máy chủ. Vui lòng kiểm tra mạng và thử lại sau.';
    } finally {
      setAuthLoading(false);
    }
  };

  const handleFillDemoAccount = () => {
    setLoginEmail('demo@dafl.vn');
    setLoginPassword('Password123!');
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setLoginEmailError(null);
    setLoginPasswordError(null);

    const normalizedEmail = loginEmail.trim().toLowerCase();
    if (normalizedEmail !== loginEmail) setLoginEmail(normalizedEmail);

    if (!normalizedEmail) {
      setLoginEmailError('Email không được để trống.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setLoginEmailError('Email không đúng định dạng.');
      return;
    }
    if (!loginPassword) {
      setLoginPasswordError('Mật khẩu không được để trống.');
      return;
    }

    setAuthLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: normalizedEmail, password: loginPassword })
      });
      const json: ApiResponse<User> = await res.json();
      if (json.success && json.data) {
        completeAuthentication(json.data);
      } else if (json.message === UNVERIFIED_LOGIN_MESSAGE) {
        setLoginFailureCount(0);
        setVerificationEmail(normalizedEmail);
        setVerificationNotice(json.message);
      } else {
        const message = getResponseError(json, 'Email hoặc mật khẩu không chính xác.');
        setAuthError(message);
        setLoginPasswordError(message);
        setLoginFailureCount(prev => prev + 1);
      }
    } catch {
      if (normalizedEmail === 'demo@dafl.vn') {
        const demoUser: User = {
          id: '11111111-1111-1111-1111-111111111111',
          email: 'demo@dafl.vn',
          fullName: 'Nguyễn Văn Demo',
          phoneNumber: '0987654321',
          address: 'Số 1 Đại Cồ Việt, Hai Bà Trưng, Hà Nội',
          role: 'Customer',
          sessionId: 'demo-session-' + Date.now()
        };
        completeAuthentication(demoUser);
      } else {
        setAuthError('Không thể kết nối đến máy chủ. Vui lòng kiểm tra mạng và thử lại sau.');
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);

    if (registerPassword.length < 8) {
      setAuthError('Mật khẩu phải có tối thiểu 8 ký tự.');
      setAuthLoading(false);
      return;
    }
    if (!/[A-Z]/.test(registerPassword)) {
      setAuthError('Mật khẩu phải chứa ít nhất 1 ký tự chữ hoa (A-Z).');
      setAuthLoading(false);
      return;
    }
    if (!/\d/.test(registerPassword)) {
      setAuthError('Mật khẩu phải chứa ít nhất 1 chữ số (0-9).');
      setAuthLoading(false);
      return;
    }
    if (!/[^a-zA-Z0-9]/.test(registerPassword)) {
      setAuthError('Mật khẩu phải chứa ít nhất 1 ký tự đặc biệt (!@#$%^&*...).');
      setAuthLoading(false);
      return;
    }
    if (registerPassword !== registerConfirmPassword) {
      setAuthError('Mật khẩu xác nhận không khớp. Vui lòng kiểm tra lại.');
      setAuthLoading(false);
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          fullName: registerName,
          email: registerEmail,
          password: registerPassword,
          phoneNumber: registerPhone,
          address: registerAddress
        })
      });
      const json: ApiResponse<User | RegisterVerificationResult> = await res.json();
      if (json.success && json.data && 'requiresVerification' in json.data && json.data.requiresVerification) {
        setVerificationEmail(json.data.email || registerEmail.trim().toLowerCase());
        setVerificationNotice(json.message || 'Đã gửi mã xác thực về email của bạn. Vui lòng kiểm tra hộp thư (cả mục Spam/Quảng cáo).');
        setRegisterPassword('');
        setRegisterConfirmPassword('');
      } else if (json.success && json.data && 'id' in json.data) {
        // Tương thích ngược nếu API cũ vẫn trả UserDto trực tiếp.
        setRegisterPassword('');
        setRegisterConfirmPassword('');
        completeAuthentication(json.data, 'Đăng ký thành công', `Chào mừng ${json.data.fullName} đến với DAFL Store!`);
      } else {
        setAuthError(getResponseError(json, 'Không thể đăng ký tài khoản.'));
      }
    } catch {
      setAuthError('Không thể kết nối đến máy chủ. Vui lòng thử lại sau.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' });
    } catch (err) {
      console.warn('Logout API offline:', err);
    } finally {
      setUser(null);
      setProfileFullName('');
      setProfileEmail('');
      setProfilePhone('');
      setProfileAddress('');
      setProfileNotes('');
      setCustomerName('');
      setCustomerEmail('');
      setCustomerPhone('');
      setShippingAddress('');
      setOrderHistory([]);
      localStorage.removeItem('dafl_saved_address');
      showToast('Đã đăng xuất', 'Hẹn gặp lại bạn!', 'System');
      navigateTo('home');
    }
  };

  const fetchOrderHistory = async () => {
    setOrderHistoryLoading(true);
    try {
      const params = new URLSearchParams();
      if (user?.id) params.append('userId', user.id);
      const email = user?.email || customerEmail;
      if (!user?.id && email) params.append('email', email);

      if (!user?.id && !email) {
        setOrderHistory([]);
        return;
      }

      const res = await fetch(`${API_BASE}/api/orders/history?${params.toString()}`);
      const json: ApiResponse<OrderHistory[]> = await res.json();
      if (json.success && json.data) {
        setOrderHistory(json.data);
      } else {
        setOrderHistory([]);
      }
    } catch {
      setOrderHistory([]);
    } finally {
      setOrderHistoryLoading(false);
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
    if ((route === 'orders' || route === 'profile') && !user) {
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
    if (route === 'orders') {
      fetchOrderHistory();
    }

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

  const openOrderHistory = async () => {
    navigateTo('orders');
    await fetchOrderHistory();
  };

  // Sync product detail when route matches /product/:id
  useEffect(() => {
    if (matchedProductId) {
      loadProductDetailById(matchedProductId);
    } else {
      lastLoadedProductIdRef.current = null;
    }
  }, [matchedProductId]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          fullName: profileFullName,
          phoneNumber: profilePhone,
          address: profileAddress
        })
      });
      const json: ApiResponse<User> = await res.json();
      if (json.success && json.data) {
        setUser(json.data);
        setCustomerName(json.data.fullName);
        if (json.data.phoneNumber) setCustomerPhone(json.data.phoneNumber);
        if (json.data.address) setShippingAddress(json.data.address);
        showToast('Cập nhật thành công', 'Địa chỉ giao hàng đã được cập nhật thành công!', 'System');
      } else {
        setCustomerName(profileFullName);
        setCustomerPhone(profilePhone);
        setShippingAddress(profileAddress);
        setUser(prev => prev ? ({ ...prev, fullName: profileFullName, phoneNumber: profilePhone, address: profileAddress }) : null);
        showToast('Cập nhật thành công', 'Địa chỉ giao hàng đã được lưu.', 'System');
      }
      localStorage.setItem('dafl_saved_address', JSON.stringify({
        fullName: profileFullName,
        phone: profilePhone,
        address: profileAddress,
        notes: profileNotes
      }));
    } catch {
      setCustomerName(profileFullName);
      setCustomerPhone(profilePhone);
      setShippingAddress(profileAddress);
      setUser(prev => prev ? ({ ...prev, fullName: profileFullName, phoneNumber: profilePhone, address: profileAddress }) : null);
      showToast('Cập nhật thành công', 'Địa chỉ giao hàng đã được lưu.', 'System');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleReorder = (order: OrderHistory) => {
    const newItems: CartItem[] = [];
    order.items.forEach(it => {
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
      newItems.push({ product: existingProd, quantity: it.quantity });
    });

    setCart(newItems);
    navigate('/cart');
    showToast('Đã thêm vào giỏ', `Đã thêm ${newItems.length} món từ đơn #${order.orderCode} vào giỏ hàng!`, 'Promotion');
  };

  const handleSimulatePaymentForOrder = async (orderCode: number, _totalAmount?: number) => {
    try {
      const res = await fetch(`${API_BASE}/api/payments/status/${orderCode}`);
      const json: ApiResponse<any> = await res.json();
      if (json.success && json.data?.status === 'Paid') {
        if (checkoutResult && checkoutResult.orderCode === orderCode) {
          setOrderStatus('Paid');
          setCart([]);
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
  const visibleProducts = products.filter(matchesHomeFilters);
  const formatPrice = (val: number) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(val);
  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const commonAuthProps = {
    gateNotice: authGateNotice,
    authError,
    authLoading,
    loginEmail,
    setLoginEmail: updateLoginEmail,
    loginPassword,
    setLoginPassword: updateLoginPassword,
    loginEmailError,
    loginPasswordError,
    loginFailureCount,
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
    registerAddress,
    setRegisterAddress,
    verificationEmail,
    verificationNotice,
    onLogin: handleLogin,
    onRegister: handleRegister,
    onVerifyEmail: handleVerifyEmail,
    onResendVerification: handleResendVerification,
    onOtpLoginRequest: handleOtpLoginRequest,
    onOtpLoginVerify: handleOtpLoginVerify,
    onForgotPasswordRequest: handleForgotPasswordRequest,
    onResetPassword: handleResetPassword,
    onFillDemoAccount: handleFillDemoAccount,
  };

  const isStandalone = location.pathname.startsWith('/mock-payos') || location.pathname.startsWith('/payment-success');

  return (
    <div className="app-container">
      {/* Live Toast Notification Alert */}
      {!isStandalone && toastAlert && (
        <div className="toast-container">
          <div className="toast-alert">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Sparkles size={16} color="#e40046" />
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
        />
      )}

      <Routes>
        {/* Home Route View */}
        <Route
          path="/"
          element={
            <>
              {/* Compact collection heading */}
              <section className="hero">
                <div className="hero-layout">
                  <div className="hero-main">
                    <div className="hero-top-badge">
                      <Sparkles size={14} color="#b80039" />
                      <span>FLASH SALE DAFL • GIẢM ĐẾN 50%</span>
                    </div>
                    <h1 className="hero-title">
                      Sàn Thương Mại Điện Tử DAFL
                    </h1>
                    <p className="hero-subtitle">
                      Mỹ phẩm chính hãng với giá hiển thị rõ ràng, ưu đãi theo ngày và chính sách đổi trả trong 30 ngày.
                    </p>
                  </div>
                </div>
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
                      {[
                        { value: 'all', label: 'Tất cả mức giá' },
                        { value: 'under-500', label: 'Dưới 500.000đ' },
                        { value: '500-2000', label: '500.000đ — 2.000.000đ' },
                        { value: 'over-2000', label: 'Trên 2.000.000đ' },
                      ].map(option => (
                        <label key={option.value} className="filter-option">
                          <input
                            type="radio"
                            name="home-price-range"
                            checked={homePriceRange === option.value}
                            onChange={() => setHomePriceRange(option.value as typeof homePriceRange)}
                          />
                          <span>{option.label}</span>
                        </label>
                      ))}
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

                    <div className="filter-group">
                      <h3>Tình trạng</h3>
                      <label className="filter-option">
                        <input
                          type="checkbox"
                          checked={homeInStockOnly}
                          onChange={e => setHomeInStockOnly(e.target.checked)}
                        />
                        <span>Chỉ hiển thị sản phẩm còn hàng</span>
                      </label>
                    </div>
                  </div>
                </aside>

                {/* Products Grid */}
                <section id="products-section" className="shop-main">
                  <div className="shop-section-header">
                    <h2>
                      {selectedCategory ? (categories.find(c => c.id === selectedCategory)?.name || 'Danh mục sản phẩm') : 'Tất cả sản phẩm'}
                    </h2>
                    {visibleProducts.length > 0 && (
                      <div className="product-count-badge">
                        <Package size={14} color="var(--primary)" />
                        <span>Hiển thị {Math.min(visibleCount, visibleProducts.length)} / {visibleProducts.length} sản phẩm</span>
                      </div>
                    )}
                  </div>

                  {loading ? (
                    <div className="shop-empty-state">
                      <RefreshCw size={24} className="spin" />
                      <div>Đang tải danh sách sản phẩm...</div>
                    </div>
                  ) : visibleProducts.length === 0 ? (
                    <div className="shop-empty-state">
                      Không tìm thấy sản phẩm nào phù hợp với tìm kiếm và bộ lọc hiện tại.
                    </div>
                  ) : (
                    <>
                      <div className="products-grid">
                        {visibleProducts.slice(0, visibleCount).map(product => (
                          <ProductCard
                            key={product.id}
                            product={product}
                            onOpenDetail={openProductDetail}
                            onAddToCart={addToCart}
                          />
                        ))}
                      </div>

                      {/* Scroll Sentinel for Infinite Scroll Lazy Loading */}
                      <div ref={loadMoreSentinelRef} className="load-more-sentinel" />

                      {/* Lazy Load Spinner */}
                      {isLoadingMore && (
                        <div className="lazy-load-indicator">
                          <RefreshCw size={20} className="spin" />
                          <span>Đang tải thêm sản phẩm khi cuộn...</span>
                        </div>
                      )}

                      {/* Manual Load More Button as Fallback */}
                      {!isLoadingMore && visibleCount < visibleProducts.length && (
                        <div className="load-more-action">
                          <button
                            className="btn btn-secondary"
                            onClick={handleLoadMore}
                          >
                            Tải thêm {Math.min(16, visibleProducts.length - visibleCount)} sản phẩm tiếp theo
                          </button>
                        </div>
                      )}

                      {/* End of list state */}
                      {visibleCount >= visibleProducts.length && visibleProducts.length > 0 && (
                        <div className="lazy-load-end">
                          <CheckCircle2 size={18} color="#2e7d4f" />
                          <span>Bạn đã xem toàn bộ {visibleProducts.length} sản phẩm</span>
                        </div>
                      )}
                    </>
                  )}
                </section>
              </div>

              <section className="brand-banner-row" aria-label="Danh mục nổi bật tại DAFL">
                {(categories.length > 0 ? categories.slice(0, 4) : [
                  { id: 'dafl-care', name: 'Chăm sóc da' },
                  { id: 'dafl-makeup', name: 'Trang điểm' },
                  { id: 'dafl-hair', name: 'Chăm sóc tóc' },
                  { id: 'dafl-body', name: 'Cơ thể & nước hoa' },
                ]).map(category => (
                  <button
                    key={category.id}
                    type="button"
                    className="brand-banner"
                    onClick={() => {
                      if (categories.length > 0) setSelectedCategory(category.id);
                    }}
                  >
                    <strong>{category.name}</strong>
                    <span>Ưu đãi DAFL đang áp dụng</span>
                  </button>
                ))}
              </section>
            </>
          }
        />

        {/* ============================================================== */}
        {/* ROUTE VIEW: ORDERS & ORDER HISTORY (/orders) */}
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
                        style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                        onClick={() => navigateTo('home')}
                      >
                        <ArrowLeft size={16} /> Tiếp tục mua sắm
                      </button>
                      <h1 className="page-title" style={{ margin: 0 }}>
                        <Package size={26} color="var(--primary)" /> Quản lý Đơn Mua & Lịch Sử Đơn Hàng
                      </h1>
                    </div>
                    <p className="page-subtitle" style={{ marginTop: 6 }}>
                      Theo dõi tiến độ đơn hàng, thanh toán trực tiếp qua PayOS trên web và kiểm tra trạng thái thời gian thực.
                    </p>
                  </div>

                  <div style={{ display: 'flex', gap: 10 }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={fetchOrderHistory}
                      disabled={orderHistoryLoading}
                      style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                      <RefreshCw size={15} className={orderHistoryLoading ? 'spin' : ''} />
                      Làm mới danh sách
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => navigateTo('profile')}
                      style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                      <MapPin size={15} color="#e40046" /> Cấu hình địa chỉ nhận hàng
                    </button>
                  </div>
                </div>

                {/* Filter Tabs */}
                <div className="order-filter-tabs">
                  {[
                    { key: 'all', label: `Tất cả (${orderHistory.length})` },
                    { key: 'Pending', label: `Chờ thanh toán (${orderHistory.filter(o => o.status === 'Pending').length})` },
                    { key: 'Paid', label: `Đã thanh toán (${orderHistory.filter(o => o.status === 'Paid').length})` },
                    { key: 'Shipping', label: `Đang giao hàng (${orderHistory.filter(o => o.status === 'Shipping').length})` },
                    { key: 'Completed', label: `Hoàn tất (${orderHistory.filter(o => o.status === 'Completed').length})` },
                    { key: 'Cancelled', label: `Đã hủy (${orderHistory.filter(o => o.status === 'Cancelled').length})` }
                  ].map(tab => (
                    <button
                      key={tab.key}
                      type="button"
                      className={`order-filter-btn ${orderFilter === tab.key ? 'active' : ''}`}
                      onClick={() => setOrderFilter(tab.key as any)}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Orders List */}
                {orderHistoryLoading ? (
                  <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
                    <RefreshCw size={36} className="spin" style={{ margin: '0 auto 12px', color: 'var(--primary)' }} />
                    <p>Đang tải danh sách đơn hàng từ máy chủ...</p>
                  </div>
                ) : orderHistory.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '60px 0', background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--border-subtle)' }}>
                    <Package size={56} style={{ margin: '0 auto 14px', opacity: 0.3, color: 'var(--text-muted)' }} />
                    <h3 style={{ fontSize: '1.2rem', marginBottom: 8 }}>Bạn chưa có đơn hàng nào</h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: 20 }}>
                      Khám phá ngay các ưu đãi giảm giá và sản phẩm nổi bật tại DAFL Store!
                    </p>
                    <button type="button" className="btn btn-primary" onClick={() => navigateTo('home')}>
                      <ShoppingBag size={16} /> Mua sắm ngay
                    </button>
                  </div>
                ) : (
                  <div className="orders-list-container">
                    {orderHistory
                      .filter(o => orderFilter === 'all' || o.status === orderFilter)
                      .map(order => {
                        const statusClass = order.status.toLowerCase();
                        return (
                          <div key={order.id} className="order-card">
                            {/* Order Card Header */}
                            <div className="order-card-header">
                              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                <span style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--text-main)' }}>
                                  Mã đơn: #{order.orderCode}
                                </span>
                                <span className={`order-status-badge ${statusClass}`}>
                                  {order.status === 'Paid' && <CheckCircle2 size={13} />}
                                  {order.status === 'Pending' && <Clock size={13} />}
                                  {order.status === 'Shipping' && <Truck size={13} />}
                                  {order.status === 'Completed' && <CheckCircle2 size={13} />}
                                  {order.status === 'Paid' ? 'Đã thanh toán (PayOS)' :
                                    order.status === 'Pending' ? 'Chờ thanh toán' :
                                      order.status === 'Shipping' ? 'Đang giao hàng' :
                                        order.status === 'Completed' ? 'Giao thành công' :
                                          order.status === 'Cancelled' ? 'Đã hủy' : order.status}
                                </span>
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <Calendar size={14} /> {new Date(order.createdAt).toLocaleString('vi-VN')}
                                </span>
                              </div>
                            </div>

                            {/* Recipient & Shipping Address */}
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 14px', background: 'var(--bg-subtle)', borderRadius: 8, marginBottom: 14, fontSize: '0.85rem' }}>
                              <MapPin size={16} color="var(--primary)" style={{ flexShrink: 0, marginTop: 2 }} />
                              <div>
                                <strong>{order.customerName}</strong> ({order.customerPhone}) — <span style={{ color: 'var(--text-muted)' }}>{order.shippingAddress}</span>
                              </div>
                            </div>

                            {/* Order Items */}
                            <div className="order-items-list">
                              {order.items && order.items.map(item => (
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
                            </div>

                            {/* Order Status Timeline (If exists) */}
                            {order.statusHistories && order.statusHistories.length > 0 && (
                              <div className="order-timeline-box">
                                <div style={{ fontWeight: 700, marginBottom: 6, fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                  Tiến trình trạng thái đơn hàng:
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                  {order.statusHistories.map((h, i) => (
                                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem' }}>
                                      <CheckCircle2 size={12} color="#10b981" />
                                      <span>{new Date(h.timestamp).toLocaleTimeString('vi-VN')}</span>
                                      <span style={{ fontWeight: 600 }}>{h.note || 'Cập nhật trạng thái'}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Order Footer & Actions */}
                            <div className="order-footer-actions">
                              <div>
                                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                  {order.discountAmount > 0 && (
                                    <span>
                                      Đã giảm <strong style={{ color: '#10b981' }}>-{formatPrice(order.discountAmount)}</strong>
                                      {order.voucherCode ? ` (Mã: ${order.voucherCode})` : ''} •
                                    </span>
                                  )}
                                  {' '}Tổng giá trị đơn: <strong style={{ color: '#e40046', fontSize: '1.15rem' }}>{formatPrice(order.totalAmount)}</strong>
                                </div>
                              </div>

                              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                {order.status === 'Pending' && (
                                  <button
                                    type="button"
                                    className="btn btn-primary"
                                    style={{ padding: '8px 16px', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                                    onClick={() => {
                                      if (!user) {
                                        sessionStorage.setItem('dafl_return_route', `/payment/${order.orderCode}`);
                                        showToast('Yêu cầu đăng nhập', 'Vui lòng đăng nhập để tiến hành thanh toán đơn hàng.', 'System');
                                        navigate('/login');
                                        return;
                                      }
                                      navigate(`/payment/${order.orderCode}`);
                                    }}
                                  >
                                    <CreditCard size={15} /> Thanh toán ngay (PayOS trực tiếp)
                                  </button>
                                )}

                                {(order.status === 'Paid' || order.status === 'Completed') && (
                                  <button
                                    type="button"
                                    className="btn btn-secondary"
                                    style={{ padding: '8px 16px', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                                    onClick={() => handleReorder(order)}
                                  >
                                    <RotateCcw size={14} /> Mua lại đơn này
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </section>
            )
          }
        />

        {/* ============================================================== */}
        {/* ROUTE VIEW: SHIPPING ADDRESS & PROFILE (/profile) */}
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
                        <MapPin size={26} color="var(--primary)" /> Địa Chỉ & Thông Tin Nhận Hàng
                      </h1>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => navigateTo('orders')}
                    style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    <Package size={15} /> Xem lịch sử đơn mua ({orderHistory.length})
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
                          {profileFullName || user?.fullName || 'Thông tin người nhận'}
                        </h3>
                        <span className="brand-badge" style={{ fontSize: '0.75rem' }}>
                          {user?.role || 'Khách hàng'}
                        </span>
                      </div>
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '4px 0 0' }}>
                        {profileEmail || user?.email || 'Chưa liên kết email'} • Sổ địa chỉ giao hàng
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

                  {/* Address Configuration Form */}
                  <form onSubmit={handleSaveProfile}>
                    <div className="address-form-grid">
                      <div className="form-group">
                        <label className="form-label">Họ và tên người nhận hàng</label>
                        <input
                          className="form-input"
                          value={profileFullName}
                          onChange={e => setProfileFullName(e.target.value)}
                          placeholder="Nguyễn Văn A"
                          required
                        />
                      </div>

                      <div className="form-group">
                        <label className="form-label">Số điện thoại liên hệ</label>
                        <input
                          className="form-input"
                          value={profilePhone}
                          onChange={e => setProfilePhone(e.target.value)}
                          placeholder="0987654321"
                          required
                        />
                      </div>
                    </div>

                    <div className="form-group">
                      <label className="form-label">Email nhận hóa đơn & thông báo</label>
                      <input
                        className="form-input"
                        type="email"
                        value={profileEmail}
                        onChange={e => setProfileEmail(e.target.value)}
                        placeholder="name@example.com"
                        required
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label">Địa chỉ giao hàng chi tiết (Số nhà, đường, phường/xã, quận/huyện, tỉnh/thành)</label>
                      <input
                        className="form-input"
                        value={profileAddress}
                        onChange={e => setProfileAddress(e.target.value)}
                        placeholder="Số 1 Đại Cồ Việt, Hai Bà Trưng, Hà Nội"
                        required
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label">Ghi chú giao hàng mặc định</label>
                      <textarea
                        className="form-input"
                        rows={2}
                        value={profileNotes}
                        onChange={e => setProfileNotes(e.target.value)}
                        placeholder="Ví dụ: Giao giờ hành chính, gọi điện trước khi giao..."
                      />
                    </div>

                    <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 24, paddingTop: 18, borderTop: '1px solid var(--border-subtle)' }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => navigateTo('home')}
                      >
                        Hủy bỏ
                      </button>
                      <button
                        type="submit"
                        className="btn btn-primary"
                        style={{ padding: '12px 28px', display: 'flex', alignItems: 'center', gap: 8 }}
                        disabled={savingProfile}
                      >
                        <Check size={16} /> {savingProfile ? 'Đang lưu vào hệ thống...' : 'Lưu thông tin địa chỉ'}
                      </button>
                    </div>
                  </form>
                </div>
              </section>
            )
          }
        />

        {/* ============================================================== */}
        {/* ROUTE VIEW: PRODUCT DETAIL (/product/:id) */}
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
                ) : !selectedProduct ? (
                  <div style={{ textAlign: 'center', padding: '60px 0' }}>
                    <Package size={48} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
                    <h3 style={{ fontSize: '1.2rem', marginBottom: 8 }}>Không tìm thấy sản phẩm</h3>
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
                            <ShieldCheck size={14} color="#e40046" /> Bảo hành 12 tháng
                          </div>
                          <div className="product-trust-badge">
                            <Truck size={14} color="#f59e0b" /> Giao hàng toàn quốc
                          </div>
                        </div>
                      </div>

                      <div>
                        <h2 style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: 8, color: 'var(--text-main)' }}>{selectedProduct.name}</h2>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                          <div className="star-rating">
                            {[1, 2, 3, 4, 5].map(st => (
                              <Star
                                key={st}
                                size={16}
                                fill={st <= Math.round(selectedProduct.rating || 5) ? '#f59e0b' : 'transparent'}
                                color="#f59e0b"
                              />
                            ))}
                          </div>
                          <span style={{ fontSize: '0.9rem', color: '#f59e0b', fontWeight: 700 }}>
                            {selectedProduct.rating ? selectedProduct.rating.toFixed(1) : '5.0'} / 5.0
                          </span>
                          <span style={{ color: '#9ca3af', fontSize: '0.85rem' }}>
                            ({selectedProduct.reviewCount || selectedProduct.evaluations?.length || 0} đánh giá)
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
                          <span style={{ fontSize: '1.6rem', fontWeight: 800, color: '#e40046' }}>
                            {formatPrice(selectedProduct.price)}
                          </span>
                          {selectedProduct.originalPrice && (
                            <span style={{ fontSize: '1rem', color: '#6b7280', textDecoration: 'line-through' }}>
                              {formatPrice(selectedProduct.originalPrice)}
                            </span>
                          )}
                          {selectedProduct.originalPrice && selectedProduct.originalPrice > selectedProduct.price && (
                            <span style={{ fontSize: '0.8rem', background: 'rgba(228, 0, 70, 0.1)', color: '#e40046', padding: '2px 8px', borderRadius: 4, fontWeight: 700 }}>
                              Tiết kiệm {formatPrice(selectedProduct.originalPrice - selectedProduct.price)}
                            </span>
                          )}
                        </div>

                        <div className="product-detail-desc" style={{ marginBottom: 20 }}>
                          {selectedProduct.description}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
                          <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Số lượng:</span>
                          <div className="cart-item-actions">
                            <button className="qty-btn" onClick={() => setDetailQuantity(Math.max(1, detailQuantity - 1))}>
                              <Minus size={14} />
                            </button>
                            <span style={{ minWidth: 24, textAlign: 'center', fontWeight: 700 }}>{detailQuantity}</span>
                            <button className="qty-btn" onClick={() => setDetailQuantity(detailQuantity + 1)}>
                              <Plus size={14} />
                            </button>
                          </div>
                          <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>
                            (Còn {selectedProduct.availableStock} sản phẩm có sẵn)
                          </span>
                        </div>

                        <div style={{ display: 'flex', gap: 12 }}>
                          <button
                            className="btn btn-secondary"
                            style={{ flex: 1, padding: '12px' }}
                            onClick={() => {
                              addToCart(selectedProduct, detailQuantity);
                            }}
                          >
                            <Plus size={16} /> Thêm vào giỏ hàng
                          </button>
                          <button
                            className="btn btn-primary"
                            style={{ flex: 1, padding: '12px' }}
                            onClick={() => {
                              handleBuyNow(selectedProduct, detailQuantity);
                            }}
                          >
                            Mua ngay
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Detail Tabs Header */}
                    <div className="detail-tabs-header" style={{ marginTop: 24 }}>
                      <button
                        className={`detail-tab-btn ${modalTab === 'description' ? 'active' : ''}`}
                        onClick={() => setModalTab('description')}
                      >
                        <FileText size={17} /> Mô tả & Thông số chi tiết
                      </button>
                      <button
                        className={`detail-tab-btn ${modalTab === 'reviews' ? 'active' : ''}`}
                        onClick={() => setModalTab('reviews')}
                      >
                        <Star size={17} /> Đánh giá từ khách hàng ({selectedProduct.evaluations?.length || 0})
                      </button>
                    </div>

                    {/* TAB 1: Mô tả chi tiết & Thông số sản phẩm */}
                    {modalTab === 'description' && (() => {
                      const extra = getProductDetailExtra(selectedProduct);
                      return (
                        <div className="product-detail-expanded" style={{ marginTop: 10 }}>
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

                    {/* TAB 2: Đánh giá từ khách hàng */}
                    {modalTab === 'reviews' && (
                      <div className="evaluations-container">
                        <h3 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: 16 }}>
                          Đánh giá từ khách hàng ({selectedProduct.evaluations?.length || 0})
                        </h3>

                        <form onSubmit={handleAddReview} style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)', padding: 16, borderRadius: 12, marginBottom: 20 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                            <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>Để lại đánh giá của bạn:</span>
                            <div className="star-picker">
                              {[1, 2, 3, 4, 5].map(st => (
                                <Star
                                  key={st}
                                  size={20}
                                  fill={st <= reviewRating ? '#f59e0b' : 'transparent'}
                                  color="#f59e0b"
                                  onClick={() => setReviewRating(st)}
                                />
                              ))}
                            </div>
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10, marginBottom: 10 }}>
                            <input
                              className="form-input"
                              placeholder="Tên của bạn..."
                              value={reviewAuthor}
                              onChange={e => setReviewAuthor(e.target.value)}
                              required
                            />
                            <input
                              className="form-input"
                              placeholder="Cảm nhận của bạn về sản phẩm..."
                              value={reviewComment}
                              onChange={e => setReviewComment(e.target.value)}
                              required
                            />
                          </div>

                          <button
                            type="submit"
                            className="btn btn-primary"
                            style={{ padding: '8px 16px', fontSize: '0.8rem', marginLeft: 'auto', display: 'flex' }}
                            disabled={submittingReview}
                          >
                            <Send size={14} /> {submittingReview ? 'Đang gửi...' : 'Gửi đánh giá'}
                          </button>
                        </form>

                        {selectedProduct.evaluations && selectedProduct.evaluations.length > 0 ? (
                          selectedProduct.evaluations.map(ev => (
                            <div key={ev.id} className="evaluation-card">
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#e40046', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700 }}>
                                    {ev.userName.charAt(0)}
                                  </div>
                                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{ev.userName}</span>
                                </div>
                                <div className="star-rating">
                                  {[1, 2, 3, 4, 5].map(st => (
                                    <Star
                                      key={st}
                                      size={13}
                                      fill={st <= ev.rating ? '#f59e0b' : 'transparent'}
                                      color="#f59e0b"
                                    />
                                  ))}
                                </div>
                              </div>
                              <p style={{ fontSize: '0.85rem', color: 'var(--text-main)', lineHeight: 1.5 }}>{ev.comment}</p>
                              <span style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: 4, display: 'block' }}>
                                {new Date(ev.createdAt).toLocaleDateString('vi-VN')}
                              </span>
                            </div>
                          ))
                        ) : (
                          <p style={{ color: '#9ca3af', fontSize: '0.85rem', textAlign: 'center', padding: '16px 0' }}>
                            Chưa có đánh giá nào cho sản phẩm này. Hãy là người đầu tiên đánh giá!
                          </p>
                        )}
                      </div>
                    )}
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
              onUpdateQuantity={updateQuantity}
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
                            <strong style={{ fontSize: '1.1rem' }}>#{orderCodeNum}</strong>
                            <span style={{ margin: '0 8px', color: 'var(--border-subtle)' }}>|</span>
                            <span style={{ fontSize: '0.95rem', color: 'var(--text-muted)' }}>Tổng thanh toán: </span>
                            <strong style={{ color: '#e40046', fontSize: '1.25rem' }}>{formatPrice(totalAmt)}</strong>
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {!isStandalone && <SiteFooter />}

      {/* Auth gate overlay: giữ nguyên trang hiện tại, đóng modal sẽ hủy pendingAdd */}
      {isAuthModalOpen && location.pathname !== '/login' && location.pathname !== '/register' && (
        <AuthModal
          {...commonAuthProps}
          isOpen={true}
          isModal={true}
          onClose={handleAuthClose}
          authTab={authTab}
          setAuthTab={(tab) => {
            setAuthTab(tab);
            setAuthError(null);
          }}
        />
      )}

      {/* ============================================================== */}
      {/* MODAL: NOTIFICATIONS MODAL */}
      {/* ============================================================== */}
      {isNotifOpen && (
        <div className="modal-overlay" onClick={() => setIsNotifOpen(false)} data-testid="notifications-modal">
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 600 }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Bell size={20} color="var(--primary)" />
                <h2 className="modal-title">Hộp thư thông báo</h2>
              </div>
              <button
                type="button"
                className="close-btn"
                onClick={() => setIsNotifOpen(false)}
                data-testid="close-notif-btn"
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <button
                type="button"
                style={{ background: 'none', border: 'none', color: '#ff8a80', cursor: 'pointer', fontSize: '0.8rem' }}
                onClick={markAllNotificationsAsRead}
                data-testid="mark-all-read-btn"
              >
                Đánh dấu tất cả đã đọc
              </button>
            </div>

            <div style={{ maxHeight: 440, overflowY: 'auto' }}>
              {notifications.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '30px 0' }}>
                  <Bell size={40} style={{ margin: '0 auto 8px', opacity: 0.3 }} />
                  <p>Không có thông báo nào.</p>
                </div>
              ) : (
                notifications.map(n => (
                  <div
                    key={n.id}
                    className={`notification-item ${!n.isRead ? 'unread' : ''}`}
                    onClick={() => markNotificationAsRead(n.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    {!n.isRead && <div className="unread-dot" />}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                      <span className={`notif-badge ${(n.type || 'system').toLowerCase()}`}>
                        {n.type === 'Payment' ? '💳 Thanh toán' : n.type === 'Order' ? '📦 Đơn hàng' : n.type === 'Promotion' ? '🎁 Khuyến mãi' : '⚙️ Hệ thống'}
                      </span>
                      <strong style={{ fontSize: '0.95rem', color: 'var(--text-main)' }}>{n.title}</strong>
                    </div>
                    <p style={{ fontSize: '0.825rem', color: 'var(--text-muted)', lineHeight: 1.4, margin: '4px 0' }}>
                      {n.message}
                    </p>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>
                      {new Date(n.createdAt).toLocaleTimeString('vi-VN')} - {new Date(n.createdAt).toLocaleDateString('vi-VN')}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
