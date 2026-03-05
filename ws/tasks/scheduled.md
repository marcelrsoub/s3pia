# Scheduled Tasks

This file defines scheduled tasks for SepiaBot.

## Format

Tasks use a simple human-readable format:

```yaml
## Task Name
Every: [schedule]
LastRun: [ISO timestamp - auto-updated]
Action: [description of what to do]
```

### Schedule Options

| Format | Example | Description |
|--------|---------|-------------|
| `X minutes` | `Every: 30 minutes` | Every X minutes |
| `X hours` | `Every: 2 hours` | Every X hours |
| `X days` | `Every: 1 day` | Every X days at current time |
| `X days at HH:MM` | `Every: 1 day at 09:00` | Every X days at specific time |
| `DayName at HH:MM` | `Every: Monday at 09:00` | Weekly on that day |
| `RunAt: [ISO]` | `RunAt: 2026-02-20T15:00:00Z` | One-time task (removed after execution) |

### Notes

- Tasks are checked every 10 minutes (aligned to :00/:10/:20...)
- The `LastRun` timestamp is automatically updated after execution
- One-time tasks (using `RunAt`) are removed after execution
- The `Action` field can span multiple lines
- Use the `send_message` tool to communicate results to channels: "web", "telegram", or "both"

---

## Active Tasks

Add tasks below. They will be parsed and executed when due.

## Proactive Check-in
Every: 2 days at 10:00
Action: Send a friendly check-in message to the user via telegram (or web if telegram not available).

Be personal and warm. Briefly mention something from recent conversations or ask about their goals/projects. Keep it short - 1-2 sentences. Don't be robotic or overly formal.

Examples of good messages:
- "Hey! How's that project coming along?"
- "Thinking of you - hope you're having a good week!"
- "Just checking in! Anything I can help with today?"

<!-- Example tasks (uncomment to use:

## Daily Status Report
Every: 1 day at 09:00
LastRun: 2026-02-17T09:00:00Z
Action: Check system health and send a summary to the web interface

## Weekly Cleanup
Every: Monday at 00:00
LastRun: 2026-02-10T00:00:00Z
Action: Clean old temporary files from the workspace

-->
