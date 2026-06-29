# Architecture

This is the developer-facing design compass for S3pia. It is for planning and implementation, not something the prod agent needs to read at runtime.

S3pia keeps behavior policy in repo-owned code and docs, and keeps mutable agent state in the workspace volume.

## Workspace Boundary

- `ws/` in the repo is the seed template.
- On startup, the app copies missing seed files into `/app/ws`.
- The agent reads and writes the live `/app/ws` tree while it runs.
- Anything that should evolve during use belongs in `/app/ws`.
- Core behavior rules belong in repo-owned code or docs, not in workspace files.

## Agent Contract

- One conversation owns one active thread of work.
- The queue is internal durability, not the user-facing workflow.
- Background work can continue while the agent sends short, human receipts.
- Follow-up messages during active work default to updates on the current thread.
- Long tasks should write state to files and checkpoints instead of carrying full chat history.
- When context is tight, rebuild a compact snapshot from current artifacts instead of replaying everything.
- Before speaking on a long task, refresh the live thread state and prefer the newest user update.
- If blocked, ask one clear question and stop.
