import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import AdminPage from '../components/admin/AdminPage';

const respond = (status: number, body: unknown) =>
  Promise.resolve({ status, json: () => Promise.resolve(body) } as unknown as Response);

function mockFetchFor(profile: { status: number; body: unknown }) {
  globalThis.fetch = vi.fn((url: any) => {
    const urlStr = typeof url === 'string' ? url : url.url;
    if (urlStr.includes('/api/admin/profile')) return respond(profile.status, profile.body);
    if (urlStr.includes('/api/admin/dashboard')) {
      return respond(200, {
        success: true,
        data: {
          revenueToday: 1250000,
          revenueThisMonth: 45000000,
          pendingOrders: 3,
          newCustomers30d: 12,
          ordersByStatus: { Pending: 2, Paid: 1 },
          lowStockProducts: [{ id: 'p1', name: 'Son 3CE', stock: 2 }],
          expiringVouchers: [{ code: 'SALE10', usedCount: 8, maxUses: 10, expiryDate: '2026-12-31T00:00:00Z' }],
        },
      });
    }
    return respond(200, { success: true, data: [] });
  });
}

function renderAdmin() {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/login" element={<div data-testid="login-page">Đăng nhập</div>} />
        <Route path="/" element={<div data-testid="home-page">Trang chủ</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('AdminPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    localStorage.clear();
  });

  it('smoke: SuperAdmin thấy menu 8 mục và 4 thẻ số tổng quan', async () => {
    mockFetchFor({
      status: 200,
      body: {
        success: true,
        data: { id: 'admin-1', email: 'admin@dafl.vn', fullName: 'Super Admin', role: 'SuperAdmin' },
      },
    });
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByTestId('admin-nav-dashboard')).toBeInTheDocument();
    });
    for (const testid of [
      'admin-nav-dashboard', 'admin-nav-orders', 'admin-nav-products', 'admin-nav-categories',
      'admin-nav-promotions', 'admin-nav-customers', 'admin-nav-membership', 'admin-nav-returns',
    ]) {
      expect(screen.getByTestId(testid)).toBeInTheDocument();
    }
    expect(screen.getByText('Doanh thu hôm nay')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('1.250.000đ')).toBeInTheDocument();
    });
    expect(screen.getByText('Doanh thu tháng này')).toBeInTheDocument();
    expect(screen.getByText('45.000.000đ')).toBeInTheDocument();
    expect(screen.getByText('Đơn chờ xử lý')).toBeInTheDocument();
    expect(screen.getByText('Khách mới 30 ngày')).toBeInTheDocument();
    expect(screen.getByText('Son 3CE — còn 2')).toBeInTheDocument();
    expect(screen.getByText(/SALE10/)).toBeInTheDocument();
  });

  it('403: tài khoản thường thấy trang không có quyền', async () => {
    mockFetchFor({
      status: 403,
      body: { success: false, message: 'Bạn không có quyền truy cập khu vực quản trị.' },
    });
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByTestId('admin-forbidden')).toBeInTheDocument();
    });
    expect(screen.getByText('Bạn không có quyền truy cập trang quản trị')).toBeInTheDocument();
    expect(screen.queryByTestId('admin-nav-dashboard')).not.toBeInTheDocument();
  });

  it('401: chưa đăng nhập thì chuyển về /login', async () => {
    mockFetchFor({
      status: 401,
      body: { success: false, message: 'Bạn cần đăng nhập để truy cập khu vực quản trị.' },
    });
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByTestId('login-page')).toBeInTheDocument();
    });
  });
});
