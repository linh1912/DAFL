import React from 'react';
import { ShoppingBag, X, CreditCard, Clock, Copy, CheckCircle2, RotateCcw, ArrowLeft } from 'lucide-react';
import { CartItem, Voucher, CheckoutResult, User } from '../../types';
import { formatPrice, formatTime } from '../../utils/formatters';
import { CartItemRow } from './CartItemRow';
import { VoucherSection } from './VoucherSection';
import { CheckoutForm } from '../checkout/CheckoutForm';
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
  onApplyVoucher: (code?: string) => void;
  onRemoveVoucher: () => void;
  onCheckout: (e: React.FormEvent) => void;
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
              className="btn btn-secondary"
              style={{ padding: '6px 14px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 6 }}
              onClick={() => {
                onClose();
                onNavigateToHome?.();
              }}
              data-testid="cart-close-btn"
              title="Quay lại trang chủ"
            >
              <ArrowLeft size={16} /> Tiếp tục mua sắm
            </button>
          )}
          <h2 className={isModal ? 'modal-title' : 'page-title'} style={{ margin: 0 }} data-testid="cart-drawer-title">
            <ShoppingBag size={24} color="var(--primary)" />
            {checkoutResult ? 'Thanh toán đơn hàng PayOS (Trực tiếp)' : 'Giỏ hàng & Đơn hàng của bạn'}
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
            <div className="cart-empty-box" style={{ textAlign: 'center', padding: '60px 0', color: '#9ca3af' }} data-testid="cart-empty-state">
              <ShoppingBag size={56} style={{ margin: '0 auto 16px', opacity: 0.3 }} />
              <h3 style={{ fontSize: '1.2rem', marginBottom: 8, color: 'var(--text-main)' }}>Giỏ hàng của bạn đang trống.</h3>
              <p style={{ marginBottom: 20 }}>Khám phá các sản phẩm hot deal giá sốc tại DAFL Store!</p>
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
                <div style={{ maxHeight: isModal ? 220 : undefined, overflowY: isModal ? 'auto' : undefined, marginBottom: 16 }} data-testid="cart-items-list">
                  {cart.map(item => (
                    <CartItemRow
                      key={item.product.id}
                      item={item}
                      onUpdateQuantity={onUpdateQuantity}
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
                  style={{
                    background: 'var(--bg-subtle)',
                    border: '1px solid var(--border-subtle)',
                    padding: 18,
                    borderRadius: 12,
                    marginBottom: 20
                  }}
                  data-testid="cart-pricing-summary"
                >
                  <h4 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: 12, color: 'var(--text-main)' }}>
                    Tóm tắt đơn hàng
                  </h4>
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
                  <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 10, borderTop: '1px solid var(--border-subtle)', fontSize: '1.2rem', fontWeight: 800 }}>
                    <span>Tổng thanh toán:</span>
                    <span style={{ color: '#e40046' }} data-testid="cart-final-total">{formatPrice(finalTotal)}</span>
                  </div>
                </div>

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
                  isAuthRequired={true}
                  onRequireAuth={onRequireAuth}
                />
              </div>
            </div>
          )}
        </>
      ) : (
        /* View 2: Embedded PayOS Payment View directly on the web page */
        <div data-testid="checkout-payment-view">
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <h3 style={{ fontSize: '1.25rem', marginBottom: 4, fontWeight: 800 }} data-testid="checkout-order-code">
              Đơn hàng #{checkoutResult.orderCode}
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              Thanh toán an toàn được xử lý trực tiếp tại trang web — Không mở tab trắng
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
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
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
                  <strong style={{ color: '#e40046', fontSize: '1.2rem' }} data-testid="payment-total-amount">
                    {formatPrice(checkoutResult.totalAmount)}
                  </strong>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: '6px 12px', fontSize: '0.75rem' }}
                    onClick={() => onCopyOrderCode && onCopyOrderCode(checkoutResult.orderCode)}
                    data-testid="copy-order-code-btn"
                  >
                    <Copy size={12} /> Sao chép mã
                  </button>
                  {onResetCheckout && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: '6px 12px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 4 }}
                      onClick={onResetCheckout}
                      data-testid="back-to-cart-btn"
                      title="Quay lại giỏ hàng để chọn hoặc thay đổi sản phẩm"
                    >
                      <RotateCcw size={12} /> Đổi giỏ hàng
                    </button>
                  )}
                </div>
              </div>

              {/* PayOS Gateway View (Real iframe or clean VietQR mock) */}
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
              <CheckCircle2 size={56} color="#10b981" style={{ margin: '0 auto 16px' }} />
              <h3 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#10b981', marginBottom: 8 }}>
                Thanh toán thành công!
              </h3>
              <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>
                Đơn hàng #{checkoutResult.orderCode} đã được thanh toán. Hệ thống đang tiến hành đóng gói và giao hàng.
              </p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
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
