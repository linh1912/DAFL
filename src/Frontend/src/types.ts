export type AppRoute =
  | 'home'
  | 'cart'
  | 'login'
  | 'register'
  | 'product'
  | 'orders'
  | 'profile'
  | 'notifications'
  | 'payment';

export interface Category {
  id: string;
  name: string;
  slug: string;
  description?: string;
  iconUrl?: string;
}

export interface Evaluation {
  id: string;
  productId: string;
  userName: string;
  rating: number;
  comment: string;
  createdAt: string;
}

export interface Product {
  id: string;
  categoryId: string;
  categoryName: string;
  name: string;
  slug: string;
  description: string;
  price: number;
  originalPrice?: number;
  availableStock: number;
  imageUrl: string;
  rating?: number;
  reviewCount?: number;
}

export interface ProductDetail extends Product {
  /** Thư viện ảnh (ảnh đại diện đứng đầu); thiếu thì dùng imageUrl */
  images?: string[];
  evaluations: Evaluation[];
}

export interface CartItem {
  product: Product;
  quantity: number;
  /** Id dòng giỏ trên server (khi đã đăng nhập — PUT/DELETE /api/cart/items/{id}); khách vãng lai không có. */
  serverItemId?: string;
  /** false = sản phẩm ngừng bán/hết hàng (BE CartItemDto.isAvailable) — dòng bị đánh dấu và KHÔNG tính tiền/không đặt được (CN-06.5). */
  isAvailable?: boolean;
  /** Giá vừa thay đổi so với lần đồng bộ trước (CN-06.5) → hiện `cart-item-price-changed-{productId}`. */
  priceChanged?: boolean;
  /** Giá cũ trước khi thay đổi (để hiển thị đối chiếu). */
  previousPrice?: number;
}

/** DTO giỏ server — khớp Features/Cart/CartFeatures.cs ở BE. */
export interface ServerCartItemDto {
  id: string;
  productId: string;
  productName: string;
  productImageUrl?: string | null;
  unitPrice: number;
  quantity: number;
  subTotal: number;
  availableStock: number;
  isAvailable: boolean;
}

export interface ServerCartDto {
  id: string;
  items: ServerCartItemDto[];
  totalQuantity: number;
  totalAmount: number;
  notice?: string | null;
}

/** Kết quả đăng nhập/đăng ký/social ở BE mới: { token (JWT 1 giờ), user }. */
export interface AuthResult {
  token: string;
  user: User;
}

export interface Voucher {
  id: string;
  code: string;
  description: string;
  discountType: string;
  discountValue: number;
  minOrderAmount: number;
  maxDiscountAmount?: number;
}

export interface ApplyVoucherResult {
  code: string;
  subTotal: number;
  discountAmount: number;
  finalTotal: number;
  message: string;
}

/** Địa chỉ trong sổ địa chỉ của tài khoản (bảng UserAddress ở BE). Mã địa giới: BE trả STRING, dữ liệu tỉnh nội bộ là number — chấp nhận cả hai. */
export interface UserAddress {
  id: string;
  label?: string;
  recipientName: string;
  phone: string;
  provinceCode: number | string;
  provinceName: string;
  districtCode: number | string;
  districtName: string;
  wardCode: number | string;
  wardName: string;
  detailAddress: string;
  note?: string;
  isDefault: boolean;
}

/** Khối thông tin giao hàng gửi kèm payload đặt hàng (snapshot ở BE). */
export interface ShippingInfo {
  recipientName: string;
  phone: string;
  email: string;
  provinceCode: number;
  provinceName: string;
  districtCode: number;
  districtName: string;
  wardCode: number;
  wardName: string;
  detailAddress: string;
  note?: string;
  /** Id địa chỉ trong sổ đã chọn (nếu dùng địa chỉ đã lưu); null khi nhập mới. */
  addressBookId: string | null;
  /** Người dùng tick "Lưu làm địa chỉ mặc định" — App lưu vào sổ sau khi đặt đơn thành công. */
  saveAsDefault?: boolean;
}

export interface CheckoutResult {
  orderId: string;
  orderCode: number;
  /** Mã đơn hiển thị dạng DH{yyyyMMdd}-{NNNN} (CN-07). */
  orderDisplayCode?: string;
  /** COD | PayOS — quyết định view sau đặt hàng (success view cho COD, cổng thanh toán cho PayOS). */
  paymentMethod?: string;
  shippingFee?: number;
  subTotal?: number;
  discountAmount?: number;
  totalAmount: number;
  checkoutUrl?: string;
  qrCode?: string;
  accountNumber?: string;
  accountName?: string;
  bin?: number | string;
  paymentDescription?: string;
  expiresAt: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  errors?: string[];
}

export interface User {
  id: string;
  email: string;
  fullName: string;
  phoneNumber?: string;
  address?: string;
  role: string;
  sessionId: string;
  avatarUrl?: string;
  /** BE v4 trả về trong /api/auth/me và các phản hồi đăng nhập: tài khoản đã có mật khẩu hay chưa (social thuần túy = false). */
  hasPassword?: boolean;
  /** Kênh đăng nhập gần nhất / nhà cung cấp đã liên kết chính (Google | Facebook). */
  authProvider?: string;
  linkedProviders?: string[];
}

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  type: string; // Order, Payment, Promotion, System
  isRead: boolean;
  createdAt: string;
}

export interface OrderItemHistory {
  id: string;
  productId: string;
  productName: string;
  productImageUrl?: string;
  unitPrice: number;
  quantity: number;
}

export interface OrderStatusHistory {
  status: number;
  note: string;
  timestamp: string;
}

export interface OrderHistory {
  id: string;
  orderCode: number;
  /** Mã đơn hiển thị DH{yyyyMMdd}-{NNNN}; fallback sang orderCode khi thiếu. */
  orderDisplayCode?: string;
  /** COD | PayOS (BE OrderHistoryDto.PaymentMethod). */
  paymentMethod?: string;
  /** Nhãn trạng thái tiếng Việt do BE tính sẵn (CN-08) — hiển thị trực tiếp, dùng quyết định nút Hủy. */
  statusLabel?: string;
  /** Lý do hủy (khi statusLabel = "Đã hủy"). */
  cancelReason?: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  shippingAddress: string;
  /** Snapshot giao hàng có cấu trúc (v4) — BE trả kèm trong lịch sử đơn nếu có. */
  shipProvinceCode?: number;
  shipProvinceName?: string;
  shipDistrictCode?: number;
  shipDistrictName?: string;
  shipWardCode?: number;
  shipWardName?: string;
  shipDetailAddress?: string;
  shipNote?: string;
  shippingFee?: number;
  addressBookId?: string;
  subTotal: number;
  discountAmount: number;
  voucherCode?: string;
  totalAmount: number;
  status: string;
  createdAt: string;
  checkoutUrl?: string;
  items: OrderItemHistory[];
  statusHistories: OrderStatusHistory[];
}
