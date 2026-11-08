import React, { useState } from 'react';
import { CreditCard, QrCode, Check, Copy, ArrowLeft, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { formatPrice } from '../../utils/formatters';

export const MockPayOSStandalonePage: React.FC = () => {
  const params = new URLSearchParams(window.location.search);
  const orderCode = Number(params.get('orderCode')) || 0;
  const amount = Number(params.get('amount')) || 0;

  const [isPaid, setIsPaid] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const qrUrl = `https://img.vietqr.io/image/MB-0987654321-compact2.png?amount=${amount}&addInfo=DH%20${orderCode}&accountName=DAFL%20STORE`;

  const copy = (text: string, key: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleConfirmPayment = async () => {
    setLoading(true);
    try {
      const payload = {
        code: '00',
        desc: 'success',
        data: {
          orderCode,
          amount,
          description: `DH ${orderCode}`,
          accountNumber: '9999888877',
          reference: 'SIMULATED_TX_' + Date.now(),
          transactionDateTime: new Date().toISOString(),
          currency: 'VND',
          paymentLinkId: 'demo_link_id',
          code: '00',
          desc: 'success'
        },
        signature: 'simulated_valid_hmac_signature'
      };

      await fetch('/api/payments/payos-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      setIsPaid(true);
    } catch {
      setIsPaid(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: "'Be Vietnam Pro', system-ui, -apple-system, sans-serif" }}>
      <div style={{ background: '#fff', maxWidth: 480, width: '100%', borderRadius: 16, boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)', overflow: 'hidden', border: '1px solid #e2e8f0' }}>
        {/* Header */}
        <div style={{ background: '#d81b60', padding: '20px 24px', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 12, background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <CreditCard size={20} />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '1.1rem' }}>Cổng thanh toán PayOS</div>
              <div style={{ fontSize: '0.8rem', opacity: 0.9 }}>Môi trường giả lập VietQR Sandbox</div>
            </div>
          </div>
          <a href="/" style={{ color: '#fff', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8rem', opacity: 0.85 }}>
            <ArrowLeft size={14} /> Về cửa hàng
          </a>
        </div>

        {isPaid ? (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <CheckCircle2 size={64} color="#10b981" style={{ margin: '0 auto 16px' }} />
            <h3 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#10b981', marginBottom: 8 }}>
              Thanh toán thành công!
            </h3>
            <p style={{ color: '#64748b', fontSize: '0.9rem', marginBottom: 24 }}>
              Đơn hàng #{orderCode} đã được hệ thống xác nhận thanh toán qua PayOS.
            </p>
            <a href="/orders" style={{ display: 'inline-block', background: '#d81b60', color: '#fff', textDecoration: 'none', padding: '10px 24px', borderRadius: 12, fontWeight: 700, fontSize: '0.9rem' }}>
              Xem danh sách đơn hàng
            </a>
          </div>
        ) : (
          <div style={{ padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #f1f5f9' }}>
              <div>
                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Mã đơn hàng:</span>
                <div style={{ fontWeight: 800, fontSize: '1.05rem', color: '#0f172a' }}>#{orderCode}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Tổng số tiền:</span>
                <div style={{ fontWeight: 800, fontSize: '1.25rem', color: '#d81b60' }}>{formatPrice(amount)}</div>
              </div>
            </div>

            {/* QR Code */}
            <div style={{ textAlign: 'center', background: '#f8fafc', padding: 16, borderRadius: 12, border: '1px solid #e2e8f0', marginBottom: 16 }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <QrCode size={16} color="#d81b60" /> Quét mã VietQR chuyển khoản
              </div>
              <img
                src={qrUrl}
                alt="QR Code PayOS"
                style={{ width: '100%', maxWidth: 220, borderRadius: 12, margin: '0 auto', display: 'block' }}
                onError={(e) => {
                  (e.target as HTMLImageElement).src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect width="200" height="200" fill="%23f3f4f6"/><text x="100" y="100" font-size="14" text-anchor="middle" fill="%23e02e24" font-weight="bold">VIETQR DEMO</text></svg>';
                }}
              />
            </div>

            {/* Account Info */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.85rem', marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: '#f8fafc', borderRadius: 8 }}>
                <span style={{ color: '#64748b' }}>Ngân hàng:</span>
                <strong>MBBank (Quân Đội)</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: '#f8fafc', borderRadius: 8 }}>
                <span style={{ color: '#64748b' }}>Số tài khoản:</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <strong>0987654321</strong>
                  <button type="button" onClick={() => copy('0987654321', 'stk')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d81b60' }}>
                    {copied === 'stk' ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: '#f8fafc', borderRadius: 8 }}>
                <span style={{ color: '#64748b' }}>Nội dung:</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <strong style={{ color: '#d81b60' }}>DH {orderCode}</strong>
                  <button type="button" onClick={() => copy(`DH ${orderCode}`, 'nd')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d81b60' }}>
                    {copied === 'nd' ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
                  </button>
                </div>
              </div>
            </div>

            {/* Action */}
            <button
              type="button"
              onClick={handleConfirmPayment}
              disabled={loading}
              style={{ width: '100%', background: '#d81b60', color: '#fff', border: 'none', padding: '14px', borderRadius: 12, fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer' }}
            >
              {loading ? 'Đang gửi xác nhận...' : '⚡ Xác nhận đã chuyển khoản thành công'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
