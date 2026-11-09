# DAFL Admin (trang quản trị, :3001) — app riêng src/Admin.
# Build context là ./src (workspace npm: Frontend + Admin + Shared) để
# import ../../Shared/... vào được image; xem docker-compose.yml.
# Trước đợt 13 file này là src/Frontend/Dockerfile.admin (build app shop
# với cờ VITE_ADMIN_ONLY=true); nay build thẳng app admin, không còn cờ đó.
# Stage 1: Build React App
FROM node:20-alpine AS build
WORKDIR /app

# Manifest của workspace root + 3 workspace (đủ để npm ci hoist deps chung).
COPY package.json package-lock.json ./
COPY Frontend/package.json ./Frontend/package.json
COPY Admin/package.json ./Admin/package.json
COPY Shared/package.json ./Shared/package.json
RUN npm ci

# Chỉ copy code admin + code dùng chung (không copy code shop).
COPY Admin ./Admin
COPY Shared ./Shared

WORKDIR /app/Admin
RUN npm run build

# Stage 2: Serve with Nginx Alpine
FROM nginx:1.25-alpine AS runtime

COPY --from=build /app/Admin/dist /usr/share/nginx/html
COPY Admin/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
