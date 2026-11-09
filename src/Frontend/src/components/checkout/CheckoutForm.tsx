import React, { useEffect, useRef, useState } from 'react';
import { ShippingInfo, User, UserAddress } from '../../../../Shared/types';
import { formatPrice } from '../../utils/formatters';
import { apiJson } from '../../../../Shared/utils/api';
import {
  VIETNAM_PROVINCES,
  PROVINCES_AVAILABLE,
  findProvince,
  findDistrict,
  findWard,
} from '../../data/vietnamProvinces';

/** Giới hạn ghi chú đơn hàng (CN-07.3). */
export const ORDER_NOTE_MAX_LENGTH = 200;
/** COD chỉ áp dụng cho đơn ≤ 2.000.000đ (Mục 11.3). */
export const COD_MAX_TOTAL = 2000000;

export type PaymentMethodChoice = 'COD' | 'PayOS';

export interface CheckoutFormValues {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  shippingAddress: string;
  /** Khối giao hàng có cấu trúc — App gửi kèm payload đặt hàng. */
  shipping?: ShippingInfo;
  /** Phương thức thanh toán khách chọn (CN-07 bước 3). */
  paymentMethod: PaymentMethodChoice;
}

export interface CheckoutFormProps {
  customerName: string;
  setCustomerName: (val: string) => void;
  customerEmail: string;
  setCustomerEmail: (val: string) => void;
  customerPhone: string;
  setCustomerPhone: (val: string) => void;
  shippingAddress: string;
  setShippingAddress: (val: string) => void;
  finalTotal: number;
  isCheckingOut: boolean;
  onSubmit: (e: React.FormEvent, values?: CheckoutFormValues) => void;
  user?: User | null;
  /** Chưa đăng nhập mà bấm Thanh toán → App điều hướng đăng nhập rồi quay lại (CN-07 E4). */
  onRequireAuth?: () => void;
  /** Sổ địa chỉ của tài khoản; nếu không truyền, form tự tải từ GET /api/addresses khi đã đăng nhập. */
  savedAddresses?: UserAddress[];
}

interface ShippingFieldErrors {
  recipient?: string;
  email?: string;
  phone?: string;
  province?: string;
  district?: string;
  ward?: string;
  detail?: string;
  note?: string;
}

const ERROR_COLOR = '#d81b60';
const fieldErrorStyle: React.CSSProperties = { color: ERROR_COLOR, fontSize: '0.8rem', marginTop: 6 };

const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
const isValidVietnamesePhone = (phone: string) => /^0\d{9}$/.test(phone.trim());

const composeFullAddress = (parts: {
  detailAddress: string;
  wardName: string;
  districtName: string;
  provinceName: string;
}) =>
  [parts.detailAddress, parts.wardName, parts.districtName, parts.provinceName]
    .map(part => (part || '').trim())
    .filter(Boolean)
    .join(', ');

const normalizeAddress = (raw: any): UserAddress | null => {
  if (!raw || typeof raw !== 'object') return null;
  const pick = (camel: string, pascal: string) => raw[camel] ?? raw[pascal];
  const id = pick('id', 'Id');
  if (id == null) return null;
  return {
    id: String(id),
    label: pick('label', 'Label') ?? undefined,
    recipientName: pick('recipientName', 'RecipientName') ?? pick('customerName', 'CustomerName') ?? '',
    phone: pick('phone', 'Phone') ?? pick('phoneNumber', 'PhoneNumber') ?? '',
    provinceCode: Number(pick('provinceCode', 'ProvinceCode') ?? 0),
    provinceName: pick('provinceName', 'ProvinceName') ?? '',
    districtCode: Number(pick('districtCode', 'DistrictCode') ?? 0),
    districtName: pick('districtName', 'DistrictName') ?? '',
    wardCode: Number(pick('wardCode', 'WardCode') ?? 0),
    wardName: pick('wardName', 'WardName') ?? '',
    detailAddress: pick('detailAddress', 'DetailAddress') ?? '',
    note: pick('note', 'Note') ?? undefined,
    isDefault: Boolean(pick('isDefault', 'IsDefault')),
  };
};

