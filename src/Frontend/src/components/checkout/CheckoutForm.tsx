import React from 'react';
import { Lock } from 'lucide-react';
import { User } from '../../types';
import { formatPrice } from '../../utils/formatters';

export interface CheckoutFormProps {
  customerName: string;
  setCustomerName: (val: string) => void;
  customerEmail: string;
  setCustomerEmail: (val: string) => void;
  customerPhone: string;
  setCustomerPhone: (val: string) => void;
  shippingAddress: string;
  setShippingAddress: (val: string) => void;
  finalTotal: number;
  isCheckingOut: boolean;
  onSubmit: (e: React.FormEvent) => void;
  user?: User | null;
  isAuthRequired?: boolean;
  onRequireAuth?: () => void;
}

export const CheckoutForm: React.FC<CheckoutFormProps> = ({
  customerName,
  setCustomerName,
  customerEmail,
  setCustomerEmail,
  customerPhone,
  setCustomerPhone,
  shippingAddress,
  setShippingAddress,
  finalTotal,
  isCheckingOut,
  onSubmit,
  user,
  isAuthRequired = false,
  onRequireAuth,
}) => {
  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isAuthRequired && !user) {
      if (onRequireAuth) {
        onRequireAuth();
      }
      return;
    }
    onSubmit(e);
  };

  return (
    <form onSubmit={handleFormSubmit} data-testid="checkout-form">
      <div className="form-group">
        <label className="form-label" htmlFor="checkout-name">Họ tên người nhận</label>
        <input
          id="checkout-name"
          className="form-input"
          data-testid="checkout-name-input"
          value={customerName}
          onChange={e => setCustomerName(e.target.value)}
          required
        />
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="checkout-email">Email nhận hóa đơn & thông tin giao hàng</label>
        <input
          id="checkout-email"
          className="form-input"
          type="email"
          data-testid="checkout-email-input"
          value={customerEmail}
          onChange={e => setCustomerEmail(e.target.value)}
          required
        />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div className="form-group">
          <label className="form-label" htmlFor="checkout-phone">Số điện thoại</label>
          <input
            id="checkout-phone"
            className="form-input"
            data-testid="checkout-phone-input"
            value={customerPhone}
            onChange={e => setCustomerPhone(e.target.value)}
            required
          />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="checkout-address">Địa chỉ giao hàng</label>
          <input
            id="checkout-address"
            className="form-input"
            data-testid="checkout-address-input"
            value={shippingAddress}
            onChange={e => setShippingAddress(e.target.value)}
            required
          />
        </div>
      </div>

      {isAuthRequired && !user && (
        <div
          data-testid="checkout-auth-required-notice"
          style={{
            background: 'rgba(228, 0, 70, 0.08)',
            border: '1px solid rgba(228, 0, 70, 0.25)',
            borderRadius: 8,
            padding: '12px 14px',
            marginTop: 14,
            marginBottom: 6,
            fontSize: '0.85rem',
            color: 'var(--text-main)',
            display: 'flex',
            alignItems: 'center',
            gap: 10
          }}
        >
          <Lock size={18} color="#e40046" style={{ flexShrink: 0 }} />
          <div>
            <strong>Yêu cầu xác thực:</strong> Bạn cần đăng nhập để được phép nhấn thanh toán đơn hàng này.
          </div>
        </div>
      )}

      <button
        type="submit"
        className="btn btn-primary"
        style={{ width: '100%', padding: '14px', marginTop: 10 }}
        disabled={isCheckingOut}
        data-testid="checkout-submit-btn"
      >
        {isCheckingOut
          ? 'Đang tạo cổng thanh toán PayOS...'
          : isAuthRequired && !user
          ? `Đăng nhập để thanh toán (${formatPrice(finalTotal)})`
          : `Thanh toán trực tiếp PayOS (${formatPrice(finalTotal)})`}
      </button>
    </form>
  );
};
