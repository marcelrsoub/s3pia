# S3pia Development Guide

In this project we want to build a minimalist version of OpenClaw, a project that went viral and is available on GitHub. S3pia will be an autonomous AI agent that can run tasks in the background, has access to a folder inside a Docker container, and can execute any type of Bash script or task—create files, write files, execute these files—all inside the container. On top of that it has built‑in tools and built‑in channels used to talk to the user.

We have Telegram, and tools such as writing files, reading files, patching, executing scripts, and sending the user a message. Another capability is skills: the model can create skills for itself—a recipe of what it can do or execute—so it can read straight from the file without needing to search the lab. Also, the agent has a system to schedule tasks.

The system has a heartbeat every 30 minutes. Every 30 minutes it checks for tasks to execute, and if any exist it sends them to the agent, which chooses how to execute them. 


The agent is fully autonomous and can evolve by editing and creating files in the workspace. The agent can create its own skills, update its own identity and personality, and schedule new tasks for itself. The workspace is a persistent volume in Docker, so all changes are saved across restarts.

> **Docker-only deployment.** This project runs exclusively in Docker containers.

## Quick Start for Development

```bash
# Build and start the container
docker-compose up -d --build

# View logs
docker logs s3pia -f

# Clean start (fresh start)
docker-compose down -v

# Stop containers
docker-compose down

# Run commands in container
docker-compose exec s3pia bun
```

## File Structure

### In the Container

| Path | Purpose |
|------|---------|
| `/app` | Application code (read-only, from image) |
| `/app/ws` | User workspace (volume mount) |
| `/app/config` | App configuration |

### On Your Machine

| Path | Purpose |
|------|---------|
| `src/` | TypeScript source code |
| `frontend/` | React frontend (builds to `frontend/dist`) |
| `ws/` | Workspace template (copied to `/app/ws` on first run) |
| `docs/` | Documentation |


Available scripts:
- `bun run lint` - Check code for linting issues
- `bun run lint:fix` - Apply safe linting fixes
- `bun run format` - Check code formatting
- `bun run format:fix` - Format code automatically
- `bun run check` - Run both linting and formatting checks
- `bun run check:fix` - Apply all safe fixes

## Building the Frontend

The frontend must be built before creating the Docker image:

```bash
# From your host machine
cd frontend
bun install
bun run build
```

The built files go to `frontend/dist/` which is copied into the Docker image.

## Key Paths (Hardcoded for Docker)

Since this is Docker-only, paths are hardcoded:

| Code Reference | Path |
|---------------|------|
| Database | `/app/ws/s3pia.db` |
| Workspace | `/app/ws` |
| Environment/Settings | `/app/ws/config/.env` |
| Scheduled Tasks | `/app/ws/tasks/scheduled.md` |
| Agent Memory | `/app/ws/memory/context.md` |
| Skills | `/app/ws/skills/*.md` |

## File-Centric State Model

All persistent state is stored in human-readable files:

```
/app/ws/
├── config/.env          # API keys and configuration
├── skills/*.md          # Deterministic recipes (agent can create new)
├── tasks/scheduled.md   # Scheduled tasks
├── memory/context.md    # Agent's long-term memory
└── s3pia.db          # SQLite for conversation history only
```

The agent can read and write all configuration files using the `read_file` and `write_file` tools, enabling self-improvement.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests:

```bash
docker-compose exec s3pia bun test
```

```ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Development Workflow

1. Make code changes on your host machine
2. Rebuild and restart: `docker-compose up -d --build`
3. Check logs: `docker logs s3pia -f`
4. Run linting: `docker-compose exec s3pia bun run check:fix`

## Adding Features

When adding new features:

1. **Database changes**: Schema is auto-migrated on startup
2. **New tools**: Tools infrastructure exists but is not currently integrated with Core Agent. See `docs/tools.md` for details.
3. **New API endpoints**: Add to `src/router.ts`
4. **Frontend changes**: Build with `bun run build` in `frontend/`
5. **AI Provider changes**: Both Z.AI and OpenRouter are supported via `src/ai/client.ts`

## Architecture Overview

The system uses a synchronous agent loop that executes tools directly (no background workers):

1. **Agent Loop** (`src/agent.ts`) - Receives messages, decides actions, executes tools in a loop until complete
2. **Direct Tools** (`src/tools.ts`) - Tools execute in-process, no subprocess spawning
3. **Skills System** (`src/skills.ts`) - Curated step-by-step recipes for common tasks
4. **Heartbeat Scheduler** (`src/heartbeat.ts`) - Scheduled tasks with human-readable format
5. **Channels** (`src/channels/`) - Web and Telegram input/output

See `docs/architecture.md` for full details.

## Debugging

```bash
# Shell into the container
docker-compose exec s3pia sh

# Check database
docker-compose exec s3pia bun -e "console.log(require('bun:sqlite').open('/app/ws/s3pia.db').query('SELECT * FROM settings'))"

# View workspace files
docker-compose exec s3pia ls -la /app/ws
```
