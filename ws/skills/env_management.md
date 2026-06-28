# Environment Management

Use this skill when you need to inspect or change configuration values in the workspace environment.

This is the canonical guide for the env-var tools when they are available in the session. If they are not exposed, edit the workspace config files directly instead.

## Tools

- `get_env_vars` lists configured variables and masks secrets
- `set_env_var` creates or updates a variable
- `delete_env_var` removes a variable

## Rules

- Use uppercase names with underscores.
- Check existing values before changing anything.
- Never hardcode secrets into files or prompts.
- Prefer OpenRouter-based config when available.

## Common Variables

- `OPENROUTER_API_KEY`
- `AI_MODEL`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ENABLED`
- `ADMIN_TELEGRAM_ID`

## Example Workflow

1. Inspect current variables with `get_env_vars`.
2. Update a value with `set_env_var`.
3. Restart or reload the relevant service if needed.

## Notes

- Secret values are masked in the listing output.
- Environment changes are stored in the workspace config.
