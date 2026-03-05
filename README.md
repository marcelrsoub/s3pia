<p align="center"><img src="frontend/public/logo.svg" alt="S3pia" width="400"></p>

An AI assistant with immediate conversational responses and autonomous background code execution.

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

<p align="center">
  <img src="assets/env_edit.png" alt="Environment Configuration" width="600">
</p>

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

## What It Does

**Instant replies, background work:**
- Chat with S3pia → get an immediate response
- Code changes and tasks run in the background
- Results appear as follow-up messages automatically

```
You: Update my IDENTITY.md to say my name is Marcel

S3pia: I'll update your IDENTITY.md for you.    [instant]

[background execution...]

S3pia: Done! Updated your IDENTITY.md.          [auto follow-up]
```

## File Structure

Your data lives in a Docker volume at `/app/ws`:

```
/app/ws/
├── IDENTITY.md       # Bot's identity (evolves over time)
├── USER.md           # Info about you
├── SOUL.md           # Bot's personality
├── tasks/scheduled.md # Scheduled tasks
├── memory/context.md  # Long-term memory
└── config/.env       # API keys and settings
```

Edit these files directly — changes are immediately available.

## Mounting Additional Volumes

You can mount additional directories to give the agent access to external data:

```yaml
services:
  s3pia:
    # ... existing config ...
    volumes:
      - s3pia-workspace:/app/ws
      - /path/on/host/data:/data          # Add your volume here
      - /path/on/host/documents:/docs      # Add more volumes as needed
```

The agent can then access these paths directly:
- `list_dir /data` — list contents of mounted volume
- `read_file /data/file.txt` — read files in mounted volume
- `write_file /data/output.txt` — write files to mounted volume

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
