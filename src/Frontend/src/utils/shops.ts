import { Product } from '../types';

/**
 * Tên gian hàng hiển thị trên card sản phẩm (UI-only, chưa có entity Shop ở BE).
 * Thương hiệu thật parse từ tên sản phẩm — 25 thương hiệu có trong 64 SP seed
 * của BE (DbInitializer.SeedProductTemplates). Thương hiệu dài đứng trước để
 * so khớp dài nhất thắng (vd "La Roche-Posay" trước "3CE").
 * Sản phẩm không chứa thương hiệu nào → "DAFL Official".
 * Khi BE có bảng Shop thì thay bằng product.shopName thật.
 */
export const BEAUTY_SHOPS = [
  'La Roche-Posay',
  'Narciso Rodriguez',
  'Real Techniques',
  'Beauty Blender',
  'The Ordinary',
  "L'Oréal",
  'Maybelline',
  'Innisfree',
  'Laneige',
  'Peripera',
  'Vaseline',
  'Bioderma',
  'Eucerin',
  'Cosrx',
  'Chanel',
  'Versace',
  'Cocoon',
  'CeraVe',
  'Anessa',
  'Foreo',
  'Rom&nd',
  'Clio',
  'Dior',
  '3CE',
  'Lancôme',
] as const;

export const shopNameFor = (product: Pick<Product, 'id' | 'categoryId' | 'name'>): string => {
  const name = product.name ?? '';
  for (const brand of BEAUTY_SHOPS) {
    if (name.includes(brand)) return brand;
  }
  return 'DAFL Official';
};

/** Rút gọn tên danh mục mỹ phẩm của BE để hiển thị rõ ràng, ít chữ. */
const SHORT_CATEGORY_NAMES: Record<string, string> = {
  'Son môi': 'Son môi',
  'Chăm sóc da': 'Skincare',
  'Trang điểm': 'Make up',
  'Nước hoa': 'Nước hoa',
  'Chăm sóc cơ thể': 'Bodycare',
  'Chăm sóc tóc': 'Chăm sóc tóc',
  'Mặt nạ': 'Mặt nạ',
  'Dụng cụ làm đẹp': 'Dụng cụ',
  'Chống nắng': 'Chống nắng',
  'Tẩy trang & Làm sạch': 'Tẩy trang',
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
