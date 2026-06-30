# OCR (Optical Character Recognition)

Extract text from images using AI-powered OCR.

## Setup

**Required**: An API key for one of the supported services

Common variable names:
- `OPENROUTER_API_KEY` - For vision-capable models (recommended)
- `GROQ_API_KEY` - For Groq vision models
- `ZAI_API_KEY` - ZAI OCR service (WAV/MP3/OGG for audio, images for OCR)

## OpenRouter Vision (Recommended)

Use vision-capable models to extract text from images. Supports URLs and base64 encoded images.

**Endpoint**: `https://openrouter.ai/api/v1/chat/completions`

```bash
curl -s -X POST "https://openrouter.ai/api/v1/chat/completions" \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen/qwen3-vl-8b-instruct",
    "messages": [
      {
        "role": "user",
        "content": [
          {"type": "text", "text": "Extract all text from this image. Provide a clean, accurate transcription."},
          {"type": "image_url", "image_url": {"url": "https://cdn.example.com/image.jpg"}}
        ]
      }
    ]
  }'
```

### Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `model` | yes | - | Vision model: `nvidia/nemotron-nano-12b-v2-vl:free`, `qwen/qwen3-vl-8b-instruct`, `google/gemini-2.0-flash-001` |
| `image_url` | yes | - | URL to image (can be https:// or data:image/ base64) |

### Recommended OpenRouter Models Today

- `nvidia/nemotron-nano-12b-v2-vl:free` - Cheapest option; OpenRouter describes it as optimized for OCR and document intelligence, with no per-token cost.
- `qwen/qwen3-vl-8b-instruct` - Best budget paid option; OpenRouter lists it at `$0.08/M input` and `$0.50/M output`, with OCR coverage across 32 languages.
- `google/gemini-2.0-flash-001` - Solid fallback when you want a broader general-purpose multimodal model.

If cost is the main concern, start with `nvidia/nemotron-nano-12b-v2-vl:free` and only move up to `qwen/qwen3-vl-8b-instruct` if accuracy needs a bump.

### Response

```json
{
  "choices": [
    {
      "message": {
        "content": "Extracted text from image..."
      }
    }
  ]
}
```

## Groq Vision

Use Groq's vision-capable models for text extraction.

**Endpoint**: `https://api.groq.com/openai/v1/chat/completions`

```bash
curl -s -X POST "https://api.groq.com/openai/v1/chat/completions" \
  -H "Authorization: Bearer $GROQ_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama-3.2-90b-vision-preview",
    "messages": [
      {
        "role": "user",
        "content": [
          {"type": "text", "text": "Extract all text from this image."},
          {"type": "image_url", "image_url": {"url": "https://cdn.example.com/image.jpg"}}
        ]
      }
    ]
  }'
```

### Groq Vision Models

- `llama-3.2-90b-vision-preview` - Best accuracy on Groq
- `llama-3.2-11b-vision-preview` - Faster, slightly less accurate

## ZAI OCR

Use ZAI's specialized OCR service.

**Endpoint**: `https://api.zai.ai/v1/ocr`

```bash
curl -s -X POST "https://api.zai.ai/v1/ocr" \
  -H "Authorization: Bearer $ZAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "image_url": "https://cdn.example.com/image.jpg"
  }'
```

## Workflow Tips

1. **Image hosting**: For best results with OpenRouter/Groq, host images on a CDN or use base64 encoding
2. **Base64 encoding**: For small images, encode as base64:
   ```bash
   base64 -w 0 image.jpg
   ```
   Then use: `"url": "data:image/jpeg;base64,<BASE64_STRING>"`
3. **Fal.ai CDN**: If you have images in `/app/ws/files/`, you can upload to fal.ai CDN:
   ```bash
   curl -X POST "https://queue.fal.run/fal-ai/ocr" -F "file=@/path/to/image"
   ```

## Use Cases

- Extracting text from documents (PDF screenshots, photos)
- Reading flight tickets, receipts, invoices
- Digitizing handwritten notes
- Transcribing text from screenshots
- Extracting data from forms

## Errors

- `400 Bad Request`: Invalid image format or corrupted file
- `401 Unauthorized`: Invalid or missing API key
- `422 Unprocessable Entity`: Image too large or format not supported
- `insufficient balance`: API quota exceeded (especially ZAI)
