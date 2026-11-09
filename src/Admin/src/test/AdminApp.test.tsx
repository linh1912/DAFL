import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
// jsdom không áp dụng stylesheet import nên không đo được computed style:
// đọc trực tiếp CSS nguồn để kiểm tra rule căn giữa của .auth-page-wrapper.
// (cwd khi chạy test là thư mục gói Admin hoặc thư mục src/ — thử cả hai.)
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const authCssPath = [
  resolve(process.cwd(), '../Shared/styles/auth.css'),
  resolve(process.cwd(), 'Shared/styles/auth.css'),
  resolve(process.cwd(), 'src/Shared/styles/auth.css'),
].find(p => existsSync(p));
const authCss = authCssPath ? readFileSync(authCssPath, 'utf-8') : '';

/**
 * App ADMIN riêng (src/Admin, localhost:3001) — đợt 13 tách khỏi app shop.
 * Trước đây là chế độ admin-riêng qua cờ VITE_ADMIN_ONLY=true trong
 * src/Frontend/src/App.tsx (test cũ AdminOnlyMode.test.tsx dùng stubEnv +
 * dynamic import vì IS_ADMIN_ONLY đọc import.meta.env lúc import).
 * Nay app admin là app độc lập nên không còn cờ đó: import App trực tiếp,
 * route / chuyển thẳng sang /admin, ẩn toàn bộ shop (header shop, banner,
 * giỏ hàng...), title là "DAFL Admin — Quản trị".
 */
describe('Admin app (src/Admin)', () => {
  beforeEach(() => {
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

  it('route / chuyển sang /admin, chỉ hiện trang Admin, title đổi thành DAFL Admin', async () => {
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
    expect(screen.queryByTestId('admin-app')).toBeInTheDocument();
    expect(document.title).toBe('DAFL Admin — Quản trị');
  });

  it('mở thẳng /admin cũng chỉ hiện trang Admin', async () => {
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

  it('admin /login: chỉ form cơ bản, không social, không tab đăng ký, không gợi ý tài khoản, không tự điền mật khẩu cũ', async () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('login-form')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('social-google-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('social-facebook-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('auth-tab-register')).not.toBeInTheDocument();
    expect(screen.queryByTestId('register-form')).not.toBeInTheDocument();
    expect(screen.getByText('Tên đăng nhập hoặc email')).toBeInTheDocument();
    expect(screen.queryByText('Tài khoản mặc định: admin / Admin@123')).not.toBeInTheDocument();
    expect(screen.getByTestId('login-password-input')).toHaveAttribute('autoComplete', 'new-password');
    expect(screen.getByTestId('login-email-input')).toHaveAttribute('autoComplete', 'off');
  });

  it('admin /admin: topbar mới không còn nút Tạo mới / ô tìm kiếm, không breadcrumb', async () => {
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('admin-page')).toBeInTheDocument();
    });
    const topbar = screen.getByRole('banner');
    expect(within(topbar).queryByRole('textbox')).toBeNull();
    expect(within(topbar).queryByText(/Tạo mới/)).toBeNull();
    expect(screen.queryByText('+ Tạo mới')).toBeNull();
    expect(screen.queryByText(/Trang chủ\s*\//)).toBeNull();
    expect(document.querySelector('.sa-breadcrumb, [class*="breadcrumb"]')).toBeNull();
    // Topbar vẫn còn các nút điều khiển của nó.
    expect(screen.getByLabelText('Thu gọn / mở menu')).toBeInTheDocument();
    expect(screen.getByLabelText('Thông báo')).toBeInTheDocument();
    expect(screen.getByLabelText('Menu tài khoản')).toBeInTheDocument();
  });

  it('admin /login: nhập "admin" được map sang admin@dafl.vn khi gọi API đăng nhập', async () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('login-form')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId('login-email-input'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByTestId('login-password-input'), { target: { value: 'Admin@123' } });
    fireEvent.click(screen.getByTestId('login-submit-btn'));

    await waitFor(() => {
      const calls = (globalThis.fetch as any).mock.calls as Array<[string, RequestInit?]>;
      const loginCall = calls.find(([url]) => typeof url === 'string' && url.includes('/api/auth/login'));
      expect(loginCall).toBeDefined();
      expect(JSON.parse(String(loginCall![1]?.body))).toEqual({ email: 'admin@dafl.vn', password: 'Admin@123' });
    });
  });

  it('admin /login (đợt 13 mục 8): không còn nút quay lại, khung form căn giữa màn hình', async () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('login-form')).toBeInTheDocument();
    });
    // Không còn nút "Trang chủ" / quay lại (nút này chỉ còn ở trang đăng nhập shop).
    expect(screen.queryByTestId('auth-close-btn')).not.toBeInTheDocument();
    expect(screen.queryByText('Trang chủ')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Quay lại trang chủ')).not.toBeInTheDocument();
    // Form cơ bản + panel vàng + nút hồng vẫn giữ nguyên.
    expect(screen.getByTestId('auth-modal')).toBeInTheDocument();
    expect(document.querySelector('.auth-side-panel')).toBeInTheDocument();
    expect(screen.getByTestId('login-submit-btn')).toBeInTheDocument();
    // Khung trang đăng nhập: bọc flex căn giữa cả 2 chiều, cao tối thiểu 100vh
    // (rule .auth-page-wrapper trong Shared/styles/auth.css).
    const wrapper = screen.getByTestId('auth-page');
    expect(wrapper).toHaveClass('auth-page-wrapper');
    const wrapperRules = [...authCss.matchAll(/\.auth-page-wrapper\s*\{([^}]*)\}/g)].map(m => m[1]);
    expect(wrapperRules.length).toBeGreaterThan(0);
    const centeredRule = wrapperRules[wrapperRules.length - 1];
    expect(centeredRule).toContain('display: flex');
    expect(centeredRule).toContain('align-items: center');
    expect(centeredRule).toContain('justify-content: center');
    expect(centeredRule).toContain('min-height: 100vh');
  });
});
