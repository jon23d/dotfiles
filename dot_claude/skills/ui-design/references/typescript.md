# UI Design — TypeScript

## Determine application type first

**Business-facing** (internal tools, dashboards, admin panels, B2B SaaS): Use **Mantine**. Do not introduce Tailwind.

**Consumer-facing** (marketing sites, consumer products): Use **Tailwind CSS** + **Radix UI** for accessible primitives. Do not introduce Mantine.

Do not mix the two systems.

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

## Responsiveness

Mantine: responsive props. Tailwind: mobile-first breakpoint prefixes.

---

## Tests — every component

Use React Testing Library. Query by accessible role, label, or visible text — never `getByTestId`. Use `userEvent`. Test loading, error, success states. Domain objects from test factories — no inline literals.

## Red flags — stop and reassess

- `useEffect` + `useState` for data fetching → use React Query
- `response.json() as SomeType` → validate with Zod
- Component exceeds 150 lines → split
- More than 3 boolean props → consider composition