type FieldKey = 'recipient' | 'email' | 'phone' | 'province' | 'district' | 'ward' | 'detail' | 'note';
const FIELD_ORDER: FieldKey[] = ['recipient', 'phone', 'email', 'province', 'district', 'ward', 'detail', 'note'];

export const CheckoutForm: React.FC<CheckoutFormProps> = ({
  customerName,
  setCustomerName,
  customerEmail,
  setCustomerEmail,
  customerPhone,
  setCustomerPhone,
  shippingAddress,
  setShippingAddress,
  finalTotal,
  isCheckingOut,
  onSubmit,
  user,
  onRequireAuth,
  savedAddresses,
}) => {
  const [errors, setErrors] = useState<ShippingFieldErrors>({});
  const fieldRefs = useRef<Partial<Record<FieldKey, HTMLElement | null>>>({});

  // --- Sổ địa chỉ ---
  const [fetchedAddresses, setFetchedAddresses] = useState<UserAddress[]>([]);
  const addresses = savedAddresses ?? fetchedAddresses;
  const [addressMode, setAddressMode] = useState<'saved' | 'new'>('new');
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const modeTouchedRef = useRef(false);

  // --- Form nhập địa chỉ mới ---
  const [provinceCode, setProvinceCode] = useState<number | null>(null);
  const [districtCode, setDistrictCode] = useState<number | null>(null);
  const [wardCode, setWardCode] = useState<number | null>(null);
  // Degrade khi dữ liệu tĩnh lỗi: 3 cấp địa giới thành ô text.
  const [provinceText, setProvinceText] = useState('');
  const [districtText, setDistrictText] = useState('');
  const [wardText, setWardText] = useState('');
  const [detailAddress, setDetailAddress] = useState('');
  const [note, setNote] = useState('');
  const [saveAsDefault, setSaveAsDefault] = useState(false);
  const detailTouchedRef = useRef(false);
  // Phương thức thanh toán (CN-07 bước 3): mặc định COD; đơn > 2 triệu chỉ được PayOS.
  const codAvailable = finalTotal <= COD_MAX_TOTAL;
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodChoice>('COD');
  const effectivePaymentMethod: PaymentMethodChoice = codAvailable ? paymentMethod : 'PayOS';

  // Tự tải sổ địa chỉ khi component được dùng độc lập (không được truyền prop) — qua JWT.
  useEffect(() => {
    if (savedAddresses !== undefined || !user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const { body } = await apiJson<any>('/api/addresses');
        const list = Array.isArray(body?.data) ? body.data : [];
        if (!cancelled) {
          setFetchedAddresses(list.map(normalizeAddress).filter(Boolean) as UserAddress[]);
        }
      } catch {
        if (!cancelled) setFetchedAddresses([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [savedAddresses, user?.id]);

  // Có địa chỉ đã lưu và người dùng chưa tự chọn chế độ → chọn sẵn địa chỉ mặc định.
  useEffect(() => {
    if (addresses.length > 0 && !modeTouchedRef.current) {
      const preferred = addresses.find(a => a.isDefault) ?? addresses[0];
      setSelectedAddressId(preferred.id);
      setAddressMode('saved');
    }
  }, [addresses]);

  // Prefill địa chỉ chi tiết từ hồ sơ tài khoản (địa chỉ text đã lưu) khi chưa gõ gì.
  useEffect(() => {
    if (shippingAddress && !detailTouchedRef.current) {
      setDetailAddress(prev => prev || shippingAddress);
    }
  }, [shippingAddress]);

  const selectedProvince = findProvince(provinceCode);
  const selectedDistrict = findDistrict(selectedProvince, districtCode);
  const selectedWard = findWard(selectedDistrict, wardCode);
  const selectedSavedAddress = addresses.find(a => a.id === selectedAddressId) ?? null;

  const clearError = (field: FieldKey) => {
    setErrors(prev => (prev[field] ? { ...prev, [field]: undefined } : prev));
  };

  const focusFirstError = (nextErrors: ShippingFieldErrors) => {
    const firstField = FIELD_ORDER.find(field => nextErrors[field]);
    if (!firstField) return;
    const element = fieldRefs.current[firstField];
    if (element) {
      try {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch {
        // jsdom/môi trường không hỗ trợ scrollIntoView — bỏ qua.
      }
      if (typeof element.focus === 'function') element.focus();
    }
  };

  const validateEmailField = (email: string): string | undefined => {
    if (!email) return 'Vui lòng nhập email.';
    if (!isValidEmail(email)) return 'Email không đúng định dạng.';
    return undefined;
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // CN-07 bước 1 + E4: chưa đăng nhập → App đưa qua đăng nhập rồi quay lại trang giỏ.
    if (!user && onRequireAuth) {
      onRequireAuth();
      return;
    }

    const email = customerEmail.trim().toLowerCase();

    // --- Dùng địa chỉ đã lưu trong sổ ---
    if (addressMode === 'saved' && selectedSavedAddress) {
      const emailError = validateEmailField(email);
      if (emailError) {
        const nextErrors = { email: emailError };
        setErrors(nextErrors);
        focusFirstError(nextErrors);
        return;
      }
      setErrors({});
      if (email !== customerEmail) setCustomerEmail(email);
      const fullAddress = composeFullAddress(selectedSavedAddress);
      if (fullAddress !== shippingAddress) setShippingAddress(fullAddress);
      onSubmit(e, {
        customerName: selectedSavedAddress.recipientName,
        customerEmail: email,
        customerPhone: selectedSavedAddress.phone,
        shippingAddress: fullAddress,
        paymentMethod: effectivePaymentMethod,
        shipping: {
          recipientName: selectedSavedAddress.recipientName,
          phone: selectedSavedAddress.phone,
          email,
          provinceCode: Number(selectedSavedAddress.provinceCode),
          provinceName: selectedSavedAddress.provinceName,
          districtCode: Number(selectedSavedAddress.districtCode),
          districtName: selectedSavedAddress.districtName,
          wardCode: Number(selectedSavedAddress.wardCode),
          wardName: selectedSavedAddress.wardName,
          detailAddress: selectedSavedAddress.detailAddress,
          note: selectedSavedAddress.note,
          addressBookId: selectedSavedAddress.id,
          saveAsDefault: false,
        },
      });
      return;
    }

    // --- Nhập địa chỉ mới: validate toàn bộ (trạng thái S17 khi thiếu/sai) ---
    const recipient = customerName.trim();
    const phone = customerPhone.trim();
    const detail = detailAddress.trim();
    const noteValue = note.trim();

    let provinceName = '';
    let districtName = '';
    let wardName = '';
    let finalProvinceCode = 0;
    let finalDistrictCode = 0;
    let finalWardCode = 0;

    const nextErrors: ShippingFieldErrors = {};
    if (!recipient) {
      nextErrors.recipient = 'Vui lòng nhập họ tên người nhận.';
    } else if (recipient.length < 2) {
      nextErrors.recipient = 'Họ tên người nhận phải có ít nhất 2 ký tự.';
    }
    if (!phone) {
      nextErrors.phone = 'Vui lòng nhập số điện thoại.';
    } else if (!isValidVietnamesePhone(phone)) {
      nextErrors.phone = 'Số điện thoại phải gồm 10 chữ số và bắt đầu bằng số 0.';
    }
    const emailError = validateEmailField(email);
    if (emailError) nextErrors.email = emailError;

    if (PROVINCES_AVAILABLE) {
      if (!selectedProvince) {
        nextErrors.province = 'Vui lòng chọn Tỉnh / Thành phố.';
      } else {
        finalProvinceCode = selectedProvince.code;
        provinceName = selectedProvince.name;
      }
      if (!selectedDistrict) {
        nextErrors.district = 'Vui lòng chọn Quận / Huyện.';
      } else {
        finalDistrictCode = selectedDistrict.code;
        districtName = selectedDistrict.name;
      }
      if (!selectedWard) {
        nextErrors.ward = 'Vui lòng chọn Phường / Xã.';
      } else {
        finalWardCode = selectedWard.code;
        wardName = selectedWard.name;
      }
    } else {
      if (!provinceText.trim()) nextErrors.province = 'Vui lòng nhập Tỉnh / Thành phố.';
      else provinceName = provinceText.trim();
      if (!districtText.trim()) nextErrors.district = 'Vui lòng nhập Quận / Huyện.';
      else districtName = districtText.trim();
      if (!wardText.trim()) nextErrors.ward = 'Vui lòng nhập Phường / Xã.';
      else wardName = wardText.trim();
    }

    if (!detail) {
      nextErrors.detail = 'Vui lòng nhập địa chỉ chi tiết.';
    } else if (detail.length < 5) {
      nextErrors.detail = 'Địa chỉ chi tiết phải có ít nhất 5 ký tự.';
    }
    if (noteValue.length > ORDER_NOTE_MAX_LENGTH) {
      nextErrors.note = 'Ghi chú đơn hàng tối đa 200 ký tự.';
    }

    setErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) {
      focusFirstError(nextErrors);
      return;
    }

    // Đồng bộ giá trị đã trim về state rồi mới gửi kèm cho onSubmit.
    if (recipient !== customerName) setCustomerName(recipient);
    if (email !== customerEmail) setCustomerEmail(email);
    if (phone !== customerPhone) setCustomerPhone(phone);
    const fullAddress = composeFullAddress({
      detailAddress: detail,
      wardName,
      districtName,
      provinceName,
    });
    if (fullAddress !== shippingAddress) setShippingAddress(fullAddress);

    onSubmit(e, {
      customerName: recipient,
      customerEmail: email,
      customerPhone: phone,
      shippingAddress: fullAddress,
      paymentMethod: effectivePaymentMethod,
      shipping: {
        recipientName: recipient,
        phone,
        email,
        provinceCode: finalProvinceCode,
        provinceName,
        districtCode: finalDistrictCode,
        districtName,
        wardCode: finalWardCode,
        wardName,
        detailAddress: detail,
        note: noteValue || undefined,
        addressBookId: null,
        saveAsDefault,
      },
    });
  };

  const errorBorder = (hasError: boolean): React.CSSProperties =>
    hasError ? { borderColor: ERROR_COLOR } : {};

  const setFieldRef = (field: FieldKey) => (element: HTMLElement | null) => {
    fieldRefs.current[field] = element;
  };

  const selectSavedAddress = (address: UserAddress) => {
    modeTouchedRef.current = true;
    setAddressMode('saved');
    setSelectedAddressId(address.id);
    setErrors({});
  };

  const startNewAddress = () => {
    modeTouchedRef.current = true;
    setAddressMode('new');
    setErrors({});
  };

  const showNewAddressForm = addressMode === 'new' || addresses.length === 0;

  return (
    <form onSubmit={handleFormSubmit} noValidate data-testid="checkout-form">
      <h4 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: 12, color: 'var(--text-main)' }}>
        Giao hàng
      </h4>

      {/* Email nhận thông tin đơn — luôn hiển thị, mặc định là email tài khoản */}
      <div className="form-group">
        <label className="form-label" htmlFor="shipping-email">Email</label>
        <input
          id="shipping-email"
          className="form-input"
          type="email"
          data-testid="shipping-email-input"
          ref={setFieldRef('email')}
          value={customerEmail}
          onChange={e => {
            setCustomerEmail(e.target.value);
            clearError('email');
          }}
          style={errorBorder(!!errors.email)}
        />
        {errors.email && (
          <div data-testid="shipping-email-error" style={fieldErrorStyle}>
            {errors.email}
          </div>
        )}
      </div>

      {/* Sổ địa chỉ đã lưu */}
      {addresses.length > 0 && (
        <div className="form-group">
          <span className="form-label">Địa chỉ đã lưu</span>
          <div data-testid="shipping-address-list" style={{ display: 'grid', gap: 8, marginTop: 6 }}>
            {addresses.map(address => {
              const isSelected = addressMode === 'saved' && selectedAddressId === address.id;
              return (
                <label
                  key={address.id}
                  data-testid={`shipping-address-option-${address.id}`}
                  style={{
                    display: 'flex',
                    gap: 10,
                    alignItems: 'flex-start',
                    border: `1px solid ${isSelected ? 'var(--primary)' : 'var(--border-subtle)'}`,
                    borderRadius: 10,
                    padding: '10px 12px',
                    cursor: 'pointer',
                    background: isSelected ? 'var(--bg-subtle)' : '#fff',
                  }}
                >
                  <input
                    type="radio"
                    name="shipping-saved-address"
                    checked={isSelected}
                    onChange={() => selectSavedAddress(address)}
                    style={{ marginTop: 3 }}
                  />
                  <span style={{ fontSize: '0.9rem', lineHeight: 1.5 }}>
                    <strong>{address.recipientName}</strong> — {address.phone}
                    {address.isDefault && (
                      <span style={{ marginLeft: 8, fontSize: '0.78rem', fontWeight: 700, color: 'var(--primary)' }}>
                        MẶC ĐỊNH
                      </span>
                    )}
                    {address.label && <span style={{ color: 'var(--text-muted)' }}> ({address.label})</span>}
                    <br />
                    <span style={{ color: 'var(--text-muted)' }}>{composeFullAddress(address)}</span>
                  </span>
                </label>
              );
            })}
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: '8px 14px', fontSize: '0.82rem', marginTop: 10 }}
            onClick={startNewAddress}
            data-testid="shipping-new-address-btn"
          >
            + Thêm địa chỉ mới
          </button>
        </div>
      )}

      {/* Form nhập địa chỉ mới */}
      {showNewAddressForm && (
        <div data-testid="shipping-new-address-form">
          <div className="checkout-grid-2">
            <div className="form-group">
              <label className="form-label" htmlFor="shipping-recipient">Người nhận</label>
            <input
              id="shipping-recipient"
              className="form-input"
              placeholder="VD: Nguyễn Văn A"
              data-testid="shipping-recipient-input"
              ref={setFieldRef('recipient')}
              value={customerName}
              onChange={e => {
                setCustomerName(e.target.value);
                clearError('recipient');
              }}
              style={errorBorder(!!errors.recipient)}
            />
            {errors.recipient && (
              <div data-testid="shipping-recipient-error" style={fieldErrorStyle}>
                {errors.recipient}
              </div>
            )}
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="shipping-phone">Số điện thoại</label>
            <input
              id="shipping-phone"
              className="form-input"
              inputMode="numeric"
              placeholder="VD: 0901234567"
              data-testid="shipping-phone-input"
              ref={setFieldRef('phone')}
              value={customerPhone}
              onChange={e => {
                setCustomerPhone(e.target.value);
                clearError('phone');
              }}
              style={errorBorder(!!errors.phone)}
            />
            {errors.phone && (
              <div data-testid="shipping-phone-error" style={fieldErrorStyle}>
                {errors.phone}
              </div>
            )}
          </div>
          </div>

          {PROVINCES_AVAILABLE ? (
            <>
              <div className="form-group">
                <label className="form-label" htmlFor="shipping-province">Tỉnh / Thành phố</label>
                <select
                  id="shipping-province"
                  className="form-input"
                  data-testid="shipping-province-select"
                  ref={setFieldRef('province')}
                  value={provinceCode ?? ''}
                  onChange={e => {
                    const code = e.target.value ? Number(e.target.value) : null;
                    setProvinceCode(code);
                    // Đổi tỉnh → đặt lại quận + phường.
                    setDistrictCode(null);
                    setWardCode(null);
                    clearError('province');
                    clearError('district');
                    clearError('ward');
                  }}
                  style={errorBorder(!!errors.province)}
                >
                  <option value="">— Chọn Tỉnh / Thành phố —</option>
                  {VIETNAM_PROVINCES.map(province => (
                    <option key={province.code} value={province.code}>
                      {province.name}
                    </option>
                  ))}
                </select>
                {errors.province && (
                  <div data-testid="shipping-province-error" style={fieldErrorStyle}>
                    {errors.province}
                  </div>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="shipping-district">Quận / Huyện</label>
                  <select
                    id="shipping-district"
                    className="form-input"
                    data-testid="shipping-district-select"
                    ref={setFieldRef('district')}
                    value={districtCode ?? ''}
                    disabled={!selectedProvince}
                    onChange={e => {
                      const code = e.target.value ? Number(e.target.value) : null;
                      setDistrictCode(code);
                      // Đổi quận → đặt lại phường.
                      setWardCode(null);
                      clearError('district');
                      clearError('ward');
                    }}
                    style={errorBorder(!!errors.district)}
                  >
                    <option value="">— Chọn quận —</option>
                    {(selectedProvince?.districts ?? []).map(district => (
                      <option key={district.code} value={district.code}>
                        {district.name}
                      </option>
                    ))}
                  </select>
                  {errors.district && (
                    <div data-testid="shipping-district-error" style={fieldErrorStyle}>
                      {errors.district}
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="shipping-ward">Phường / Xã</label>
                  <select
                    id="shipping-ward"
                    className="form-input"
                    data-testid="shipping-ward-select"
                    ref={setFieldRef('ward')}
                    value={wardCode ?? ''}
                    disabled={!selectedDistrict}
                    onChange={e => {
                      setWardCode(e.target.value ? Number(e.target.value) : null);
                      clearError('ward');
                    }}
                    style={errorBorder(!!errors.ward)}
                  >
                    <option value="">— Chọn phường —</option>
                    {(selectedDistrict?.wards ?? []).map(ward => (
                      <option key={ward.code} value={ward.code}>
                        {ward.name}
                      </option>
                    ))}
                  </select>
                  {errors.ward && (
                    <div data-testid="shipping-ward-error" style={fieldErrorStyle}>
                      {errors.ward}
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="form-group">
                <label className="form-label" htmlFor="shipping-province">Tỉnh / Thành phố</label>
                <input
                  id="shipping-province"
                  className="form-input"
                  data-testid="shipping-province-select"
                  ref={setFieldRef('province')}
                  value={provinceText}
                  onChange={e => {
                    setProvinceText(e.target.value);
                    clearError('province');
                  }}
                  style={errorBorder(!!errors.province)}
                />
                {errors.province && (
                  <div data-testid="shipping-province-error" style={fieldErrorStyle}>
                    {errors.province}
                  </div>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="shipping-district">Quận / Huyện</label>
                  <input
                    id="shipping-district"
                    className="form-input"
                    data-testid="shipping-district-select"
                    ref={setFieldRef('district')}
                    value={districtText}
                    onChange={e => {
                      setDistrictText(e.target.value);
                      clearError('district');
                    }}
                    style={errorBorder(!!errors.district)}
                  />
                  {errors.district && (
                    <div data-testid="shipping-district-error" style={fieldErrorStyle}>
                      {errors.district}
                    </div>
                  )}
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="shipping-ward">Phường / Xã</label>
                  <input
                    id="shipping-ward"
                    className="form-input"
                    data-testid="shipping-ward-select"
                    ref={setFieldRef('ward')}
                    value={wardText}
                    onChange={e => {
                      setWardText(e.target.value);
                      clearError('ward');
                    }}
                    style={errorBorder(!!errors.ward)}
                  />
                  {errors.ward && (
                    <div data-testid="shipping-ward-error" style={fieldErrorStyle}>
                      {errors.ward}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          <div className="form-group">
            <label className="form-label" htmlFor="shipping-detail">Số nhà, tên đường</label>
            <input
              id="shipping-detail"
              className="form-input"
              placeholder="VD: 123 Nguyễn Trãi"
              data-testid="shipping-detail-input"
              ref={setFieldRef('detail')}
              value={detailAddress}
              onChange={e => {
                detailTouchedRef.current = true;
                setDetailAddress(e.target.value);
                clearError('detail');
              }}
              style={errorBorder(!!errors.detail)}
            />
            {errors.detail && (
              <div data-testid="shipping-detail-error" style={fieldErrorStyle}>
                {errors.detail}
              </div>
            )}
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="shipping-note">
              Ghi chú (không bắt buộc)
              <span className="note-counter" data-testid="shipping-note-counter">{note.length}/{ORDER_NOTE_MAX_LENGTH}</span>
            </label>
            <textarea
              id="shipping-note"
              className="form-input"
              rows={2}
              data-testid="shipping-note-input"
              ref={setFieldRef('note')}
              value={note}
              onChange={e => {
                setNote(e.target.value);
                clearError('note');
              }}
              placeholder="Ví dụ: Gọi trước khi giao"
              style={errorBorder(!!errors.note)}
            />
            {errors.note && (
              <div data-testid="shipping-note-error" style={fieldErrorStyle}>
                {errors.note}
              </div>
            )}
          </div>

          {user && (
            <label
              style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', cursor: 'pointer', margin: '4px 0 8px' }}
            >
              <input
                type="checkbox"
                data-testid="shipping-save-default-checkbox"
                checked={saveAsDefault}
                onChange={e => setSaveAsDefault(e.target.checked)}
              />
              Lưu làm địa chỉ mặc định
            </label>
          )}
        </div>
      )}

      {/* Phương thức thanh toán (CN-07 bước 3) */}
      <div className="form-group" style={{ marginTop: 16 }}>
        <span className="form-label">Phương thức thanh toán</span>
        <div className="payment-method-options">
          <label className={`payment-method-option ${effectivePaymentMethod === 'COD' ? 'selected' : ''} ${!codAvailable ? 'disabled' : ''}`}>
            <input
              type="radio"
              name="payment-method"
              value="COD"
              checked={effectivePaymentMethod === 'COD'}
              disabled={!codAvailable}
              onChange={() => setPaymentMethod('COD')}
              data-testid="payment-method-cod"
            />
            <span>
              <strong>Thanh toán khi nhận hàng (COD)</strong>
              <small>Trả tiền khi nhận hàng.</small>
            </span>
          </label>
          <label className={`payment-method-option ${effectivePaymentMethod === 'PayOS' ? 'selected' : ''}`}>
            <input
              type="radio"
              name="payment-method"
              value="PayOS"
              checked={effectivePaymentMethod === 'PayOS'}
              onChange={() => setPaymentMethod('PayOS')}
              data-testid="payment-method-payos"
            />
            <span>
              <strong>Thanh toán trực tuyến PayOS</strong>
              <small>Quét VietQR, giữ kho 15 phút.</small>
            </span>
          </label>
        </div>
        {!codAvailable && (
          <div data-testid="payment-cod-limit-note" style={{ color: ERROR_COLOR, fontSize: '0.8rem', marginTop: 6 }}>
            Đơn hàng trên {formatPrice(COD_MAX_TOTAL)} chỉ hỗ trợ thanh toán trực tuyến PayOS.
          </div>
        )}
      </div>

      <button
        type="submit"
        className="btn btn-primary checkout-submit-btn"
        style={{ width: '100%', height: 52, padding: '0 14px', marginTop: 10, borderRadius: 12, fontSize: '1rem' }}
        disabled={isCheckingOut}
        data-testid="cart-checkout-btn"
      >
        {isCheckingOut
          ? 'Đang xử lý đơn hàng...'
          : !user && onRequireAuth
          ? `Đăng nhập để thanh toán (${formatPrice(finalTotal)})`
          : effectivePaymentMethod === 'COD'
          ? `Đặt hàng (${formatPrice(finalTotal)})`
          : `Thanh toán trực tiếp PayOS (${formatPrice(finalTotal)})`}
      </button>
    </form>
  );
};
