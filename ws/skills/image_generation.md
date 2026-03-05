# Image Generation & Editing

Generate and edit images using xAI's Grok Imagine model via fal.ai.

## ⚠️ CRITICAL: Use curl ONLY

**DO NOT write Python scripts.** Python is NOT available with the `requests` module.

**You MUST use the `exec` tool with curl commands exactly as shown below.**

## Setup

The API key is already configured as `FAL_AI_API_KEY`. Use `$FAL_AI_API_KEY` in curl commands.

If you get an auth error, check with `get_env_vars` first.

## Image Generation

Generate images from text descriptions using the `exec` tool.

**Endpoint**: `https://fal.run/xai/grok-imagine-image`

```bash
curl -s -X POST "https://fal.run/xai/grok-imagine-image" \
  -H "Authorization: Key $FAL_AI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A serene mountain landscape at sunset",
    "num_images": 1,
    "aspect_ratio": "16:9",
    "output_format": "jpeg"
  }'
```

**Example exec command:**
```
exec: curl -s -X POST "https://fal.run/xai/grok-imagine-image" -H "Authorization: Key $FAL_AI_API_KEY" -H "Content-Type: application/json" -d '{"prompt": "your prompt here", "num_images": 1, "aspect_ratio": "1:1"}'
```

### Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `prompt` | yes | - | Text description of the desired image |
| `num_images` | no | 1 | Number of images (1-4) |
| `aspect_ratio` | no | "1:1" | Options: "2:1", "20:9", "16:9", "4:3", "3:2", "1:1", "2:3", "3:4", "9:16", "1:2" |
| `output_format` | no | "jpeg" | Options: "jpeg", "png", "webp" |

### Response

```json
{
  "images": [{ "url": "https://v3b.fal.media/files/..." }],
  "revised_prompt": "enhanced prompt used"
}
```

## Image Editing

Edit existing images based on text instructions using the `exec` tool.

**Endpoint**: `https://fal.run/xai/grok-imagine-image/edit`

```bash
curl -s -X POST "https://fal.run/xai/grok-imagine-image/edit" \
  -H "Authorization: Key $FAL_AI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Make this scene more realistic",
    "image_url": "https://example.com/image.png"
  }'
```

### Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `prompt` | yes | - | Editing instructions |
| `image_url` | yes | - | URL of image to edit |
| `num_images` | no | 1 | Number of images (1-4) |
| `output_format` | no | "jpeg" | Options: "jpeg", "png", "webp" |

## Pricing

- Generation: $0.02 per image
- Editing: $0.022 per image ($0.02 output + $0.002 input)

## Usage

After receiving the response, display images to the user in markdown format:
```
![Generated Image](https://v3b.fal.media/files/...)
```

## Errors

- `Authentication is required`: No valid fal.ai API key found. Use `get_env_vars` to check existing keys, then `set_env_var` to configure one if needed.
- Invalid image URL (editing): Verify the URL is accessible
- Rate limited: Suggest retrying after a short wait
