# Creating Skills

This is a reference for creating new skills. Read this when you need to create a new skill file.

## What is a Skill?

A skill is a markdown file that documents how to use an API or tool. Skills are stored in `/app/ws/skills/` as `.md` files.

## Creating a New Skill

Use the `write_file` tool to create a new skill file:

```
write_file with:
  path = "/app/ws/skills/your_skill_name.md"
  content = "<skill content>"
```

## Skill Format

```markdown
# Skill Name

Brief description of what this API/tool does.

## Setup

**Required**: What the user needs (API key, account, etc.)

Common variable names: `VARIABLE_NAME_1`, `VARIABLE_NAME_2`

When constructing curl commands, use shell variable expansion with the actual variable name:
- If `VARIABLE_NAME_1` is configured: use `$VARIABLE_NAME_1`
- If `VARIABLE_NAME_2` is configured: use `$VARIABLE_NAME_2`

If no key is configured, use `set_env_var` to add one.

## <Feature Name>

Description of this feature/endpoint.

**Endpoint**: `https://api.example.com/endpoint`

```bash
curl -s -X POST "https://api.example.com/endpoint" \
  -H "Authorization: Bearer $API_KEY_VAR" \
  -H "Content-Type: application/json" \
  -d '{
    "param": "value"
  }'
```

### Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `param` | yes/no | value | What it does |

### Response

```json
{
  "result": "example"
}
```

## Errors

- `Error message`: What it means and how to fix it
```

## Important Rules

### Environment Variables

1. **Never hardcode API keys** - Always use shell variable expansion (`$VAR_NAME`)
2. **Check existing vars first** - Use `get_env_vars` to see what's configured
3. **List common variable names** - Different users may use different naming conventions
4. **Secrets are masked** - You cannot see actual secret values from `get_env_vars`, but you can use them via shell expansion

### Shell Commands in Skills

1. **Use `$VAR_NAME` syntax** - This allows shell expansion when the command runs
2. **Always use `-s` flag with curl** - Silent mode for cleaner output
3. **Use single quotes for JSON body** - Prevents shell expansion inside JSON

### Examples

Good curl command:
```bash
curl -s -X POST "https://api.example.com/endpoint" \
  -H "Authorization: Bearer $SERVICE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "hello"}'
```

Bad (hardcoded key):
```bash
curl -X POST "https://api.example.com/endpoint" \
  -H "Authorization: Bearer sk-12345" \
  -d '{"prompt": "hello"}'
```

## Naming Convention

- Use lowercase with underscores: `image_generation.md`, `web_search.md`
- Name should describe the capability, not the API: `send_email.md` not `sendgrid.md`
- Keep it short but descriptive

## Installing Additional Tools

Pre-installed: `python3`, `pip`, `curl`, `git`, `jq`, `sqlite3`, `zip`, `unzip`, `wget`, `agent-browser` (browser automation CLI)

For browser automation, use the `browser` tool directly - no installation needed.

Install more with `exec`:
```bash
apt-get update && apt-get install -y <package>   # System packages
pip install <package>                             # Python packages
```

Note: apt-get installs are lost on container rebuild.
