# =============================================================================
# Stage 1: Build Frontend (multi-stage build for optimization)
# =============================================================================
FROM node:20-alpine AS frontend-builder

WORKDIR /build

# Copy frontend package files first for better layer caching
COPY frontend/package.json frontend/package-lock.json* ./

# Install frontend dependencies
RUN npm ci

# Copy frontend source code
COPY frontend/ ./

# Build frontend to dist folder
RUN npm run build

# =============================================================================
# Stage 2: Final Production Image
# =============================================================================
FROM oven/bun:1

# Install Python (for skills/tools that need it)
# The oven/bun image is based on Debian, so we use apt-get
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    curl \
    git \
    jq \
    sqlite3 \
    zip \
    unzip \
    wget \
    # Chromium dependencies (for agent-browser)
    libglib2.0-0 \
    libnspr4 \
    libnss3 \
    libatk1.0-0 \
    libdbus-1-3 \
    libatspi2.0-0 \
    libx11-6 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libxcb1 \
    libxkbcommon0 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3 /usr/bin/python

# Install common Python packages for data analysis/charting
RUN pip3 install --break-system-packages \
    matplotlib \
    pandas \
    numpy \
    requests

# Allow pip to install packages without --break-system-packages flag
# This removes Debian's EXTERNALLY-MANAGED restriction
RUN rm -f /usr/lib/python3*/EXTERNALLY-MANAGED

# Create a non-root user for better security and bind mount compatibility
# UID 1000 is the standard first user on most Linux systems
# --non-unique allows creation even if UID 1000 already exists in base image
RUN useradd -u 1000 --non-unique -m -s /bin/bash s3pia 2>/dev/null || \
    useradd -m -s /bin/bash s3pia || true

# Set working directory
WORKDIR /app

# Copy backend package files
COPY package.json bun.lock* ./

# Install backend dependencies
RUN bun install

# Install agent-browser for browser automation
RUN bun install -g agent-browser

# Install Node.js (required by agent-browser install command)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Download Chromium for agent-browser (system deps installed above)
RUN agent-browser install

# Copy backend source code
COPY src ./src
RUN chmod -R a+rX /app/src

# Copy tests
COPY tests ./tests
RUN chmod -R a+rX /app/tests

# Copy built-in tools (shipped with the application)

# Copy ONLY the built frontend assets from the builder stage
# This keeps the final image small by excluding node_modules and source code
COPY --from=frontend-builder /build/dist ./frontend/dist
RUN chmod -R a+rX /app/frontend/dist

# Copy workspace template (default files) - copied to volume on first run
COPY ws ./ws-template
RUN chmod -R a+rX /app/ws-template

# Copy .env.example to where entrypoint expects it
COPY ws/config/.env.example /app/.env.example
RUN chmod a+r /app/.env.example

# Copy entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod a+rx /usr/local/bin/docker-entrypoint.sh

# Ensure all app files are readable by non-root users (for bind mount compatibility)
RUN chmod -R a+rX /app

# Expose port
EXPOSE 3210

# Run via entrypoint
CMD ["docker-entrypoint.sh"]
