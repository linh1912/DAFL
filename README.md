# DAFL — Sàn thương mại điện tử (fork GlowMart)

Ứng dụng thương mại điện tử DAFL (bản fork mỹ phẩm đa gian hàng "GlowMart"),
là hệ thống được kiểm thử (SUT) của đồ án tốt nghiệp Continuous Testing với
Quality Gate tự động. Repo này chứa mã nguồn FE + BE của SUT.

- **Shop (web bán hàng):** http://localhost:3000
- **Admin (trang quản trị):** http://localhost:3001
- **Backend API:** http://localhost:5000

## Tách Web / Admin — thực tế đang làm được gì

Shop và admin **chung 1 codebase frontend** (`src/Frontend`), **chung 1 backend
API**, chỉ khác nhau ở cờ build + Dockerfile + service Docker:

| | Shop (web) | Admin |
|---|---|---|
| Service Docker | `frontend` (`dafl-frontend`) | `admin` (`dafl-admin`) |
| Cổng | `${FRONTEND_PORT:-3000}` | `${ADMIN_PORT:-3001}` |
| Dockerfile | `src/Frontend/Dockerfile` | `src/Frontend/Dockerfile.admin` |
| Cờ build | (mặc định, không đặt cờ) | `VITE_ADMIN_ONLY=true` (cố định trong `Dockerfile.admin`) |
| Script npm | `npm run build:web` | `npm run build:admin` |
| Test FE (vitest) | `npm run test:web` | `npm run test:admin` |

Khi build với `VITE_ADMIN_ONLY=true`, app chỉ render trang quản trị
(route `/` chuyển sang `/admin`), ẩn toàn bộ shop (header, banner, giỏ hàng…),
title đổi thành "DAFL Admin — Quản trị". Xem `src/App.tsx` (`IS_ADMIN_ONLY`)
và `src/test/AdminOnlyMode.test.tsx`.

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

Build/test FE trực tiếp bằng npm (trong `src/Frontend`). Các script mới chạy
được cả trên Windows lẫn Linux/CI — không dùng tiền tố `VAR=value` kiểu Unix:

```bash
cd src/Frontend
npm run build        # build mặc định (bản shop)
npm run build:web    # build bản shop thường (tương đương build)
npm run build:admin  # build bản admin-riêng: `tsc && vite build --mode admin`
npm run test         # chạy toàn bộ test vitest
npm run test:web     # chạy vitest TRỪ 2 file test admin
npm run test:admin   # chạy vitest CHỈ 2 file AdminPage.test.tsx + AdminOnlyMode.test.tsx
```

Cơ chế của `build:admin`: Vite với `--mode admin` tự nạp file
`src/Frontend/.env.admin` (chỉ chứa `VITE_ADMIN_ONLY=true`, không có secret
nên được commit cùng repo). `Dockerfile.admin` đặt thêm `ENV
VITE_ADMIN_ONLY=true` làm lớp dự phòng nếu thiếu file `.env.admin` trong
context build. `Dockerfile` cũ giữ nguyên cho shop, không đổi.

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

- Admin và shop vẫn chung 1 codebase FE — tách ở mức cờ build + Dockerfile +
  service Docker, **không** dời code, **không** tách thành 2 repo/thư mục FE.
- Backend là 1 service chung, chưa tách.
- Tài khoản admin mặc định được seed bởi backend (`admin@dafl.vn` /
  `Admin@123` khi DB chưa có tài khoản này); đổi mật khẩu admin không nằm
  trong phạm vi đợt này.
