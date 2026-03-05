<p align="center"><img src="frontend/public/logo.svg" alt="S3pia" width="400"></p>

An AI assistant with autonomous background code execution.

A lightweight, Docker-focused version of [OpenClaw](https://github.com/openclaw/openclaw).

## Features

- **Single Docker Container** — Simple install, one command setup
- **Web Interface** — Chat with S3pia in your browser
- **Telegram** — Connect via Telegram bot
- **Memory** — Persistent long-term memory across conversations
- **Soul & Identity** — Customizable personality that evolves over time
- **Scheduled Tasks** — Cron-style background jobs and reminders
- **Skills** — Prebuilt recipes + agent can create its own skills
- **Browser Access** — Agent can browse the web
- **Image Generation** — Generate images with FAL AI

**Prebuilt Skills:** Web Browsing • Image Generation • Task Scheduling

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/marcelrsoub/s3pia/main/install.sh | bash
```

One command. The installer checks Docker, clones the repo, and starts a single container.

Then open **http://localhost:3210** and add your API key via the gear icon.

## Requirements

- [Docker](https://docs.docker.com/get-docker/)
- An API key from any supported provider

## AI Providers

| Provider | Get Key |
|----------|---------|
| Z.AI | [z.ai/subscribe](https://z.ai/subscribe) |
| OpenRouter | [openrouter.ai](https://openrouter.ai) |
| Anthropic | [console.anthropic.com](https://console.anthropic.com) |
| OpenAI | [platform.openai.com](https://platform.openai.com) |
| DeepSeek | [platform.deepseek.com](https://platform.deepseek.com) |
| Groq | [console.groq.com](https://console.groq.com) |
| Gemini | [ai.google.dev](https://ai.google.dev) |

## How It Works

**Chat with S3pia, get responses. Tasks run in the background:**
- S3pia processes your messages
- Code changes and tasks execute asynchronously
- Results appear as follow-up messages automatically

```
You: Update my IDENTITY.md to say my name is Marcel

S3pia: I'll update your IDENTITY.md for you.

[background execution...]

S3pia: Done! Updated your IDENTITY.md.
```

## File Structure

Your data lives in a Docker volume:

```
/app/ws/
├── IDENTITY.md       # Bot's identity (evolves over time)
├── USER.md           # Info about you
├── SOUL.md           # Bot's personality
├── BOOTSTRAP.md     # Initial setup instructions
├── config/           # API keys and settings
├── memory/           # Long-term memory
│   └── context.md
├── skills/           # Prebuilt and custom skills
├── tasks/            # Scheduled tasks
│   └── scheduled.md
└── temp/            # Temporary files
```

Edit these files directly — changes are immediately available.

## Scheduling & Tasks

S3pia uses a file-system based scheduling mechanism (inspired by OpenClaw):

- Tasks are defined in `tasks/scheduled.md`
- Agent reads tasks every 30 minutes
- Tasks can be one-time or recurring (cron-style)
- The agent can create its own scheduled tasks

## Skills

S3pia comes with prebuilt skills for common tasks:
- **Web Browsing** — Search the web, read articles
- **Image Generation** — Create images with FAL AI
- **Task Scheduling** — Schedule reminders and background jobs

The agent can also create custom skills by writing markdown recipes to the `skills/` folder.

## Mounting Additional Volumes

You can mount an additional directory to give the agent access to external data:

```yaml
services:
  s3pia:
    image: marcelrsoub/s3pia:latest
    container_name: s3pia
    restart: unless-stopped
    
    volumes:
      - s3pia-workspace:/app/ws
      - /path/on/host/custom:/app/custom        # Access to external folder
    
    ports:
      - "3210:3210"
    
    environment:
      - TELEGRAM_ENABLED=true
```

The agent can then access this path directly:
- `list_dir /custom` — list contents of mounted volume
- `read_file /custom/file.txt` — read files in mounted volume
- `write_file /custom/output.txt` — write files to mounted volume

## Commands

```bash
docker-compose up -d --build    # Start / rebuild
docker-compose down              # Stop
docker logs s3pia -f          # View logs
docker-compose exec s3pia sh  # Shell into container
```

## Documentation

- [Deployment Guide](DEPLOY.md) — Deploy to NAS, VPS, or any Docker host
- [Telegram Setup](docs/telegram.md) — Connect your Telegram bot
- [Architecture](docs/architecture.md) — How the agent works
- [Full Index](docs/INDEX.md) — All documentation

## License

MIT
