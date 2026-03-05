#!/bin/bash
#
# S3pia Installer
# One-script installation for Docker-based deployment
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/marcelrsoub/s3pia/main/install.sh | bash
#   OR
#   ./install.sh
#
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BROWN='\033[0;33m'
NC='\033[0m' # No Color

# Print colored message
msg() {
    echo -e "${1}${2}${NC}"
}

# Print step
step() {
    echo ""
    msg "$BLUE" "▶ $1"
}

# Print success
success() {
    msg "$GREEN" "✓ $1"
}

# Print error and exit
error() {
    msg "$RED" "✗ $1"
    exit 1
}

# Print warning
warn() {
    msg "$YELLOW" "! $1"
}

# Check if command exists
command_exists() {
    command -v "$1" &> /dev/null
}

# Get repository URL from git remote or default
get_repo_url() {
    if [ -d ".git" ]; then
        git remote get-url origin 2>/dev/null || echo "https://github.com/marcelrsoub/s3pia"
    else
        echo "https://github.com/marcelrsoub/s3pia"
    fi
}

# =============================================================================
# Main Installation
# =============================================================================

msg "$BROWN" ""
msg "$BROWN" "                        ▄▄          "
msg "$BROWN" "                        ██          "
msg "$BROWN" "                                    "
msg "$BROWN" " ▄██▀███ ██▀▀█▄ ▀████████▄▀███  ▄█▀██▄  "
msg "$BROWN" " ██   ▀▀███  ▀██  ██   ▀██  ██ ██   ██  "
msg "$BROWN" " ▀█████▄     ▄██  ██    ██  ██  ▄█████   "
msg "$BROWN" " █▄   ██   ▀▀██▄  ██   ▄██  ██ ██   ██   "
msg "$BROWN" " ██████▀      ██  ██████▀ ▄████▄████▀██▄"
msg "$BROWN" "       ███  ▄█▀   ██                    "
msg "$BROWN" "        █████▀  ▄████▄                  "
msg "$BROWN" ""
echo ""

# Step 1: Check Docker
step "Checking Docker installation..."
if ! command_exists docker; then
    error "Docker is not installed. Please install Docker first: https://docs.docker.com/get-docker/"
fi

if ! docker info &> /dev/null; then
    error "Docker is not running. Please start Docker and try again."
fi
success "Docker is installed and running"

# Step 2: Check Docker Compose
step "Checking Docker Compose..."
if command_exists docker-compose; then
    COMPOSE_CMD="docker-compose"
elif docker compose version &> /dev/null; then
    COMPOSE_CMD="docker compose"
else
    error "Docker Compose is not installed. Please install Docker Compose."
fi
success "Docker Compose is available ($COMPOSE_CMD)"

# Step 3: Get or clone repository
step "Setting up S3pia..."

SEPIABOT_DIR=""
REPO_URL=$(get_repo_url)

# Check if we're already in the s3pia directory
if [ -f "docker-compose.yml" ] && [ -f "Dockerfile" ]; then
    SEPIABOT_DIR="$(pwd)"
    success "Using current directory: $SEPIABOT_DIR"
else
    # Need to clone
    SEPIABOT_DIR="$HOME/s3pia"

    if [ -d "$SEPIABOT_DIR" ]; then
        warn "Directory $SEPIABOT_DIR already exists"
        read -p "Remove and reinstall? [y/N] " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            rm -rf "$SEPIABOT_DIR"
        else
            error "Installation cancelled. Remove $SEPIABOT_DIR or use a different location."
        fi
    fi

    msg "$YELLOW" "Cloning S3pia from $REPO_URL..."
    git clone "$REPO_URL" "$SEPIABOT_DIR"
    success "Cloned to $SEPIABOT_DIR"
fi

# Step 4: Change to s3pia directory
cd "$SEPIABOT_DIR"

# Step 5: Ask about bind mount for workspace
step "Workspace storage configuration..."
msg "$YELLOW" "By default, workspace data is stored in a Docker volume (not directly accessible from host)."
msg "$YELLOW" "A bind mount lets you access workspace files directly from your host machine."
echo ""

read -p "Bind workspace to a host directory? [y/N] " -n 1 -r
echo

