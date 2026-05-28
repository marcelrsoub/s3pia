# Public Pages

Create local, visitable web pages for the user in S3pia's workspace.

## What This Is For

Use this skill when the user wants a page, mini-site, dashboard, demo, landing page, or any other browser-viewable output.

## Where To Write Files

Write pages into `/app/ws/public_pages/<page-name>/`.

Recommended structure:

```text
/app/ws/public_pages/my-page/
├── index.html
├── style.css
└── assets/
```

## How Users Open Pages

Pages are served locally from the main app:

```text
http://localhost:3210/pages/my-page/
```

## Page Rules

- Keep each page self-contained.
- Use relative links for CSS, JS, and assets.
- Put all page-specific assets inside the page folder.
- Prefer a single `index.html` entry point.
- Avoid external dependencies unless the user explicitly wants them.

## Example

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="stylesheet" href="./style.css" />
    <title>My Page</title>
  </head>
  <body>
    <main>
      <h1>Hello</h1>
      <p>This page lives in the workspace.</p>
    </main>
  </body>
</html>
```

## Optional Exposure

If the user wants someone outside the local machine to view the page, suggest one of these:

- cloudflared tunnel
- ngrok
- SSH reverse tunnel

Keep this optional. The default behavior is local-only.
