# Text to Speech

Generate spoken audio from text for Telegram replies, narration, and accessibility.

## Setup

**Required**: An API key for one of the supported providers

Common variable names: `OPENROUTER_API_KEY`
Common variable names: `GROQ_API_KEY`

## OpenRouter TTS

Use OpenRouter first when you want the broadest model choice and easy provider switching.

**Endpoint**: `https://openrouter.ai/api/v1/audio/speech`

OpenRouter returns a raw audio byte stream, so save it directly to a file.

### Generate Audio

```bash
curl -s -X POST "https://openrouter.ai/api/v1/audio/speech" \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "hexgrad/kokoro-82m",
    "input": "Hello! This is a text to speech test.",
    "voice": "<supported voice>",
    "response_format": "mp3"
  }' > /app/ws/files/tts-output.mp3
```

### Recommended OpenRouter Models Today

- `hexgrad/kokoro-82m` - Cheapest practical default for short spoken replies and voice notes. OpenRouter lists it at `$0.62/M characters`.
- `openai/gpt-audio-mini` - Good balanced fallback if you want stronger voice consistency. OpenRouter lists it at `$0.60/M input` and `$2.40/M output`.
- `mistralai/voxtral-mini-tts-2603` - Good low-cost alternative if you want a non-OpenAI provider voice path. OpenRouter lists it at `$16/M characters`.
- `google/gemini-3.1-flash-tts-preview` - Best-quality expressive option when you want rich delivery and multilingual coverage. OpenRouter lists it at `$1/M input` and `$20/M output`.

### Notes

- OpenRouter TTS returns raw audio bytes, not JSON.
- Keep output short for Telegram-friendly responses.
- Check the model page for supported voice IDs before using a model in production.
- After sending the file to the user, delete the local audio file to keep the workspace clean.

### Realism Tags

Use inline audio tags only on models that document support for them. Keep them lowercase and bracketed unless the model docs say otherwise.

Verified examples today:

- `[whispers]`
- `[laughs]`
- `[excited]`

Use these to shape delivery for things like:

- laughter
- whispers
- emphasis
- pacing

If you need a cough-like beat or another nonverbal sound, prefer a model that explicitly documents support for that tag rather than inventing one.

## Groq TTS

Use Groq when you want a second provider path or already have Groq configured.

**Endpoint**: `https://api.groq.com/openai/v1/audio/speech`

### Generate Audio

```bash
curl -s -X POST "https://api.groq.com/openai/v1/audio/speech" \
  -H "Authorization: Bearer $GROQ_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "canopylabs/orpheus-v1-english",
    "input": "Hello! This is a text to speech test.",
    "voice": "hannah",
    "response_format": "wav"
  }' > /app/ws/files/tts-output.wav
```

### Recommended Groq Model

- `canopylabs/orpheus-v1-english` - The current Groq English TTS model. Groq prices it at `$22 / 1 million characters`.
- `canopylabs/orpheus-arabic-saudi` - Groq’s Arabic Saudi dialect model, priced at `$40 / 1 million characters`.

### Expressive Notes

- `x-ai/grok-voice-tts-1.0` on OpenRouter supports inline speech tags for pauses, emphasis, pitch, speed, and vocal style.
- If you want the most expressive output, prefer a model with inline audio tags over the cheapest voice-only option.

### Workflow

1. Generate the audio file into `/app/ws/files/`
2. Send the file to the user through Telegram
3. Delete the local file immediately after successful delivery

### Cleanup

```bash
rm -f /app/ws/files/tts-output.mp3
```

## Use Cases

- Voice replies for Telegram
- Read-aloud summaries
- Accessibility output
- Short narration clips

## Errors

- `401 Unauthorized`: Missing or invalid API key
- `400 Bad Request`: Invalid text, model, or voice value
- `413 Payload Too Large`: Text or output request too large
- `429 Too Many Requests`: Back off and retry later
