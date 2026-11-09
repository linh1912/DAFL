import React from 'react';
import { Star, Plus, Store } from 'lucide-react';
import { Product } from '../../../../Shared/types';
import { formatPrice } from '../../utils/formatters';
import { IMAGE_PLACEHOLDER } from '../../utils/images';
import { shopNameFor } from '../../utils/shops';

export interface ProductCardProps {
  product: Product;
  onOpenDetail: (product: Product) => void;
  onAddToCart: (product: Product) => void;
}

export const ProductCard: React.FC<ProductCardProps> = ({
  product,
  onOpenDetail,
  onAddToCart,
}) => {
  const isOutOfStock = product.availableStock <= 0;
  const discountPercent =
    product.originalPrice && product.originalPrice > product.price
      ? Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100)
      : null;

  return (
    <div
      className="product-card"
      onClick={() => onOpenDetail(product)}
      data-testid={`product-card-${product.id}`}
    >
      <div className="product-image-wrap">
        <img
          src={product.imageUrl}
          alt={product.name}
          className="product-image"
          loading="lazy"
          decoding="async"
          onError={e => {
            // Ảnh lỗi (404...) -> thay bằng ảnh placeholder, tránh icon ảnh vỡ; chặn lặp vô hạn nếu placeholder cũng lỗi
            if (e.currentTarget.src !== IMAGE_PLACEHOLDER) e.currentTarget.src = IMAGE_PLACEHOLDER;
          }}
        />
        {discountPercent !== null && (
          <span className="product-discount-badge">-{discountPercent}%</span>
        )}
      </div>
      <div className="product-content">
        <div className="product-brand">{product.categoryName}</div>
        <h3 className="product-name" data-testid={`product-name-${product.id}`}>
          {product.name}
        </h3>
        <div className="product-shop-row">
          <div className="product-shop" data-testid={`product-shop-${product.id}`}>
            <Store size={12} /> {shopNameFor(product)}
          </div>

          <div className="product-meta">
            <span className="product-rating">
              <Star size={13} fill="#f5a623" color="#f5a623" />
              {product.rating ? product.rating.toFixed(1) : '5.0'}
            </span>
            <span>({product.reviewCount || 0})</span>
          </div>
        </div>

        <div className="product-footer">
          <div className="product-price-block">
            <span className="product-price" data-testid={`product-price-${product.id}`}>
              {formatPrice(product.price)}
            </span>
            {product.originalPrice && (
              <span className="product-original-price">
                {formatPrice(product.originalPrice)}
              </span>
            )}
          </div>
          <div className="product-stock" data-testid={`product-stock-${product.id}`}>
            {isOutOfStock ? 'Hết hàng' : `Còn ${product.availableStock}`}
          </div>
          <button
            className="btn btn-primary product-add-btn"
            onClick={(e) => {
              e.stopPropagation();
              onAddToCart(product);
            }}
            disabled={isOutOfStock}
            data-testid={`add-to-cart-btn-${product.id}`}
            title={isOutOfStock ? 'Sản phẩm tạm hết hàng' : 'Thêm vào giỏ hàng'}
          >
            <Plus size={15} /> Thêm vào giỏ
          </button>
        </div>
      </div>
    </div>
  );
};
