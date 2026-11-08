# Stage 1: Build React App
FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . ./
# Build arg: VITE_ADMIN_ONLY=true để build bản admin-riêng (service dafl-admin,
# localhost:3001). Vite chỉ đọc biến VITE_* lúc build nên phải truyền qua ARG/ENV
# trước bước build; không truyền thì mặc định build bản shop thường.
ARG VITE_ADMIN_ONLY
ENV VITE_ADMIN_ONLY=$VITE_ADMIN_ONLY

RUN npm run build

# Stage 2: Serve with Nginx Alpine
FROM nginx:1.25-alpine AS runtime

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
