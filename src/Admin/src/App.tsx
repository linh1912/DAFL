import React, { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import AdminPage from './components/admin/AdminPage';
import { AuthModal } from '../../Shared/components/auth/AuthModal';
import type { AuthResult } from '../../Shared/types';
import { apiJson, setSessionExpiredHandler, setToken } from '../../Shared/utils/api';

/**
 * App ADMIN riêng (localhost:3001) — đợt 13 tách khỏi app shop.
 * Trước đây là nhánh `IS_ADMIN_ONLY` trong src/Frontend/src/App.tsx
 * (cờ build VITE_ADMIN_ONLY=true); nay là app độc lập, không còn cờ đó.
 *
 * Chỉ có 2 màn: /login (AuthModal adminOnly — form cơ bản, không tab đăng ký,
 * không social) và /admin (AdminPage, tự chặn quyền: chưa đăng nhập hoặc
 * không phải SuperAdmin thì chuyển về /login). Route / và * đều về /admin.
 * Đăng nhập thành công chỉ lưu JWT rồi vào /admin; mọi dữ liệu lấy qua
 * /api/admin/* chung backend với shop (1 API chung, không tách backend).
 */
export default function App() {
  const navigate = useNavigate();
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginEmailError, setLoginEmailError] = useState<string | null>(null);
  const [loginPasswordError, setLoginPasswordError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    document.title = 'DAFL Admin — Quản trị';
  }, []);

  // 401 (CN-02 E3): phiên hết hạn → về màn hình đăng nhập kèm thông báo.
  useEffect(() => {
    setSessionExpiredHandler(() => {
      setSessionExpired(true);
      navigate('/login');
    });
    return () => setSessionExpiredHandler(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearAuthErrors = () => {
    setAuthError(null);
    setLoginEmailError(null);
    setLoginPasswordError(null);
  };

  const updateLoginEmail = (value: string) => {
    setLoginEmail(value);
    if (loginEmailError) setLoginEmailError(null);
  };

  const updateLoginPassword = (value: string) => {
    setLoginPassword(value);
    if (loginPasswordError) setLoginPasswordError(null);
  };

  const handleLogin = async (e: React.FormEvent, values?: { email: string; password: string }) => {
    e.preventDefault();
    clearAuthErrors();

    // Nhập "admin" cũng đăng nhập bằng tài khoản admin@dafl.vn
    // (AuthModal đã chuẩn hóa; đây là lớp đảm bảo nếu email đi qua state App).
    const rawEmail = (values?.email ?? loginEmail).trim().toLowerCase();
    const email = rawEmail === 'admin' ? 'admin@dafl.vn' : rawEmail;
    const password = values?.password ?? loginPassword;
    if (email !== loginEmail) setLoginEmail(email);

    if (!email) {
      setLoginEmailError('Email không được để trống.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setLoginEmailError('Email không đúng định dạng.');
      return;
    }
    if (!password) {
      setLoginPasswordError('Mật khẩu không được để trống.');
      return;
    }

    setAuthLoading(true);
    try {
      const { body } = await apiJson<AuthResult>('/api/auth/login', {
        method: 'POST',
        skipAuthHandler: true,
        body: JSON.stringify({ email, password }),
      });
      if (body?.success && body.data && body.data.token && body.data.user) {
        setToken(body.data.token);
        setSessionExpired(false);
        clearAuthErrors();
        navigate('/admin');
      } else {
        // CN-02.3: một thông điệp chung, hiện dưới ô mật khẩu (một chỗ duy nhất).
        setLoginPasswordError(
          body?.message || 'Email hoặc mật khẩu không đúng'
        );
      }
    } catch {
      setAuthError('Không thể kết nối đến máy chủ. Vui lòng kiểm tra mạng và thử lại sau.');
    } finally {
      setAuthLoading(false);
    }
  };

  return (
    <div className="admin-app" data-testid="admin-app">
      <Routes>
        <Route path="/admin" element={<AdminPage />} />
        <Route
          path="/login"
          element={(
            <AuthModal
              isOpen={true}
              isModal={false}
              adminOnly
              onClose={() => navigate('/admin')}
              authTab="login"
              setAuthTab={() => {}}
              authError={authError}
              authLoading={authLoading}
              loginEmail={loginEmail}
              setLoginEmail={updateLoginEmail}
              loginPassword={loginPassword}
              setLoginPassword={updateLoginPassword}
              registerName=""
              setRegisterName={() => {}}
              registerEmail=""
              setRegisterEmail={() => {}}
              registerPassword=""
              setRegisterPassword={() => {}}
              registerPhone=""
              setRegisterPhone={() => {}}
              onLogin={handleLogin}
              onRegister={() => {}}
              onClearAuthErrors={clearAuthErrors}
              loginEmailError={loginEmailError}
              loginPasswordError={loginPasswordError}
              sessionExpired={sessionExpired}
            />
          )}
        />
        <Route path="/" element={<Navigate to="/admin" replace />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </div>
  );
}
