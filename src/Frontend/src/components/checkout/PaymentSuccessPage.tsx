import React, { useEffect, useState } from 'react';
import { CheckCircle2, ArrowRight } from 'lucide-react';
import { formatPrice } from '../../utils/formatters';

export const PaymentSuccessPage: React.FC = () => {
  const params = new URLSearchParams(window.location.search);
  const orderCode = params.get('orderCode');
  const [totalAmount, setTotalAmount] = useState<number | null>(null);

  useEffect(() => {
    if (orderCode) {
      // Query order status from backend to verify payment confirmation
      // (and read the amount for the order summary block).
      fetch(`/api/payments/status/${orderCode}`)
        .then(r => r.json())
        .then((res: { data?: { totalAmount?: number; TotalAmount?: number } }) => {
          const amount = res?.data?.totalAmount ?? res?.data?.TotalAmount;
          if (typeof amount === 'number') setTotalAmount(amount);
        })
        .catch(console.warn);
    }
  }, [orderCode]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', padding: 20, fontFamily: "'Be Vietnam Pro', system-ui, -apple-system, sans-serif" }}>
      <div style={{ background: '#fff', maxWidth: 460, width: '100%', borderRadius: 16, padding: 36, textAlign: 'center', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)', border: '1px solid #e2e8f0' }}>
        <div className="success-tick-wrap scale-in" style={{ width: 104, height: 104, borderRadius: '50%', background: 'rgba(16,185,129,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
          <CheckCircle2 size={72} color="#10b981" />
        </div>
        <h2 style={{ fontSize: '1.7rem', fontWeight: 800, color: '#10b981', marginBottom: 8, lineHeight: 1.3, padding: '0 8px' }}>
          Thanh toán thành công!
        </h2>
        <p style={{ color: '#64748b', fontSize: '0.9rem', marginBottom: 16, maxWidth: 480, marginLeft: 'auto', marginRight: 'auto' }}>
          Đơn hàng {orderCode ? `#${orderCode}` : ''} đã được xác nhận thanh toán qua PayOS. Hệ thống đang tiến hành xử lý và giao hàng.
        </p>
        {orderCode && (
          <div style={{ display: 'inline-flex', gap: 24, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 12, padding: '12px 20px', marginBottom: 20, fontSize: '0.9rem' }}>
            <span style={{ color: '#64748b' }}>Mã đơn: <strong style={{ color: '#111827' }}>#{orderCode}</strong></span>
            {totalAmount !== null && (
              <span style={{ color: '#64748b' }}>Số tiền: <strong style={{ color: '#d81b60' }}>{formatPrice(totalAmount)}</strong></span>
            )}
          </div>
        )}
        <div className="success-actions" style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <a
            href="/orders"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: '#d81b60',
              color: '#fff',
              textDecoration: 'none',
              padding: '12px 20px',
              borderRadius: 12,
              fontWeight: 700,
              fontSize: '0.9rem'
            }}
          >
            Xem lịch sử đơn hàng <ArrowRight size={16} />
          </a>
          <a
            href="/"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: '#f1f5f9',
              color: '#334155',
              textDecoration: 'none',
              padding: '12px 20px',
              borderRadius: 12,
              fontWeight: 700,
              fontSize: '0.9rem'
            }}
          >
            Về trang chủ
          </a>
        </div>
      </div>
    </div>
  );
};
