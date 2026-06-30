# Update Core Skills

Check whether a core skill in S3pia should be refreshed from the upstream GitHub repo.

## Use This When

- The user asks to update, refresh, or compare a shipped skill
- You want to check the upstream S3pia repo before changing local skill docs
- You need to show the user exactly which upstream file to review first

## Upstream Source

- Repo skills folder: `https://github.com/marcelrsoub/s3pia/tree/main/ws/skills`
- Raw file pattern: `https://raw.githubusercontent.com/marcelrsoub/s3pia/main/ws/skills/<skill-name>.md`

## Workflow

1. Compare the local skill file in `/app/ws/skills` against the upstream GitHub version.
2. Summarize only the meaningful differences:
   - new sections
   - changed model or API recommendations
   - changed setup steps
   - changed cleanup or safety rules
3. Show the user the upstream URL to review.
4. Ask whether they want to update the local skill.
5. Do not edit the local skill until the user says yes.

## Comparison Rules

- Prefer the upstream GitHub raw file as the source of truth for the latest shipped version.
- Do not guess at updates from memory.
- If the upstream skill is unchanged, say so and stop.
- If the upstream skill introduces a new provider, model, or cleanup rule, call that out explicitly before asking.

## Response Format

Keep the message short and review-friendly:

- `Skill`: name
- `Local`: status
- `Upstream`: URL to inspect
- `Changes`: 1-3 bullet summary
- `Question`: ask whether to update this skill now

## Safety

- Never overwrite a skill without confirmation
- Never update more than one skill at a time unless the user explicitly asks
- If multiple skills need refreshes, present them as a short list and ask which one to do first
