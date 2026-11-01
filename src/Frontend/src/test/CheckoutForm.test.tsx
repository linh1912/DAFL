import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CheckoutForm } from '../components/checkout/CheckoutForm';
import { User, UserAddress } from '../types';

describe('Checkout & Order Module - CheckoutForm Component', () => {
  const mockUser: User = {
    id: 'user-1',
    email: 'demo@dafl.vn',
    fullName: 'Nguyễn Văn Demo',
    phoneNumber: '0987654321',
    address: 'Số 1 Đại Cồ Việt, Hà Nội',
    role: 'Customer',
    sessionId: 'session-1',
  };

  const defaultProps = {
    customerName: 'Nguyễn Văn Demo',
    setCustomerName: vi.fn(),
    customerEmail: 'demo@dafl.vn',
    setCustomerEmail: vi.fn(),
    customerPhone: '0987654321',
    setCustomerPhone: vi.fn(),
    shippingAddress: 'Số 1 Đại Cồ Việt, Hà Nội',
    setShippingAddress: vi.fn(),
    finalTotal: 450000,
    isCheckingOut: false,
    onSubmit: vi.fn((e) => e.preventDefault()),
  };

  /** Chọn đủ 3 cấp: Hà Nội (1) → Quận Ba Đình (1) → Phường Phúc Xá (1). */
  const selectFullAddress = () => {
    fireEvent.change(screen.getByTestId('shipping-province-select'), { target: { value: '1' } });
    fireEvent.change(screen.getByTestId('shipping-district-select'), { target: { value: '1' } });
    fireEvent.change(screen.getByTestId('shipping-ward-select'), { target: { value: '1' } });
  };

  // ==========================================
  // Positive Path Test Cases (70%)
  // ==========================================
  it('TC_ORDER_01: Should render the v4 shipping form with prefilled profile values', () => {
    render(<CheckoutForm {...defaultProps} />);

    expect(screen.getByTestId('checkout-form')).toBeInTheDocument();
    expect(screen.getByTestId('shipping-recipient-input')).toHaveValue('Nguyễn Văn Demo');
    expect(screen.getByTestId('shipping-email-input')).toHaveValue('demo@dafl.vn');
    expect(screen.getByTestId('shipping-phone-input')).toHaveValue('0987654321');
    // Địa chỉ chi tiết được prefill từ hồ sơ (prop shippingAddress).
    expect(screen.getByTestId('shipping-detail-input')).toHaveValue('Số 1 Đại Cồ Việt, Hà Nội');
    expect(screen.getByTestId('shipping-province-select')).toBeInTheDocument();
    expect(screen.getByTestId('shipping-district-select')).toBeDisabled();
    expect(screen.getByTestId('shipping-ward-select')).toBeDisabled();
    expect(screen.getByTestId('shipping-note-input')).toBeInTheDocument();
    expect(screen.getByTestId('cart-checkout-btn')).toBeInTheDocument();
  });

  it('TC_ORDER_02: Should update input values when user types', () => {
    const setCustomerName = vi.fn();
    const setCustomerPhone = vi.fn();

    render(
      <CheckoutForm
        {...defaultProps}
        setCustomerName={setCustomerName}
        setCustomerPhone={setCustomerPhone}
      />
    );

    fireEvent.change(screen.getByTestId('shipping-recipient-input'), { target: { value: 'Trần Thị B' } });
    expect(setCustomerName).toHaveBeenCalledWith('Trần Thị B');

    fireEvent.change(screen.getByTestId('shipping-phone-input'), { target: { value: '0912345678' } });
    expect(setCustomerPhone).toHaveBeenCalledWith('0912345678');
  });

  it('TC_ORDER_03: Should submit with a structured shipping block when the form is valid', () => {
    const onSubmit = vi.fn((e: React.FormEvent, _values?: unknown) => e.preventDefault());
    render(<CheckoutForm {...defaultProps} onSubmit={onSubmit} />);

    selectFullAddress();
    fireEvent.click(screen.getByTestId('cart-checkout-btn'));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const values = onSubmit.mock.calls[0][1] as any;
    expect(values.customerName).toBe('Nguyễn Văn Demo');
    expect(values.shippingAddress).toBe(
      'Số 1 Đại Cồ Việt, Hà Nội, Phường Phúc Xá, Quận Ba Đình, Thành phố Hà Nội'
    );
    expect(values.shipping).toEqual({
      recipientName: 'Nguyễn Văn Demo',
      phone: '0987654321',
      email: 'demo@dafl.vn',
      provinceCode: 1,
      provinceName: 'Thành phố Hà Nội',
      districtCode: 1,
      districtName: 'Quận Ba Đình',
      wardCode: 1,
      wardName: 'Phường Phúc Xá',
      detailAddress: 'Số 1 Đại Cồ Việt, Hà Nội',
      note: undefined,
      addressBookId: null,
      saveAsDefault: false,
    });
  });

  it('TC_ORDER_04: Should cascade-reset district and ward when the province changes', () => {
    render(<CheckoutForm {...defaultProps} />);

    const provinceSelect = screen.getByTestId('shipping-province-select') as HTMLSelectElement;
    const districtSelect = screen.getByTestId('shipping-district-select') as HTMLSelectElement;
    const wardSelect = screen.getByTestId('shipping-ward-select') as HTMLSelectElement;

    fireEvent.change(provinceSelect, { target: { value: '1' } });
    expect(districtSelect).not.toBeDisabled();
    // Quận của Hà Nội xuất hiện trong select quận.
    expect(Array.from(districtSelect.options).some(o => o.text === 'Quận Ba Đình')).toBe(true);

    fireEvent.change(districtSelect, { target: { value: '1' } });
    expect(wardSelect).not.toBeDisabled();
    fireEvent.change(wardSelect, { target: { value: '1' } });
    expect(wardSelect.value).toBe('1');

    // Đổi sang Thành phố Hồ Chí Minh (79) → quận + phường bị đặt lại.
    fireEvent.change(provinceSelect, { target: { value: '79' } });
    expect(districtSelect.value).toBe('');
    expect(wardSelect.value).toBe('');
    expect(wardSelect).toBeDisabled();
    expect(Array.from(districtSelect.options).some(o => o.text === 'Quận Ba Đình')).toBe(false);
  });

  it('TC_ORDER_05: Should submit a saved address from the address book without the new-address form', () => {
    const saved: UserAddress[] = [
      {
        id: 'addr-1',
        label: 'Nhà',
        recipientName: 'Nguyễn Văn Demo',
        phone: '0987654321',
        provinceCode: 1,
        provinceName: 'Thành phố Hà Nội',
        districtCode: 1,
        districtName: 'Quận Ba Đình',
        wardCode: 1,
        wardName: 'Phường Phúc Xá',
        detailAddress: 'Số 1 Đại Cồ Việt',
        isDefault: true,
      },
    ];
    const onSubmit = vi.fn((e: React.FormEvent, _values?: unknown) => e.preventDefault());
    render(<CheckoutForm {...defaultProps} user={mockUser} savedAddresses={saved} onSubmit={onSubmit} />);

    expect(screen.getByTestId('shipping-address-list')).toBeInTheDocument();
    expect(screen.getByTestId('shipping-address-option-addr-1')).toBeInTheDocument();
    // Đang dùng địa chỉ đã lưu → form nhập mới ẩn.
    expect(screen.queryByTestId('shipping-new-address-form')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('cart-checkout-btn'));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const values = onSubmit.mock.calls[0][1] as any;
    expect(values.shipping.addressBookId).toBe('addr-1');
    expect(values.shipping.recipientName).toBe('Nguyễn Văn Demo');
    expect(values.shippingAddress).toBe('Số 1 Đại Cồ Việt, Phường Phúc Xá, Quận Ba Đình, Thành phố Hà Nội');
  });

  it('TC_ORDER_06: Should pass saveAsDefault=true when the checkbox is ticked', () => {
    const onSubmit = vi.fn((e: React.FormEvent, _values?: unknown) => e.preventDefault());
    render(<CheckoutForm {...defaultProps} user={mockUser} savedAddresses={[]} onSubmit={onSubmit} />);

    const checkbox = screen.getByTestId('shipping-save-default-checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);

    selectFullAddress();
    fireEvent.click(screen.getByTestId('cart-checkout-btn'));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const values = onSubmit.mock.calls[0][1] as any;
    expect(values.shipping.saveAsDefault).toBe(true);
    expect(values.shipping.addressBookId).toBeNull();
  });

  // ==========================================
  // Negative Path Test Cases (30%)
  // ==========================================
  it('TC_ORDER_07: Should disable submit button and display loading indicator while isCheckingOut is true', () => {
    render(<CheckoutForm {...defaultProps} isCheckingOut={true} />);

    const submitBtn = screen.getByTestId('cart-checkout-btn');
    expect(submitBtn).toBeDisabled();
    expect(submitBtn).toHaveTextContent('Đang xử lý đơn hàng...');
  });

  it('TC_ORDER_08: Should block ordering with per-field red errors when shipping info is incomplete (S17)', () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <CheckoutForm
        {...defaultProps}
        customerName=""
        customerEmail=""
        customerPhone=""
        shippingAddress=""
        onSubmit={onSubmit}
      />
    );

    // Chuẩn validate v3.1/v4: không dùng popup mặc định của trình duyệt.
    expect(screen.getByTestId('checkout-form')).toHaveAttribute('novalidate');
    expect(screen.getByTestId('shipping-recipient-input')).not.toBeRequired();
    expect(screen.getByTestId('shipping-email-input')).not.toBeRequired();
    expect(screen.getByTestId('shipping-phone-input')).not.toBeRequired();

    fireEvent.click(screen.getByTestId('cart-checkout-btn'));

    expect(screen.getByTestId('shipping-recipient-error')).toHaveTextContent('Vui lòng nhập họ tên người nhận.');
    expect(screen.getByTestId('shipping-email-error')).toHaveTextContent('Vui lòng nhập email.');
    expect(screen.getByTestId('shipping-phone-error')).toHaveTextContent('Vui lòng nhập số điện thoại.');
    expect(screen.getByTestId('shipping-province-error')).toHaveTextContent('Vui lòng chọn Tỉnh / Thành phố.');
    expect(screen.getByTestId('shipping-district-error')).toHaveTextContent('Vui lòng chọn Quận / Huyện.');
    expect(screen.getByTestId('shipping-ward-error')).toHaveTextContent('Vui lòng chọn Phường / Xã.');
    expect(screen.getByTestId('shipping-detail-error')).toHaveTextContent('Vui lòng nhập địa chỉ chi tiết.');
    // Không gọi đặt hàng khi thông tin giao hàng chưa hợp lệ.
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('TC_ORDER_09: Should reject an invalid Vietnamese phone number with the fixed spec message', () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(<CheckoutForm {...defaultProps} customerPhone="12345" onSubmit={onSubmit} />);

    selectFullAddress();
    fireEvent.click(screen.getByTestId('cart-checkout-btn'));

    expect(screen.getByTestId('shipping-phone-error')).toHaveTextContent(
      'Số điện thoại phải gồm 10 chữ số và bắt đầu bằng số 0.'
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('TC_ORDER_10: Should trim whitespace and pass cleaned values plus shipping block to onSubmit', () => {
    const onSubmit = vi.fn((e: React.FormEvent, _values?: unknown) => e.preventDefault());
    render(
      <CheckoutForm
        {...defaultProps}
        customerName="  Nguyễn Văn Demo  "
        customerEmail="  DEMO@dafl.vn "
        customerPhone=" 0987654321 "
        shippingAddress="  Số 1 Đại Cồ Việt, Hà Nội  "
        onSubmit={onSubmit}
      />
    );

    selectFullAddress();
    fireEvent.click(screen.getByTestId('cart-checkout-btn'));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const values = onSubmit.mock.calls[0][1] as any;
    expect(values.customerName).toBe('Nguyễn Văn Demo');
    expect(values.customerEmail).toBe('demo@dafl.vn');
    expect(values.customerPhone).toBe('0987654321');
    expect(values.shipping.detailAddress).toBe('Số 1 Đại Cồ Việt, Hà Nội');
    expect(values.shipping.recipientName).toBe('Nguyễn Văn Demo');
  });

  it('TC_ORDER_11: Should open the new-address form from the address book view', () => {
    const saved: UserAddress[] = [
      {
        id: 'addr-9',
        recipientName: 'Trần Thị B',
        phone: '0912345678',
        provinceCode: 79,
        provinceName: 'Thành phố Hồ Chí Minh',
        districtCode: 760,
        districtName: 'Quận 1',
        wardCode: 26734,
        wardName: 'Phường Bến Nghé',
        detailAddress: 'Số 2 Lê Lợi',
        isDefault: true,
      },
    ];
    render(<CheckoutForm {...defaultProps} user={mockUser} savedAddresses={saved} />);

    expect(screen.queryByTestId('shipping-new-address-form')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('shipping-new-address-btn'));
    expect(screen.getByTestId('shipping-new-address-form')).toBeInTheDocument();
    expect(screen.getByTestId('shipping-province-select')).toBeInTheDocument();
  });

  it('TC_ORDER_12: Order note is limited to 200 characters with a live counter (CN-07.3)', () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(<CheckoutForm {...defaultProps} onSubmit={onSubmit} />);

    expect(screen.getByTestId('shipping-note-counter')).toHaveTextContent('0/200');

    fireEvent.change(screen.getByTestId('shipping-note-input'), {
      target: { value: 'x'.repeat(201) },
    });
    expect(screen.getByTestId('shipping-note-counter')).toHaveTextContent('201/200');

    selectFullAddress();
    fireEvent.click(screen.getByTestId('cart-checkout-btn'));

    expect(screen.getByTestId('shipping-note-error')).toHaveTextContent(
      'Ghi chú đơn hàng tối đa 200 ký tự.'
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('TC_ORDER_13: Payment method selection is passed to onSubmit; COD is blocked above 2,000,000đ (CN-07 + Mục 11.3)', () => {
    const onSubmit = vi.fn((e: React.FormEvent, _values?: unknown) => e.preventDefault());
    const first = render(<CheckoutForm {...defaultProps} onSubmit={onSubmit} />);

    // Mặc định COD.
    selectFullAddress();
    fireEvent.click(screen.getByTestId('cart-checkout-btn'));
    expect((onSubmit.mock.calls[0][1] as any).paymentMethod).toBe('COD');
    first.unmount();
    onSubmit.mockClear();

    // Chọn PayOS → giá trị truyền lên là PayOS.
    render(<CheckoutForm {...defaultProps} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByTestId('payment-method-payos'));
    selectFullAddress();
    fireEvent.click(screen.getByTestId('cart-checkout-btn'));
    expect((onSubmit.mock.calls[0][1] as any).paymentMethod).toBe('PayOS');
  });

  it('TC_ORDER_14: COD radio is disabled and a limit note shows when the total exceeds 2,000,000đ', () => {
    render(<CheckoutForm {...defaultProps} finalTotal={2500000} />);

    expect(screen.getByTestId('payment-method-cod')).toBeDisabled();
    expect(screen.getByTestId('payment-cod-limit-note')).toBeInTheDocument();
    expect(screen.getByTestId('payment-method-payos')).toBeChecked();
  });
});
