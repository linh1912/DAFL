import React, { useState } from 'react';
import { ShoppingBag, X, CreditCard, Clock, Copy, CheckCircle2, RotateCcw, ArrowLeft, AlertTriangle, MapPin } from 'lucide-react';
import { CartItem, Voucher, CheckoutResult, User } from '../../types';
import { formatPrice, formatTime } from '../../utils/formatters';
import { CartItemRow } from './CartItemRow';
import { VoucherSection } from './VoucherSection';
import { CheckoutForm, CheckoutFormValues } from '../checkout/CheckoutForm';
import { PayOSGatewayView } from '../checkout/PayOSGatewayView';

export interface CartDrawerProps {
  isOpen?: boolean;
  onClose: () => void;
  cart: CartItem[];
  vouchers: Voucher[];
  voucherCodeInput: string;
  setVoucherCodeInput: (val: string) => void;
  appliedVoucher: { code: string; discountAmount: number } | null;
  voucherMessage: string | null;
  rawSubTotal: number;
  /** Phí ship ước tính (O1: 25.000đ, miễn phí khi tạm tính ≥ 299.000đ) — finalTotal đã gồm phí này. */
  shippingFee?: number;
  finalTotal: number;
  totalItemCount: number;
  customerName: string;
  setCustomerName: (val: string) => void;
  customerEmail: string;
  setCustomerEmail: (val: string) => void;
  customerPhone: string;
  setCustomerPhone: (val: string) => void;
  shippingAddress: string;
  setShippingAddress: (val: string) => void;
  checkoutResult: CheckoutResult | null;
  isCheckingOut: boolean;
  orderStatus: string;
  timeLeft: number;
  onUpdateQuantity: (productId: string, delta: number) => void;
  /** Đặt số lượng trực tiếp cho một dòng giỏ (CN-06.3). */
  onSetQuantity?: (productId: string, quantity: number) => void;
  /** Xóa hẳn một dòng giỏ sau khi người dùng xác nhận (CN-06.4). */
  onRemoveItem?: (productId: string) => void;
  /** Lỗi đặt hàng từ BE — hiển thị nguyên văn phía trên form thanh toán (CN-07). */
  checkoutError?: string | null;
  /** Giá trong giỏ vừa thay đổi → hiển thị checkout-price-changed-notice, yêu cầu xác nhận lại (CN-07 E2). */
  priceChangedPending?: boolean;
  /** Địa chỉ giao hàng của đơn vừa đặt — hiển thị trong order-success-view. */
  lastOrderAddress?: string;
  onApplyVoucher: (code?: string) => void;
  onRemoveVoucher: () => void;
  onCheckout: (e: React.FormEvent, values?: CheckoutFormValues) => void;
  onNavigateToOrders: () => void;
  onNavigateToHome: () => void;
  onCopyOrderCode?: (orderCode: number) => void;
  onManualRecheckOrder?: (orderCode: number) => void;
  onSimulateSuccess?: () => void;
  onResetCheckout?: () => void;
  user?: User | null;
  onRequireAuth?: () => void;
  isModal?: boolean;
}

