# DAFL — Sàn thương mại điện tử (fork GlowMart)

Ứng dụng thương mại điện tử DAFL (bản fork mỹ phẩm đa gian hàng "GlowMart"),
là hệ thống được kiểm thử (SUT) của đồ án tốt nghiệp Continuous Testing với
Quality Gate tự động. Repo này chứa mã nguồn FE + BE của SUT.

- **Shop (web bán hàng):** http://localhost:3000
- **Admin (trang quản trị):** http://localhost:3001
- **Backend API:** http://localhost:5000

## Tách Web / Admin — cấu trúc thư mục riêng (đợt 13)

Shop và admin **tách hẳn thành 2 app riêng** dưới `src/` (npm workspaces),
code dùng chung để ở `src/Shared/`; backend vẫn 1 API chung:

| | Shop (web) | Admin | Dùng chung |
|---|---|---|---|
| Thư mục | `src/Frontend/` | `src/Admin/` | `src/Shared/` |
| Service Docker | `frontend` (`dafl-frontend`) | `admin` (`dafl-admin`) | — |
| Cổng | `${FRONTEND_PORT:-3000}` | `${ADMIN_PORT:-3001}` | — |
| Dockerfile | `src/Frontend/Dockerfile` | `src/Admin/Dockerfile` | — |
| Script npm (chạy ở `src/`) | `npm run build:web` / `npm run test:web` | `npm run build:admin` / `npm run test:admin` | — |

```text
src/
├── Frontend/        ← app shop: App.tsx, components/ (shop, giỏ, checkout, hội viên...), test/
├── Admin/           ← app admin riêng: App.tsx, components/admin/AdminPage.tsx, test/
├── Shared/          ← dùng chung: components/auth/AuthModal.tsx (đăng nhập + quên mật khẩu),
│                      utils/api.ts, styles/auth.css, types.ts
├── package.json     ← npm workspaces: ["Frontend", "Admin", "Shared"]
└── node_modules/    ← hoist chung (chạy `npm install` 1 lần ở src/)
```

`src/Shared/components/auth/AuthModal.tsx` là form đăng nhập dùng chung cả
shop lẫn admin (kể cả luồng "Quên mật khẩu" đợt 13); ở admin nó render dạng
trang (`isModal={false}`, `adminOnly`) với khung `.auth-page-wrapper` căn
giữa và **không có nút quay lại**. Trang Hội viên riêng (`/membership`) chỉ
có ở shop. Xem `src/package.json` (scripts `build:web`, `build:admin`,
`test:web`, `test:admin`).

### Backend KHÔNG tách

Chỉ có **1 API chung** phục vụ cả 2 app (cùng container `dafl-backend`, cùng
database PostgreSQL). Tách backend thành 2 service là việc khác, chưa làm.

## Build / chạy riêng từng phần

```bash
# Chạy tất cả service (postgres, kafka, backend, shop :3000, admin :3001)
docker compose up -d --build

# Chỉ build + chạy riêng từng app FE (backend vẫn cần chạy để có API)
docker compose build frontend && docker compose up -d frontend   # shop :3000
docker compose build admin && docker compose up -d admin         # admin :3001

# Đổi cổng admin: đặt ADMIN_PORT trong file .env rồi chạy lại compose
```

Build/test FE trực tiếp bằng npm (ở `src/` — workspace root, chạy
`npm install` 1 lần ở đây; không dùng tiền tố `VAR=value` kiểu Unix nên
chạy được cả trên Windows lẫn Linux/CI):

```bash
cd src
npm run build:web    # build app shop (tsc + vite build, workspace dafl-frontend)
npm run build:admin  # build app admin riêng (workspace dafl-admin)
npm run test:web     # vitest app shop
npm run test:admin   # vitest app admin riêng
```

## Kiểm thử Selenium (repo test riêng)

Bộ test Selenium nằm ở repo đồ án `linh1912/DAFL_DO_AN_TOT_NGHIEP`
(thư mục `automation/`), đã tách thành 2 suite:

- `testng-web.xml` — test web bán hàng (chạy với shop `:3000`).
- `testng-admin.xml` — test admin (chỉ cần app admin `:3001` + tài khoản
  `admin@dafl.vn` đã seed, không mở `:3000`).
- `testng.xml` — chạy cả 2 suite.

Số lượng test từng suite thay đổi theo thời gian — xem `TEST-MAPPING.md`
trong repo test để biết số liệu mới nhất. Chạy tay trên Windows:

```bat
cd automation
run_test_web.bat      :: chi test web (testng-web.xml)
run_test_admin.bat    :: chi test admin (testng-admin.xml)
```

## CI (Jenkins) — 2 stage test nối tiếp

Pipeline trong `Jenkinsfile` (repo này) chạy test chức năng thành 2 stage
**nối tiếp** (không song song, vì 2 stage chung 1 workspace Jenkins — chạy
song song sẽ đụng nhau ở `target/surefire-reports`):

1. `Functional Regression - Web` — `mvn clean test -DsuiteXmlFile=testng-web.xml`
2. `Functional Regression - Admin` — `mvn test -DsuiteXmlFile=testng-admin.xml`

Stage Admin **không** `mvn clean` và không xóa `target/` để
`target/surefire-reports` giữ kết quả của cả 2 suite cho stage
`Functional Quality Gate` phía sau kiểm tra. Mỗi stage giữ nguyên khối post
thu thập junit / archive artifact / Allure. Logic Quality Gate, deploy và các
stage khác không đổi.

> **Lưu ý:** `Jenkinsfile` ở repo này checkout SUT rồi chạy test từ thư mục
> `tests/functional-selenium/` trong SUT — thư mục này hiện chỉ có file
> `testng.xml` cũ (chưa có `testng-web.xml` / `testng-admin.xml`), nên 2 stage
> mới sẽ fail cho tới khi 2 file suite đó được đồng bộ vào
> `tests/functional-selenium/`. Trong repo test
> (`linh1912/DAFL_DO_AN_TOT_NGHIEP`), 2 file suite đã có sẵn trong
> `automation/` và `Jenkinsfile` / `Jenkinsfile.auto` ở đó chạy được ngay.

## Giới hạn còn lại của đợt tách này

- Backend là 1 service chung, chưa tách.
- Tài khoản admin mặc định được seed bởi backend (`admin@dafl.vn` /
  `Admin@123` khi DB chưa có tài khoản này); đổi mật khẩu admin không nằm
  trong phạm vi đợt này.
