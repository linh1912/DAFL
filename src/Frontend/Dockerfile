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
RUN npm ci

# Chỉ copy code shop + code dùng chung (không copy code admin).
COPY Frontend ./Frontend
COPY Shared ./Shared

WORKDIR /app/Frontend
RUN npm run build

# Stage 2: Serve with Nginx Alpine
FROM nginx:1.25-alpine AS runtime

COPY --from=build /app/Frontend/dist /usr/share/nginx/html
COPY Frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
