# Workspace IO

Use this skill for reading, writing, editing, listing, and executing code inside the workspace.

## When To Use

- Inspect files with `read_file`
- Create or overwrite files with `write_file`
- Make targeted replacements with `edit_file`
- Explore directories with `list_dir`
- Run workspace commands with `exec`

## Rules

- Use absolute paths inside `/app/ws`.
- Prefer `read_file` before editing so you know the current contents.
- Use `edit_file` for small changes and `write_file` for full-file rewrites.
- Use `exec` for tests, scripts, and one-off shell commands inside the container.
- When changing `BOOTSTRAP.md`, `IDENTITY.md`, `SOUL.md`, `USER.md`, or anything under `/skills/`, the cache is cleared automatically.

## Common Patterns

- Read a file:
  - `read_file(path="/app/ws/tasks/scheduled.md")`
- Patch a file:
  - `edit_file(path="/app/ws/skills/example.md", old_string="old", new_string="new")`
- Run tests:
  - `exec(command="bun test")`

## Notes

- The workspace is persistent across restarts.
- Keep edits small and deterministic when possible.
