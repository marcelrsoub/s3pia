# Telegram Live Messaging

Use this skill for the live Telegram conversation with the admin.

## Core Tools

- These are real runtime tools, not workarounds:
- `send_message` sends a Telegram update
- `refresh_thread` reloads the latest conversation state
- `ask_user` pauses the run and asks one blocking question

## Rules

- Telegram is the only user-facing channel.
- Keep replies short, clear, and mobile-friendly.
- Use `files` when you want the user to see an image or document.
- Do not rely on mentioning filenames in text alone.
- Do not use bash/curl to impersonate Telegram output when `send_message` is available.
- Use `refresh_thread` before continuing if new user messages may have arrived while you were working.

## When To Use Each Tool

- `send_message`: progress updates, partial results, or final replies
- `ask_user`: when the task cannot continue without one missing answer
- `refresh_thread`: when the conversation may have changed during a long run

## File Handling

- Pass workspace file paths in `files`.
- Images can render inline.
- Other files show as download attachments.

## Reply Style

- Prefer one idea per line.
- Use bullets or short numbered steps.
- Avoid long preambles.

## Notes

- If tool execution fails, a visible Telegram error reply is appropriate.
- Normal intake should stay quiet until the agent has something meaningful to say.
