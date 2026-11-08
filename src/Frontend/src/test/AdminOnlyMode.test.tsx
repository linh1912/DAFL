import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Chế độ admin-riêng (VITE_ADMIN_ONLY=true, service dafl-admin ở localhost:3001):
 * app chỉ render trang Admin, route / chuyển thẳng sang /admin, ẩn toàn bộ shop
 * (header shop, banner, giỏ hàng...), title đổi thành "DAFL Admin — Quản trị".
 * Dùng stubEnv + dynamic import vì IS_ADMIN_ONLY đọc import.meta.env lúc import.
 */
describe('Admin-only mode (VITE_ADMIN_ONLY=true)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_ADMIN_ONLY', 'true');
    sessionStorage.clear();
    localStorage.clear();
    document.title = 'DAFL | Sàn mỹ phẩm đa gian hàng';

    globalThis.fetch = vi.fn((url: any) => {
      const urlStr = typeof url === 'string' ? url : url.url;
      if (urlStr.includes('/api/admin/profile')) {
        return Promise.resolve({
          status: 200,
          json: () =>
            Promise.resolve({
              success: true,
              data: { id: 'admin-1', email: 'admin@dafl.vn', fullName: 'Quản trị viên', role: 'SuperAdmin' },
            }),
        } as unknown as Response);
      }
      if (urlStr.includes('/api/admin/dashboard')) {
        return Promise.resolve({
          status: 200,
          json: () =>
            Promise.resolve({
              success: true,
              data: { revenueToday: 0, revenueThisMonth: 0, pendingOrders: 0, newCustomers30d: 0, ordersByStatus: {}, lowStockProducts: [], expiringVouchers: [] },
            }),
        } as unknown as Response);
      }
      if (urlStr.includes('/api/admin/reports/revenue')) {
        return Promise.resolve({
          status: 200,
          json: () =>
            Promise.resolve({ success: true, data: { byDay: [], topProducts: [], totalOrders: 0, cancelledOrders: 0, cancelRate: 0, voucherOrders: 0, voucherUsageRate: 0 } }),
        } as unknown as Response);
      }
      if (urlStr.includes('/api/auth/me')) {
        return Promise.resolve({
          status: 200,
          json: () => Promise.resolve({ success: true, data: { id: 'admin-1', email: 'admin@dafl.vn', fullName: 'Quản trị viên', role: 'SuperAdmin' } }),
        } as unknown as Response);
      }
      return Promise.resolve({
        status: 200,
        json: () => Promise.resolve({ success: true, data: [] }),
      } as unknown as Response);
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('route / chuyển sang /admin, chỉ hiện trang Admin, title đổi thành DAFL Admin', async () => {
    const { default: App } = await import('../App');
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('admin-page')).toBeInTheDocument();
    });
    // Không còn shop: không header shop, không banner, không footer shop.
    expect(screen.queryByTestId('header')).not.toBeInTheDocument();
    expect(screen.queryByTestId('hero-carousel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('admin-only-app')).toBeInTheDocument();
    expect(document.title).toBe('DAFL Admin — Quản trị');
  });

  it('mở thẳng /admin cũng chỉ hiện trang Admin', async () => {
    const { default: App } = await import('../App');
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('admin-page')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('hero-carousel')).not.toBeInTheDocument();
  });
});
