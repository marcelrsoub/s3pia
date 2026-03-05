# Scheduling Tasks

Schedule tasks to run automatically using the heartbeat system.

## How It Works

- **Heartbeat**: Checks for due tasks every 10 minutes (aligned to :00/:10/:20...)
- **Task File**: `/app/ws/tasks/scheduled.md`
- **To add a task**: Use `edit_file` to add a new task block to the file

## Task Format

Add tasks under the `## Active Tasks` section in this format:

```
## Your Task Name
Every: 1 day at 09:00
Action: Send a motivational message to telegram

## Or for one-time tasks:
## Reminder
RunAt: 2026-02-20T17:30:00Z
Action: Tell Marcel about the meeting
```

## Schedule Options

| Format | Example |
|--------|---------|
| Every X minutes | `Every: 30 minutes` |
| Every X hours | `Every: 2 hours` |
| Every X days | `Every: 1 day` |
| Every X days at time | `Every: 1 day at 09:00` |
| Weekly | `Every: Monday at 09:00` |
| One-time | `RunAt: 2026-02-20T17:30:00Z` |

## How to Add a Task

1. Read the current file: `read_file(path="/app/ws/tasks/scheduled.md")`
2. Use `edit_file` to insert your task after the `## Active Tasks` line

Example:
```
edit_file with:
  path = "/app/ws/tasks/scheduled.md"
  old_string = "## Active Tasks\n\nAdd tasks below."
  new_string = "## Active Tasks\n\nAdd tasks below.\n\n## 5pm Reminder\nRunAt: 2026-02-20T17:00:00Z\nAction: Send a message to telegram reminding Marcel about the meeting"
```

## How to Remove a Task

Use `edit_file` to remove the task block (from `## TaskName` to the end of the `Action:` line).

## Notes

- All times are in UTC
- One-time tasks (RunAt) are auto-deleted after execution
- The Action field describes what you want to happen - it runs with full tool access
