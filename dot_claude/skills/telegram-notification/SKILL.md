---
name: telegram-notification
description: Use when sending a Telegram notification on task completion or when a task is blocked. Defines message format and delegates to the send-telegram tool.
---

# Telegram Notification

Send a single notification via the `send-telegram` tool.

## Message format

**On completion:**

```
✅ Task complete: {TASK_NAME}

{1–2 sentence summary of what was done}

PR: {pr_url}
```

**When blocked:**

```
🚫 Task blocked: {TASK_NAME}

Blocker: {specific description of what is blocking progress}
```

## Usage

1. Format the message using the template above
2. Call `send-telegram` **once** with the formatted message

## Rules

- Call `send-telegram` exactly once — never more
- Do not include information not provided by the caller
- If `send-telegram` returns `"Telegram not configured — skipping notification"`, that is not an error — report it back to the caller as a skipped notification
