import React, { useEffect, useState } from 'react';
import { Plus, Minus, Trash2 } from 'lucide-react';
import { CartItem } from '../../../../Shared/types';
import { formatPrice } from '../../utils/formatters';
import { shopNameFor } from '../../utils/shops';

export interface CartItemRowProps {
  item: CartItem;
  onUpdateQuantity: (productId: string, delta: number) => void;
  /** Đặt số lượng trực tiếp (CN-06.3 — nhập số). */
  onSetQuantity?: (productId: string, quantity: number) => void;
  /** Yêu cầu xóa dòng — CartDrawer mở hộp xác nhận (CN-06.4). */
  onRemoveRequest?: (productId: string) => void;
}

export const CartItemRow: React.FC<CartItemRowProps> = ({
  item,
  onUpdateQuantity,
  onSetQuantity,
  onRemoveRequest,
}) => {
  const productId = item.product.id;
  const unavailable = item.isAvailable === false;
  const [qtyText, setQtyText] = useState(String(item.quantity));
  const [editing, setEditing] = useState(false);

  // Đồng bộ ô nhập khi số lượng thay đổi từ bên ngoài (đồng bộ giỏ server, +/-).
  useEffect(() => {
    if (!editing) setQtyText(String(item.quantity));
  }, [item.quantity, editing]);

  const commitQtyText = () => {
    setEditing(false);
    const parsed = Number(qtyText.replace(/[^\d]/g, ''));
    if (!Number.isFinite(parsed)) {
      setQtyText(String(item.quantity));
      return;
    }
    if (parsed <= 0) {
      // Giảm về 0 → cùng hộp xác nhận xóa như nút Xóa (CN-06.4).
      setQtyText(String(item.quantity));
      onRemoveRequest?.(productId);
      return;
    }
    if (parsed !== item.quantity) {
      onSetQuantity?.(productId, parsed);
    }
    setQtyText(String(parsed));
  };

  const handleMinus = () => {
    if (item.quantity <= 1) {
      onRemoveRequest?.(productId);
      return;
    }
    onUpdateQuantity(productId, -1);
  };

  return (
    <div
      className={`cart-item ${unavailable ? 'cart-item-unavailable' : ''}`}
      data-testid={`cart-item-${productId}`}
    >
      <img
        src={item.product.imageUrl}
        alt={item.product.name}
        style={{ width: 64, height: 64, borderRadius: 10, objectFit: 'cover', marginRight: 12, flexShrink: 0 }}
      />
      <div className="cart-item-info">
        <div className="cart-item-name" data-testid={`cart-item-name-${productId}`}>
          {item.product.name}
        </div>
        <div className="cart-item-shop">{shopNameFor(item.product)}</div>
        <div className="cart-item-price" data-testid={`cart-item-price-${productId}`}>
          {formatPrice(item.product.price)}
          <span className="cart-item-line-total"> · {formatPrice(item.product.price * item.quantity)}</span>
        </div>
        {item.priceChanged && (
          <div className="cart-item-price-changed" data-testid={`cart-item-price-changed-${productId}`}>
            Giá vừa thay đổi{item.previousPrice ? ` từ ${formatPrice(item.previousPrice)}` : ''} — vui lòng kiểm tra lại trước khi đặt hàng.
          </div>
        )}
        {unavailable && (
          <div className="cart-item-unavailable-note" data-testid={`cart-item-unavailable-${productId}`}>
            Sản phẩm đã ngừng bán hoặc hết hàng — không thể đặt hàng.
          </div>
        )}
      </div>
      <div className="cart-item-actions">
        <button
          className="qty-btn"
          onClick={handleMinus}
          disabled={unavailable}
          data-testid={`cart-item-minus-${productId}`}
          title="Giảm số lượng"
        >
          <Minus size={14} />
        </button>
        <input
          className="cart-qty-input"
          type="text"
          inputMode="numeric"
          value={qtyText}
          disabled={unavailable}
          onFocus={() => setEditing(true)}
          onChange={e => setQtyText(e.target.value)}
          onBlur={commitQtyText}
          onKeyDown={e => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          data-testid={`cart-item-qty-${productId}`}
          aria-label={`Số lượng ${item.product.name}`}
        />
        <button
          className="qty-btn"
          onClick={() => onUpdateQuantity(productId, 1)}
          disabled={unavailable}
          data-testid={`cart-item-plus-${productId}`}
          title="Tăng số lượng"
        >
          <Plus size={14} />
        </button>
        <button
          type="button"
          className="cart-item-remove-btn"
          onClick={() => onRemoveRequest?.(productId)}
          data-testid={`cart-item-remove-${productId}`}
          title="Xóa sản phẩm khỏi giỏ hàng"
        >
          <Trash2 size={14} /> Xóa
        </button>
      </div>
    </div>
  );
};
