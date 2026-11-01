import React from 'react';
import {
  ShoppingBag, Search, Bell, LogOut, User as UserIcon,
  Sun, Moon, ChevronDown, X, Package, Store, Newspaper, Heart
} from 'lucide-react';
import { User } from '../../types';

export interface HeaderProps {
  searchQuery: string;
  setSearchQuery: (val: string) => void;
  onNavigate: (route: 'home' | 'cart' | 'login' | 'register' | 'orders' | 'profile' | 'notifications') => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  unreadCount: number;
  onToggleNotif: () => void;
  user: User | null;
  profileFullName: string;
  isAccountDropdownOpen: boolean;
  setIsAccountDropdownOpen: (open: boolean) => void;
  accountDropdownRef: React.RefObject<HTMLDivElement>;
  onLogout: () => void;
  onOpenAuth: () => void;
  totalItemCount: number;
  onOpenCart: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  searchQuery,
  setSearchQuery,
  onNavigate,
  theme,
  onToggleTheme,
  unreadCount,
  onToggleNotif,
  user,
  profileFullName,
  isAccountDropdownOpen,
  setIsAccountDropdownOpen,
  accountDropdownRef,
  onLogout,
  onOpenAuth,
  totalItemCount,
  onOpenCart,
}) => {
  return (
    <>
      <div className="dafl-topbar" aria-label="Ưu đãi DAFL">
        <span>MIỄN PHÍ VẬN CHUYỂN CHO ĐƠN TỪ 299.000Đ</span>
        <span>ĐỔI TRẢ TRONG 30 NGÀY</span>
        <span>HÀNG CHÍNH HÃNG 100%</span>
      </div>
      <header className="header" data-testid="header">
      <a
        href="/"
        onClick={(e) => { e.preventDefault(); onNavigate('home'); }}
        className="brand"
        data-testid="brand-logo"
      >
        <span className="brand-mark">D</span>
        <span className="brand-name">
          DAFL
          <small>MỸ PHẨM CHỌN LỌC</small>
        </span>
      </a>

      {/* Search Bar with Clear button */}
      <div className="search-bar" data-testid="search-bar">
        <Search className="search-icon" size={18} />
        <input
          type="text"
          className="search-input"
          placeholder="Tìm kiếm sản phẩm, thương hiệu và nhu cầu làm đẹp..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          data-testid="search-input"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', display: 'flex', padding: 2 }}
            title="Xóa tìm kiếm"
            data-testid="search-clear-btn"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Header Actions */}
      <div className="header-actions">
        <nav className="header-utilities" aria-label="Tiện ích DAFL">
          <button type="button" className="header-utility" onClick={() => onNavigate('home')}>
            <Store size={20} />
            <span>Cửa hàng</span>
          </button>
          <button type="button" className="header-utility" onClick={() => onNavigate('home')}>
            <Newspaper size={20} />
            <span>Tạp chí</span>
          </button>
          <button type="button" className="header-utility" onClick={() => onNavigate('home')}>
            <Heart size={20} />
            <span>Yêu thích</span>
          </button>
        </nav>

        {/* Theme Switch Toggle Button */}
        <button
          type="button"
          className="btn-theme-toggle"
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Chuyển sang giao diện Sáng' : 'Chuyển sang giao diện Tối'}
          aria-label="Chuyển đổi giao diện Sáng / Tối"
          data-testid="theme-toggle-btn"
        >
          <div className="theme-toggle-switch">
            <div className="theme-toggle-knob">
              {theme === 'dark' ? <Moon size={10} color="#1f2937" /> : <Sun size={10} color="#e40046" />}
            </div>
          </div>
          <span>{theme === 'dark' ? 'Theme Tối' : 'Theme Sáng'}</span>
        </button>

        {/* Notification Bell */}
        <button
          className="btn-icon"
          onClick={onToggleNotif}
          title="Thông báo đơn hàng & khuyến mãi"
          data-testid="notif-bell-btn"
        >
          <Bell size={19} />
          {unreadCount > 0 && <span className="badge-count" data-testid="notif-badge-count">{unreadCount}</span>}
        </button>

        {/* User Account Dropdown */}
        <div className="account-dropdown-wrapper" ref={accountDropdownRef}>
          <button
            type="button"
            className={`btn btn-secondary btn-account-toggle ${isAccountDropdownOpen ? 'active' : ''}`}
            onClick={() => setIsAccountDropdownOpen(!isAccountDropdownOpen)}
            title="Menu tài khoản & điều hướng các trang"
            data-testid="account-toggle-btn"
          >
            <div className="account-avatar-mini">
              {user ? user.fullName.charAt(0).toUpperCase() : <UserIcon size={20} />}
            </div>
            <span className="account-toggle-name">{user ? user.fullName : 'Đăng nhập'}</span>
            <ChevronDown size={14} className={`dropdown-chevron ${isAccountDropdownOpen ? 'open' : ''}`} />
          </button>

          {isAccountDropdownOpen && (
            <div className="account-dropdown-menu" data-testid="account-dropdown-menu">
              <div className="dropdown-header">
                <div className="dropdown-user-name">
                  {user ? user.fullName : 'Khách hàng'}
                </div>
                <div className="dropdown-user-role">
                  {user ? (user.role === 'Admin' ? 'Quản trị viên' : 'Thành viên DAFL') : 'Chưa đăng nhập'}
                </div>
              </div>

              <div className="dropdown-divider" />

              <div className="dropdown-nav-list">
                <button
                  type="button"
                  className="dropdown-nav-item"
                  onClick={() => {
                    setIsAccountDropdownOpen(false);
                    if (!user) {
                      onOpenAuth();
                    } else {
                      onNavigate('orders');
                    }
                  }}
                  data-testid="dropdown-orders-btn"
                >
                  <Package size={16} className="dropdown-item-icon" />
                  <span className="dropdown-item-label">Đơn hàng của tôi</span>
                </button>

                <button
                  type="button"
                  className="dropdown-nav-item"
                  onClick={() => {
                    setIsAccountDropdownOpen(false);
                    if (!user) {
                      onOpenAuth();
                    } else {
                      onNavigate('profile');
                    }
                  }}
                  data-testid="dropdown-profile-btn"
                >
                  <UserIcon size={16} className="dropdown-item-icon" />
                  <span className="dropdown-item-label">Thông tin & Sổ địa chỉ</span>
                </button>
              </div>

              <div className="dropdown-divider" />

              <div className="dropdown-footer">
                {user ? (
                  <button
                    type="button"
                    className="dropdown-logout-btn"
                    onClick={() => {
                      onLogout();
                      setIsAccountDropdownOpen(false);
                    }}
                    data-testid="dropdown-logout-btn"
                  >
                    <LogOut size={15} />
                    <span>Đăng xuất tài khoản</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary dropdown-login-btn"
                    onClick={() => {
                      onOpenAuth();
                      setIsAccountDropdownOpen(false);
                    }}
                    data-testid="dropdown-login-btn"
                  >
                    <UserIcon size={15} />
                    <span>Đăng nhập / Đăng ký</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Cart Button */}
        <button
          className="btn btn-cart"
          onClick={onOpenCart}
          data-testid="cart-btn"
        >
          <ShoppingBag size={18} />
          <span>Giỏ hàng</span>
          {totalItemCount > 0 && (
            <span className="badge-count" data-testid="cart-badge-count">
              {totalItemCount}
            </span>
          )}
        </button>
      </div>
      </header>
    </>
  );
};
