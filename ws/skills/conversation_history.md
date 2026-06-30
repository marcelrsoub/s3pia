# Conversation History

Access and query the S3PIA conversation database to retrieve past messages.

## Setup

**Database location**: `/app/ws/s3pia.db`

No API keys or external services required. Uses SQLite3.

## Database Schema

### messages table
```sql
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  source TEXT,
  worker_type TEXT,
  worker_status TEXT,
  files TEXT,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
```

### conversations table
Stores conversation metadata and session information.

## Query Messages

### Get last N messages

```bash
sqlite3 /app/ws/s3pia.db "SELECT role, substr(content, 1, 200) as content_preview, datetime(timestamp, 'unixepoch') as time FROM messages ORDER BY timestamp DESC LIMIT 20;"
```

**Parameters**:
- Change `LIMIT 20` to any number
- Change `substr(content, 1, 200)` to see more or less text

### Get full content of last N messages

```bash
sqlite3 /app/ws/s3pia.db "SELECT role, content, datetime(timestamp, 'unixepoch') as time FROM messages ORDER BY timestamp DESC LIMIT 10;"
```

### Get messages by role (user or assistant)

```bash
sqlite3 /app/ws/s3pia.db "SELECT role, substr(content, 1, 150) as preview, datetime(timestamp, 'unixepoch') as time FROM messages WHERE role = 'user' ORDER BY timestamp DESC LIMIT 20;"
```

**Change `role = 'user'` to `role = 'assistant'`** to see my responses.

### Get messages from a specific date

```bash
sqlite3 /app/ws/s3pia.db "SELECT role, substr(content, 1, 150) as preview, datetime(timestamp, 'unixepoch') as time FROM messages WHERE date(timestamp, 'unixepoch') = '2025-01-09' ORDER BY timestamp;"
```

### Search for specific content

```bash
sqlite3 /app/ws/s3pia.db "SELECT role, substr(content, 1, 150) as preview, datetime(timestamp, 'unixepoch') as time FROM messages WHERE content LIKE '%Menuit%' ORDER BY timestamp DESC LIMIT 20;"
```

Replace `%Menuit%` with your search term.

### Get message count

```bash
sqlite3 /app/ws/s3pia.db "SELECT COUNT(*) as total_messages FROM messages;"
```

### Get messages by conversation

```bash
sqlite3 /app/ws/s3pia.db "SELECT conversation_id, COUNT(*) as msg_count FROM messages GROUP BY conversation_id ORDER BY MAX(timestamp) DESC;"
```

## Timestamp Notes

- Timestamps are stored as Unix epoch (seconds)
- Use `datetime(timestamp, 'unixepoch')` to convert to readable format
- Use `date(timestamp, 'unixepoch')` for date-only comparisons

## Common Queries for Quick Reference

**Last 5 user messages:**
```bash
sqlite3 /app/ws/s3pia.db "SELECT content, datetime(timestamp, 'unixepoch') FROM messages WHERE role = 'user' ORDER BY timestamp DESC LIMIT 5;"
```

**Today's messages:**
```bash
sqlite3 /app/ws/s3pia.db "SELECT role, substr(content, 1, 100) as preview FROM messages WHERE date(timestamp, 'unixepoch') = date('now') ORDER BY timestamp;"
```

**Messages with files:**
```bash
sqlite3 /app/ws/s3pia.db "SELECT role, files, substr(content, 1, 100) as preview FROM messages WHERE files IS NOT NULL ORDER BY timestamp DESC LIMIT 10;"
```
