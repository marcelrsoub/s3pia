<p align="center"><img src="frontend/public/logo.svg" alt="S3pia" width="400"></p>

S3pia is a self-contained AI assistant that runs in one Docker container. It chats through Telegram, uses OpenRouter for AI, and keeps its state in a persistent workspace.

## Quick Start

```bash
curl -fsSL https://raw.githubusercontent.com/marcelrsoub/s3pia/main/install.sh | bash
```

Then open `http://localhost:3210` to edit config and check Telegram status.

## What It Includes

- Telegram-only interaction
- Persistent memory, skills, tasks, and generated pages
- Background execution for code changes and other work
- Built-in and custom skills
- A browser UI for config and status

## Requirements

- Docker
- An OpenRouter API key

## AI Backend

OpenRouter is the only supported LLM backend.

Set these values in `/app/ws/config/.env`:

```bash
OPENROUTER_API_KEY=your_key_here
AI_MODEL=anthropic/claude-sonnet-4
```

## Telegram

Telegram is the only user-facing channel. Messages can trigger background work, and results come back as follow-up messages. Telegram updates support simple markdown for bold, inline code, links, and bullets.

## Workspace

Your data lives in a Docker volume. The repo's `ws/` folder is the seed template copied into `/app/ws` on first start.

Key paths:

- `/app/ws/config/.env` - API keys and settings
- `/app/ws/memory/context.md` - long-term memory
- `/app/ws/tasks/scheduled.md` - scheduled tasks
- `/app/ws/skills/*.md` - built-in and custom skills
- `/app/ws/public_pages/` - generated local pages

## Scheduling

- Tasks live in `tasks/scheduled.md`
- The agent checks them every 10 minutes
- Tasks can be one-time or recurring

## Skills

- Built-in and custom skills live in `skills/`
- The agent can create new skills as markdown recipes

## Public Pages

- Write pages to `public_pages/<name>/index.html`
- Open them at `http://localhost:3210/pages/<name>/`
- Use a tunnel if you want to expose a page externally

## Additional Volumes

You can mount extra folders for the agent to access external files.

```yaml
services:
  s3pia:
    image: marcelrsoub/s3pia:latest
    container_name: s3pia
    restart: unless-stopped
    volumes:
      - s3pia-workspace:/app/ws
      - /path/on/host/custom:/app/custom
    ports:
      - "3210:3210"
    environment:
      - TELEGRAM_ENABLED=true
```

## Commands

```bash
docker-compose up -d --build
docker-compose down
docker logs s3pia -f
docker-compose exec s3pia sh
```

## Docs

- [Deployment Guide](DEPLOY.md)
- [Telegram Setup](docs/telegram.md)
- [Architecture](docs/architecture.md)
- [Full Index](docs/INDEX.md)

## License

MIT
