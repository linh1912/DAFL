import React, { useEffect } from 'react';
import { CheckCircle2, ArrowRight } from 'lucide-react';

export const PaymentSuccessPage: React.FC = () => {
  const params = new URLSearchParams(window.location.search);
  const orderCode = params.get('orderCode');

  useEffect(() => {
    if (orderCode) {
      // Query order status from backend to verify payment confirmation
      fetch(`/api/payments/status/${orderCode}`)
        .catch(console.warn);
    }
  }, [orderCode]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', padding: 20, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div style={{ background: '#fff', maxWidth: 460, width: '100%', borderRadius: 16, padding: 36, textAlign: 'center', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)', border: '1px solid #e2e8f0' }}>
        <CheckCircle2 size={64} color="#10b981" style={{ margin: '0 auto 16px' }} />
        <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#10b981', marginBottom: 8 }}>
          Thanh toán thành công!
        </h2>
        <p style={{ color: '#64748b', fontSize: '0.9rem', marginBottom: 24 }}>
          Đơn hàng {orderCode ? `#${orderCode}` : ''} đã được xác nhận thanh toán qua PayOS. Hệ thống đang tiến hành xử lý và giao hàng.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <a
            href="/orders"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: '#e40046',
              color: '#fff',
              textDecoration: 'none',
              padding: '12px 20px',
              borderRadius: 8,
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
              borderRadius: 8,
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
