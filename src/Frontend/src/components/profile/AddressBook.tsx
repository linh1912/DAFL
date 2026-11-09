import React, { useCallback, useEffect, useState } from 'react';
import { MapPin, Plus, Pencil, Trash2, Check, Home } from 'lucide-react';
import { UserAddress } from '../../../../Shared/types';
import { apiJson } from '../../../../Shared/utils/api';
import {
  VIETNAM_PROVINCES,
  PROVINCES_AVAILABLE,
  findProvince,
  findDistrict,
  findWard,
} from '../../data/vietnamProvinces';

/**
 * Sổ địa chỉ trong trang Hồ sơ (CN-03.3):
 * - Tối đa 5 địa chỉ; địa chỉ đầu tiên tự thành mặc định.
 * - Xóa địa chỉ mặc định → BE tự đưa địa chỉ mới nhất còn lại lên mặc định.
 * - Mã địa giới gửi lên BE dạng STRING (AddressDto của BE là string).
 */

const MAX_ADDRESSES = 5;
const ERROR_COLOR = '#d81b60';
const fieldErrorStyle: React.CSSProperties = { color: ERROR_COLOR, fontSize: '0.85rem', marginTop: 6 };
const errorBorder = (hasError: boolean): React.CSSProperties => (hasError ? { borderColor: ERROR_COLOR } : {});

const isValidVietnamesePhone = (phone: string) => /^0\d{9}$/.test(phone.trim());

