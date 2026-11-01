import rawProvinces from './vietnam-provinces.json';

export interface Ward {
  code: number;
  name: string;
}

export interface District {
  code: number;
  name: string;
  wards: Ward[];
}

export interface Province {
  code: number;
  name: string;
  districts: District[];
}

/**
 * Dữ liệu địa giới tĩnh đóng gói cùng FE (snapshot từ provinces.open-api.vn,
 * 63 tỉnh/thành, 3 cấp Tỉnh → Quận/Huyện → Phường/Xã). Đóng gói tĩnh để
 * checkout và Selenium không phụ thuộc dịch vụ bên ngoài lúc chạy/test.
 */
export const VIETNAM_PROVINCES: Province[] = Array.isArray(rawProvinces)
  ? (rawProvinces as Province[])
  : [];

/** False khi file dữ liệu lỗi/rỗng — UI degrade sang ô text có validate (Mục 7B.1). */
export const PROVINCES_AVAILABLE = VIETNAM_PROVINCES.length > 0;

export const findProvince = (code: number | null | undefined): Province | undefined =>
  code == null ? undefined : VIETNAM_PROVINCES.find(p => p.code === code);

export const findDistrict = (
  province: Province | undefined,
  code: number | null | undefined
): District | undefined =>
  province && code != null ? province.districts.find(d => d.code === code) : undefined;

export const findWard = (
  district: District | undefined,
  code: number | null | undefined
): Ward | undefined =>
  district && code != null ? district.wards.find(w => w.code === code) : undefined;
