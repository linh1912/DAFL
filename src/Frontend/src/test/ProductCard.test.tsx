import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProductCard } from '../components/product/ProductCard';
import { Product } from '../../../Shared/types';

describe('Product Card & Add-To-Cart Component', () => {
  const mockProductInStock: Product = {
    id: 'prod-1',
    categoryId: 'cat-1',
    categoryName: 'Điện tử',
    name: 'Tai nghe Bluetooth Pro',
    slug: 'tai-nghe-bluetooth-pro',
    description: 'Tai nghe chống ồn chủ động ANC cao cấp',
    price: 500000,
    originalPrice: 800000,
    availableStock: 15,
    imageUrl: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=500',
    rating: 4.8,
    reviewCount: 32,
  };

  const mockProductOutOfStock: Product = {
    ...mockProductInStock,
    id: 'prod-out',
    name: 'Sản phẩm hết hàng',
    availableStock: 0,
    originalPrice: undefined,
  };

  // ==========================================
  // Positive Path Test Cases (70%)
  // ==========================================
  it('TC_PROD_01: Should render product information correctly', () => {
    render(
      <ProductCard
        product={mockProductInStock}
        onOpenDetail={vi.fn()}
        onAddToCart={vi.fn()}
      />
    );

    expect(screen.getByTestId('product-name-prod-1')).toHaveTextContent('Tai nghe Bluetooth Pro');
    expect(screen.getByTestId('product-stock-prod-1')).toHaveTextContent('Còn 15');
    expect(screen.getByText('-38%')).toBeInTheDocument(); // Math.round(((800-500)/800)*100) = 38%
  });

  it('TC_PROD_02: Should trigger onAddToCart with product when clicking "Thêm" button', () => {
    const onAddToCart = vi.fn();
    render(
      <ProductCard
        product={mockProductInStock}
        onOpenDetail={vi.fn()}
        onAddToCart={onAddToCart}
      />
    );

    const addBtn = screen.getByTestId('add-to-cart-btn-prod-1');
    fireEvent.click(addBtn);
    expect(onAddToCart).toHaveBeenCalledWith(mockProductInStock);
  });

  it('TC_PROD_03: Should trigger onOpenDetail when clicking product card', () => {
    const onOpenDetail = vi.fn();
    render(
      <ProductCard
        product={mockProductInStock}
        onOpenDetail={onOpenDetail}
        onAddToCart={vi.fn()}
      />
    );

    const card = screen.getByTestId('product-card-prod-1');
    fireEvent.click(card);
    expect(onOpenDetail).toHaveBeenCalledWith(mockProductInStock);
  });

  // ==========================================
  // Negative Path Test Cases (30%)
  // ==========================================
  it('TC_PROD_04: Should disable add button and display "Hết hàng" when availableStock is 0', () => {
    const onAddToCart = vi.fn();
    render(
      <ProductCard
        product={mockProductOutOfStock}
        onOpenDetail={vi.fn()}
        onAddToCart={onAddToCart}
      />
    );

    const addBtn = screen.getByTestId('add-to-cart-btn-prod-out');
    expect(addBtn).toBeDisabled();
    expect(screen.getByTestId('product-stock-prod-out')).toHaveTextContent('Hết hàng');

    fireEvent.click(addBtn);
    expect(onAddToCart).not.toHaveBeenCalled();
  });

  it('TC_PROD_05: Should not display discount badge when originalPrice is undefined', () => {
    render(
      <ProductCard
        product={mockProductOutOfStock}
        onOpenDetail={vi.fn()}
        onAddToCart={vi.fn()}
      />
    );

    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });
});