export const CartDrawer: React.FC<CartDrawerProps> = ({
  isOpen,
  onClose,
  cart,
  vouchers,
  voucherCodeInput,
  setVoucherCodeInput,
  appliedVoucher,
  voucherMessage,
  rawSubTotal,
  shippingFee,
  finalTotal,
  totalItemCount,
  customerName,
  setCustomerName,
  customerEmail,
  setCustomerEmail,
  customerPhone,
  setCustomerPhone,
  shippingAddress,
  setShippingAddress,
  checkoutResult,
  isCheckingOut,
  orderStatus,
  timeLeft,
  onUpdateQuantity,
  onSetQuantity,
  onRemoveItem,
  checkoutError,
  priceChangedPending,
  lastOrderAddress,
  onApplyVoucher,
  onRemoveVoucher,
  onCheckout,
  onNavigateToOrders,
  onNavigateToHome,
  onCopyOrderCode,
  onManualRecheckOrder,
  onSimulateSuccess,
  onResetCheckout,
  user,
  onRequireAuth,
  isModal = false,
}) => {
  // Dòng giỏ đang chờ xác nhận xóa (CN-06.4 — áp cho cả nút Xóa và giảm về 0).
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);
  const pendingRemoveItem = pendingRemoveId ? cart.find(i => i.product.id === pendingRemoveId) : undefined;
  const hasUnavailable = cart.some(i => i.isAvailable === false);
  const isCodSuccess = !!checkoutResult && checkoutResult.paymentMethod === 'COD';

  if (isOpen === false) return null;

  const content = (
    <div
      className={`cart-container ${isModal ? `modal-content ${checkoutResult ? 'modal-content-lg' : ''}` : 'cart-page-content'}`}
      onClick={e => e.stopPropagation()}
      data-testid="cart-drawer"
    >
      <div className={isModal ? 'modal-header' : 'cart-page-header'}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {!isModal && (
            <button
              type="button"
              className="btn btn-secondary cart-back-link"
              style={{ padding: '6px 10px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 4 }}
              onClick={() => {
                onClose();
                onNavigateToHome?.();
              }}
              data-testid="cart-close-btn"
              title="Quay lại trang chủ"
            >
              <ArrowLeft size={16} /> Quay lại
            </button>
          )}
          <h2 className={isModal ? 'modal-title' : 'page-title'} style={{ margin: 0 }} data-testid="cart-drawer-title">
            <ShoppingBag size={24} color="var(--primary)" />
            {checkoutResult
              ? isCodSuccess
                ? 'Đặt hàng thành công'
                : 'Thanh toán PayOS'
              : 'Giỏ hàng'}
          </h2>
        </div>
        {isModal && (
          <button className="close-btn" onClick={onClose} data-testid="cart-close-btn" title="Đóng">
            <X size={20} />
          </button>
        )}
      </div>

      {/* View 1: Cart Items, Voucher, and Checkout Form */}
      {!checkoutResult ? (
        <>
          {cart.length === 0 ? (
            <div className="cart-empty-box" style={{ textAlign: 'center', padding: '48px 20px', color: '#9ca3af', minHeight: 360, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }} data-testid="cart-empty-state">
              <div style={{ width: 104, height: 104, borderRadius: '50%', background: 'var(--bg-subtle, #f3f4f6)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
                <ShoppingBag size={72} style={{ opacity: 0.35 }} />
              </div>
              <h3 style={{ fontSize: '1.2rem', marginBottom: 8, color: 'var(--text-main)' }}>Giỏ hàng trống</h3>
              <p style={{ marginBottom: 20 }}>Khám phá deal mỹ phẩm ngay.</p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  onClose();
                  onNavigateToHome?.();
                }}
                style={{ padding: '10px 24px', borderRadius: 999 }}
              >
                Tiếp tục mua sắm
              </button>
            </div>
          ) : (
            <div className={isModal ? '' : 'cart-two-columns-layout'}>
              <div className="cart-left-col">
                {/* Cart Items List */}
                {hasUnavailable && (
                  <div className="cart-unavailable-banner">
                    Một số sản phẩm trong giỏ đã ngừng bán hoặc hết hàng — các sản phẩm này không được tính vào tổng tiền và không thể đặt hàng.
                  </div>
                )}
                <div style={{ maxHeight: isModal ? 220 : undefined, overflowY: isModal ? 'auto' : undefined, marginBottom: 16 }} data-testid="cart-items-list">
                  {cart.map(item => (
                    <CartItemRow
                      key={item.product.id}
                      item={item}
                      onUpdateQuantity={onUpdateQuantity}
                      onSetQuantity={onSetQuantity}
                      onRemoveRequest={(productId) => setPendingRemoveId(productId)}
                    />
                  ))}
                </div>

                {/* Voucher Section */}
                <VoucherSection
                  vouchers={vouchers}
                  voucherCodeInput={voucherCodeInput}
                  setVoucherCodeInput={setVoucherCodeInput}
                  appliedVoucher={appliedVoucher}
                  voucherMessage={voucherMessage}
                  onApplyVoucher={onApplyVoucher}
                  onRemoveVoucher={onRemoveVoucher}
                />
              </div>

              <div className="cart-right-col">
                {/* Pricing Summary */}
                <div
                  className="cart-summary-card"
                  style={{
                    background: 'var(--bg-subtle)',
                    border: '1px solid var(--border-subtle)',
                    padding: 18,
                    borderRadius: 16,
                    marginBottom: 20
                  }}
                  data-testid="cart-pricing-summary"
                >
                  <h4 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: 12, color: 'var(--text-main)' }}>
                    Tóm tắt đơn hàng
                  </h4>
                  {/* Tiến độ freeship (đơn ≥ 299.000đ) */}
                  {(() => {
                    const FREE_SHIP_AT = 299000;
                    const remaining = Math.max(0, FREE_SHIP_AT - rawSubTotal);
                    const pct = Math.min(100, Math.round((rawSubTotal / FREE_SHIP_AT) * 100));
                    return (
                      <div className="freeship-progress" data-testid="cart-freeship-progress">
                        <div className="freeship-progress-label">
                          {remaining === 0 ? (
                            <span>🎉 Đã được freeship</span>
                          ) : (
                            <span>Thêm <strong>{formatPrice(remaining)}</strong> để freeship</span>
                          )}
                          <span>{pct}%</span>
                        </div>
                        <div className="freeship-progress-track">
                          <div className="freeship-progress-fill" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })()}
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                    <span>Tạm tính ({totalItemCount} sản phẩm):</span>
                    <span data-testid="cart-raw-subtotal">{formatPrice(rawSubTotal)}</span>
                  </div>
                  {appliedVoucher && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: '0.9rem', color: '#10b981', fontWeight: 600 }}>
                      <span>Khuyến mãi Voucher ({appliedVoucher.code}):</span>
                      <span data-testid="cart-voucher-discount">-{formatPrice(appliedVoucher.discountAmount)}</span>
                    </div>
                  )}
                  {shippingFee !== undefined && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                      <span>Phí vận chuyển:</span>
                      <span data-testid="cart-shipping-fee">{shippingFee === 0 ? 'Miễn phí' : formatPrice(shippingFee)}</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 10, borderTop: '1px solid var(--border-subtle)', fontSize: '1.2rem', fontWeight: 800 }}>
                    <span>Tổng thanh toán:</span>
                    <span style={{ color: '#d81b60' }} data-testid="cart-final-total">{formatPrice(finalTotal)}</span>
                  </div>
                </div>

                {priceChangedPending && (
                  <div className="checkout-notice checkout-notice-warning" data-testid="checkout-price-changed-notice">
                    <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                    <span>
                      Giá của một số sản phẩm trong giỏ vừa thay đổi. Vui lòng kiểm tra lại giỏ hàng,
                      rồi nhấn nút đặt hàng một lần nữa để xác nhận mức giá mới.
                    </span>
                  </div>
                )}

                {checkoutError && (
                  <div className="checkout-notice checkout-notice-error" data-testid="checkout-error-msg">
                    <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                    <span>{checkoutError}</span>
                  </div>
                )}

                {/* Checkout Form */}
                <CheckoutForm
                  customerName={customerName}
                  setCustomerName={setCustomerName}
                  customerEmail={customerEmail}
                  setCustomerEmail={setCustomerEmail}
                  customerPhone={customerPhone}
                  setCustomerPhone={setCustomerPhone}
                  shippingAddress={shippingAddress}
                  setShippingAddress={setShippingAddress}
                  finalTotal={finalTotal}
                  isCheckingOut={isCheckingOut}
                  onSubmit={onCheckout}
                  user={user}
                  onRequireAuth={onRequireAuth}
                />
              </div>
            </div>
          )}

          {/* Hộp xác nhận xóa sản phẩm khỏi giỏ (CN-06.4) */}
          {pendingRemoveItem && (
            <div className="modal-overlay" onClick={() => setPendingRemoveId(null)}>
              <div className="modal-content remove-confirm-dialog" onClick={e => e.stopPropagation()} data-testid="cart-remove-confirm-dialog">
                <div className="modal-header">
                  <h2 className="modal-title" style={{ margin: 0 }}>Xóa sản phẩm khỏi giỏ?</h2>
                  <button className="close-btn" onClick={() => setPendingRemoveId(null)} title="Đóng">
                    <X size={20} />
                  </button>
                </div>
                <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 18 }}>
                  Bạn có chắc muốn xóa <strong style={{ color: 'var(--text-main)' }}>{pendingRemoveItem.product.name}</strong> khỏi giỏ hàng không?
                </p>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setPendingRemoveId(null)}
                    data-testid="cart-remove-cancel-btn"
                  >
                    Hủy
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      onRemoveItem?.(pendingRemoveItem.product.id);
                      setPendingRemoveId(null);
                    }}
                    data-testid="cart-remove-confirm-btn"
                  >
                    Xóa khỏi giỏ
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      ) : isCodSuccess ? (
        /* View 2a: Đặt hàng COD thành công (CN-07.5) */
        <div style={{ textAlign: 'center', padding: '30px 10px' }} data-testid="order-success-view">
          <div className="success-tick-wrap scale-in" style={{ width: 104, height: 104, borderRadius: '50%', background: 'rgba(16,185,129,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <CheckCircle2 size={72} color="#10b981" />
          </div>
          <h3 style={{ fontSize: '1.7rem', fontWeight: 800, color: '#16a34a', marginBottom: 8, lineHeight: 1.3, padding: '0 16px' }}>
            Đặt hàng thành công!
          </h3>
          <p style={{ color: 'var(--text-muted)', marginBottom: 6 }}>
            Mã đơn hàng của bạn: <strong style={{ color: 'var(--text-main)', fontSize: '1.05rem' }} data-testid="order-success-code">
              {checkoutResult.orderDisplayCode || `#${checkoutResult.orderCode}`}
            </strong>
          </p>
          <p style={{ color: 'var(--text-muted)', marginBottom: 6 }}>
            Tổng thanh toán: <strong style={{ color: '#d81b60', fontSize: '1.1rem' }}>{formatPrice(checkoutResult.totalAmount)}</strong>
            {' '}— thanh toán khi nhận hàng (COD).
          </p>
          <p style={{ color: 'var(--text-muted)', marginBottom: 6 }}>
            Trạng thái đơn: <strong style={{ color: 'var(--text-main)' }}>Chờ xác nhận</strong>
          </p>
          {lastOrderAddress && (
            <p style={{ color: 'var(--text-muted)', marginBottom: 20, display: 'flex', alignItems: 'flex-start', gap: 6, justifyContent: 'center' }}>
              <MapPin size={15} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>Giao đến: {lastOrderAddress}</span>
            </p>
          )}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 14 }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onNavigateToOrders}
              data-testid="view-orders-btn"
            >
              Xem đơn hàng
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={onNavigateToHome}
              data-testid="continue-shopping-btn"
            >
              Tiếp tục mua sắm
            </button>
          </div>
        </div>
      ) : (
        /* View 2: Embedded PayOS Payment View directly on the web page */
        <div data-testid="checkout-payment-view">
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <h3 style={{ fontSize: '1.35rem', lineHeight: 1.35, padding: '0 16px', marginBottom: 4, fontWeight: 800, overflowWrap: 'break-word' }} data-testid="checkout-order-code">
              Đơn hàng #{checkoutResult.orderCode}
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', padding: '0 16px' }}>
              Quét mã VietQR tại chỗ hoặc mở PayOS ở tab mới — an toàn, không cần đăng nhập
            </p>
          </div>

          {orderStatus === 'Pending' && (
            <div className="payos-embedded-card" style={{ marginTop: 0 }}>
              <div className="payos-embedded-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 34, height: 34, borderRadius: 8, background: 'var(--primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <CreditCard size={18} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--text-main)' }}>
                      Cổng thanh toán PayOS (Thực hiện trực tiếp)
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Quét mã QR VietQR hoặc chuyển khoản trực tiếp qua ngân hàng
                    </div>
                  </div>
                </div>
                <div className="timer-badge" style={{ margin: 0 }} data-testid="payment-timer">
                  <Clock size={13} /> {formatTime(timeLeft)}
                </div>
              </div>

              <div className="payos-summary-bar">
                <div>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Số tiền thanh toán: </span>
                  <strong style={{ color: '#d81b60', fontSize: '1.2rem' }} data-testid="payment-total-amount">
                    {formatPrice(checkoutResult.totalAmount)}
                  </strong>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: '8px 14px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}
                    onClick={() => onCopyOrderCode && onCopyOrderCode(checkoutResult.orderCode)}
                    data-testid="copy-order-code-btn"
                  >
                    <Copy size={12} /> Sao chép mã
                  </button>
                  {onResetCheckout && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: '8px 14px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}
                      onClick={onResetCheckout}
                      data-testid="back-to-cart-btn"
                      title="Quay lại giỏ hàng để chọn hoặc thay đổi sản phẩm"
                    >
                      <RotateCcw size={12} /> Đổi giỏ hàng
                    </button>
                  )}
                </div>
              </div>

              {/* PayOS Gateway View (VietQR tại chỗ) */}
              <PayOSGatewayView
                orderCode={checkoutResult.orderCode}
                totalAmount={checkoutResult.totalAmount}
                checkoutUrl={checkoutResult.checkoutUrl}
                qrCode={checkoutResult.qrCode}
                accountNumber={checkoutResult.accountNumber}
                accountName={checkoutResult.accountName}
                bin={checkoutResult.bin}
                paymentDescription={checkoutResult.paymentDescription}
                onSimulateSuccess={onSimulateSuccess}
                onCopyOrderCode={() => onCopyOrderCode && onCopyOrderCode(checkoutResult.orderCode)}
              />
            </div>
          )}

          {orderStatus === 'Paid' && (
            <div style={{ textAlign: 'center', padding: '30px 10px' }} data-testid="order-paid-view">
              <div className="success-tick-wrap scale-in" style={{ width: 104, height: 104, borderRadius: '50%', background: 'rgba(16,185,129,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <CheckCircle2 size={72} color="#10b981" />
              </div>
              <h3 style={{ fontSize: '1.7rem', fontWeight: 800, color: '#10b981', marginBottom: 8, lineHeight: 1.3, padding: '0 16px' }}>
                Thanh toán thành công!
              </h3>
              <p style={{ color: 'var(--text-muted)', marginBottom: 16, maxWidth: 480, marginLeft: 'auto', marginRight: 'auto' }}>
                Đơn hàng #{checkoutResult.orderCode} đã được thanh toán. Hệ thống đang tiến hành đóng gói và giao hàng.
              </p>
              <div style={{ display: 'inline-flex', gap: 24, background: 'var(--bg-subtle, #f9fafb)', border: '1px solid var(--border-subtle, #e5e7eb)', borderRadius: 12, padding: '12px 20px', marginBottom: 20, fontSize: '0.9rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Mã đơn: <strong style={{ color: 'var(--text-main)' }}>#{checkoutResult.orderCode}</strong></span>
                <span style={{ color: 'var(--text-muted)' }}>Số tiền: <strong style={{ color: '#d81b60' }}>{formatPrice(checkoutResult.totalAmount)}</strong></span>
              </div>
              <div className="paid-view-actions" style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={onNavigateToOrders}
                  data-testid="view-orders-btn"
                >
                  Xem lịch sử đơn hàng
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={onNavigateToHome}
                  data-testid="continue-shopping-btn"
                >
                  Tiếp tục mua sắm
                </button>
              </div>
            </div>
          )}

          {orderStatus === 'Expired' && (
            <div style={{ textAlign: 'center', padding: '30px 0' }} data-testid="order-expired-view">
              <Clock size={56} color="#f43f5e" style={{ margin: '0 auto 16px' }} />
              <h3 style={{ fontSize: '1.3rem', color: '#f43f5e', marginBottom: 8 }}>Đơn hàng đã hết hạn giữ chỗ!</h3>
              <p style={{ color: '#9ca3af', fontSize: '0.9rem', marginBottom: 20 }}>
                Đã quá 15 phút mà đơn hàng chưa được thanh toán. Số lượng tồn kho đã được hoàn trả lại cho hệ thống.
              </p>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onNavigateToHome}
                data-testid="recreate-order-btn"
              >
                Tạo lại đơn hàng
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );

  if (isModal) {
    return (
      <div className="modal-overlay" onClick={onClose} data-testid="cart-modal-overlay">
        {content}
      </div>
    );
  }

  return (
    <div className="cart-page-wrapper" data-testid="cart-page">
      {content}
    </div>
  );
};