const normalizeAddress = (raw: any): UserAddress | null => {
  if (!raw || typeof raw !== 'object') return null;
  const pick = (camel: string, pascal: string) => raw[camel] ?? raw[pascal];
  const id = pick('id', 'Id');
  if (id == null) return null;
  return {
    id: String(id),
    recipientName: pick('recipientName', 'RecipientName') ?? '',
    phone: pick('phone', 'Phone') ?? '',
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

const composeFullAddress = (a: UserAddress) =>
  [a.detailAddress, a.wardName, a.districtName, a.provinceName]
    .map(part => (part || '').trim())
    .filter(Boolean)
    .join(', ');

interface AddressFormState {
  recipientName: string;
  phone: string;
  provinceCode: number | null;
  districtCode: number | null;
  wardCode: number | null;
  detailAddress: string;
  note: string;
  setAsDefault: boolean;
}

const emptyForm: AddressFormState = {
  recipientName: '',
  phone: '',
  provinceCode: null,
  districtCode: null,
  wardCode: null,
  detailAddress: '',
  note: '',
  setAsDefault: false,
};

interface AddressFormErrors {
  recipient?: string;
  phone?: string;
  province?: string;
  district?: string;
  ward?: string;
  detail?: string;
  form?: string;
}

export const AddressBook: React.FC = () => {
  const [addresses, setAddresses] = useState<UserAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AddressFormState>(emptyForm);
  const [errors, setErrors] = useState<AddressFormErrors>({});
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadAddresses = useCallback(async () => {
    try {
      const { body } = await apiJson<any>('/api/addresses');
      const list = Array.isArray(body?.data) ? body.data : [];
      setAddresses(list.map(normalizeAddress).filter(Boolean) as UserAddress[]);
    } catch {
      setAddresses([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAddresses();
  }, [loadAddresses]);

  const atLimit = addresses.length >= MAX_ADDRESSES;

  const openAddForm = () => {
    setEditingId(null);
    setForm(emptyForm);
    setErrors({});
    setFormOpen(true);
  };

  const openEditForm = (address: UserAddress) => {
    setEditingId(address.id);
    setForm({
      recipientName: address.recipientName,
      phone: address.phone,
      provinceCode: Number(address.provinceCode) || null,
      districtCode: Number(address.districtCode) || null,
      wardCode: Number(address.wardCode) || null,
      detailAddress: address.detailAddress,
      note: address.note || '',
      setAsDefault: address.isDefault,
    });
    setErrors({});
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setErrors({});
  };

  const selectedProvince = findProvince(form.provinceCode);
  const selectedDistrict = findDistrict(selectedProvince, form.districtCode);
  const selectedWard = findWard(selectedDistrict, form.wardCode);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const nextErrors: AddressFormErrors = {};
    const recipient = form.recipientName.trim();
    const phone = form.phone.trim();
    const detail = form.detailAddress.trim();
    if (recipient.length < 2 || recipient.length > 50) {
      nextErrors.recipient = 'Tên người nhận không hợp lệ';
    }
    if (!isValidVietnamesePhone(phone)) {
      nextErrors.phone = 'Số điện thoại không hợp lệ';
    }
    if (PROVINCES_AVAILABLE) {
      if (!selectedProvince) nextErrors.province = 'Vui lòng chọn tỉnh/thành phố.';
      if (!selectedDistrict) nextErrors.district = 'Vui lòng chọn quận/huyện.';
      if (!selectedWard) nextErrors.ward = 'Vui lòng chọn phường/xã.';
    }
    if (detail.length < 5) {
      nextErrors.detail = 'Địa chỉ chi tiết phải có ít nhất 5 ký tự.';
    }
    setErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) return;

    const payload = {
      recipientName: recipient,
      phone,
      provinceCode: String(selectedProvince?.code ?? form.provinceCode ?? ''),
      provinceName: selectedProvince?.name ?? '',
      districtCode: String(selectedDistrict?.code ?? form.districtCode ?? ''),
      districtName: selectedDistrict?.name ?? '',
      wardCode: String(selectedWard?.code ?? form.wardCode ?? ''),
      wardName: selectedWard?.name ?? '',
      detailAddress: detail,
      note: form.note.trim() || undefined,
      setAsDefault: form.setAsDefault,
    };

    setSaving(true);
    try {
      const { body } = editingId
        ? await apiJson<any>(`/api/addresses/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) })
        : await apiJson<any>('/api/addresses', { method: 'POST', body: JSON.stringify(payload) });
      if (body?.success) {
        closeForm();
        await loadAddresses();
      } else {
        setErrors({ form: body?.message || 'Không thể lưu địa chỉ. Vui lòng thử lại.' });
      }
    } catch {
      setErrors({ form: 'Không thể kết nối đến máy chủ. Vui lòng thử lại.' });
    } finally {
      setSaving(false);
    }
  };

  const handleSetDefault = async (address: UserAddress) => {
    setBusyId(address.id);
    try {
      const { body } = await apiJson<any>(`/api/addresses/${address.id}/default`, { method: 'PUT' });
      if (body?.success) await loadAddresses();
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (address: UserAddress) => {
    setBusyId(address.id);
    try {
      const { body } = await apiJson<any>(`/api/addresses/${address.id}`, { method: 'DELETE' });
      if (body?.success) {
        setConfirmDeleteId(null);
        if (editingId === address.id) closeForm();
        await loadAddresses();
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div data-testid="address-book">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h3 className="profile-section-title" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
          <MapPin size={17} color="var(--primary)" /> Sổ địa chỉ giao hàng
        </h3>
        <button
          type="button"
          className="btn btn-primary"
          style={{ padding: '9px 16px', display: 'flex', alignItems: 'center', gap: 6 }}
          onClick={openAddForm}
          disabled={atLimit || formOpen}
          data-testid="address-add-btn"
        >
          <Plus size={15} /> Thêm địa chỉ
        </button>
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: '8px 0 0' }}>
        Tối đa {MAX_ADDRESSES} địa chỉ. Địa chỉ đầu tiên tự động là mặc định; khi đặt hàng bạn có thể chọn địa chỉ khác trong sổ.
      </p>

      {atLimit && !formOpen && (
        <div data-testid="address-limit-error" style={{ color: ERROR_COLOR, fontSize: '0.85rem', marginTop: 10 }}>
          Bạn đã lưu tối đa {MAX_ADDRESSES} địa chỉ. Vui lòng xóa bớt trước khi thêm mới.
        </div>
      )}

      <div data-testid="address-book-list" style={{ display: 'grid', gap: 10, marginTop: 14 }}>
        {loading ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>Đang tải sổ địa chỉ…</p>
        ) : addresses.length === 0 && !formOpen ? (
          <div className="empty-state-inline">
            Bạn chưa lưu địa chỉ nào. Thêm địa chỉ để đặt hàng nhanh hơn.
          </div>
        ) : (
          addresses.map(address => (
            <div
              key={address.id}
              className="address-book-item"
              data-testid={`address-item-${address.id}`}
            >
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: '0.92rem' }}>{address.recipientName}</strong>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{address.phone}</span>
                  {address.isDefault && (
                    <span className="address-default-badge" data-testid={`address-default-badge-${address.id}`}>
                      <Home size={11} /> Mặc định
                    </span>
                  )}
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 3, lineHeight: 1.5 }}>
                  {composeFullAddress(address)}
                </div>
                {address.note && (
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 2 }}>
                    Ghi chú: {address.note}
                  </div>
                )}
              </div>
              <div className="address-book-actions">
                {!address.isDefault && (
                  <button
                    type="button"
                    className="btn btn-secondary address-action-btn"
                    onClick={() => handleSetDefault(address)}
                    disabled={busyId === address.id}
                    data-testid={`address-set-default-btn-${address.id}`}
                  >
                    Đặt mặc định
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-secondary address-action-btn"
                  onClick={() => openEditForm(address)}
                  disabled={busyId === address.id}
                  data-testid={`address-edit-btn-${address.id}`}
                >
                  <Pencil size={13} /> Sửa
                </button>
                {confirmDeleteId === address.id ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-primary address-action-btn"
                      onClick={() => handleDelete(address)}
                      disabled={busyId === address.id}
                      data-testid="address-delete-confirm-btn"
                    >
                      <Check size={13} /> Xác nhận xóa
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary address-action-btn"
                      onClick={() => setConfirmDeleteId(null)}
                      data-testid="address-delete-cancel-btn"
                    >
                      Hủy
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn btn-secondary address-action-btn address-delete-btn"
                    onClick={() => setConfirmDeleteId(address.id)}
                    disabled={busyId === address.id}
                    data-testid={`address-delete-btn-${address.id}`}
                  >
                    <Trash2 size={13} /> Xóa
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {formOpen && (
        <form
          onSubmit={handleSave}
          noValidate
          data-testid="address-form"
          style={{ marginTop: 16, border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 16, background: 'var(--bg-subtle)' }}
        >
          <h4 style={{ margin: '0 0 12px', fontSize: '0.95rem', fontWeight: 800 }}>
            {editingId ? 'Sửa địa chỉ' : 'Thêm địa chỉ mới'}
          </h4>
          <div className="address-form-grid">
            <div className="form-group">
              <label className="form-label" htmlFor="address-recipient">Tên người nhận</label>
              <input
                id="address-recipient"
                className="form-input"
                data-testid="address-recipient-input"
                value={form.recipientName}
                onChange={e => {
                  setForm(f => ({ ...f, recipientName: e.target.value }));
                  setErrors(prev => ({ ...prev, recipient: undefined }));
                }}
                style={errorBorder(!!errors.recipient)}
              />
              {errors.recipient && <div data-testid="address-recipient-error" style={fieldErrorStyle}>{errors.recipient}</div>}
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="address-phone">Số điện thoại</label>
              <input
                id="address-phone"
                className="form-input"
                inputMode="numeric"
                data-testid="address-phone-input"
                value={form.phone}
                onChange={e => {
                  setForm(f => ({ ...f, phone: e.target.value }));
                  setErrors(prev => ({ ...prev, phone: undefined }));
                }}
                style={errorBorder(!!errors.phone)}
              />
              {errors.phone && <div data-testid="address-phone-error" style={fieldErrorStyle}>{errors.phone}</div>}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="address-province">Tỉnh / Thành phố</label>
            <select
              id="address-province"
              className="form-input"
              data-testid="address-province-select"
              value={form.provinceCode ?? ''}
              onChange={e => {
                const code = e.target.value ? Number(e.target.value) : null;
                setForm(f => ({ ...f, provinceCode: code, districtCode: null, wardCode: null }));
                setErrors(prev => ({ ...prev, province: undefined, district: undefined, ward: undefined }));
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
            {errors.province && <div data-testid="address-province-error" style={fieldErrorStyle}>{errors.province}</div>}
          </div>

          <div className="address-form-grid">
            <div className="form-group">
              <label className="form-label" htmlFor="address-district">Quận / Huyện</label>
              <select
                id="address-district"
                className="form-input"
                data-testid="address-district-select"
                value={form.districtCode ?? ''}
                disabled={!selectedProvince}
                onChange={e => {
                  const code = e.target.value ? Number(e.target.value) : null;
                  setForm(f => ({ ...f, districtCode: code, wardCode: null }));
                  setErrors(prev => ({ ...prev, district: undefined, ward: undefined }));
                }}
                style={errorBorder(!!errors.district)}
              >
                <option value="">— Chọn Quận / Huyện —</option>
                {(selectedProvince?.districts ?? []).map(district => (
                  <option key={district.code} value={district.code}>
                    {district.name}
                  </option>
                ))}
              </select>
              {errors.district && <div data-testid="address-district-error" style={fieldErrorStyle}>{errors.district}</div>}
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="address-ward">Phường / Xã</label>
              <select
                id="address-ward"
                className="form-input"
                data-testid="address-ward-select"
                value={form.wardCode ?? ''}
                disabled={!selectedDistrict}
                onChange={e => {
                  setForm(f => ({ ...f, wardCode: e.target.value ? Number(e.target.value) : null }));
                  setErrors(prev => ({ ...prev, ward: undefined }));
                }}
                style={errorBorder(!!errors.ward)}
              >
                <option value="">— Chọn Phường / Xã —</option>
                {(selectedDistrict?.wards ?? []).map(ward => (
                  <option key={ward.code} value={ward.code}>
                    {ward.name}
                  </option>
                ))}
              </select>
              {errors.ward && <div data-testid="address-ward-error" style={fieldErrorStyle}>{errors.ward}</div>}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="address-detail">Địa chỉ chi tiết (số nhà, tên đường, tòa nhà...)</label>
            <input
              id="address-detail"
              className="form-input"
              data-testid="address-detail-input"
              value={form.detailAddress}
              onChange={e => {
                setForm(f => ({ ...f, detailAddress: e.target.value }));
                setErrors(prev => ({ ...prev, detail: undefined }));
              }}
              style={errorBorder(!!errors.detail)}
            />
            {errors.detail && <div data-testid="address-detail-error" style={fieldErrorStyle}>{errors.detail}</div>}
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="address-note">Ghi chú (không bắt buộc)</label>
            <input
              id="address-note"
              className="form-input"
              data-testid="address-note-input"
              value={form.note}
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
              placeholder="Ví dụ: Chung cư, tòa nhà, tầng..."
            />
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', cursor: 'pointer', margin: '4px 0 8px' }}>
            <input
              type="checkbox"
              data-testid="address-set-default-checkbox"
              checked={form.setAsDefault}
              onChange={e => setForm(f => ({ ...f, setAsDefault: e.target.checked }))}
            />
            Đặt làm địa chỉ mặc định
          </label>

          {errors.form && (
            <div data-testid="address-form-error" style={{ color: ERROR_COLOR, fontSize: '0.85rem', marginBottom: 10 }}>
              {errors.form}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
            <button type="button" className="btn btn-secondary" onClick={closeForm} data-testid="address-cancel-btn">
              Hủy
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving} data-testid="address-save-btn">
              {saving ? 'Đang lưu...' : editingId ? 'Lưu thay đổi' : 'Thêm địa chỉ'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
