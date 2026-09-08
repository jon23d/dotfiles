---
name: ui-design
description: UI design principles and conventions for any frontend stack. Load when building or modifying any user interface or component-based UI. Covers visual standards, component design, accessibility, responsiveness, state management, data fetching, testing, and in-app help patterns.
---

## Visual standards

### Typography

- Three distinct sizes minimum: heading, body, label/caption. Body line height 1.5, headings 1.2–1.3.
- Constrain line length to 60–80 chars. Sequential heading hierarchy — never skip levels.
- Max three font weights per screen.

### Spacing

- Base-8 scale: 4, 8, 16, 24, 32, 48, 64px. No arbitrary values.
- Related elements closer than unrelated. Consistent padding inside containers.

### Colour

- One primary action colour, consistent for all primary buttons. Max 2–3 accent colours.
- Background/surface/border form clear hierarchy. Never colour alone for meaning — pair with icon/label.
- WCAG AA: 4.5:1 body text, 3:1 large text and UI components.

### Visual hierarchy

- One primary action per screen, visually dominant. Most important content has most visual weight.
- Decorative elements are subtle. Whitespace is structure.

### Interactive elements

- Four explicit states: default, hover, focus, disabled. Focus always visible.
- Primary buttons filled, secondary outlined/ghost, destructive red. Min 44×44px touch targets.

### Forms

- Every input has a visible label above it. Validation errors adjacent to the field.
- Required fields marked consistently. Submit buttons disabled/loading during requests.

### Feedback

- Scoped loading indicators, not full-page spinners. Specific success/error messages.
- Destructive actions require confirmation naming the thing being destroyed.

---

## Component design

**One component, one responsibility.** Keep components small — split a component when it takes on more than one job. Extract every visually distinct section as its own component. Deep nesting in a component's markup is a sign you missed an extraction.

Separate data from presentation: a component that fetches or mutates data should not also contain complex markup — extract the data-fetching concern (a hook, a composable, a service call) and let the component focus on rendering.

Never put logic directly in the markup/template. Extract conditionals and transformations into variables before the render step.

---

## Data fetching

Use whatever caching data-fetching layer your framework's ecosystem provides — never hand-roll fetching with raw local-state juggling (loading/error/data flags managed by hand) when a caching layer is available.

- **Service layer first.** Keep data-fetching calls in a dedicated services layer that calls the typed client and returns typed objects.
- **A hook/composable/interface layer between components and services.** Components consume that interface, not the service directly.
- **No hardcoded URLs.** Endpoint definitions live in the generated client or service layer only.
- **Validate at the boundary.** Never trust-cast an HTTP response into a type — validate it against a schema.

---

## State management

- **Local UI state** → component-local state.
- **Shared UI state** → a shared-state mechanism appropriate to your framework (a context/provider mechanism for infrequent changes, a lightweight store for frequent changes).
- **Server state** → the caching data-fetching layer. Never replicate it into local state.
- Reach for a full state-management framework (e.g. Redux-style global stores) only when the lighter options above are genuinely insufficient.

---

## Accessibility

- All images have meaningful `alt` text. Decorative: `alt=""`.
- Form inputs have associated labels. Interactive non-native elements have `role` and `aria-*`.
- Colour never sole means of information. Focus states always visible. Semantic HTML.
- `<button>` for actions, `<a>` for navigation. Never `<div onClick>`.
- Toggle buttons: `aria-pressed`. Dialogs: `role="dialog"`, `aria-modal`, focus trapped, Escape closes.

---

## Responsiveness

Design mobile first. No hardcoded widths for content containers.

---

## Loading, error, and empty states

Every data-dependent component handles three states: loading, error, success. Skeleton loaders, not spinners. Actionable error messages with retry. Empty states are specific, explain the entity, and offer a primary action.

---

## In-app help patterns

### Tooltips

One-sentence explanations for controls and icons. Trigger on hover and keyboard focus. 300–500ms delay. Never critical info only in tooltip (invisible on touch).

### Help icons and popovers

2–4 sentence inline explanations for non-obvious form fields and settings. Place after field label. Keyboard-accessible.

### Field-level help text

Always-visible description beneath inputs with non-obvious purpose. Distinct from validation errors. Concise.

### Empty states as onboarding

Icon/illustration, specific heading, 1–2 sentences explaining the entity, primary action button to create first item. Never generic "Nothing here yet".

---

## Tests — every component

Query by accessible role, label, or visible text — never a test-id-only hook. Simulate real user interaction rather than firing raw events. Test loading, error, success states. Use domain objects from test factories — no inline literals.

## Red flags — stop and reassess

- Hardcoded hex values → use design tokens
- `div`/`span` with `onClick` → use `<button>`
- About to skip tests → write them now

## Stack-specific guidance

Read `references/typescript.md` for TypeScript/Node-specific implementation detail before applying this skill to a TypeScript repo. A Go equivalent (`references/golang.md`) does not exist yet — if this skill applies to a Go repo, flag the gap rather than force-fitting the TypeScript reference.
