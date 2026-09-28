# syntax=docker/dockerfile:1

# 构建阶段：安装依赖 → 跑对拍测试 → 打包静态资源
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm test && npm run build

# 运行阶段：纯静态文件，离线可用
FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
