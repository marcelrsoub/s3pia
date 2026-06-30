# Telegram Live Messaging

Quick reference for live Telegram work. The canonical live policy is injected at runtime.

## Core Tools

- `send_message` sends visible progress, partial results, or final replies
- `refresh_thread` reloads the latest live thread state
- `ask_user` pauses the run for one blocking answer

## Rules

- Telegram is the only user-facing channel.
- Keep replies short, clear, and mobile-friendly.
- Use `files` when you want the user to see an image or document.
- Do not rely on mentioning filenames in text alone.
- Do not use bash/curl to impersonate Telegram output when `send_message` is available.
- Use `refresh_thread` before continuing if new user messages may have arrived while you were working.

## File Handling

- Pass workspace file paths in `files`.
- Images can render inline.
- Other files show as download attachments.

## Reply Style

- Prefer one idea per line.
- Use bullets or short numbered steps.
- Default to 2-5 short lines instead of a single paragraph.
- Add a blank line between distinct ideas when it improves scanability.
- Avoid long preambles.

## Notes

- If tool execution fails, a visible Telegram error reply is appropriate.
- Normal intake should stay quiet until the agent has something meaningful to say.
