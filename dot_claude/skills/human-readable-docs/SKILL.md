---
name: human-readable-docs
description: Use when writing any documentation — API references, guides, feature overviews, changelogs, or README files — intended to be read by humans in raw markdown or rendered form.
---

# Human-Readable Documentation

## Overview

Good documentation is scannable, active, and written for the reader's task — not the author's knowledge dump. These rules address the specific ways agents produce documentation that is technically correct but hard to read.

## Structure

**Lead with what the reader needs first.**
Order sections by the reader's journey, not by how the system is built. A reader implementing webhooks needs to know what payload they'll receive before they decide what to subscribe to.

Typical order for feature documentation:

- What it is and why it matters (1–2 sentences, not a whole section)
- What the reader will receive / what the output looks like
- How to set it up
- Reference material (full parameter lists, event catalogs)
- Edge cases and error handling

**Don't add an "Overview" section after an intro paragraph.**
If the first paragraph already explains what something is, a second section labeled "Overview" just repeats it. Say it once, say it well, move on.

**Use the minimum heading depth needed.**
Don't create `###` subsections inside `##` sections unless there are at least two of them. A lone subheading signals a structure problem — fold it into prose or promote it.

## Voice and tone

**Write in second person, active voice, present tense.**
The reader is "you." The system is "we." Things happen now, not in a passive fog.

- Avoid: "A delivery is considered failed if the endpoint returns a non-2xx status."
- Prefer: "We consider a delivery failed if your endpoint returns a non-2xx status."

- Avoid: "It is retried up to 3 times."
- Prefer: "We retry failed deliveries up to 3 times."

**Use imperative mood for instructions.**
Steps and requirements should tell the reader what to do, not describe what happens.

- Avoid: "The signature should be verified before processing the payload."
- Prefer: "Verify the signature before processing the payload."

## Prose density

**Keep paragraphs to 3–4 sentences maximum.**
Long paragraphs are skipped. If a paragraph runs longer, split it or convert it to a list.

**Don't restate what the heading already says.**
If a section is titled "Retry behavior", don't open with "When a delivery fails, the system has retry behavior." Get directly to the substance.

**Use bullet lists for 3+ parallel items.**
If you're writing "X, Y, and Z" in a sentence and all three are the same kind of thing, make them a list.

## Tables

**Pad all columns to uniform width.**
Every cell must be padded to match the widest cell in its column. Bare `|---|---|` separators are not acceptable.

```
| Event            | Description                              |
|------------------|------------------------------------------|
| `user.created`   | A new user account was created.          |
| `payment.failed` | A payment attempt failed.                |
```

**Don't use a table for one row.**
Replace with inline prose: **`id`** (string, required) — The user's ID.

**Drop columns that carry no information.**
Remove "Required" columns where every value is "Yes". State it in the heading or prose instead.

**Keep description cells short.**
If a cell description exceeds ~80 characters, shorten it and move the detail to prose below the table.

## Code examples

**Use TypeScript for all code examples.**
This codebase is TypeScript. Do not include examples in Python, JavaScript, or any other language.

**One example per concept.**
One well-commented TypeScript example is better than two thin ones in different languages.

**Make examples copy-paste ready.**
Examples should include imports, handle errors, and reflect real usage — not toy pseudocode.

**Annotate the non-obvious.**
Add inline comments to explain _why_, not _what_. Skip comments that restate the code.

```ts
// Use timingSafeEqual to prevent timing attacks — do not use ===
const valid = crypto.timingSafeEqual(expected, actual);
```

## Common mistakes

- Passive voice throughout ("it is retried", "the request is verified")
- "Overview" section that restates the intro paragraph
- Events or parameters table with bare `|---|---|` separators
- Multi-language code examples (Python + Node.js side by side)
- Section order that follows system internals instead of the reader's task
- Single-item subheadings (`###` with no sibling)
- Paragraphs that open by restating the section heading
