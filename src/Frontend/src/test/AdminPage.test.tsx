import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import AdminPage from '../components/admin/AdminPage';

const respond = (status: number, body: unknown) =>
  Promise.resolve({ status, json: () => Promise.resolve(body) } as unknown as Response);

function mockFetchFor(profile: { status: number; body: unknown }) {
  globalThis.fetch = vi.fn((url: any) => {
    const urlStr = typeof url === 'string' ? url : url.url;
    if (urlStr.includes('/api/admin/profile')) return respond(profile.status, profile.body);
    if (urlStr.includes('/api/admin/reports/revenue')) {
      const today = new Date(); const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
      const iso = (d: Date) => d.toISOString().slice(0, 10) + 'T00:00:00Z';
      return respond(200, {
        success: true,
        data: {
          byDay: [
            { date: iso(yesterday), revenue: 2000000, orders: 4 },
            { date: iso(today), revenue: 3500000, orders: 6 },
          ],
          topProducts: [{ productId: 'p1', productName: 'Son kem 3CE', quantity: 12, revenue: 3000000 }],
          totalOrders: 10, cancelledOrders: 1, cancelRate: 10,
          voucherOrders: 4, voucherUsageRate: 40,
        },
      });
    }
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
    // SP sắp hết hàng giờ là bảng mini chuẩn: tên 1 cột, "còn N" là pill 1 cột khác.
    expect(screen.getByText('Son 3CE')).toBeInTheDocument();
    expect(screen.getByText('còn 2')).toBeInTheDocument();
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

  it('403 đợt 4: trang cấm có hướng dẫn cấp quyền từng bước + nút đổi tài khoản', async () => {
    mockFetchFor({
      status: 403,
      body: { success: false, message: 'Bạn không có quyền truy cập khu vực quản trị.' },
    });
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByTestId('admin-forbidden')).toBeInTheDocument();
    });
    expect(screen.getByText('Cách cấp quyền Super Admin')).toBeInTheDocument();
    expect(screen.getByText(/UPDATE "Users"/)).toBeInTheDocument();
    expect(screen.getByText('Về trang chủ')).toBeInTheDocument();
    expect(screen.getByText('Đăng nhập tài khoản khác')).toBeInTheDocument();
  });

  it('Doanh thu: SuperAdmin thấy biểu đồ cột + nút chọn 7/30 ngày + top SP bán chạy', async () => {
    mockFetchFor({
      status: 200,
      body: {
        success: true,
        data: { id: 'admin-1', email: 'admin@dafl.vn', fullName: 'Super Admin', role: 'SuperAdmin' },
      },
    });
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByTestId('admin-revenue-chart')).toBeInTheDocument();
    });
    expect(screen.getByTestId('admin-revenue-range-7')).toBeInTheDocument();
    expect(screen.getByTestId('admin-revenue-range-30')).toBeInTheDocument();
    expect(screen.getByText(/Son kem 3CE/)).toBeInTheDocument();
    expect(screen.getByText(/Tỉ lệ hủy đơn/)).toBeInTheDocument();
    expect(screen.getByText(/Đơn dùng voucher/)).toBeInTheDocument();
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

  it('Sản phẩm: bấm mắt mở modal chi tiết (giá, đánh giá) + nút Sửa mở form', async () => {
    globalThis.fetch = vi.fn((url: any) => {
      const urlStr = typeof url === 'string' ? url : url.url;
      if (urlStr.includes('/api/admin/profile')) {
        return respond(200, {
          success: true,
          data: { id: 'admin-1', email: 'admin@dafl.vn', fullName: 'Super Admin', role: 'SuperAdmin' },
        });
      }
      if (urlStr.includes('/api/admin/dashboard')) {
        return respond(200, {
          success: true,
          data: { revenueToday: 0, revenueThisMonth: 0, pendingOrders: 0, newCustomers30d: 0, ordersByStatus: {}, lowStockProducts: [], expiringVouchers: [] },
        });
      }
      if (urlStr.includes('/api/admin/reports/revenue')) {
        return respond(200, {
          success: true,
          data: { byDay: [], topProducts: [], totalOrders: 0, cancelledOrders: 0, cancelRate: 0, voucherOrders: 0, voucherUsageRate: 0 },
        });
      }
      if (urlStr.includes('/api/products')) {
        return respond(200, {
          success: true,
          data: [{ id: 'p1', categoryId: 'c1', categoryName: 'Son môi', name: 'Son kem 3CE', price: 250000, originalPrice: 300000, availableStock: 5, imageUrl: 'https://example.com/son.jpg', rating: 4.5, reviewCount: 12 }],
        });
      }
      if (urlStr.includes('/api/admin/categories')) {
        return respond(200, {
          success: true,
          data: [{ id: 'c1', name: 'Son môi', slug: 'son-moi', isActive: true, productCount: 1 }],
        });
      }
      return respond(200, { success: true, data: [] });
    });
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByTestId('admin-nav-products')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('admin-nav-products'));
    await waitFor(() => {
      expect(screen.getByText('Son kem 3CE')).toBeInTheDocument();
    });
    // Bảng có cột ảnh + đánh giá (rating/reviewCount từ PublicProduct).
    expect(screen.getByText(/4.5/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Xem chi tiết sản phẩm Son kem 3CE'));
    await waitFor(() => {
      expect(screen.getByTestId('admin-product-detail')).toBeInTheDocument();
    });
    const modal = within(screen.getByTestId('admin-product-detail'));
    expect(modal.getByText('250.000đ')).toBeInTheDocument();
    expect(modal.getByText(/4.5/)).toBeInTheDocument();
    expect(modal.getByText('Son môi')).toBeInTheDocument();
    // Nút Sửa trong modal mở form sửa đã có (giữ nguyên testid form).
    fireEvent.click(modal.getByText('Sửa sản phẩm'));
    await waitFor(() => {
      expect(screen.getByTestId('admin-product-form')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('admin-product-detail')).not.toBeInTheDocument();
  });

  it('Danh mục: bấm mắt mở modal chi tiết + nút Sửa mở form', async () => {
    globalThis.fetch = vi.fn((url: any) => {
      const urlStr = typeof url === 'string' ? url : url.url;
      if (urlStr.includes('/api/admin/profile')) {
        return respond(200, {
          success: true,
          data: { id: 'admin-1', email: 'admin@dafl.vn', fullName: 'Super Admin', role: 'SuperAdmin' },
        });
      }
      if (urlStr.includes('/api/admin/dashboard')) {
        return respond(200, {
          success: true,
          data: { revenueToday: 0, revenueThisMonth: 0, pendingOrders: 0, newCustomers30d: 0, ordersByStatus: {}, lowStockProducts: [], expiringVouchers: [] },
        });
      }
      if (urlStr.includes('/api/admin/reports/revenue')) {
        return respond(200, {
          success: true,
          data: { byDay: [], topProducts: [], totalOrders: 0, cancelledOrders: 0, cancelRate: 0, voucherOrders: 0, voucherUsageRate: 0 },
        });
      }
      if (urlStr.includes('/api/admin/categories')) {
        return respond(200, {
          success: true,
          data: [{ id: 'c1', name: 'Son môi', slug: 'son-moi', description: 'Son các loại', isActive: true, sortOrder: 1, productCount: 3 }],
        });
      }
      return respond(200, { success: true, data: [] });
    });
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByTestId('admin-nav-categories')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('admin-nav-categories'));
    await waitFor(() => {
      expect(screen.getByText('Son môi')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText('Xem chi tiết danh mục Son môi'));
    await waitFor(() => {
      expect(screen.getByTestId('admin-category-detail')).toBeInTheDocument();
    });
    const modal = within(screen.getByTestId('admin-category-detail'));
    expect(modal.getByText('son-moi')).toBeInTheDocument();
    expect(modal.getByText('Son các loại')).toBeInTheDocument();
  });
});
