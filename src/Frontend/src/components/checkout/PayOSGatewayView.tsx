import React, { useState } from 'react';
import { CreditCard, QrCode, Copy, Check, ExternalLink, Zap, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { formatPrice } from '../../utils/formatters';

export interface PayOSGatewayViewProps {
  orderCode: number;
  totalAmount: number;
  checkoutUrl?: string;
  qrCode?: string;
  accountNumber?: string;
  accountName?: string;
  bin?: number | string;
  paymentDescription?: string;
  onSimulateSuccess?: () => void;
  onCopyOrderCode?: () => void;
}

export const PayOSGatewayView: React.FC<PayOSGatewayViewProps> = ({
  orderCode,
  totalAmount,
  checkoutUrl,
  qrCode,
  accountNumber,
  accountName,
  bin,
  paymentDescription,
  onSimulateSuccess,
  onCopyOrderCode,
}) => {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'qr' | 'iframe'>('qr');

  const isRealPayOS = Boolean(checkoutUrl && checkoutUrl.startsWith('https://pay.payos.vn'));

  // Resolve Bank Name and code based on BIN from PayOS
  let bankName = 'BIDV (Ngân hàng TMCP Đầu tư và Phát triển Việt Nam)';
  let bankShort = 'BIDV';
  const binStr = String(bin || '970418');

  if (binStr === '970418') {
    bankName = 'BIDV (Ngân hàng TMCP Đầu tư và Phát triển Việt Nam)';
    bankShort = 'BIDV';
  } else if (binStr === '970422') {
    bankName = 'MBBank (Ngân hàng TMCP Quân Đội)';
    bankShort = 'MB';
  } else if (binStr === '970436') {
    bankName = 'Vietcombank (Ngoại thương Việt Nam)';
    bankShort = 'VCB';
  } else if (binStr === '970407') {
    bankName = 'Techcombank';
    bankShort = 'TCB';
  }

  const finalAccountNumber = accountNumber || 'V3CAS8858082810';
  const finalAccountName = accountName || 'NGUYEN TRINH SON';
  const finalDescription = paymentDescription || `DH ${orderCode}`;

  // Use official PayOS VietQR EMVCo string if available, otherwise VietQR API
  const qrUrl = qrCode && qrCode.startsWith('000201')
    ? `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(qrCode)}`
    : `https://img.vietqr.io/image/${bankShort}-${finalAccountNumber}-compact2.png?amount=${totalAmount}&addInfo=${encodeURIComponent(finalDescription)}&accountName=${encodeURIComponent(finalAccountName)}`;

  const copyToClipboard = (text: string, fieldName: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 2000);
  };

  return (
    <div
      style={{
        background: 'var(--bg-card, #ffffff)',
        border: '1px solid var(--border-subtle, #e5e7eb)',
        borderRadius: 12,
        padding: 20,
        margin: '12px 0',
      }}
      data-testid="payos-mock-gateway"
    >
      {/* Navigation Options for payment */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => setActiveTab('qr')}
          className={`btn ${activeTab === 'qr' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ padding: '8px 16px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <QrCode size={15} /> Quét mã VietQR tại chỗ
        </button>

        {isRealPayOS && (
          <>
            <button
              type="button"
              onClick={() => setActiveTab('iframe')}
              className={`btn ${activeTab === 'iframe' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ padding: '8px 16px', fontSize: '0.85rem' }}
            >
              Nhúng Cổng PayOS
            </button>
            <a
              href={checkoutUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary"
              style={{ padding: '8px 16px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none', marginLeft: 'auto', color: '#d81b60', fontWeight: 700 }}
            >
              <ExternalLink size={14} /> Mở PayOS ở Tab Mới
            </a>
          </>
        )}
      </div>

      {activeTab === 'qr' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'center' }}>
          {/* VietQR Code Column */}
          <div style={{ textAlign: 'center', background: 'var(--bg-subtle, #f9fafb)', padding: 16, borderRadius: 12, border: '1px solid var(--border-subtle, #e5e7eb)' }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-main, #374151)', marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <QrCode size={15} color="#d81b60" /> Quét mã VietQR để thanh toán
            </div>
            <img
              src={qrUrl}
              alt={`Mã QR thanh toán đơn hàng #${orderCode}`}
              style={{ width: '100%', maxWidth: 220, borderRadius: 8, margin: '0 auto', display: 'block', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
              onError={(e) => {
                (e.target as HTMLImageElement).src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect width="200" height="200" fill="%23f3f4f6"/><text x="100" y="95" font-size="14" text-anchor="middle" fill="%23e02e24" font-weight="bold">VIETQR</text><text x="100" y="115" font-size="12" text-anchor="middle" fill="%234b5563">Quét mã thanh toán</text></svg>';
              }}
            />
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #9ca3af)', marginTop: 8 }}>
              Hỗ trợ 40+ ứng dụng Ngân hàng (MB, VCB, TCB, Momo, ...)
            </div>
          </div>

          {/* Bank Transfer Details Column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ background: 'var(--bg-subtle, #f9fafb)', padding: 10, borderRadius: 8, fontSize: '0.85rem' }}>
              <div style={{ color: 'var(--text-muted, #6b7280)', fontSize: '0.75rem' }}>Ngân hàng thụ hưởng</div>
              <strong style={{ color: 'var(--text-main, #111827)' }}>{bankName}</strong>
            </div>

            <div style={{ background: 'var(--bg-subtle, #f9fafb)', padding: 10, borderRadius: 8, fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ color: 'var(--text-muted, #6b7280)', fontSize: '0.75rem' }}>Số tài khoản người nhận</div>
                <strong style={{ color: 'var(--text-main, #111827)' }}>{finalAccountNumber}</strong>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                onClick={() => copyToClipboard(finalAccountNumber, 'stk')}
              >
                {copiedField === 'stk' ? <Check size={12} color="#10b981" /> : <Copy size={12} />}
                <span>{copiedField === 'stk' ? 'Đã chép' : 'Sao chép'}</span>
              </button>
            </div>

            <div style={{ background: 'var(--bg-subtle, #f9fafb)', padding: 10, borderRadius: 8, fontSize: '0.85rem' }}>
              <div style={{ color: 'var(--text-muted, #6b7280)', fontSize: '0.75rem' }}>Tên người nhận</div>
              <strong style={{ color: 'var(--text-main, #111827)' }}>{finalAccountName}</strong>
            </div>

            <div style={{ background: 'var(--bg-subtle, #f9fafb)', padding: 10, borderRadius: 8, fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ color: 'var(--text-muted, #6b7280)', fontSize: '0.75rem' }}>Nội dung chuyển khoản (bắt buộc)</div>
                <strong style={{ color: '#d81b60', fontWeight: 800 }}>{finalDescription}</strong>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                onClick={() => copyToClipboard(finalDescription, 'nd')}
              >
                {copiedField === 'nd' ? <Check size={12} color="#10b981" /> : <Copy size={12} />}
                <span>{copiedField === 'nd' ? 'Đã chép' : 'Sao chép'}</span>
              </button>
            </div>

            {/* Confirm Payment Success Button */}
            {onSimulateSuccess && (
              <button
                type="button"
                className="btn btn-primary"
                style={{ padding: '14px', fontSize: '0.9rem', marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontWeight: 700 }}
                onClick={onSimulateSuccess}
                data-testid="simulate-payos-success-btn"
              >
                <Zap size={16} /> Tôi đã chuyển khoản xong (Kiểm tra thanh toán)
              </button>
            )}
          </div>
        </div>
      ) : (
        /* Embedded Iframe Tab */
        <div>
          <div style={{ background: '#fef3c7', border: '1px solid #fde68a', color: '#92400e', padding: '8px 12px', borderRadius: 8, fontSize: '0.8rem', marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Lưu ý: Nếu trình duyệt chặn nhúng iframe hoặc bạn đã chuyển tiền xong, bấm nút kiểm tra bên dưới.</span>
            {onSimulateSuccess && (
              <button
                type="button"
                onClick={onSimulateSuccess}
                style={{ background: '#d81b60', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: 6, fontWeight: 700, cursor: 'pointer', fontSize: '0.75rem' }}
              >
                Kiểm tra trạng thái thanh toán
              </button>
            )}
          </div>
          <div className="payos-iframe-container" style={{ minHeight: 520 }} data-testid="payos-iframe-container">
            <iframe
              src={checkoutUrl}
              className="payos-iframe"
              title={`Cổng thanh toán PayOS #${orderCode}`}
              allow="payment"
            />
          </div>
        </div>
      )}
    </div>
  );
};
