import React from 'react';
import { Tag } from 'lucide-react';
import { Voucher } from '../../../../Shared/types';
import { formatPrice } from '../../utils/formatters';

export interface VoucherSectionProps {
  vouchers: Voucher[];
  voucherCodeInput: string;
  setVoucherCodeInput: (val: string) => void;
  appliedVoucher: { code: string; discountAmount: number } | null;
  voucherMessage: string | null;
  onApplyVoucher: (code?: string) => void;
  onRemoveVoucher: () => void;
}

export const VoucherSection: React.FC<VoucherSectionProps> = ({
  vouchers,
  voucherCodeInput,
  setVoucherCodeInput,
  appliedVoucher,
  voucherMessage,
  onApplyVoucher,
  onRemoveVoucher,
}) => {
  return (
    <div className="voucher-section" data-testid="voucher-section">
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: '0.85rem', fontWeight: 700, color: 'var(--primary)' }}>
        <Tag size={15} /> Mã giảm giá
      </div>
      <div className="voucher-input-group">
        <input
          className="form-input"
          placeholder="Nhập mã voucher (VD: DAFL10)…"
          value={voucherCodeInput}
          onChange={e => setVoucherCodeInput(e.target.value.toUpperCase())}
          data-testid="voucher-code-input"
        />
        <button
          type="button"
          className="btn btn-primary"
          style={{ padding: '0 18px', whiteSpace: 'nowrap' }}
          onClick={() => onApplyVoucher()}
          data-testid="voucher-apply-btn"
        >
          Áp dụng
        </button>
      </div>

      {/* Quick Available Vouchers Chips */}
      <div className="voucher-chips" data-testid="voucher-chips">
        {vouchers.map(v => (
          <span
            key={v.id}
            className="voucher-chip"
            onClick={() => {
              setVoucherCodeInput(v.code);
              onApplyVoucher(v.code);
            }}
            title={v.description}
            data-testid={`voucher-chip-${v.code}`}
          >
            🏷️ {v.code} ({v.discountType === 'Percentage' ? `-${v.discountValue}%` : `-${formatPrice(v.discountValue)}`})
          </span>
        ))}
      </div>

      {appliedVoucher && (
        <div className="applied-voucher-banner" data-testid="applied-voucher-banner">
          <span>✓ Đã áp dụng mã <strong>{appliedVoucher.code}</strong>: -{formatPrice(appliedVoucher.discountAmount)}</span>
          <button
            type="button"
            style={{ background: 'none', border: 'none', color: '#f43f5e', cursor: 'pointer', fontWeight: 700 }}
            onClick={onRemoveVoucher}
            data-testid="remove-voucher-btn"
          >
            Bỏ chọn
          </button>
        </div>
      )}

      {voucherMessage && !appliedVoucher && (
        <div style={{ fontSize: '0.8rem', color: '#f87171', marginTop: 6 }} data-testid="voucher-error-msg">
          {voucherMessage}
        </div>
      )}
    </div>
  );
};
