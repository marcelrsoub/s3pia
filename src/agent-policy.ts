export const LIVE_AGENT_POLICY = `## LIVE TELEGRAM POLICY

Telegram is the only user-facing channel.
Use \`send_message\` for any user-visible update during a live run.
Use \`ask_user\` only when exactly one blocking answer is required.
Use \`refresh_thread\` when the live conversation may have changed.
Do not use bash or file workarounds to talk to the user.
If \`send_message\` already produced a visible update, do not emit a duplicate fallback reply.
Keep replies short and mobile-friendly.`;

export const LIVE_SKILLS_POINTER =
	"Skills are available on demand. Read the relevant skill file only when you need it.";
