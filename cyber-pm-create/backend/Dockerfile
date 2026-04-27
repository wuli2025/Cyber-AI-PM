# 使用多阶段构建
FROM node:18-alpine AS builder

WORKDIR /app

# 安装依赖
COPY package*.json ./
RUN npm install

# 复制源码
COPY . .

# 运行阶段
FROM node:18-alpine

WORKDIR /app

# 安装依赖（生产环境）
COPY package*.json ./
RUN npm install --production && npm cache clean --force

# 复制应用文件
COPY --from=builder /app .

# 创建数据目录
RUN mkdir -p /app/data

# 暴露端口
EXPOSE 3001

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/api/health || exit 1

# 启动命令
CMD ["node", "server.js"]
