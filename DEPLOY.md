# Deploy S3pia to Any Server

This guide covers deploying S3pia to any Docker-compatible server:
- Synology NAS (Docker Container Manager)
- QNAP NAS (Container Station)
- Any Linux server with Docker
- VPS (DigitalOcean, Linode, AWS Lightsail, etc.)

## Quick Start

```bash
curl -fsSL https://raw.githubusercontent.com/marcelrsoub/s3pia/main/install.sh | bash
```

Or manually:

```bash
git clone https://github.com/marcelrsoub/s3pia.git
cd s3pia
docker-compose up -d --build
```

---

## Platform-Specific Instructions

### Synology NAS

1. **Enable SSH** in Control Panel > Terminal & SNMP
2. **SSH into the NAS**: `ssh your-nas-ip`
3. Run the install command above
4. **Optional**: Use Container Manager UI to view/manage the container

### QNAP NAS

1. Enable SSH in Control Panel > Network Services > Telnet / SSH
2. SSH in and follow the standard install commands

### Linux Server / VPS

Standard deployment works as-is. Ensure Docker and Docker Compose are installed:

```bash
# Verify Docker is installed
docker --version
docker-compose --version
```

---

## Configuration

All configuration is done via the `.env` file. Key settings:

```bash
# Required: Choose an AI provider and set its key
AI_PROVIDER=zai
ZAI_API_KEY=your_key_here

# Optional: Telegram bot
TELEGRAM_BOT_TOKEN=your_bot_token
ADMIN_TELEGRAM_ID=your_telegram_id

# Optional: Web search
TAVILY_API_KEY=your_tavily_key

# Server port (default: 3210)
PORT=3210
```

You can also configure everything through the web UI after first launch.

---

## Data Persistence

All data is stored in a Docker volume (`s3pia_s3pia-workspace`) mounted at `/app/ws`:

- Database (`s3pia.db`)
- Configuration files (`.env`)
- User identity files
- Logs

**Backup the volume:**
```bash
docker run --rm -v s3pia_s3pia-workspace:/data -v $(pwd):/backup alpine tar -czf /backup/s3pia-backup-$(date +%Y%m%d).tar.gz /data
```

**Restore:**
```bash
docker-compose down
docker run --rm -v s3pia_s3pia-workspace:/data -v $(pwd):/backup alpine tar -xzf /backup/s3pia-backup-YYYYMMDD.tar.gz -C /
docker-compose up -d
```

---

## Updating

```bash
cd ~/s3pia
git pull
docker-compose up -d --build
```

**Note:** Your data is stored in a Docker volume and persists across container updates.

---

## Troubleshooting

**Container won't start:**
```bash
docker-compose logs
```

**Port already in use:**
Edit `docker-compose.yml` and change `3210:3210` to `8080:3210` (or another port).

**Health check failing:**
Check that the API is responding: `curl http://localhost:3210/health`

**Container restarts unexpectedly:**
Check logs: `docker-compose logs s3pia`

---

## Firewall Configuration

Ensure port `3210` is accessible:

- **Synology**: Control Panel > Security > Firewall
- **Linux**: `sudo ufw allow 3210` (if using UFW)
- **VPS provider**: Configure security group/firewall rules
