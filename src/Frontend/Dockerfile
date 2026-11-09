# DAFL Shop (web bán hàng, :3000) — app riêng src/Frontend.
# Build context là ./src (workspace npm: Frontend + Admin + Shared) để
# import ../../Shared/... vào được image; xem docker-compose.yml.
# Stage 1: Build React App
FROM node:20-alpine AS build
WORKDIR /app

# Manifest của workspace root + 3 workspace (đủ để npm ci hoist deps chung).
COPY package.json package-lock.json ./
COPY Frontend/package.json ./Frontend/package.json
COPY Admin/package.json ./Admin/package.json
COPY Shared/package.json ./Shared/package.json
# --include=dev: ép cài cả devDependencies (typescript, vite). Nếu môi
# trường build lược devDeps thì bước build dưới sẽ lỗi 127 (không thấy tsc).
RUN npm ci --include=dev

# Chỉ copy code shop + code dùng chung (không copy code admin).
COPY Frontend ./Frontend
COPY Shared ./Shared

WORKDIR /app/Frontend
# Gọi trực tiếp binary đã hoist ở /app/node_modules/.bin thay vì
# `npm run build`: npm trong image node:20-alpine không đưa .bin của
# workspace root vào PATH khi chạy script trong thư mục con, gây lỗi 127
# (sh: tsc: not found) dù `npm ci` đã cài đủ. Cách này đã kiểm chứng.
RUN ../node_modules/.bin/tsc && ../node_modules/.bin/vite build

# Stage 2: Serve with Nginx Alpine
FROM nginx:1.25-alpine AS runtime

COPY --from=build /app/Frontend/dist /usr/share/nginx/html
COPY Frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
