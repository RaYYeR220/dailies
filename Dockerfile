FROM node:24-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      git \
      ffmpeg \
      ca-certificates \
      fonts-liberation \
      libnss3 \
      libdbus-1-3 \
      libatk1.0-0 \
      libatk-bridge2.0-0 \
      libgbm1 \
      libasound2 \
      libxrandr2 \
      libxkbcommon0 \
      libxfixes3 \
      libxcomposite1 \
      libxdamage1 \
      libpango-1.0-0 \
      libcairo2 \
      libcups2 \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@12.11.2 --activate

WORKDIR /app
COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @dailies/web build

ENV DAILIES_DATA_DIR=/data

RUN mkdir -p /data \
    && useradd --create-home --shell /bin/bash dailies \
    && chown -R dailies:dailies /app /data

USER dailies

EXPOSE 3000
