import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MembershipPage } from '../components/membership/MembershipPage';

const meGold = {
  tier: 'Gold',
  tierLabel: 'Vàng',
  availablePoints: 250,
  expiringSoonPoints: 50,
  totalSpent12m: 6000000,
  nextTierSpent: 15000000,
  nextTier: 'Diamond',
  nextTierLabel: 'Kim cương',
  spendPerPoint: 10000,
  maxPointsPercent: 20,
  freeShipThreshold: 99000,
  autoUsePoints: true,
  defaultPaymentMethod: 'PayOS',
  birthDate: null,
};

const pointsHistory = [
  { id: 'pt-1', type: 'EARN', points: 100, expiresAt: '2027-11-01T00:00:00Z', reason: 'Tích điểm đơn #1001', orderId: 'o1', createdAt: '2026-11-07T10:00:00Z' },
  { id: 'pt-2', type: 'USE', points: -50, expiresAt: null, reason: 'Dùng điểm giảm giá đơn #1002', orderId: 'o2', createdAt: '2026-11-08T10:00:00Z' },
];

const myVouchers = [
  { id: 'v1', code: 'VANG10', description: 'Giảm 10% cho hạng Vàng', discountType: 'Percentage', discountValue: 10, minOrderAmount: 0, maxDiscountAmount: 150000, expiryDate: '2026-12-31T00:00:00Z', minTier: 'Gold', isPersonal: false },
];

function mockMembershipFetch(meBody: unknown) {
  globalThis.fetch = vi.fn((url: any) => {
    const urlStr = typeof url === 'string' ? url : url.url;
    const respond = (body: unknown) => Promise.resolve({ status: 200, json: () => Promise.resolve(body) } as unknown as Response);
    if (urlStr.includes('/api/membership/me')) return respond(meBody);
    if (urlStr.includes('/api/membership/points')) return respond({ success: true, data: pointsHistory });
    if (urlStr.includes('/api/membership/vouchers')) return respond({ success: true, data: myVouchers });
    return respond({ success: true, data: [] });
  });
}

describe('MembershipPage (/membership) — đợt 13, mục 2', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    localStorage.clear();
  });

  it('hiện hạng, số dư điểm + giá trị quy đổi, quyền lợi theo hạng, lịch sử điểm và voucher', async () => {
    mockMembershipFetch({ success: true, data: meGold });
    render(<MembershipPage onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('membership-page')).toBeInTheDocument();
    });
    // Hạng hiện tại + tiến độ lên hạng tiếp theo.
    expect(screen.getByTestId('membership-tier')).toHaveTextContent('Vàng');
    expect(screen.getByTestId('membership-tier')).toHaveTextContent('Kim cương');
    // Số dư điểm 250 = 250.000đ (1 điểm = 1.000đ).
    expect(screen.getByTestId('membership-points-balance')).toHaveTextContent('250 điểm');
    expect(screen.getByTestId('membership-tier')).toHaveTextContent(/250\.000/);
    expect(screen.getByTestId('membership-tier')).toHaveTextContent('sắp hết hạn: 50 điểm');
    // Quyền lợi lấy từ /me (không hard-code theo hạng).
    const benefits = screen.getByTestId('membership-benefits');
    expect(benefits).toHaveTextContent('10.000đ');
    expect(benefits).toHaveTextContent('20%');
    expect(benefits).toHaveTextContent(/99\.000/);
    expect(benefits).toHaveTextContent('Voucher sinh nhật');
    expect(screen.getByTestId('membership-tier-badge-Gold')).toHaveTextContent('Hạng của bạn');
    // Voucher của tôi.
    expect(screen.getByTestId('membership-voucher-VANG10')).toHaveTextContent('Giảm 10% cho hạng Vàng');
    // Lịch sử điểm: nhãn loại + dấu +/-.
    const history = screen.getByTestId('membership-history');
    expect(history).toHaveTextContent('Tích điểm');
    expect(history).toHaveTextContent('Dùng điểm');
    expect(screen.getByTestId('membership-history-item-pt-1')).toHaveTextContent('+100 điểm');
    expect(screen.getByTestId('membership-history-item-pt-2')).toHaveTextContent('-50 điểm');
  });

  it('chưa đăng nhập: hiện thông báo thay vì số liệu hội viên', async () => {
    mockMembershipFetch({ success: false, data: null, message: 'Bạn cần đăng nhập để xem hội viên.' });
    render(<MembershipPage onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('membership-login-required')).toBeInTheDocument();
    });
    expect(screen.getByTestId('membership-login-required')).toHaveTextContent('Bạn cần đăng nhập để xem hội viên.');
    expect(screen.queryByTestId('membership-tier')).not.toBeInTheDocument();
    expect(screen.queryByTestId('membership-history')).not.toBeInTheDocument();
  });
});
