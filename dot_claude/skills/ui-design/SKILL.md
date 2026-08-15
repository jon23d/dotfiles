---
name: ui-design
description: React UI design principles and conventions. Load when building or modifying any user interface or React components. Covers application type detection, visual standards, component design and structure, Mantine (business apps) and Tailwind (consumer apps), accessibility, responsiveness, state management, data fetching, testing, and in-app help patterns.
---

## Determine application type first

**Business-facing** (internal tools, dashboards, admin panels, B2B SaaS): Use **Mantine**. Do not introduce Tailwind.

**Consumer-facing** (marketing sites, consumer products): Use **Tailwind CSS** + **Radix UI** for accessible primitives. Do not introduce Mantine.

Do not mix the two systems.

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

**One component, one responsibility.** A component file should not exceed 150 lines.

### Decomposition rules

**Separate data from presentation.** A component that calls `useQuery`/`useMutation` should not contain complex JSX — extract data-fetching into a custom hook, render focused children.

```tsx
// Good — hook owns data, page composes focused children
function useUserDashboard() {
  const user = useQuery({ queryKey: ['user'], queryFn: fetchUser });
  const projects = useQuery({ queryKey: ['projects'], queryFn: fetchProjects });
  return { user, projects };
}

function UserDashboard() {
  const { user, projects } = useUserDashboard();
  return (
    <Stack>
      <UserHeader user={user.data} isLoading={user.isLoading} />
      <ProjectList projects={projects.data} isLoading={projects.isLoading} />
    </Stack>
  );
}
```

**Extract every visually distinct section as its own component.** More than 3 `useState` calls is a smell. JSX nesting deeper than 3 levels means you missed an extraction.

### File structure

One component per file. Related files in a folder:

```
UserCard/
├── index.ts
├── UserCard.tsx
├── UserCard.test.tsx
└── types.ts
```

### Props

Explicit TypeScript interfaces. Required props are necessary, optional have defaults. Prefer callbacks over store references. Never use `React.FC`.

### Composition over configuration

Prefer composing smaller components over boolean flag props (`showHeader`, `compact`, `withBorder`).

### Never put logic in JSX

Extract conditionals and transformations into variables before the return statement.

---

## Data fetching — always use React Query

Never use `useEffect` + `useState` for data fetching.

- **Service layer first.** Data fetching in `@/services`. Services call the typed client, return typed objects.
- **Custom hooks as the interface.** Components call hooks, not services directly. Hooks use TanStack Query internally.
- **No hardcoded URLs.** Endpoint definitions in generated client or service layer only.
- **Validate at the boundary** with Zod — never `as SomeType`.

---

## State management

- **Local UI state** → `useState` or `useReducer`
- **Shared UI state** → React context or Zustand (context for infrequent changes, Zustand for frequent)
- **Server state** → React Query. Never replicate into `useState`.
- Do not reach for Redux.

---

## Business apps: Mantine conventions

Use Mantine components before building custom. Style with `classNames` + CSS Modules → Mantine CSS variables → `styles` prop. Never hardcoded hex values — use theme tokens. Forms with `@mantine/form`.

## Consumer apps: Tailwind conventions

Tailwind utility classes exclusively. Radix UI for interactive primitives. Establish design tokens in `tailwind.config.ts`. No arbitrary values except one-off pixel-perfect needs. Prettier plugin for class ordering.

---

## Accessibility

- All images have meaningful `alt` text. Decorative: `alt=""`.
- Form inputs have associated labels. Interactive non-native elements have `role` and `aria-*`.
- Colour never sole means of information. Focus states always visible. Semantic HTML.
- `<button>` for actions, `<a>` for navigation. Never `<div onClick>`.
- Toggle buttons: `aria-pressed`. Dialogs: `role="dialog"`, `aria-modal`, focus trapped, Escape closes.

---

## Responsiveness

Design mobile first. Mantine: responsive props. Tailwind: mobile-first breakpoint prefixes. No hardcoded widths for content containers.

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

Use React Testing Library. Query by accessible role, label, or visible text — never `getByTestId`. Use `userEvent`. Test loading, error, success states. Domain objects from test factories — no inline literals.

## Red flags — stop and reassess

- `useEffect` + `useState` for data fetching → use React Query
- `response.json() as SomeType` → validate with Zod
- Component exceeds 150 lines → split
- More than 3 boolean props → consider composition
- Hardcoded hex values → use design tokens
- `div`/`span` with `onClick` → use `<button>`
- About to skip tests → write them now
