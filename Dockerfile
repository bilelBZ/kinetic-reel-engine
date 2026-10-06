# Kinetic Reel Engine — container image for 24/7 rendering (bot or CLI).
FROM node:22-bookworm-slim

# FFmpeg for muxing/audio, Chromium for the HyperFrames render, and the font
# packages that keep Latin + Arabic typography identical across machines.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      chromium \
      fonts-inter \
      fonts-noto-core \
      fonts-liberation \
      ca-certificates \
      tini \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    HYPERFRAMES_BROWSER_PATH=/usr/bin/chromium \
    HYPERFRAMES_NO_UPDATE_CHECK=1 \
    NODE_ENV=production \
    CHROME_FLAGS="--no-sandbox --disable-dev-shm-usage"

WORKDIR /app

# Dependencies first so source edits do not invalidate the install layer.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY . .

# Chromium refuses to run as root without this in many container runtimes.
ENV PUPPETEER_ARGS="--no-sandbox"

# Non-root runtime user; scratch/ holds generated projects.
RUN mkdir -p /app/scratch && chown -R node:node /app
USER node

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "telegram-bot.mjs"]
