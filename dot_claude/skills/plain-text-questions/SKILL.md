---
name: plain-text-questions
description: Use when you need to ask the user clarifying questions, gather requirements, make a decision that requires user input, or confirm anything before proceeding with a task.
---

# Plain Text Questions

## Overview

Ask questions as a numbered list in plain text. The user responds inline. Never use the `question` tool.

## Rule

**Never use the `question` tool.** Write questions directly in your message as a numbered list, then stop and wait for the user to reply before doing anything else.

## Pattern

```
Before I proceed, I have a few questions:

1. What framework is this project using?
2. Should this replace the existing implementation or live alongside it?
3. Are there specific components you want to prioritize first?
```

Stop after asking. Do not start work, explore the codebase, or take any action until the user replies.

## Why numbered lists

- User can reply "1. React, 2. Replace it, 3. Navbar first" or respond to individual items
- Works in any interface, including mobile
- Long context is never truncated
- No predefined options that might not fit the user's situation

## Common mistakes

- Using the `question` tool — never do this, regardless of how simple the question seems
- Asking one question at a time across multiple messages — batch all questions for a decision point into one numbered list
- Continuing to work while waiting for an answer — stop completely until the user replies
