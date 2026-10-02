# Multi-stage or slim Dockerfile for Kinetic Reel Engine
FROM node:22-bookworm-slim

# Install FFmpeg and Chromium for headless video rendering
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    chromium \
    fonts-inter \
    fonts-liberation \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Set Puppeteer executable path for HyperFrames
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV NODE_ENV=production

WORKDIR /app

# Copy project files
COPY package.json ./
RUN npm install --production

COPY . .

# Start Telegram Bot daemon 24/7
CMD ["node", "telegram-bot.mjs"]
