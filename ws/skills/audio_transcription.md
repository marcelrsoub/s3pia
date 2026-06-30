# Audio Transcription

Convert audio files to text using Whisper (speech-to-text AI).

## Setup

**Required**: An API key for one of the supported providers

Common variable names: `OPENROUTER_API_KEY`
Common variable names: `GROQ_API_KEY`

Groq Whisper supports OGG, WAV, MP3, and other formats (ZAI only supports WAV/MP3).

## OpenRouter Transcription

Use OpenRouter when you already have an OpenRouter key or want access to the broader transcription model catalog.

**Endpoint**: `https://openrouter.ai/api/v1/audio/transcriptions`

OpenRouter accepts **base64-encoded audio** for transcription. Unlike the Groq endpoint, it does not take a direct file upload in this flow.

### Quick Transcription

```bash
AUDIO_BASE64=$(base64 < /path/to/audio.wav | tr -d '\n')

curl -s -X POST "https://openrouter.ai/api/v1/audio/transcriptions" \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "nvidia/parakeet-tdt-0.6b-v3",
    "input_audio": {
      "data": "'"$AUDIO_BASE64"'",
      "format": "wav"
    }
  }'
```

### Recommended OpenRouter Models Today

- `nvidia/parakeet-tdt-0.6b-v3` - Cheapest practical default I found on OpenRouter, priced at `$0.0015/minute` and described as multilingual with punctuation and timestamps.
- `mistralai/voxtral-mini-transcribe` - Strong low-cost general transcription option at `$0.003/minute`, good for meetings, voice notes, and podcasts.
- `openai/gpt-4o-mini-transcribe` - A good general-purpose fallback if you want OpenAI’s transcription stack inside OpenRouter.
- `google/chirp-3` - Higher-quality multilingual option if you want more language coverage and can spend a bit more.

### Model Discovery

You can also list transcription-capable models with:

```bash
curl -s "https://openrouter.ai/api/v1/models?output_modalities=transcription" \
  -H "Authorization: Bearer $OPENROUTER_API_KEY"
```

### OpenRouter Notes

- OpenRouter’s transcription API returns JSON with the transcribed text and usage data.
- Audio must be base64-encoded before sending.
- If you already use OpenRouter for text models, this keeps transcription in the same provider.
- OpenRouter’s model catalog also exposes a transcription ranking page, which is a good way to re-check recommendations before changing defaults.
- For a fresh model shortlist, check [OpenRouter’s transcription rankings](https://openrouter.ai/rankings/transcription) before changing the skill defaults.

## Transcribe Audio File

Transcribe an audio file using Groq's Whisper API.

**Endpoint**: `https://api.groq.com/openai/v1/audio/transcriptions`

```bash
curl -s -X POST "https://api.groq.com/openai/v1/audio/transcriptions" \
  -H "Authorization: Bearer $GROQ_API_KEY" \
  -F "file=@/path/to/audio.ogg" \
  -F "model=whisper-large-v3-turbo" \
  -F "response_format=text"
```

### Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `file` | yes | - | Audio file path (local file) |
| `model` | yes | - | Whisper model: `whisper-large-v3-turbo`, `whisper-large-v3` |
| `response_format` | no | json | Response format: `text`, `json`, `verbose_json`, `srt`, `vtt` |
| `language` | no | auto | Language code (e.g., `en`, `pt`) - auto-detected if not specified |

### Recommended Groq Models Today

- `whisper-large-v3-turbo` - Best price/performance for multilingual transcription. This should be the default for most runs.
- `whisper-large-v3` - Use when accuracy matters most or when you need translation support.

### Notes

- Groq has deprecated `distil-whisper-large-v3-en` in favor of `whisper-large-v3-turbo`.
- Groq charges a minimum of 10 seconds per request, even for shorter clips.

### Response

Text output (when using `response_format=text`):
```
This is the transcribed text from your audio file.
```

JSON output (default):
```json
{
  "text": "Transcribed text here"
}
```

## Use Cases

- Telegram voice messages
- Voice notes from meetings
- Dictation for quick notes
- Transcribing calls or interviews

## Workflow

1. User sends audio file (usually via Telegram)
2. File is saved to `/app/ws/files/`
3. Use this skill to transcribe
4. Return text to user

## Errors

- `400 Bad Request`: File format not supported (try WAV/MP3/OGG)
- `401 Unauthorized`: Invalid or missing GROQ_API_KEY
- `413 Payload Too Large`: File too big for the API
