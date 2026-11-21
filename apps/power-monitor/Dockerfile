FROM oven/bun:1-alpine
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --production
COPY . .
ENV NODE_ENV=production
EXPOSE 3100
CMD ["bun", "run", "src/index.ts"]
