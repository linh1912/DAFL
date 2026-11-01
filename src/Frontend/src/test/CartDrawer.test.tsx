import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CartDrawer } from '../components/cart/CartDrawer';
import { CartItem, Voucher } from '../types';

describe('Cart Management Module - CartDrawer Component', () => {
  const mockCartItems: CartItem[] = [
    {
      product: {
        id: 'prod-1',
        categoryId: 'cat-1',
        categoryName: 'Thời trang',
        name: 'Áo Polo Thể Thao Nam',
        slug: 'ao-polo-the-thao-nam',
        description: 'Vải co giãn 4 chiều thoáng khí',
        price: 200000,
        availableStock: 50,
        imageUrl: 'https://images.unsplash.com/photo-1581655353564-df123a1eb820?w=500',
      },
      quantity: 2,
    },
    {
      product: {
        id: 'prod-2',
        categoryId: 'cat-2',
        categoryName: 'Gia dụng',
        name: 'Bình Giữ Nhiệt 500ml',
        slug: 'binh-giu-nhiet-500ml',
        description: 'Inox 304 giữ nhiệt 24h',
        price: 150000,
        availableStock: 20,
        imageUrl: 'https://images.unsplash.com/photo-1544816155-12df9643f363?w=500',
      },
      quantity: 1,
    },
  ];

  const mockVouchers: Voucher[] = [
    {
      id: 'v-1',
      code: 'GIAM20K',
      description: 'Giảm 20.000đ cho đơn từ 200K',
      discountType: 'FixedAmount',
      discountValue: 20000,
      minOrderAmount: 200000,
    },
    {
      id: 'v-2',
      code: 'DAFL10',
      description: 'Giảm 10% tối đa 50.000đ',
      discountType: 'Percentage',
      discountValue: 10,
      minOrderAmount: 100000,
    },
  ];

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    cart: mockCartItems,
    vouchers: mockVouchers,
    voucherCodeInput: '',
    setVoucherCodeInput: vi.fn(),
    appliedVoucher: null,
    voucherMessage: null,
    rawSubTotal: 550000,
    finalTotal: 550000,
    totalItemCount: 3,
    customerName: 'Nguyễn Văn Demo',
    setCustomerName: vi.fn(),
    customerEmail: 'demo@dafl.vn',
    setCustomerEmail: vi.fn(),
    customerPhone: '0987654321',
    setCustomerPhone: vi.fn(),
    shippingAddress: 'Hà Nội',
    setShippingAddress: vi.fn(),
    checkoutResult: null,
    isCheckingOut: false,
    orderStatus: 'Pending',
    timeLeft: 900,
    onUpdateQuantity: vi.fn(),
    onSetQuantity: vi.fn(),
    onRemoveItem: vi.fn(),
    onApplyVoucher: vi.fn(),
    onRemoveVoucher: vi.fn(),
    onCheckout: vi.fn((e) => e.preventDefault()),
    onNavigateToOrders: vi.fn(),
    onNavigateToHome: vi.fn(),
  };

  // ==========================================
  // Positive Path Test Cases (70%)
  // ==========================================
  it('TC_CART_01: Should render all cart items and quantities correctly', () => {
    render(<CartDrawer {...defaultProps} />);

    expect(screen.getByTestId('cart-drawer')).toBeInTheDocument();
    expect(screen.getByTestId('cart-item-name-prod-1')).toHaveTextContent('Áo Polo Thể Thao Nam');
    expect(screen.getByTestId('cart-item-qty-prod-1')).toHaveValue('2');

    expect(screen.getByTestId('cart-item-name-prod-2')).toHaveTextContent('Bình Giữ Nhiệt 500ml');
    expect(screen.getByTestId('cart-item-qty-prod-2')).toHaveValue('1');
  });

  it('TC_CART_02: Should trigger onUpdateQuantity with +1 when clicking increase button', () => {
    const onUpdateQuantity = vi.fn();
    render(<CartDrawer {...defaultProps} onUpdateQuantity={onUpdateQuantity} />);

    const plusBtn = screen.getByTestId('cart-item-plus-prod-1');
    fireEvent.click(plusBtn);
    expect(onUpdateQuantity).toHaveBeenCalledWith('prod-1', 1);
  });

  it('TC_CART_03: Should trigger onUpdateQuantity with -1 when clicking decrease button', () => {
    const onUpdateQuantity = vi.fn();
    render(<CartDrawer {...defaultProps} onUpdateQuantity={onUpdateQuantity} />);

    const minusBtn = screen.getByTestId('cart-item-minus-prod-1');
    fireEvent.click(minusBtn);
    expect(onUpdateQuantity).toHaveBeenCalledWith('prod-1', -1);
  });

  it('TC_CART_04: Should trigger onApplyVoucher when typing code and clicking apply', () => {
    const onApplyVoucher = vi.fn();
    const setVoucherCodeInput = vi.fn();
    render(
      <CartDrawer
        {...defaultProps}
        voucherCodeInput="GIAM20K"
        setVoucherCodeInput={setVoucherCodeInput}
        onApplyVoucher={onApplyVoucher}
      />
    );

    const applyBtn = screen.getByTestId('voucher-apply-btn');
    fireEvent.click(applyBtn);
    expect(onApplyVoucher).toHaveBeenCalledTimes(1);
  });

  it('TC_CART_05: Should display applied voucher banner with discount amount and allow removing', () => {
    const onRemoveVoucher = vi.fn();
    render(
      <CartDrawer
        {...defaultProps}
        appliedVoucher={{ code: 'GIAM20K', discountAmount: 20000 }}
        rawSubTotal={550000}
        finalTotal={530000}
        onRemoveVoucher={onRemoveVoucher}
      />
    );

    expect(screen.getByTestId('applied-voucher-banner')).toBeInTheDocument();
    expect(screen.getByTestId('cart-voucher-discount')).toBeInTheDocument();

    const removeVoucherBtn = screen.getByTestId('remove-voucher-btn');
    fireEvent.click(removeVoucherBtn);
    expect(onRemoveVoucher).toHaveBeenCalledTimes(1);
  });

  it('TC_CART_06: Should call onClose when clicking close button', () => {
    const onClose = vi.fn();
    render(<CartDrawer {...defaultProps} onClose={onClose} />);

    const closeBtn = screen.getByTestId('cart-close-btn');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ==========================================
  // Negative Path Test Cases (30%)
  // ==========================================
  it('TC_CART_07: Should display empty cart view when cart array is empty', () => {
    render(<CartDrawer {...defaultProps} cart={[]} />);

    expect(screen.getByTestId('cart-empty-state')).toBeInTheDocument();
    expect(screen.getByText('Giỏ hàng trống')).toBeInTheDocument();
    expect(screen.queryByTestId('cart-items-list')).not.toBeInTheDocument();
    expect(screen.queryByTestId('checkout-form')).not.toBeInTheDocument();
  });

  it('TC_CART_08: Should display voucher error message when invalid voucher is entered', () => {
    const errorMsg = 'Mã giảm giá không tồn tại hoặc đã hết hạn!';
    render(<CartDrawer {...defaultProps} voucherMessage={errorMsg} appliedVoucher={null} />);

    const errorBox = screen.getByTestId('voucher-error-msg');
    expect(errorBox).toBeInTheDocument();
    expect(errorBox).toHaveTextContent(errorMsg);
  });

  // ==========================================
  // CN-06/CN-07: xác nhận xóa, marker dòng giỏ, view thành công COD
  // ==========================================
  it('TC_CART_09: Removing an item requires the confirm dialog before onRemoveItem fires (CN-06.4)', () => {
    const onRemoveItem = vi.fn();
    render(<CartDrawer {...defaultProps} onRemoveItem={onRemoveItem} />);

    fireEvent.click(screen.getByTestId('cart-item-remove-prod-1'));
    expect(screen.getByTestId('cart-remove-confirm-dialog')).toBeInTheDocument();
    expect(onRemoveItem).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('cart-remove-cancel-btn'));
    expect(screen.queryByTestId('cart-remove-confirm-dialog')).not.toBeInTheDocument();
    expect(onRemoveItem).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('cart-item-remove-prod-1'));
    fireEvent.click(screen.getByTestId('cart-remove-confirm-btn'));
    expect(onRemoveItem).toHaveBeenCalledWith('prod-1');
  });

  it('TC_CART_10: Decreasing quantity to zero opens the same remove confirmation (CN-06.4)', () => {
    const onUpdateQuantity = vi.fn();
    render(<CartDrawer {...defaultProps} onUpdateQuantity={onUpdateQuantity} />);

    // prod-2 đang có số lượng 1 → bấm giảm là về 0 → hộp xác nhận thay vì gọi update.
    fireEvent.click(screen.getByTestId('cart-item-minus-prod-2'));
    expect(screen.getByTestId('cart-remove-confirm-dialog')).toBeInTheDocument();
    expect(onUpdateQuantity).not.toHaveBeenCalledWith('prod-2', -1);
  });

  it('TC_CART_11: Unavailable and price-changed items are marked and excluded messaging shows (CN-06.5)', () => {
    const items: CartItem[] = [
      {
        ...mockCartItems[0],
        isAvailable: false,
      },
      {
        ...mockCartItems[1],
        priceChanged: true,
        previousPrice: 140000,
      },
    ];
    render(<CartDrawer {...defaultProps} cart={items} />);

    expect(screen.getByTestId('cart-item-unavailable-prod-1')).toBeInTheDocument();
    expect(screen.getByTestId('cart-item-price-changed-prod-2')).toHaveTextContent('Giá vừa thay đổi');
  });

  it('TC_CART_12: COD checkout result renders the order success view with the DH display code (CN-07.5)', () => {
    render(
      <CartDrawer
        {...defaultProps}
        checkoutResult={{
          orderId: 'order-1',
          orderCode: 202611010001,
          orderDisplayCode: 'DH20261101-0001',
          paymentMethod: 'COD',
          totalAmount: 575000,
          expiresAt: new Date().toISOString(),
        }}
        lastOrderAddress="Số 1 Đại Cồ Việt, Hà Nội"
      />
    );

    expect(screen.getByTestId('order-success-view')).toBeInTheDocument();
    expect(screen.getByTestId('order-success-code')).toHaveTextContent('DH20261101-0001');
    expect(screen.getByTestId('view-orders-btn')).toBeInTheDocument();
    expect(screen.getByTestId('continue-shopping-btn')).toBeInTheDocument();
    expect(screen.queryByTestId('checkout-payment-view')).not.toBeInTheDocument();
  });

  it('TC_CART_13: Checkout error and price-changed notice are surfaced above the form (CN-07)', () => {
    render(
      <CartDrawer
        {...defaultProps}
        checkoutError="Mã giảm giá không tồn tại."
        priceChangedPending={true}
      />
    );

    expect(screen.getByTestId('checkout-error-msg')).toHaveTextContent('Mã giảm giá không tồn tại.');
    expect(screen.getByTestId('checkout-price-changed-notice')).toBeInTheDocument();
  });
});
