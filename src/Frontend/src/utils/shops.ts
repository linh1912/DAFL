import { Product } from '../types';

/**
 * Tên gian hàng hiển thị trên card sản phẩm (UI-only, chưa có entity Shop ở BE).
 * Suy ra ổn định từ id sản phẩm để cùng 1 sản phẩm luôn hiện cùng 1 shop.
 * Khi BE có bảng Shop thì thay bằng product.shopName thật.
 */
export const BEAUTY_SHOPS = [
  'Glow Official',
  'Lumière Beauty',
  'PureSkin Lab',
  'Rose Botanica',
  'Mira Cosmetics',
  'Aura Beauty',
] as const;

export const shopNameFor = (product: Pick<Product, 'id' | 'categoryId'>): string => {
  // Danh mục mỹ phẩm luôn gắn shop chính hãng của sàn.
  if (product.categoryId === 'cat-9') return 'Glow Official';
  let hash = 0;
  for (let i = 0; i < product.id.length; i++) hash = (hash * 31 + product.id.charCodeAt(i)) >>> 0;
  return BEAUTY_SHOPS[hash % BEAUTY_SHOPS.length];
};

/** Rút gọn tên danh mục dài của BE để hiển thị rõ ràng, ít chữ. */
const SHORT_CATEGORY_NAMES: Record<string, string> = {
  'Đồ gia dụng & Đời sống': 'Gia dụng',
  'Đồ ăn khô & Thực phẩm chế biến': 'Ăn vặt',
  'Quần áo & Thời trang nam nữ': 'Thời trang',
  'Trang sức & Phụ kiện cao cấp': 'Trang sức',
  'Cà phê nguyên chất & Dụng cụ pha chế': 'Cà phê',
  'Cá cảnh, Bể thủy sinh & Phụ kiện': 'Cá cảnh',
  'Thiết bị điện tử & Phụ kiện công nghệ': 'Điện tử',
  'Máy tính & Thiết bị văn phòng': 'Máy tính',
  'Mỹ phẩm & Chăm sóc sắc đẹp': 'Mỹ phẩm',
  'Mẹ & Bé (Sữa, tã bỉm, đồ chơi)': 'Mẹ & Bé',
  'Sách & Văn phòng phẩm': 'Sách',
  'Dụng cụ thể thao & Dã ngoại': 'Thể thao',
  'Giày dép & Túi xách thời trang': 'Giày & Túi',
  'Phụ kiện ô tô & Xe máy': 'Ô tô & Xe máy',
  'Nội thất & Trang trí không gian sống': 'Nội thất',
  'Thiết bị âm thanh & Nhạc cụ': 'Âm thanh',
  'Trà & Đồ uống thảo mộc': 'Trà',
  'Thực phẩm chức năng & Sức khỏe': 'Sức khỏe',
  'Đồ chơi & Mô hình sưu tầm': 'Đồ chơi',
  'Thú cưng & Phụ kiện chăm sóc': 'Thú cưng',
  'Cây cảnh & Làm vườn tại gia': 'Cây cảnh',
  'Đồ thủ công mỹ nghệ & Quà tặng': 'Quà tặng',
  'Đồng hồ thời trang & Smartwatch': 'Đồng hồ',
  'Dụng cụ làm bánh & Đồ bếp chuyên sâu': 'Đồ bếp',
  'Hành lý & Đồ du lịch': 'Du lịch',
  'Thiết bị nhà thông minh (Smart Home)': 'Smart Home',
};

export const shortCategoryName = (name: string): string => {
  if (SHORT_CATEGORY_NAMES[name]) return SHORT_CATEGORY_NAMES[name];
  const cut = name.split('(')[0].split('&')[0].trim();
  return cut.length > 18 ? `${cut.slice(0, 17)}…` : cut || name;
};

/** Thời gian tương đối ngắn gọn cho thông báo: "5 phút trước". */
export const timeAgoVi = (iso: string): string => {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return 'Vừa xong';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Vừa xong';
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ngày trước`;
  return new Date(iso).toLocaleDateString('vi-VN');
};
