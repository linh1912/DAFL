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
    // Form sửa giờ mở trong DRAWER (không còn inline trên bảng, không còn modal):
    // drawer có overlay che phủ, form nằm bên trong drawer, bảng vẫn còn trong DOM phía dưới.
    const formModal = screen.getByTestId('admin-product-form-modal');
    expect(formModal).toHaveAttribute('role', 'dialog');
    expect(formModal).toHaveClass('sa-drawer');
    expect(formModal.closest('.sa-modal-overlay')).not.toBeNull();
    expect(within(formModal).getByTestId('admin-product-form')).toBeInTheDocument();
    // Tên SP xuất hiện cả ở bảng và ở khối preview trong drawer.
    expect(screen.getAllByText('Son kem 3CE').length).toBeGreaterThan(0);
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
    // Nút Sửa trong modal chi tiết mở form sửa — form giờ nằm trong MODAL.
    fireEvent.click(modal.getByText('Sửa danh mục'));
    await waitFor(() => {
      expect(screen.getByTestId('admin-category-form-modal')).toBeInTheDocument();
    });
    expect(within(screen.getByTestId('admin-category-form-modal')).getByTestId('admin-category-form')).toBeInTheDocument();
    expect(screen.queryByTestId('admin-category-detail')).not.toBeInTheDocument();
  });

  // ---------- Helper cho các test giao diện mới (toolbar / phân trang / modal) ----------
  const adminProfile = { id: 'admin-1', email: 'admin@dafl.vn', fullName: 'Super Admin', role: 'SuperAdmin' };

  /** Mock fetch cho trang Admin: profile/dashboard/revenue mặc định + `extra` cho từng endpoint. */
  function mockFetchAdmin(extra?: (urlStr: string) => unknown) {
    globalThis.fetch = vi.fn((url: any) => {
      const urlStr = typeof url === 'string' ? url : url.url;
      if (urlStr.includes('/api/admin/profile')) return respond(200, { success: true, data: adminProfile });
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
      if (extra) {
        const data = extra(urlStr);
        if (data !== undefined) return respond(200, { success: true, data });
      }
      return respond(200, { success: true, data: [] });
    });
  }

  const mkProducts = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `p${i + 1}`, categoryId: 'c1', categoryName: 'Son môi',
      name: `Sản phẩm ${String(i + 1).padStart(2, '0')}`,
      price: 100000 + i * 1000, originalPrice: 150000, availableStock: 10,
      imageUrl: '', rating: 4.5, reviewCount: 3,
    }));

  const mkOrders = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `o${i + 1}`, orderDisplayCode: `DH-${1001 + i}`, orderCode: 1001 + i,
      customerName: `Khách ${String(i + 1).padStart(2, '0')}`,
      customerEmail: `khach${i + 1}@example.com`,
      status: 'Pending', paymentMethod: 'COD', totalAmount: 500000, createdAt: '2026-11-08T10:00:00Z',
    }));

  const mkCategories = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `c${i + 1}`, name: `Danh mục ${String(i + 1).padStart(2, '0')}`,
      slug: `danh-muc-${i + 1}`, description: `Mô tả ${i + 1}`,
      isActive: true, sortOrder: i + 1, productCount: 0,
    }));

  const mkReturns = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `r${i + 1}`, orderId: `o${i + 1}`, orderDisplayCode: `DH-${2000 + i}`,
      productId: 'p1', productName: `SP trả ${String(i + 1).padStart(2, '0')}`,
      quantity: 1, reason: 'Lỗi sản phẩm', status: 'Pending', createdAt: '2026-11-08T10:00:00Z',
    }));

  const mkAudit = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `a${i + 1}`, actorEmail: 'admin@dafl.vn',
      action: `Cập nhật đơn DH-${2000 + i}`, entityType: 'Order',
      entityId: `o${i + 1}`, createdAt: '2026-11-08T10:00:00Z',
    }));

  const mkTiers = () => [
    { tier: 'Member', minSpent: 0, spendPerPoint: 10000, maxPointsPercent: 10, freeShipThreshold: 299000 },
    { tier: 'Silver', minSpent: 5000000, spendPerPoint: 10000, maxPointsPercent: 15, freeShipThreshold: 299000 },
    { tier: 'Gold', minSpent: 15000000, spendPerPoint: 8000, maxPointsPercent: 20, freeShipThreshold: 199000 },
    { tier: 'Diamond', minSpent: 30000000, spendPerPoint: 5000, maxPointsPercent: 30, freeShipThreshold: 0 },
  ];

  it('Topbar mới: không còn nút Tạo mới / ô tìm kiếm; không còn breadcrumb', async () => {
    mockFetchFor({
      status: 200,
      body: { success: true, data: adminProfile },
    });
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByTestId('admin-nav-dashboard')).toBeInTheDocument();
    });
    const topbar = screen.getByRole('banner');
    // Topbar chỉ còn: thu gọn sidebar, toàn màn hình, chuông, avatar/tên.
    expect(within(topbar).queryByRole('textbox')).toBeNull();
    expect(within(topbar).queryByText(/Tạo mới/)).toBeNull();
    expect(screen.queryByText('+ Tạo mới')).toBeNull();
    expect(screen.getByLabelText('Thu gọn / mở menu')).toBeInTheDocument();
    expect(screen.getByLabelText('Thông báo')).toBeInTheDocument();
    expect(screen.getByLabelText('Menu tài khoản')).toBeInTheDocument();
    // Breadcrumb "Trang chủ / Quản trị / ..." đã bỏ ở mọi mục.
    expect(screen.queryByText(/Trang chủ\s*\//)).toBeNull();
    expect(document.querySelector('.sa-breadcrumb, [class*="breadcrumb"]')).toBeNull();
  });

  it('Toolbar Sản phẩm: nút Thêm mới ở TRÁI (class sa-btn-add), tìm kiếm + Đặt lại + Làm mới ở PHẢI', async () => {
    mockFetchAdmin(urlStr => {
      if (urlStr.includes('/api/products')) return mkProducts(1);
      if (urlStr.includes('/api/admin/categories')) return mkCategories(1);
      return undefined;
    });
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByTestId('admin-nav-products')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('admin-nav-products'));
    await waitFor(() => {
      expect(screen.getByText('Sản phẩm 01')).toBeInTheDocument();
    });
    const addBtn = screen.getByTestId('admin-product-add-btn');
    expect(addBtn).toHaveTextContent('+ Thêm sản phẩm');
    expect(addBtn).toHaveClass('sa-btn-add');
    expect(addBtn.closest('.sa-toolbar-left')).not.toBeNull();
    expect(screen.getByTestId('admin-product-search').closest('.sa-toolbar-right')).not.toBeNull();
    expect(screen.getByTestId('admin-products-reset-btn').closest('.sa-toolbar-right')).not.toBeNull();
    expect(screen.getByTestId('admin-products-refresh-btn').closest('.sa-toolbar-right')).not.toBeNull();
    expect(screen.getByTestId('admin-products-pagination')).toBeInTheDocument();
  });

  it('Toolbar Đơn hàng: không có nút Thêm mới; có tìm kiếm + Tìm + Đặt lại + Làm mới + Export ở phải', async () => {
    mockFetchAdmin(urlStr => {
      if (urlStr.includes('/api/admin/orders')) return mkOrders(1);
      return undefined;
    });
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByTestId('admin-nav-orders')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('admin-nav-orders'));
    await waitFor(() => {
      expect(screen.getByText('Khách 01')).toBeInTheDocument();
    });
    expect(document.querySelector('.sa-toolbar .sa-btn-add')).toBeNull();
    expect(screen.getByTestId('admin-order-search').closest('.sa-toolbar-right')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Tìm' })).toBeInTheDocument();
    expect(screen.getByTestId('admin-orders-reset-btn').closest('.sa-toolbar-right')).not.toBeNull();
    expect(screen.getByTestId('admin-orders-refresh-btn').closest('.sa-toolbar-right')).not.toBeNull();
    expect(screen.getByRole('button', { name: /Export/ })).toBeInTheDocument();
  });

  it('Phân trang Sản phẩm: 12 SP → 2 trang, bấm Sau/Trước và số trang đổi "Trang X / Y"', async () => {
    mockFetchAdmin(urlStr => {
      if (urlStr.includes('/api/products')) return mkProducts(12);
      if (urlStr.includes('/api/admin/categories')) return mkCategories(1);
      return undefined;
    });
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByTestId('admin-nav-products')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('admin-nav-products'));
    await waitFor(() => {
      expect(screen.getByText('Sản phẩm 01')).toBeInTheDocument();
    });
    expect(screen.getByText(/Trang 1 \/ 2/)).toBeInTheDocument();
    expect(screen.getByText(/Tổng 12 dòng/)).toBeInTheDocument();
    expect(screen.getByTestId('admin-products-pagination-prev')).toBeDisabled();
    expect(screen.queryByText('Sản phẩm 11')).toBeNull();

    fireEvent.click(screen.getByTestId('admin-products-pagination-next'));
    await waitFor(() => {
      expect(screen.getByText(/Trang 2 \/ 2/)).toBeInTheDocument();
    });
    expect(screen.getByText('Sản phẩm 11')).toBeInTheDocument();
    expect(screen.getByText('Sản phẩm 12')).toBeInTheDocument();
    expect(screen.queryByText('Sản phẩm 01')).toBeNull();
    expect(screen.getByTestId('admin-products-pagination-next')).toBeDisabled();

    // Bấm số trang 1 để quay lại.
    fireEvent.click(screen.getByTestId('admin-products-pagination-page-1'));
    await waitFor(() => {
      expect(screen.getByText(/Trang 1 \/ 2/)).toBeInTheDocument();
    });
    expect(screen.getByText('Sản phẩm 01')).toBeInTheDocument();
    expect(screen.queryByText('Sản phẩm 11')).toBeNull();
  });

  it('Phân trang Đơn hàng: 15 đơn → tối đa 2 trang (API trả tối đa 20 dòng)', async () => {
    mockFetchAdmin(urlStr => {
      if (urlStr.includes('/api/admin/orders')) return mkOrders(15);
      return undefined;
    });
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByTestId('admin-nav-orders')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('admin-nav-orders'));
    await waitFor(() => {
      expect(screen.getByText('Khách 01')).toBeInTheDocument();
    });
    expect(screen.getByText(/Trang 1 \/ 2/)).toBeInTheDocument();
    expect(screen.getByText(/Tổng 15 dòng/)).toBeInTheDocument();
    expect(screen.getByTestId('admin-orders-pagination-prev')).toBeDisabled();
    expect(screen.queryByText('Khách 11')).toBeNull();

    fireEvent.click(screen.getByTestId('admin-orders-pagination-next'));
    await waitFor(() => {
      expect(screen.getByText(/Trang 2 \/ 2/)).toBeInTheDocument();
    });
    expect(screen.getByText('Khách 11')).toBeInTheDocument();
    expect(screen.getByText('Khách 15')).toBeInTheDocument();
    expect(screen.queryByText('Khách 01')).toBeNull();
    expect(screen.getByTestId('admin-orders-pagination-next')).toBeDisabled();

    fireEvent.click(screen.getByTestId('admin-orders-pagination-prev'));
    await waitFor(() => {
      expect(screen.getByText(/Trang 1 \/ 2/)).toBeInTheDocument();
    });
    expect(screen.getByText('Khách 01')).toBeInTheDocument();
  });

  it('Form Sản phẩm: bấm Thêm mới mở DRAWER (bảng vẫn trong DOM phía dưới)', async () => {
    mockFetchAdmin(urlStr => {
      if (urlStr.includes('/api/products')) return mkProducts(1);
      if (urlStr.includes('/api/admin/categories')) return mkCategories(1);
      return undefined;
    });
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByTestId('admin-nav-products')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('admin-nav-products'));
    await waitFor(() => {
      expect(screen.getByText('Sản phẩm 01')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('admin-product-form-modal')).toBeNull();

    fireEvent.click(screen.getByTestId('admin-product-add-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('admin-product-form-modal')).toBeInTheDocument();
    });
    const formModal = screen.getByTestId('admin-product-form-modal');
    expect(formModal).toHaveAttribute('role', 'dialog');
    expect(formModal).toHaveClass('sa-drawer');
    expect(formModal.closest('.sa-modal-overlay')).not.toBeNull();
    const form = within(formModal).getByTestId('admin-product-form');
    expect(form).toBeInTheDocument();
    expect(within(formModal).getByTestId('admin-product-name-input')).toBeInTheDocument();
    expect(within(formModal).getByTestId('admin-product-price-input')).toBeInTheDocument();
    // Modal chỉ che phủ bảng, không gỡ bảng khỏi DOM.
    expect(screen.getByText('Sản phẩm 01')).toBeInTheDocument();
  });

  it('Form Danh mục: bấm Thêm mới mở MODAL', async () => {
    mockFetchAdmin(urlStr => {
      if (urlStr.includes('/api/admin/categories')) return mkCategories(1);
      return undefined;
    });
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByTestId('admin-nav-categories')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('admin-nav-categories'));
    await waitFor(() => {
      expect(screen.getByText('Danh mục 01')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('admin-category-form-modal')).toBeNull();

    fireEvent.click(screen.getByTestId('admin-category-add-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('admin-category-form-modal')).toBeInTheDocument();
    });
    const formModal = screen.getByTestId('admin-category-form-modal');
    expect(formModal).toHaveAttribute('role', 'dialog');
    expect(formModal.closest('.sa-modal-overlay')).not.toBeNull();
    expect(within(formModal).getByTestId('admin-category-form')).toBeInTheDocument();
    expect(within(formModal).getByTestId('admin-category-name-input')).toBeInTheDocument();
    expect(screen.getByText('Danh mục 01')).toBeInTheDocument();
  });

  it('Form Khuyến mãi: bấm Tạo khuyến mãi mở MODAL', async () => {
    mockFetchAdmin();
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByTestId('admin-nav-promotions')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('admin-nav-promotions'));
    await waitFor(() => {
      expect(screen.getByTestId('admin-promo-add-btn')).toBeInTheDocument();
    });
    expect(screen.getByText('Chưa có khuyến mãi.')).toBeInTheDocument();
    expect(screen.queryByTestId('admin-promo-form-modal')).toBeNull();

    fireEvent.click(screen.getByTestId('admin-promo-add-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('admin-promo-form-modal')).toBeInTheDocument();
    });
    const formModal = screen.getByTestId('admin-promo-form-modal');
    expect(formModal).toHaveAttribute('role', 'dialog');
    expect(formModal.closest('.sa-modal-overlay')).not.toBeNull();
    expect(within(formModal).getByTestId('admin-promo-form')).toBeInTheDocument();
    expect(within(formModal).getByTestId('admin-promo-code-input')).toBeInTheDocument();
  });

  it('Hội viên: form điều chỉnh điểm VẪN inline (không modal); bảng 4 hạng không phân trang', async () => {
    mockFetchAdmin(urlStr => {
      if (urlStr.includes('/api/admin/membership/config')) return mkTiers();
      return undefined;
    });
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByTestId('admin-nav-membership')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('admin-nav-membership'));
    await waitFor(() => {
      expect(screen.getByTestId('admin-adjust-points-form')).toBeInTheDocument();
    });
    const form = screen.getByTestId('admin-adjust-points-form');
    expect(form.closest('.sa-modal')).toBeNull();
    expect(form.closest('.sa-modal-overlay')).toBeNull();
    expect(screen.getByTestId('admin-adjust-user-input')).toBeInTheDocument();
    expect(screen.getByTestId('admin-adjust-points-input')).toBeInTheDocument();
    // Bảng hạng chỉ 4 dòng nên không có phân trang; toolbar vẫn có Đặt lại/Làm mới.
    expect(screen.getByText('Thường (Member)')).toBeInTheDocument();
    expect(screen.getByText('Kim cương (Diamond)')).toBeInTheDocument();
    expect(screen.queryByTestId('admin-members-pagination')).toBeNull();
    expect(screen.queryByTestId('admin-membership-pagination')).toBeNull();
    expect(screen.getByTestId('admin-members-reset-btn')).toBeInTheDocument();
    expect(screen.getByTestId('admin-members-refresh-btn')).toBeInTheDocument();
  });

  it('Tổng quan: không có toolbar chuẩn, không có phân trang', async () => {
    mockFetchFor({
      status: 200,
      body: { success: true, data: adminProfile },
    });
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByTestId('admin-nav-dashboard')).toBeInTheDocument();
    });
    expect(document.querySelector('.sa-toolbar')).toBeNull();
    expect(screen.queryByTestId('admin-orders-pagination')).toBeNull();
    expect(screen.queryByTestId('admin-products-pagination')).toBeNull();
    expect(screen.queryByTestId('admin-orders-reset-btn')).toBeNull();
    expect(screen.queryByTestId('admin-orders-refresh-btn')).toBeNull();
  });

  it('Trả hàng / Nhật ký: toolbar reset/refresh + phân trang riêng cho 2 bảng', async () => {
    mockFetchAdmin(urlStr => {
      if (urlStr.includes('/api/admin/audit-log')) return mkAudit(12);
      if (urlStr.includes('/api/admin/returns')) return mkReturns(12);
      return undefined;
    });
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByTestId('admin-nav-returns')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('admin-nav-returns'));
    await waitFor(() => {
      expect(screen.getByText('SP trả 01')).toBeInTheDocument();
    });
    expect(screen.getByTestId('admin-returns-reset-btn')).toBeInTheDocument();
    expect(screen.getByTestId('admin-returns-refresh-btn')).toBeInTheDocument();
    expect(screen.getByTestId('admin-returns-audit-reset-btn')).toBeInTheDocument();
    expect(screen.getByTestId('admin-returns-audit-refresh-btn')).toBeInTheDocument();
    const returnsPaging = screen.getByTestId('admin-returns-pagination');
    const auditPaging = screen.getByTestId('admin-returns-audit-pagination');
    expect(within(returnsPaging).getByText(/Trang 1 \/ 2/)).toBeInTheDocument();
    expect(within(auditPaging).getByText(/Trang 1 \/ 2/)).toBeInTheDocument();
    expect(screen.queryByText('SP trả 11')).toBeNull();

    // Chuyển trang bảng trả hàng không ảnh hưởng bảng nhật ký.
    fireEvent.click(screen.getByTestId('admin-returns-pagination-next'));
    await waitFor(() => {
      expect(within(returnsPaging).getByText(/Trang 2 \/ 2/)).toBeInTheDocument();
    });
    expect(screen.getByText('SP trả 11')).toBeInTheDocument();
    expect(within(auditPaging).getByText(/Trang 1 \/ 2/)).toBeInTheDocument();
  });

  it('Khách hàng: bảng có cột Điểm + chi tiết khách hiện số dư điểm (đợt 13, mục 3)', async () => {
    const customers = [
      { id: 'u1', email: 'lan@example.com', fullName: 'Lan Anh', phoneNumber: '0912345678', role: 'Customer', isLocked: false, membershipTier: 'Gold', totalSpent12m: 6000000, orderCount: 3, availablePoints: 250, createdAt: '2026-11-01T10:00:00Z', lastLoginAt: '2026-11-08T10:00:00Z' },
      { id: 'u2', email: 'minh@example.com', fullName: 'Minh Quân', phoneNumber: null, role: 'Customer', isLocked: false, membershipTier: 'Member', totalSpent12m: 0, orderCount: 0, availablePoints: 0, createdAt: '2026-11-02T10:00:00Z', lastLoginAt: null },
    ];
    mockFetchAdmin(urlStr => {
      if (urlStr.includes('/api/admin/customers/')) return { customer: customers[0], recentOrders: [] };
      if (urlStr.includes('/api/admin/customers')) return customers;
      return undefined;
    });
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByTestId('admin-nav-customers')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('admin-nav-customers'));
    await waitFor(() => {
      expect(screen.getByText('Lan Anh')).toBeInTheDocument();
    });
    // Cột "Điểm" nằm sau "Chi tiêu 12 tháng", hiển thị số dư từng khách.
    expect(screen.getByText('Điểm')).toBeInTheDocument();
    expect(screen.getByTestId('admin-customer-points-u1')).toHaveTextContent('250');
    expect(screen.getByTestId('admin-customer-points-u2')).toHaveTextContent('0');

    // Mở chi tiết khách → thấy số dư điểm + giá trị quy đổi (1 điểm = 1.000đ).
    fireEvent.click(screen.getByLabelText('Xem khách hàng Lan Anh'));
    await waitFor(() => {
      expect(screen.getByTestId('admin-customer-detail')).toBeInTheDocument();
    });
    expect(screen.getByTestId('admin-customer-detail-points')).toHaveTextContent('250 điểm');
    expect(screen.getByTestId('admin-customer-detail-points')).toHaveTextContent('250.000đ');
  });

  it('Nhật ký: lọc theo khoảng ngày chỉ giữ các dòng trong khoảng (đợt 13 mục 7)', async () => {
    const auditRows = [
      { id: 'a1', actorEmail: 'admin@dafl.vn', action: 'Xóa sản phẩm SP-01', entityType: 'Product', entityId: 'p1', createdAt: '2026-11-01T10:00:00Z' },
      { id: 'a2', actorEmail: 'admin@dafl.vn', action: 'Cập nhật đơn DH-2001', entityType: 'Order', entityId: 'o1', createdAt: '2026-11-05T10:00:00Z' },
      { id: 'a3', actorEmail: 'admin@dafl.vn', action: 'Cập nhật đơn DH-2002', entityType: 'Order', entityId: 'o2', createdAt: '2026-11-08T10:00:00Z' },
      { id: 'a4', actorEmail: 'admin@dafl.vn', action: 'Duyệt trả hàng TH-01', entityType: 'Return', entityId: 'r1', createdAt: '2026-11-10T10:00:00Z' },
    ];
    mockFetchAdmin(urlStr => {
      if (urlStr.includes('/api/admin/audit-log')) return auditRows;
      if (urlStr.includes('/api/admin/returns')) return [];
      return undefined;
    });
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByTestId('admin-nav-returns')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('admin-nav-returns'));
    await waitFor(() => {
      expect(screen.getByText('Xóa sản phẩm SP-01')).toBeInTheDocument();
    });
    // Chưa bấm Lọc: cả 4 dòng đều hiện (ô ngày chỉ là bản nháp).
    expect(screen.getByText('Duyệt trả hàng TH-01')).toBeInTheDocument();
    expect(screen.getByTestId('admin-log-date-from')).toBeInTheDocument();
    expect(screen.getByTestId('admin-log-date-to')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('admin-log-date-from'), { target: { value: '2026-11-05' } });
    fireEvent.change(screen.getByTestId('admin-log-date-to'), { target: { value: '2026-11-08' } });
    fireEvent.click(screen.getByTestId('admin-log-filter-btn'));

    await waitFor(() => {
      expect(screen.queryByText('Xóa sản phẩm SP-01')).toBeNull();
    });
    expect(screen.getByText('Cập nhật đơn DH-2001')).toBeInTheDocument();
    expect(screen.getByText('Cập nhật đơn DH-2002')).toBeInTheDocument();
    expect(screen.queryByText('Duyệt trả hàng TH-01')).toBeNull();

    // Đặt lại xóa cả khoảng ngày → cả 4 dòng hiện lại.
    fireEvent.click(screen.getByTestId('admin-returns-audit-reset-btn'));
    await waitFor(() => {
      expect(screen.getByText('Xóa sản phẩm SP-01')).toBeInTheDocument();
    });
    expect(screen.getByText('Duyệt trả hàng TH-01')).toBeInTheDocument();
  });

  it('Nhật ký: Export CSV xuất đúng danh sách nhật ký đã lọc (đợt 13 mục 7)', async () => {
    const auditRows = [
      { id: 'a1', actorEmail: 'admin@dafl.vn', action: 'Xóa sản phẩm SP-01', entityType: 'Product', entityId: 'p1', createdAt: '2026-11-01T10:00:00Z' },
      { id: 'a2', actorEmail: 'admin@dafl.vn', action: 'Cập nhật đơn DH-2001', entityType: 'Order', entityId: 'o1', createdAt: '2026-11-05T10:00:00Z' },
    ];
    mockFetchAdmin(urlStr => {
      if (urlStr.includes('/api/admin/audit-log')) return auditRows;
      if (urlStr.includes('/api/admin/returns')) return [];
      return undefined;
    });
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByTestId('admin-nav-returns')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('admin-nav-returns'));
    await waitFor(() => {
      expect(screen.getByText('Cập nhật đơn DH-2001')).toBeInTheDocument();
    });

    let capturedBlob: Blob | null = null;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn((blob: Blob) => { capturedBlob = blob; return 'blob:mock'; }),
      revokeObjectURL: vi.fn(),
    });
    try {
      // Lọc chỉ còn ngày 2026-11-05 rồi Export: CSV chỉ chứa dòng DH-2001.
      fireEvent.change(screen.getByTestId('admin-log-date-from'), { target: { value: '2026-11-05' } });
      fireEvent.change(screen.getByTestId('admin-log-date-to'), { target: { value: '2026-11-05' } });
      fireEvent.click(screen.getByTestId('admin-log-filter-btn'));
      await waitFor(() => {
        expect(screen.queryByText('Xóa sản phẩm SP-01')).toBeNull();
      });
      fireEvent.click(screen.getByTestId('admin-log-export-btn'));

      expect(clickSpy).toHaveBeenCalled();
      expect(capturedBlob).not.toBeNull();
      const blob = capturedBlob as unknown as Blob;
      expect(blob.type).toContain('text/csv');
      const text = typeof blob.text === 'function'
        ? await blob.text()
        : new TextDecoder().decode(await blob.arrayBuffer());
      expect(text).toContain('Thời gian');
      expect(text).toContain('Cập nhật đơn DH-2001');
      expect(text).not.toContain('Xóa sản phẩm SP-01');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // ---------- Đợt 13 (mục 4, 5 + voucher Draft): ghi nhận hoàn tiền / sửa-xóa voucher Draft / hộp xác nhận ----------
  const mkPromos = () => [
    { id: 'promo-draft', code: 'SALE10', description: 'Giảm 10%', discountType: 'Percentage', discountValue: 10, minOrderAmount: 0, maxDiscountAmount: null, startDate: null, expiryDate: '2026-12-31T00:00:00Z', maxUses: 100, usedCount: 0, maxUsesPerUser: 1, minTier: null, scopeType: 'All', status: 'Draft' },
    { id: 'promo-active', code: 'SALE20', description: 'Giảm 20%', discountType: 'Percentage', discountValue: 20, minOrderAmount: 100000, maxDiscountAmount: null, startDate: null, expiryDate: '2026-12-31T00:00:00Z', maxUses: 100, usedCount: 5, maxUsesPerUser: 1, minTier: null, scopeType: 'All', status: 'Active' },
  ];

  const fetchCalls = () => (globalThis.fetch as unknown as { mock: { calls: Array<[unknown, { method?: string } | undefined]> } }).mock.calls;
  const calledWith = (urlPart: string, method: string) =>
    fetchCalls().some(([url, init]) => String(url).includes(urlPart) && (init?.method ?? 'GET') === method);

  it('Trả hàng: yêu cầu đã duyệt + chờ hoàn tiền có nút Ghi nhận; xác nhận gọi POST record', async () => {
    const refundRow = {
      id: 'r1', orderId: 'o1', orderDisplayCode: 'DH-2001', productId: 'p1', productName: 'Son kem 3CE',
      quantity: 1, reason: 'Lỗi sản phẩm', status: 'Approved', refundAmount: 250000,
      refundStatus: 'PendingRefund', refundId: 'ref-1', createdAt: '2026-11-08T10:00:00Z',
    };
    mockFetchAdmin(urlStr => {
      if (urlStr.includes('/api/admin/returns')) return [refundRow];
      return undefined;
    });
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByTestId('admin-nav-returns')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('admin-nav-returns'));
    await waitFor(() => {
      expect(screen.getByText('Son kem 3CE')).toBeInTheDocument();
    });
    expect(screen.getByTestId('admin-return-record-refund-btn')).toHaveTextContent('Ghi nhận đã hoàn tiền');

    fireEvent.click(screen.getByTestId('admin-return-record-refund-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('admin-refund-record-modal')).toBeInTheDocument();
    });
    const modal = screen.getByTestId('admin-refund-record-modal');
    expect(within(modal).getByText('250.000đ')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('admin-refund-transaction-input'), { target: { value: 'TX123456' } });
    fireEvent.click(screen.getByTestId('admin-refund-record-confirm-btn'));
    await waitFor(() => {
      expect(calledWith('/api/admin/refunds/ref-1/record', 'POST')).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getByText('Đã ghi nhận hoàn tiền.')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('admin-refund-record-modal')).toBeNull();
  });

  it('Trả hàng: chưa có refundId (hoặc chưa duyệt) thì KHÔNG có nút Ghi nhận hoàn tiền', async () => {
    const rows = [
      { id: 'r1', orderId: 'o1', orderDisplayCode: 'DH-2001', productId: 'p1', productName: 'Son kem 3CE', quantity: 1, reason: 'Lỗi sản phẩm', status: 'Approved', refundAmount: 250000, refundStatus: 'PendingRefund', refundId: null, createdAt: '2026-11-08T10:00:00Z' },
      { id: 'r2', orderId: 'o2', orderDisplayCode: 'DH-2002', productId: 'p1', productName: 'Son lì 3CE', quantity: 1, reason: 'Đổi ý', status: 'Pending', createdAt: '2026-11-08T10:00:00Z' },
    ];
    mockFetchAdmin(urlStr => {
      if (urlStr.includes('/api/admin/returns')) return rows;
      return undefined;
    });
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByTestId('admin-nav-returns')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('admin-nav-returns'));
    await waitFor(() => {
      expect(screen.getByText('Son kem 3CE')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('admin-return-record-refund-btn')).toBeNull();
  });

  it('Khuyến mãi: chỉ voucher Draft có nút Sửa/Xóa; voucher Active không có', async () => {
    mockFetchAdmin(urlStr => {
      if (urlStr.includes('/api/admin/promotions')) return mkPromos();
      return undefined;
    });
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByTestId('admin-nav-promotions')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('admin-nav-promotions'));
    await waitFor(() => {
      expect(screen.getByText('SALE10')).toBeInTheDocument();
    });
    expect(screen.getByText('SALE20')).toBeInTheDocument();
    expect(screen.getAllByTestId('admin-promo-edit-btn')).toHaveLength(1);
    expect(screen.getAllByTestId('admin-promo-delete-btn')).toHaveLength(1);
    expect(screen.getByLabelText('Sửa khuyến mãi SALE10')).toBeInTheDocument();
    expect(screen.queryByLabelText('Sửa khuyến mãi SALE20')).toBeNull();
    expect(screen.queryByLabelText('Xóa khuyến mãi SALE20')).toBeNull();
  });

  it('Khuyến mãi: Sửa voucher Draft mở form (mã bị khóa), Lưu gọi PUT', async () => {
    mockFetchAdmin(urlStr => {
      if (urlStr.includes('/api/admin/promotions')) return mkPromos();
      return undefined;
    });
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByTestId('admin-nav-promotions')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('admin-nav-promotions'));
    await waitFor(() => {
      expect(screen.getByText('SALE10')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('admin-promo-edit-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('admin-promo-form-modal')).toBeInTheDocument();
    });
    const formModal = screen.getByTestId('admin-promo-form-modal');
    expect(within(formModal).getByText('Sửa khuyến mãi SALE10')).toBeInTheDocument();
    expect(within(formModal).getByTestId('admin-promo-code-input')).toBeDisabled();
    expect(within(formModal).getByText('Lưu thay đổi')).toBeInTheDocument();

    fireEvent.click(within(formModal).getByText('Lưu thay đổi'));
    await waitFor(() => {
      expect(calledWith('/api/admin/promotions/promo-draft', 'PUT')).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getByText('Đã cập nhật khuyến mãi.')).toBeInTheDocument();
    });
  });

  it('Khuyến mãi: Xóa voucher Draft phải qua hộp xác nhận; Hủy thì không gọi DELETE, Xác nhận thì gọi', async () => {
    mockFetchAdmin(urlStr => {
      if (urlStr.includes('/api/admin/promotions')) return mkPromos();
      return undefined;
    });
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByTestId('admin-nav-promotions')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('admin-nav-promotions'));
    await waitFor(() => {
      expect(screen.getByText('SALE10')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('admin-promo-delete-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('admin-confirm-modal')).toBeInTheDocument();
    });
    expect(screen.getByText(/Xóa voucher Nháp “SALE10”/)).toBeInTheDocument();
    expect(calledWith('/api/admin/promotions/promo-draft', 'DELETE')).toBe(false);

    fireEvent.click(screen.getByTestId('admin-confirm-no-btn'));
    await waitFor(() => {
      expect(screen.queryByTestId('admin-confirm-modal')).toBeNull();
    });
    expect(calledWith('/api/admin/promotions/promo-draft', 'DELETE')).toBe(false);

    fireEvent.click(screen.getByTestId('admin-promo-delete-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('admin-confirm-modal')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('admin-confirm-yes-btn'));
    await waitFor(() => {
      expect(calledWith('/api/admin/promotions/promo-draft', 'DELETE')).toBe(true);
    });
  });

  it('Hộp xác nhận: Xóa sản phẩm chỉ mở hộp xác nhận, chưa gọi DELETE; xác nhận mới gọi', async () => {
    mockFetchAdmin(urlStr => {
      if (urlStr.includes('/api/products')) return mkProducts(1);
      if (urlStr.includes('/api/admin/categories')) return mkCategories(1);
      return undefined;
    });
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByTestId('admin-nav-products')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('admin-nav-products'));
    await waitFor(() => {
      expect(screen.getByText('Sản phẩm 01')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText('Xóa sản phẩm Sản phẩm 01'));
    await waitFor(() => {
      expect(screen.getByTestId('admin-confirm-modal')).toBeInTheDocument();
    });
    expect(screen.getByText(/Xóa sản phẩm “Sản phẩm 01”/)).toBeInTheDocument();
    expect(calledWith('/api/admin/products/p1', 'DELETE')).toBe(false);

    fireEvent.click(screen.getByTestId('admin-confirm-yes-btn'));
    await waitFor(() => {
      expect(calledWith('/api/admin/products/p1', 'DELETE')).toBe(true);
    });
  });

  it('Hộp xác nhận: Xóa danh mục phải xác nhận trước khi gọi DELETE', async () => {
    mockFetchAdmin(urlStr => {
      if (urlStr.includes('/api/admin/categories')) return mkCategories(1);
      return undefined;
    });
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByTestId('admin-nav-categories')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('admin-nav-categories'));
    await waitFor(() => {
      expect(screen.getByText('Danh mục 01')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText('Xóa danh mục Danh mục 01'));
    await waitFor(() => {
      expect(screen.getByTestId('admin-confirm-modal')).toBeInTheDocument();
    });
    expect(calledWith('/api/admin/categories/c1', 'DELETE')).toBe(false);

    fireEvent.click(screen.getByTestId('admin-confirm-no-btn'));
    await waitFor(() => {
      expect(screen.queryByTestId('admin-confirm-modal')).toBeNull();
    });
    expect(calledWith('/api/admin/categories/c1', 'DELETE')).toBe(false);
  });

  it('Hộp xác nhận: Hủy đơn phải xác nhận trước khi gọi API hủy', async () => {
    const orderDetail = {
      order: {
        id: 'o1', orderCode: 1001, orderDisplayCode: 'DH-1001', customerName: 'Khách 01',
        customerEmail: 'khach1@example.com', customerPhone: '0900000001', subTotal: 500000,
        totalAmount: 500000, status: 'Pending', createdAt: '2026-11-08T10:00:00Z',
        paymentMethod: 'COD', items: [], statusHistories: [],
      },
    };
    mockFetchAdmin(urlStr => {
      if (urlStr.includes('/api/admin/orders/')) return orderDetail;
      if (urlStr.includes('/api/admin/orders')) return mkOrders(1);
      return undefined;
    });
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByTestId('admin-nav-orders')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('admin-nav-orders'));
    await waitFor(() => {
      expect(screen.getByText('Khách 01')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('admin-order-row-o1'));
    await waitFor(() => {
      expect(screen.getByTestId('admin-order-cancel-btn')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId('admin-order-cancel-reason'), { target: { value: 'Khách đổi ý' } });
    fireEvent.click(screen.getByTestId('admin-order-cancel-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('admin-confirm-modal')).toBeInTheDocument();
    });
    expect(screen.getByText(/Hủy đơn DH-1001/)).toBeInTheDocument();
    expect(calledWith('/api/admin/orders/o1/cancel', 'POST')).toBe(false);

    fireEvent.click(screen.getByTestId('admin-confirm-yes-btn'));
    await waitFor(() => {
      expect(calledWith('/api/admin/orders/o1/cancel', 'POST')).toBe(true);
    });
  });

  // ---------- Đợt redesign form admin + upload ảnh (drawer/modal, dropzone, validate, toast) ----------
  const openProductAddForm = async () => {
    mockFetchAdmin(urlStr => {
      if (urlStr.includes('/api/products')) return mkProducts(1);
      if (urlStr.includes('/api/admin/categories')) return mkCategories(1);
      return undefined;
    });
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByTestId('admin-nav-products')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('admin-nav-products'));
    await waitFor(() => {
      expect(screen.getByText('Sản phẩm 01')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('admin-product-add-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('admin-product-form-modal')).toBeInTheDocument();
    });
  };

  it('Form Sản phẩm mới: drawer + autofocus ô tên + dropzone có input file thật + preview + toggle', async () => {
    await openProductAddForm();
    const drawer = screen.getByTestId('admin-product-form-modal');
    expect(drawer).toHaveAttribute('role', 'dialog');
    expect(drawer).toHaveAttribute('aria-modal', 'true');
    expect(drawer).toHaveClass('sa-drawer');
    expect(drawer.closest('.sa-modal-overlay')).not.toBeNull();
    // Autofocus ô tên khi mở.
    await waitFor(() => {
      expect(screen.getByTestId('admin-product-name-input')).toHaveFocus();
    });
    // Dropzone + input file thật (visually-hidden, không display:none).
    const dropzone = screen.getByTestId('admin-product-image-dropzone');
    expect(dropzone).toBeInTheDocument();
    const fileInput = screen.getByTestId('admin-product-image-input');
    expect(fileInput).toHaveAttribute('type', 'file');
    expect(fileInput).not.toHaveStyle('display: none');
    expect(dropzone).toContainElement(fileInput);
    // Bộ đếm tên, toggle trạng thái, preview realtime, nút +/- tồn kho, link dán URL.
    expect(screen.getByTestId('admin-product-name-count')).toHaveTextContent('0/120');
    expect(screen.getByTestId('admin-product-status-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('admin-product-preview')).toBeInTheDocument();
    expect(screen.getByTestId('admin-product-stock-minus-btn')).toBeInTheDocument();
    expect(screen.getByTestId('admin-product-stock-plus-btn')).toBeInTheDocument();
    expect(screen.getByTestId('admin-product-image-link-toggle')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('admin-product-image-link-toggle'));
    expect(screen.getByTestId('admin-product-image-url-input')).toBeInTheDocument();
  });

  it('Form Sản phẩm: Lưu khi trống hiện lỗi từng ô (tên/giá/danh mục), không gọi POST, form vẫn mở', async () => {
    // Không có danh mục nào -> nút Thêm để trống categoryId, lỗi danh mục mới hiện.
    mockFetchAdmin(urlStr => {
      if (urlStr.includes('/api/products')) return mkProducts(1);
      if (urlStr.includes('/api/admin/categories')) return [];
      return undefined;
    });
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByTestId('admin-nav-products')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('admin-nav-products'));
    await waitFor(() => {
      expect(screen.getByText('Sản phẩm 01')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('admin-product-add-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('admin-product-form-modal')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('admin-product-save-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('admin-product-name-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('admin-product-name-error')).toHaveTextContent('3 đến 120 ký tự');
    expect(screen.getByTestId('admin-product-price-error')).toBeInTheDocument();
    expect(screen.getByTestId('admin-product-category-error')).toBeInTheDocument();
    expect(screen.getByTestId('admin-product-form-modal')).toBeInTheDocument();
    expect(calledWith('/api/admin/products', 'POST')).toBe(false);
  });

  it('Form Sản phẩm: gõ giá bán + giá gốc tự hiện "Giảm 20%" + tiền định dạng dấu chấm + +/- tồn kho', async () => {
    await openProductAddForm();
    fireEvent.change(screen.getByTestId('admin-product-price-input'), { target: { value: '200000' } });
    fireEvent.change(screen.getByTestId('admin-product-original-price-input'), { target: { value: '250000' } });
    await waitFor(() => {
      expect(screen.getByTestId('admin-product-discount-badge')).toHaveTextContent('Giảm 20%');
    });
    expect(screen.getByTestId('admin-product-price-input')).toHaveValue('200.000');
    expect(screen.getByTestId('admin-product-original-price-input')).toHaveValue('250.000');
    fireEvent.change(screen.getByTestId('admin-product-name-input'), { target: { value: 'Son kem' } });
    expect(screen.getByTestId('admin-product-name-count')).toHaveTextContent('7/120');
    expect(screen.getByTestId('admin-product-preview')).toHaveTextContent('Son kem');
    fireEvent.click(screen.getByTestId('admin-product-stock-plus-btn'));
    expect(screen.getByTestId('admin-product-stock-input')).toHaveValue('1');
    fireEvent.click(screen.getByTestId('admin-product-stock-minus-btn'));
    expect(screen.getByTestId('admin-product-stock-input')).toHaveValue('0');
    fireEvent.click(screen.getByTestId('admin-product-stock-minus-btn'));
    expect(screen.getByTestId('admin-product-stock-input')).toHaveValue('0');
  });

  it('Form Sản phẩm: Lưu hợp lệ gọi POST kèm imageUrls + toast thành công + đóng form', async () => {
    await openProductAddForm();
    fireEvent.change(screen.getByTestId('admin-product-name-input'), { target: { value: 'Son kem mới' } });
    fireEvent.click(screen.getByTestId('admin-product-category-select'));
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Tìm danh mục...')).toBeInTheDocument();
    });
    fireEvent.click(within(screen.getByTestId('admin-product-form')).getByRole('option', { name: 'Danh mục 01' }));
    fireEvent.change(screen.getByTestId('admin-product-price-input'), { target: { value: '250000' } });
    fireEvent.change(screen.getByTestId('admin-product-stock-input'), { target: { value: '5' } });
    fireEvent.click(screen.getByTestId('admin-product-save-btn'));
    await waitFor(() => {
      expect(calledWith('/api/admin/products', 'POST')).toBe(true);
    });
    const postCall = fetchCalls().find(([url, init]) => String(url).includes('/api/admin/products') && (init as { method?: string } | undefined)?.method === 'POST');
    expect(postCall).toBeDefined();
    const body = JSON.parse(String((postCall as [unknown, { body: string }])[1].body));
    expect(body.name).toBe('Son kem mới');
    expect(body.price).toBe(250000);
    expect(body.stock).toBe(5);
    expect(body.imageUrls).toEqual([]);
    expect(body.imageUrl).toBe('');
    await waitFor(() => {
      expect(screen.getByTestId('admin-toast')).toHaveTextContent('Đã thêm sản phẩm thành công.');
    });
    expect(screen.queryByTestId('admin-product-form-modal')).toBeNull();
  });

  it('Form Sản phẩm: đã sửa mà bấm Hủy thì hỏi "chưa lưu" (Ở lại / Thoát)', async () => {
    await openProductAddForm();
    fireEvent.change(screen.getByTestId('admin-product-name-input'), { target: { value: 'Son mới' } });
    fireEvent.click(screen.getByTestId('admin-product-cancel-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('admin-confirm-modal')).toBeInTheDocument();
    });
    expect(screen.getByText('Bạn có thay đổi chưa lưu. Thoát không?')).toBeInTheDocument();
    expect(screen.getByTestId('admin-confirm-no-btn')).toHaveTextContent('Ở lại');
    expect(screen.getByTestId('admin-confirm-yes-btn')).toHaveTextContent('Thoát');
    fireEvent.click(screen.getByTestId('admin-confirm-no-btn'));
    await waitFor(() => {
      expect(screen.queryByTestId('admin-confirm-modal')).toBeNull();
    });
    expect(screen.getByTestId('admin-product-form-modal')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('admin-product-cancel-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('admin-confirm-modal')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('admin-confirm-yes-btn'));
    await waitFor(() => {
      expect(screen.queryByTestId('admin-product-form-modal')).toBeNull();
    });
  });

  it('Form Sản phẩm: bấm ESC khi chưa sửa thì đóng luôn, không hỏi', async () => {
    await openProductAddForm();
    fireEvent.keyDown(screen.getByTestId('admin-product-name-input'), { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByTestId('admin-product-form-modal')).toBeNull();
    });
    expect(screen.queryByTestId('admin-confirm-modal')).toBeNull();
  });

  it('Form Sản phẩm: dán link ảnh thêm thumbnail, đặt ảnh chính đổi thứ tự, xóa ảnh', async () => {
    await openProductAddForm();
    const form = screen.getByTestId('admin-product-form');
    fireEvent.click(screen.getByTestId('admin-product-image-link-toggle'));
    fireEvent.change(screen.getByTestId('admin-product-image-url-input'), { target: { value: 'https://example.com/a.jpg' } });
    fireEvent.click(within(form).getByText('Thêm'));
    fireEvent.click(screen.getByTestId('admin-product-image-link-toggle'));
    fireEvent.change(screen.getByTestId('admin-product-image-url-input'), { target: { value: 'https://example.com/b.jpg' } });
    fireEvent.click(within(form).getByText('Thêm'));
    await waitFor(() => {
      expect(screen.getByTestId('admin-product-image-thumb-0')).toBeInTheDocument();
    });
    expect(screen.getByTestId('admin-product-image-thumb-1')).toBeInTheDocument();
    expect(screen.getByText('Ảnh chính')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('admin-product-image-set-main-btn-1'));
    expect(within(screen.getByTestId('admin-product-image-thumb-0')).getByRole('img')).toHaveAttribute('src', 'https://example.com/b.jpg');
    fireEvent.click(screen.getByTestId('admin-product-image-remove-btn-0'));
    expect(screen.queryByTestId('admin-product-image-thumb-1')).toBeNull();
    expect(screen.getByTestId('admin-product-image-thumb-0')).toBeInTheDocument();
  });

  it('Form Danh mục: slug tự sinh từ tên, sửa tay slug thì dừng tự sinh; lưu gọi POST kèm slug + iconUrl', async () => {
    mockFetchAdmin(urlStr => {
      if (urlStr.includes('/api/admin/categories')) return mkCategories(1);
      return undefined;
    });
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByTestId('admin-nav-categories')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('admin-nav-categories'));
    await waitFor(() => {
      expect(screen.getByText('Danh mục 01')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('admin-category-add-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('admin-category-form-modal')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId('admin-category-name-input'), { target: { value: 'Son Môi Mới' } });
    expect(screen.getByTestId('admin-category-slug-input')).toHaveValue('son-moi-moi');
    fireEvent.change(screen.getByTestId('admin-category-slug-input'), { target: { value: 'son-moi-rieng' } });
    fireEvent.change(screen.getByTestId('admin-category-name-input'), { target: { value: 'Son Môi Khác' } });
    expect(screen.getByTestId('admin-category-slug-input')).toHaveValue('son-moi-rieng');
    fireEvent.click(screen.getByTestId('admin-category-image-link-toggle'));
    fireEvent.change(screen.getByTestId('admin-category-image-url-input'), { target: { value: 'https://example.com/cat.jpg' } });
    fireEvent.click(within(screen.getByTestId('admin-category-form')).getByText('Thêm'));
    await waitFor(() => {
      expect(screen.getByTestId('admin-category-image-thumb')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('admin-category-save-btn'));
    await waitFor(() => {
      expect(calledWith('/api/admin/categories', 'POST')).toBe(true);
    });
    const postCall = fetchCalls().find(([url, init]) => String(url).includes('/api/admin/categories') && (init as { method?: string } | undefined)?.method === 'POST');
    expect(postCall).toBeDefined();
    const body = JSON.parse(String((postCall as [unknown, { body: string }])[1].body));
    expect(body.slug).toBe('son-moi-rieng');
    expect(body.iconUrl).toBe('https://example.com/cat.jpg');
    await waitFor(() => {
      expect(screen.getByTestId('admin-toast')).toHaveTextContent('Đã thêm danh mục thành công.');
    });
  });

  it('Form Khuyến mãi: mã tự viết hoa + tạo mã ngẫu nhiên + segmented % hiện Giảm tối đa + expiry kiểu date', async () => {
    mockFetchAdmin();
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByTestId('admin-nav-promotions')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('admin-nav-promotions'));
    await waitFor(() => {
      expect(screen.getByTestId('admin-promo-add-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('admin-promo-add-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('admin-promo-form-modal')).toBeInTheDocument();
    });
    const codeInput = screen.getByTestId('admin-promo-code-input');
    fireEvent.change(codeInput, { target: { value: 'sale10' } });
    expect(codeInput).toHaveValue('SALE10');
    fireEvent.click(screen.getByTestId('admin-promo-generate-code-btn'));
    expect((codeInput as HTMLInputElement).value).toMatch(/^[A-Z0-9]{8}$/);
    // Mặc định loại % → ô Giảm tối đa hiện; chuyển Cố định → ẩn; quay lại % → hiện.
    expect(screen.getByTestId('admin-promo-max-discount-input')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('admin-promo-discount-type-fixed'));
    expect(screen.queryByTestId('admin-promo-max-discount-input')).toBeNull();
    fireEvent.click(screen.getByTestId('admin-promo-discount-type-percent'));
    expect(screen.getByTestId('admin-promo-max-discount-input')).toBeInTheDocument();
    expect(screen.getByTestId('admin-promo-expiry-input')).toHaveAttribute('type', 'date');
    expect(screen.getByTestId('admin-promo-status-toggle')).toBeInTheDocument();
    // Lưu khi thiếu giá trị giảm → lỗi, không gọi POST.
    fireEvent.click(screen.getByTestId('admin-promo-save-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('admin-promo-value-error')).toBeInTheDocument();
    });
    expect(calledWith('/api/admin/promotions', 'POST')).toBe(false);
  });

});
