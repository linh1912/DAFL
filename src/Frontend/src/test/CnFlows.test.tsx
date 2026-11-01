import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';

/**
 * Test tích hợp các luồng CN mới ở tầng App:
 * - CN-02 E3: token hết hạn → session-expired-notice ở màn hình đăng nhập.
 * - CN-04: phân trang server 12/trang + lỗi khoảng giá.
 * - CN-08: xem chi tiết đơn + hủy đơn qua dialog.
 * - CN-03: đổi mật khẩu + sổ địa chỉ ở trang Hồ sơ.
 */

const respond = (body: unknown, status = 200) =>
  Promise.resolve({ status, json: () => Promise.resolve(body) } as Response);

const makeProduct = (n: number) => ({
  id: `prod-p${n}`,
  categoryId: 'cat-1',
  categoryName: 'Chăm sóc da',
  name: `Sản phẩm phân trang ${n}`,
  slug: `san-pham-phan-trang-${n}`,
  description: 'Mô tả sản phẩm phân trang',
  price: 100000 + n * 1000,
  availableStock: 5,
  imageUrl: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=600',
  rating: 5,
  reviewCount: 3,
});

const authUser = {
  id: 'user-cn',
  email: 'cn@dafl.vn',
  fullName: 'Người dùng CN',
  phoneNumber: '0912345678',
  address: '',
  role: 'Customer',
  sessionId: 'session-cn',
  hasPassword: true,
};