BIND_MOUNT_PATH=""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    DEFAULT_PATH="$HOME/s3pia-data"
    read -p "  Path [$DEFAULT_PATH]: " BIND_MOUNT_PATH
    BIND_MOUNT_PATH="${BIND_MOUNT_PATH:-$DEFAULT_PATH}"
    BIND_MOUNT_PATH=$(eval echo "$BIND_MOUNT_PATH")
    
    if [[ "$BIND_MOUNT_PATH" != /* ]]; then
        BIND_MOUNT_PATH="$(pwd)/$BIND_MOUNT_PATH"
    fi
    
    if [ -d "$BIND_MOUNT_PATH" ]; then
        warn "Directory already exists: $BIND_MOUNT_PATH"
    else
        mkdir -p "$BIND_MOUNT_PATH"
        if [ $? -eq 0 ]; then
            success "Created directory: $BIND_MOUNT_PATH"
        else
            error "Could not create directory: $BIND_MOUNT_PATH"
        fi
    fi
    
    # Platform-specific permission handling
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        if chown -R "$(id -u):$(id -g)" "$BIND_MOUNT_PATH" 2>/dev/null; then
            success "Set ownership to current user (UID $(id -u))"
        else
            warn "Could not set ownership automatically"
            msg "$YELLOW" "  You may need: sudo chown -R \$(id -u):\$(id -g) $BIND_MOUNT_PATH"
        fi
        
        # Strip extended ACLs (fixes Synology Drive and NAS sync issues)
        if command -v setfacl &> /dev/null; then
            setfacl -R -b "$BIND_MOUNT_PATH" 2>/dev/null || true
        elif command -v synoacltool &> /dev/null; then
            synoacltool -del "$BIND_MOUNT_PATH" 2>/dev/null || true
        fi
        
        cat > docker-compose.override.yml << EOF
# Generated by install.sh - workspace bind mount
services:
  s3pia:
    user: "$(id -u):$(id -g)"
    volumes:
      - $BIND_MOUNT_PATH:/app/ws
EOF
        success "Created docker-compose.override.yml (Linux mode with user mapping)"
        
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        cat > docker-compose.override.yml << EOF
# Generated by install.sh - workspace bind mount
services:
  s3pia:
    volumes:
      - $BIND_MOUNT_PATH:/app/ws
EOF
        success "Created docker-compose.override.yml (macOS mode)"
        
    else
        cat > docker-compose.override.yml << EOF
# Generated by install.sh - workspace bind mount
services:
  s3pia:
    volumes:
      - $BIND_MOUNT_PATH:/app/ws
EOF
        success "Created docker-compose.override.yml"
        msg "$YELLOW" "  Note: If you have permission issues, you may need to adjust ownership of $BIND_MOUNT_PATH"
    fi
else
    msg "$BLUE" "Using Docker named volume (s3pia-workspace)"
    if [ -f "docker-compose.override.yml" ]; then
        rm docker-compose.override.yml
        success "Removed existing docker-compose.override.yml"
    fi
fi

# Step 6: Create .env file from example if it doesn't exist
step "Checking configuration..."
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        cp .env.example .env
        success "Created .env from .env.example"
    fi
else
    success ".env file already exists"
fi

# Step 7: Build and start containers
step "Building and starting S3pia..."
msg "$YELLOW" "This may take a few minutes on first run..."
$COMPOSE_CMD up -d --build

# Step 8: Wait for container to be healthy
step "Waiting for S3pia to start..."
MAX_WAIT=60
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
    if curl -sf http://localhost:3210/health > /dev/null 2>&1; then
        break
    fi
    sleep 2
    WAITED=$((WAITED + 2))
    echo -n "."
done
echo ""

if [ $WAITED -ge $MAX_WAIT ]; then
    warn "S3pia is taking longer than expected to start"
    msg "$YELLOW" "Check logs with: $COMPOSE_CMD logs -f"
fi

# Step 9: Done!
echo ""
msg "$GREEN" "═══════════════════════════════════════════════════════════════"
msg "$GREEN" "  S3pia is running!"
msg "$GREEN" "═══════════════════════════════════════════════════════════════"
echo ""
msg "$BLUE" "  Web UI:    http://localhost:3210"
msg "$BLUE" "  Directory: $SEPIABOT_DIR"
if [ -n "$BIND_MOUNT_PATH" ]; then
    msg "$BLUE" "  Workspace: $BIND_MOUNT_PATH (bind mount)"
fi
echo ""
msg "$YELLOW" "  Next steps:"
msg "$YELLOW" "  1. Open http://localhost:3210 in your browser"
msg "$YELLOW" "  2. Click the gear icon to configure your AI provider"
msg "$YELLOW" "  3. Add your API key (Z.AI or OpenRouter)"
msg "$YELLOW" "  4. Start chatting!"
echo ""
msg "$BLUE" "  Commands:"
msg "$BLUE" "    View logs:   cd $SEPIABOT_DIR && $COMPOSE_CMD logs -f"
msg "$BLUE" "    Stop:        cd $SEPIABOT_DIR && $COMPOSE_CMD down"
msg "$BLUE" "    Restart:     cd $SEPIABOT_DIR && $COMPOSE_CMD restart"
echo ""
