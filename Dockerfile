FROM node:22-slim

# Install dependencies for Chromium and gosu for privilege dropping
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-sandbox \
    fonts-liberation \
    fonts-noto-color-emoji \
    fonts-noto-cjk \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxkbcommon0 \
    libxrandr2 \
    libxrender1 \
    libxshmfence1 \
    libxss1 \
    libxtst6 \
    xdg-utils \
    wget \
    ca-certificates \
    gosu \
    curl \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Install Docker Compose so this container can orchestrate others
RUN curl -L "https://github.com/docker/compose/releases/download/1.29.2/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose && \
    chmod +x /usr/local/bin/docker-compose

# Create a dummy crash handler if it doesn't exist (Chromium workaround)
RUN if [ ! -f /usr/lib/chromium/chrome_crashpad_handler ]; then \
      echo '#!/bin/sh' > /usr/lib/chromium/chrome_crashpad_handler && \
      echo 'exit 0' >> /usr/lib/chromium/chrome_crashpad_handler && \
      chmod +x /usr/lib/chromium/chrome_crashpad_handler; \
    fi

WORKDIR /app

# Install pnpm globally with retry logic
RUN npm install -g pnpm --registry=https://registry.npmjs.org/ || \
    npm install -g pnpm --registry=https://registry.npmjs.org/

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Install dependencies with increased timeout and retry logic
RUN pnpm config set network-timeout 600000 && \
    pnpm config set registry https://registry.npmjs.org/ && \
    pnpm install --no-frozen-lockfile --prod=false || \
    pnpm install --no-frozen-lockfile --prod=false

# Copy entrypoint script first (before changing user context)
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Copy application code
COPY . .

# Create scraper user - handle whether node user exists or not
RUN if id node >/dev/null 2>&1; then \
      usermod -l scraper node && \
      groupmod -n scraper node && \
      usermod -d /home/scraper -m scraper; \
    else \
      groupadd -r scraper && \
      useradd -r -g scraper -m -d /home/scraper scraper; \
    fi

# Create directories with wide-open permissions for Docker volume mounts (Windows compatibility)
RUN mkdir -p /app/data \
             /app/data/dawn/lists \
             /app/data/dawn/articles \
             /app/data/dawn/logs \
             /app/data/app/lists \
             /app/data/app/articles \
             /app/data/app/logs \
             /app/data/progress/refetch_nulls \
             /app/logs \
             /home/scraper && \
    chmod -R 777 /app/data && \
    chmod -R 777 /app/logs && \
    chown -R scraper:scraper /app

# Environment variables for Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    DOCKER_ENV=true \
    HOME=/home/scraper \
    NODE_ENV=production

# Set entrypoint (runs as root, then switches to scraper user via gosu)
ENTRYPOINT ["/entrypoint.sh"]

# Default command - keeps container alive for manual commands
CMD ["tail", "-f", "/dev/null"]