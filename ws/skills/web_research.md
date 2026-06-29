# Web Research

Use this skill when you need current information from the public web.

This documents the broader web-research tool set. Use it when your session exposes `web_search`, `web_fetch`, or `browser`.

## Tool Choice

- `web_search` for discovery and broad lookup
- `web_fetch` for reading a specific URL
- `browser` for interactive sites, forms, screenshots, and scraping

## How To Choose

- Start with `web_search` when you do not know the right page yet.
- Use `web_fetch` when you already have a URL and just need the page content.
- Use `browser` when the page is dynamic, requires clicks, or needs visual interaction.

## Practical Rules

- Prefer primary sources for technical facts.
- Cite dates when the topic can change over time.
- If `web_fetch` returns HTML noise, switch to `textOnly=true` or use `browser`.
- For browser work, see [browser.md](browser.md).

## Example Workflow

1. Search for the topic.
2. Open the most relevant result.
3. Fetch the page or browse it interactively.
4. Summarize only the parts needed for the task.

## Notes

- Use the browser tool directly when the site is already known and interactive.
- Do not assume a website is static just because it loads in a browser.
