# Browser Automation

Control a web browser for navigation, interaction, and scraping. The browser is BUILT-IN and WORKS IMMEDIATELY.

## CRITICAL: No Installation Needed

**NEVER run any of these commands:**
- `npx playwright install` - DO NOT RUN
- `npm install playwright` - DO NOT RUN  
- `bunx playwright install` - DO NOT RUN
- `apt-get install` for browser deps - DO NOT RUN
- Any setup/installation command - DO NOT RUN

The browser works right now. Just use the `browser` tool directly.

## Important: `open` Only Returns Title

When you run `browser({command: "open <url>"})`, it returns ONLY the page title. You won't see the content.

**To see page content, you MUST use:**
- `snapshot` or `snapshot -i` - Returns the page structure with element refs
- `get text @ref` - Returns text from a specific element

## Workflow

1. **Open URL**: `browser({command: "open https://example.com"})`
2. **Get interactive elements**: `browser({command: "snapshot -i"})`
3. **Interact using refs**: Use refs like `@e1`, `@e2` from the snapshot
4. **Repeat**: Snapshot after navigation to get new refs

## Commands

| Command | Example | Description |
|---------|---------|-------------|
| `open <url>` | `open https://example.com` | Navigate to URL |
| `snapshot -i` | `snapshot -i` | Get interactive elements with refs |
| `click @ref` | `click @e5` | Click element by ref |
| `fill @ref 'text'` | `fill @e3 'hello world'` | Clear and fill input |
| `type @ref 'text'` | `type @e3 'more text'` | Append text to input |
| `press <key>` | `press Enter` | Press key (Enter, Tab, Escape, etc.) |
| `screenshot [path]` | `screenshot` or `screenshot /app/ws/temp/page.png` | Take screenshot |
| `wait <ref|ms>` | `wait @e10` or `wait 2000` | Wait for element or milliseconds |
| `get text @ref` | `get text @e7` | Get text content from element |
| `back` | `back` | Go back in history |
| `close` | `close` | Close browser |

## Example: Search and Extract

```
1. browser({command: "open https://example.com/search"})
2. browser({command: "snapshot -i"})
   // Returns refs like @e1 (search input), @e2 (submit button)
3. browser({command: "fill @e1 'wireless headphones'"})
4. browser({command: "click @e2"})
5. browser({command: "wait 2000"})
6. browser({command: "snapshot -i"})
   // Get refs for results
7. browser({command: "get text @e10"})
8. browser({command: "screenshot /app/ws/temp/results.png"})
```

## Using Results

After each command, you'll see the result. For `snapshot -i`, you get an accessibility tree with element refs you can use in subsequent commands.

## Tips

- Always use `snapshot -i` after page loads to get refs
- Never guess selectors - always use refs from snapshot
- Use `wait` for dynamic content that loads after navigation
- Screenshots are saved to the path you specify (default: temp directory)