describe('CN Flows - App integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    localStorage.clear();
  });

  it('TC_CN_01: Expired token at boot clears the session and shows session-expired-notice on the login page (CN-02 E3)', async () => {
    localStorage.setItem('dafl_token', 'jwt-expired');
    globalThis.fetch = vi.fn((url: any) => {
      const urlStr = typeof url === 'string' ? url : url.url;
      // /me trả data=null → token hết hạn/không hợp lệ.
      if (urlStr.includes('/api/auth/me')) return respond({ success: true, data: null });
      if (urlStr.includes('/api/auth/social/config')) {
        return respond({ success: true, data: { googleEnabled: false, facebookEnabled: false, mockEnabled: true } });
      }
      return respond({ success: true, data: [] });
    });

    render(
      <MemoryRouter initialEntries={['/orders']}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByTestId('session-expired-notice', {}, { timeout: 5000 })).toHaveTextContent(
      'Phiên đăng nhập đã hết hạn'
    );
    expect(localStorage.getItem('dafl_token')).toBeNull();
    expect(screen.getByTestId('login-form')).toBeInTheDocument();
  });

  it('TC_CN_02: Catalog uses real server pagination with 12 products per page (CN-04)', async () => {
    const page1 = Array.from({ length: 13 }, (_, i) => makeProduct(i + 1)); // 12 hiện + 1 thăm dò
    const page2 = [makeProduct(14), makeProduct(15)];
    globalThis.fetch = vi.fn((url: any) => {
      const urlStr = typeof url === 'string' ? url : url.url;
      if (urlStr.includes('/api/auth/me')) return respond({ success: false, data: null });
      if (urlStr.includes('/api/products')) {
        if (urlStr.includes('page=2')) return respond({ success: true, data: page2 });
        return respond({ success: true, data: page1 });
      }
      return respond({ success: true, data: [] });
    });

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );

    // Trang 1: đúng 12 thẻ sản phẩm.
    expect(await screen.findByTestId('product-card-prod-p1')).toBeInTheDocument();
    expect(screen.getByTestId('product-card-prod-p12')).toBeInTheDocument();
    expect(screen.queryByTestId('product-card-prod-p13')).not.toBeInTheDocument();
    expect(screen.getByTestId('catalog-result-count')).toBeInTheDocument();
    expect(screen.getByTestId('pagination-prev-btn')).toBeDisabled();

    // Sang trang 2: chỉ còn 2 sản phẩm, nút Trang sau bị khóa.
    fireEvent.click(screen.getByTestId('pagination-next-btn'));
    expect(await screen.findByTestId('product-card-prod-p14')).toBeInTheDocument();
    expect(screen.getByTestId('product-card-prod-p15')).toBeInTheDocument();
    expect(screen.queryByTestId('product-card-prod-p1')).not.toBeInTheDocument();
    expect(screen.getByTestId('pagination-next-btn')).toBeDisabled();
    expect(screen.getByTestId('pagination-page-2')).toBeInTheDocument();
  });

  it('TC_CN_03: Price range with from > to shows price-filter-error and does not apply the filter (CN-04)', async () => {
    const fetchMock = vi.fn((url: any) => {
      const urlStr = typeof url === 'string' ? url : url.url;
      if (urlStr.includes('/api/auth/me')) return respond({ success: false, data: null });
      if (urlStr.includes('/api/products')) return respond({ success: true, data: [makeProduct(1)] });
      return respond({ success: true, data: [] });
    });
    globalThis.fetch = fetchMock;

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByTestId('product-card-prod-p1')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('price-from-input'), { target: { value: '500000' } });
    fireEvent.change(screen.getByTestId('price-to-input'), { target: { value: '100000' } });

    expect(
      await screen.findByTestId('price-filter-error', {}, { timeout: 3000 })
    ).toHaveTextContent('Giá bắt đầu không được lớn hơn giá đến');

    // Không có request nào mang priceFrom=500000 (bộ lọc không được áp dụng).
    const badCall = fetchMock.mock.calls.find(([url]: any[]) =>
      String(typeof url === 'string' ? url : url.url).includes('priceFrom=500000')
    );
    expect(badCall).toBeUndefined();
  });

  it('TC_CN_04: Order detail shows the cancel dialog and cancelling succeeds (CN-08)', async () => {
    localStorage.setItem('dafl_token', 'jwt-cn');
    const order = {
      id: 'order-cn-1',
      orderCode: 202611010001,
      orderDisplayCode: 'DH20261101-0001',
      customerName: 'Người dùng CN',
      customerEmail: 'cn@dafl.vn',
      customerPhone: '0912345678',
      shippingAddress: 'Số 1 Đại Cồ Việt, Hà Nội',
      subTotal: 450000,
      discountAmount: 0,
      voucherCode: null,
      totalAmount: 475000,
      status: 'Paid',
      paymentMethod: 'COD',
      shippingFee: 25000,
      statusLabel: 'Chờ xác nhận',
      cancelReason: null,
      createdAt: '2026-11-01T08:00:00.000Z',
      checkoutUrl: null,
      items: [
        {
          id: 'oi-1',
          productId: 'prod-p1',
          productName: 'Sản phẩm phân trang 1',
          productImageUrl: '',
          unitPrice: 450000,
          quantity: 1,
        },
      ],
      statusHistories: [
        { status: 1, note: 'Đơn hàng đã được tạo', timestamp: '2026-11-01T08:00:00.000Z' },
      ],
    };

    const fetchMock = vi.fn((url: any, init?: any) => {
      const urlStr = typeof url === 'string' ? url : url.url;
      if (urlStr.includes('/api/auth/me')) return respond({ success: true, data: authUser });
      if (urlStr.includes('/api/orders/history')) return respond({ success: true, data: [order] });
      if (urlStr.includes('/api/orders/order-cn-1/cancel')) {
        return respond({ success: true, data: { ...order, status: 'Cancelled', statusLabel: 'Đã hủy' } });
      }
      if (urlStr.includes('/api/orders/order-cn-1')) return respond({ success: true, data: order });
      if (urlStr.includes('/api/orders')) return respond({ success: true, data: [order] });
      if (urlStr.includes('/api/cart')) {
        return respond({ success: true, data: { id: 'cart-1', items: [], totalQuantity: 0, totalAmount: 0, notice: null } });
      }
      return respond({ success: true, data: [] });
    });
    globalThis.fetch = fetchMock;

    render(
      <MemoryRouter initialEntries={['/orders']}>
        <App />
      </MemoryRouter>
    );

    // Danh sách đơn có testid theo mã hiển thị DH...
    expect(await screen.findByTestId('orders-list')).toBeInTheDocument();
    expect(screen.getByTestId('order-item-DH20261101-0001')).toBeInTheDocument();
    expect(screen.getByTestId('order-status-filter')).toBeInTheDocument();

    // Mở chi tiết → thấy timeline + nút Hủy vì StatusLabel = "Chờ xác nhận".
    fireEvent.click(screen.getByTestId('order-detail-btn-DH20261101-0001'));
    expect(await screen.findByTestId('order-detail-view')).toBeInTheDocument();
    expect(screen.getByTestId('order-detail-status')).toHaveTextContent('Chờ xác nhận');
    expect(screen.getByTestId('order-timeline')).toBeInTheDocument();
    expect(screen.getByTestId('order-shipping-info')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('cancel-order-btn'));
    expect(await screen.findByTestId('cancel-order-dialog')).toBeInTheDocument();

    // Chọn lý do "Khác" + nhập lý do riêng rồi xác nhận.
    fireEvent.change(screen.getByTestId('cancel-reason-select'), { target: { value: 'Khác' } });
    fireEvent.change(screen.getByTestId('cancel-reason-input'), { target: { value: 'Tôi muốn đổi sản phẩm khác' } });
    fireEvent.click(screen.getByTestId('cancel-confirm-btn'));

    await waitFor(() => {
      const cancelCall = fetchMock.mock.calls.find(([url]: any[]) =>
        String(typeof url === 'string' ? url : url.url).includes('/api/orders/order-cn-1/cancel')
      );
      expect(cancelCall).toBeTruthy();
      expect(JSON.parse(cancelCall![1].body)).toEqual({ reason: 'Tôi muốn đổi sản phẩm khác' });
    });
    expect(await screen.findByTestId('cancel-success-msg')).toHaveTextContent('Hủy đơn thành công');
  });

  it('TC_CN_05: Profile save and change password post to the CN endpoints (CN-03)', async () => {
    localStorage.setItem('dafl_token', 'jwt-cn');
    const fetchMock = vi.fn((url: any, init?: any) => {
      const urlStr = typeof url === 'string' ? url : url.url;
      if (urlStr.includes('/api/auth/me')) return respond({ success: true, data: authUser });
      if (urlStr.includes('/api/auth/profile')) {
        return respond({ success: true, data: { ...authUser, fullName: 'Tên Đã Đổi' }, message: 'Cập nhật thành công' });
      }
      if (urlStr.includes('/api/auth/change-password')) {
        return respond({ success: true, data: null, message: 'Đổi mật khẩu thành công' });
      }
      if (urlStr.includes('/api/addresses')) return respond({ success: true, data: [] });
      if (urlStr.includes('/api/cart')) {
        return respond({ success: true, data: { id: 'cart-1', items: [], totalQuantity: 0, totalAmount: 0, notice: null } });
      }
      return respond({ success: true, data: [] });
    });
    globalThis.fetch = fetchMock;

    render(
      <MemoryRouter initialEntries={['/profile']}>
        <App />
      </MemoryRouter>
    );

    // Form hồ sơ CN-03.1: email bị khóa, tên/SĐT sửa được.
    expect(await screen.findByTestId('profile-form')).toBeInTheDocument();
    expect(screen.getByTestId('profile-email-input')).toBeDisabled();
    fireEvent.change(screen.getByTestId('profile-name-input'), { target: { value: 'Tên Đã Đổi' } });
    fireEvent.click(screen.getByTestId('profile-save-btn'));
    expect(await screen.findByTestId('profile-success-msg')).toHaveTextContent('Cập nhật thành công');

    // Đổi mật khẩu: mật khẩu mới trùng mật khẩu cũ → lỗi client, không gọi API.
    fireEvent.change(screen.getByTestId('change-password-current-input'), { target: { value: 'Oldpass1!' } });
    fireEvent.change(screen.getByTestId('change-password-new-input'), { target: { value: 'Oldpass1!' } });
    fireEvent.change(screen.getByTestId('change-password-confirm-input'), { target: { value: 'Oldpass1!' } });
    fireEvent.click(screen.getByTestId('change-password-submit-btn'));
    expect(screen.getByTestId('change-password-new-error')).toHaveTextContent(
      'Mật khẩu mới không được trùng với mật khẩu cũ'
    );

    // Mật khẩu mới hợp lệ → gọi API và báo thành công.
    fireEvent.change(screen.getByTestId('change-password-new-input'), { target: { value: 'Newpass1!' } });
    fireEvent.change(screen.getByTestId('change-password-confirm-input'), { target: { value: 'Newpass1!' } });
    fireEvent.click(screen.getByTestId('change-password-submit-btn'));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]: any[]) =>
        String(typeof url === 'string' ? url : url.url).includes('/api/auth/change-password')
      );
      expect(call).toBeTruthy();
      expect(JSON.parse(call![1].body)).toEqual({
        currentPassword: 'Oldpass1!',
        newPassword: 'Newpass1!',
        confirmNewPassword: 'Newpass1!',
      });
    });
    expect(await screen.findByTestId('change-password-success')).toBeInTheDocument();
  });

  it('TC_CN_06: Address book on the profile page creates an address with string codes (CN-03.3)', async () => {
    localStorage.setItem('dafl_token', 'jwt-cn');
    const created = {
      id: 'addr-cn-1',
      recipientName: 'Người dùng CN',
      phone: '0912345678',
      provinceCode: '1',
      provinceName: 'Thành phố Hà Nội',
      districtCode: '1',
      districtName: 'Quận Ba Đình',
      wardCode: '1',
      wardName: 'Phường Phúc Xá',
      detailAddress: 'Số 1 Đại Cồ Việt',
      note: null,
      isDefault: true,
    };
    let addressList: any[] = [];
    const fetchMock = vi.fn((url: any, init?: any) => {
      const urlStr = typeof url === 'string' ? url : url.url;
      const method = (init?.method || 'GET').toUpperCase();
      if (urlStr.includes('/api/auth/me')) return respond({ success: true, data: authUser });
      if (urlStr.includes('/api/addresses')) {
        if (method === 'POST') {
          addressList = [created];
          return respond({ success: true, data: created, message: 'Thêm địa chỉ thành công' });
        }
        return respond({ success: true, data: addressList });
      }
      if (urlStr.includes('/api/cart')) {
        return respond({ success: true, data: { id: 'cart-1', items: [], totalQuantity: 0, totalAmount: 0, notice: null } });
      }
      return respond({ success: true, data: [] });
    });
    globalThis.fetch = fetchMock;

    render(
      <MemoryRouter initialEntries={['/profile']}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByTestId('address-book-list')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('address-add-btn'));
    expect(screen.getByTestId('address-form')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('address-recipient-input'), { target: { value: 'Người dùng CN' } });
    fireEvent.change(screen.getByTestId('address-phone-input'), { target: { value: '0912345678' } });
    fireEvent.change(screen.getByTestId('address-province-select'), { target: { value: '1' } });
    fireEvent.change(screen.getByTestId('address-district-select'), { target: { value: '1' } });
    fireEvent.change(screen.getByTestId('address-ward-select'), { target: { value: '1' } });
    fireEvent.change(screen.getByTestId('address-detail-input'), { target: { value: 'Số 1 Đại Cồ Việt' } });
    fireEvent.click(screen.getByTestId('address-save-btn'));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, init]: any[]) =>
        String(typeof url === 'string' ? url : url.url).includes('/api/addresses') &&
        (init?.method || '').toUpperCase() === 'POST'
      );
      expect(call).toBeTruthy();
      const body = JSON.parse(call![1].body);
      // Mã địa giới gửi dạng STRING theo AddressDto của BE.
      expect(body.provinceCode).toBe('1');
      expect(body.districtCode).toBe('1');
      expect(body.wardCode).toBe('1');
      expect(body.recipientName).toBe('Người dùng CN');
    });

    // Địa chỉ mới xuất hiện trong sổ kèm huy hiệu Mặc định.
    expect(await screen.findByTestId('address-item-addr-cn-1')).toBeInTheDocument();
    expect(screen.getByTestId('address-default-badge-addr-cn-1')).toBeInTheDocument();
  });
});
