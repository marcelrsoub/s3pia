#!/bin/bash
set -e

echo ""
echo "🤎 SepiaBot"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# =============================================================================
# Permission fixes - ensure app files are readable
# =============================================================================
chmod -R a+rX /app/src 2>/dev/null || true
chmod -R a+rX /app/frontend/dist 2>/dev/null || true

# =============================================================================
# Workspace initialization
# =============================================================================
if [ ! -f "/app/ws/IDENTITY.md" ]; then
    echo "→ Initializing workspace..."
    if [ "$(id -u)" = "0" ]; then
        cp -r /app/ws-template/* /app/ws/
        chown -R 1000:1000 /app/ws 2>/dev/null || true
    else
        cp -r /app/ws-template/* /app/ws/
    fi
    echo "  Workspace initialized."
else
    echo "→ Using existing workspace."
fi

# Fix workspace permissions if running as root
if [ "$(id -u)" = "0" ]; then
    chmod -R a+rX /app/ws 2>/dev/null || true
fi

# =============================================================================
# Config initialization - create .env from template if missing
# =============================================================================
CONFIG_DIR="/app/ws/config"
ENV_FILE="$CONFIG_DIR/.env"
ENV_TEMPLATE="/app/.env.example"

mkdir -p "$CONFIG_DIR"

if [ ! -f "$ENV_FILE" ]; then
    if [ -f "$ENV_TEMPLATE" ]; then
        cp "$ENV_TEMPLATE" "$ENV_FILE"
        echo "→ Created config/.env from template"
    else
        # Create minimal .env if template missing
        cat > "$ENV_FILE" << 'EOF'
# SepiaBot Configuration
# Configure your AI provider below or use the web UI (click gear icon)

# ====== AI PROVIDER CONFIGURATION (Required) ======

# AI Provider Selection
# Options: zai, openrouter, anthropic, openai, deepseek, groq, gemini
AI_PROVIDER=
AI_MODEL=

# API Keys - Set the one for your chosen provider
ZAI_API_KEY=
OPENROUTER_API_KEY=
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
DEEPSEEK_API_KEY=
GROQ_API_KEY=
GEMINI_API_KEY=

# ====== OPTIONAL FEATURES ======

# Web Search (Tavily)
TAVILY_API_KEY=

# Image Generation (fal.ai)
FAL_AI_API_KEY=

# ====== TELEGRAM BOT (Optional) ======

# Get your bot token from @BotFather on Telegram
TELEGRAM_BOT_TOKEN=

# Message @userinfobot on Telegram to get your user ID
ADMIN_TELEGRAM_ID=

# Enable/disable Telegram (default: true)
# TELEGRAM_ENABLED=true

# ====== SERVER CONFIGURATION (Optional) ======

# Server Port (default: 3210)
# PORT=3210
EOF
        echo "→ Created empty config/.env"
    fi
fi

# =============================================================================
# Check configuration
# =============================================================================
MISSING_CONFIG=""

# Source the .env file to check values
set -a
source "$ENV_FILE" 2>/dev/null || true
set +a

if [ -z "$AI_PROVIDER" ]; then
    MISSING_CONFIG="AI_PROVIDER"
fi
if [ -z "$AI_MODEL" ]; then
    MISSING_CONFIG="$MISSING_CONFIG AI_MODEL"
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Web UI:     http://localhost:${PORT:-3210}"
echo "  Configure:  Open the UI and click the gear icon"
if [ -n "$MISSING_CONFIG" ]; then
    echo ""
    echo "  ⚠ Missing: $MISSING_CONFIG"
    echo "    Add to $ENV_FILE or use the web UI"
fi
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "Starting..."

exec bun run src/index.ts
