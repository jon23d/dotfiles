---
name: mantine
description: Mantine v7 deep implementation guide. Load this skill whenever building or modifying UI for a business or internal application that uses Mantine. Use alongside `ui-design`. Covers package setup, theming, component selection, CSS Modules styling, @mantine/form patterns, key hooks, and common Mantine patterns (modal with form, notifications, AppShell). Load whenever you see @mantine imports, a MantineProvider, or the user mentions Mantine, mantine-datatable, or @mantine/form.
---

# Mantine v7

This skill covers Mantine v7, which made a clean break from v6. The most important change: **the `sx` prop is gone**. All component styling goes through CSS Modules, the `classNames` prop, or `style` with CSS variables. If you see `sx`, that is v6 code — do not write new code that way.

For general UI design principles, visual standards, accessibility, and responsive patterns, see the `ui-design` skill. This skill focuses on how to implement things correctly in Mantine.

---

## 1. Package setup

```bash
# Core
pnpm add @mantine/core @mantine/hooks
pnpm add -D postcss postcss-preset-mantine postcss-simple-vars

# Almost always needed
pnpm add @mantine/form
pnpm add @mantine/notifications
pnpm add @tabler/icons-react

# On demand
pnpm add @mantine/dates dayjs          # date pickers
pnpm add @mantine/charts recharts       # charts
pnpm add @mantine/tiptap               # rich text editor
pnpm add mantine-datatable             # data tables
```

`postcss.config.cjs`:

```js
module.exports = {
  plugins: {
    'postcss-preset-mantine': {},
    'postcss-simple-vars': {
      variables: {
        'mantine-breakpoint-xs': '36em',
        'mantine-breakpoint-sm': '48em',
        'mantine-breakpoint-md': '62em',
        'mantine-breakpoint-lg': '75em',
        'mantine-breakpoint-xl': '88em',
      },
    },
  },
};
```

---

## 2. Provider and theme setup

One `MantineProvider` at the root. Define the entire theme in one place — never override Mantine defaults in individual components.

```tsx
// theme.ts
import { createTheme, MantineColorsTuple } from '@mantine/core';

const brand: MantineColorsTuple = ['#f0f4ff', '#dce6ff', '#b3c8ff', /* ... 10 shades */ '#1a3fcc'];

export const theme = createTheme({
  primaryColor: 'brand',
  colors: { brand },
  fontFamily: 'Inter, sans-serif',
  defaultRadius: 'sm',
  components: {
    Button: { defaultProps: { radius: 'sm' } },
    TextInput: { defaultProps: { radius: 'sm' } },
    Select: { defaultProps: { radius: 'sm' } },
  },
});
```

```tsx
// main.tsx / layout.tsx
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/dates/styles.css';
import { MantineProvider, ColorSchemeScript } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { theme } from './theme';

// In SSR (Next.js / Remix): add <ColorSchemeScript /> to <head>
export default function Root() {
  return (
    <MantineProvider theme={theme}>
      <Notifications />
      {children}
    </MantineProvider>
  );
}
```

---

## 3. Component selection guide

Reach for these before writing custom components.

| Need                               | Component                                     | Package                                     |
| ---------------------------------- | --------------------------------------------- | ------------------------------------------- |
| Data table with sorting/pagination | `DataTable`                                   | `mantine-datatable`                         |
| Simple table                       | `Table`                                       | `@mantine/core`                             |
| Modal / dialog                     | `Modal`                                       | `@mantine/core`                             |
| Slide-out panel                    | `Drawer`                                      | `@mantine/core`                             |
| Dropdown select (searchable)       | `Select` with `searchable`                    | `@mantine/core`                             |
| Multi-select with search           | `MultiSelect`                                 | `@mantine/core`                             |
| Tags / freeform chips              | `TagsInput`                                   | `@mantine/core`                             |
| Combobox (full custom)             | `Combobox`                                    | `@mantine/core`                             |
| Date picker                        | `DatePickerInput` / `DateInput`               | `@mantine/dates`                            |
| Date range                         | `DatePickerInput type="range"`                | `@mantine/dates`                            |
| Loading skeleton                   | `Skeleton`                                    | `@mantine/core`                             |
| Overlay loading on section         | `LoadingOverlay`                              | `@mantine/core`                             |
| Toast notifications                | `notifications.show()`                        | `@mantine/notifications`                    |
| App shell layout                   | `AppShell`                                    | `@mantine/core`                             |
| Rich text editor                   | `RichTextEditor`                              | `@mantine/tiptap`                           |
| Charts                             | `BarChart`, `LineChart`, etc.                 | `@mantine/charts`                           |
| Code display                       | `Code`, `CodeHighlight`                       | `@mantine/core` / `@mantine/code-highlight` |
| JSON / tree display                | `JsonInput` (read-only) or render with `Code` | —                                           |
| Stepper / wizard                   | `Stepper`                                     | `@mantine/core`                             |
| Timeline                           | `Timeline`                                    | `@mantine/core`                             |
| File upload                        | `FileInput`, `Dropzone`                       | `@mantine/core` / `@mantine/dropzone`       |
| Spotlight / command palette        | `Spotlight`                                   | `@mantine/spotlight`                        |

---

## 4. Styling: CSS Modules with Mantine

The v7 way is CSS Modules with Mantine's PostCSS utilities. Use `light-dark()` and `var(--mantine-*)` for all values.

```css
/* Component.module.css */
.card {
  background-color: light-dark(var(--mantine-color-white), var(--mantine-color-dark-6));
  border: 1px solid light-dark(var(--mantine-color-gray-2), var(--mantine-color-dark-4));
  border-radius: var(--mantine-radius-md);
  padding: var(--mantine-spacing-md);

  @mixin hover {
    background-color: light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-5));
  }
}

.active {
  composes: card;
  border-color: var(--mantine-color-blue-5);
}
```

```tsx
import classes from './Component.module.css';
import cx from 'clsx';

<Box className={cx(classes.card, { [classes.active]: isActive })} />;
```

Use the `classNames` prop to style internal Mantine component parts:

```tsx
// Target Mantine's internal elements
<TextInput
  classNames={{
    root: classes.inputRoot,
    label: classes.inputLabel,
    input: classes.input,
    error: classes.inputError,
  }}
/>
```

Use `style` prop with CSS variables for one-off values — never hardcode:

```tsx
// Good
<Box style={{ borderRadius: 'var(--mantine-radius-sm)', padding: 'var(--mantine-spacing-md)' }}>

// Bad — hardcoded values break theming
<Box style={{ borderRadius: '4px', padding: '16px' }}>
```

---

## 5. Forms with @mantine/form

Read `references/forms.md` for complete patterns. The essentials:

```tsx
import { useForm, zodResolver } from '@mantine/form';
import { z } from 'zod';

const schema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email'),
});

type FormValues = z.infer<typeof schema>;

function MyForm() {
  const form = useForm<FormValues>({
    initialValues: { name: '', email: '' },
    validate: zodResolver(schema),
    // Validate on change only after first submit attempt
    validateInputOnChange: false,
    validateInputOnBlur: true,
  });

  const handleSubmit = form.onSubmit(async (values) => {
    try {
      await api.create(values);
      notifications.show({ title: 'Saved', message: 'Record created', color: 'green' });
      onClose();
    } catch (err) {
      // Map server errors to fields
      if (err.fieldErrors) {
        form.setErrors(err.fieldErrors);
      } else {
        form.setFieldError('name', err.message);
      }
    }
  });

  return (
    <form onSubmit={handleSubmit}>
      <TextInput label="Name" {...form.getInputProps('name')} />
      <TextInput label="Email" {...form.getInputProps('email')} />
      <Button type="submit" loading={form.submitting}>
        Save
      </Button>
    </form>
  );
}
```

See `references/forms.md` for: nested objects, array fields, `TransformedValues`, file uploads, and async initial values.

---

## 6. Key hooks

```tsx
import {
  useDisclosure,        // open/close state (modal, drawer, popover)
  useMediaQuery,        // responsive breakpoints
  useDebouncedValue,    // debounce search inputs
  useLocalStorage,      // persisted state
  useHotkeys,           // keyboard shortcuts
  useClickOutside,      // dismiss custom dropdowns
  useListState,         // array state management
  useDebouncedCallback, // debounce callback (v7.4+)
  useTimeout,           // delayed actions
  useInterval,          // polling
  usePrevious,          // track previous value
} from '@mantine/hooks'

// useDisclosure — the most-used hook
const [opened, { open, close, toggle }] = useDisclosure(false)
<Modal opened={opened} onClose={close} title="Edit record">...</Modal>

// useMediaQuery
const isMobile = useMediaQuery('(max-width: 62em)')

// useDebouncedValue — pair with search inputs
const [search, setSearch] = useState('')
const [debouncedSearch] = useDebouncedValue(search, 300)
// use debouncedSearch for API calls

// useHotkeys
useHotkeys([
  ['mod+k', () => spotlight.open()],
  ['Escape', close],
])

// useListState — array fields outside of @mantine/form
const [items, handlers] = useListState<Item>([])
handlers.append({ id: uuid(), name: '' })
handlers.remove(index)
handlers.reorder({ from: oldIndex, to: newIndex })
```

---

## 7. Common patterns

### Notification after async action

```tsx
import { notifications } from '@mantine/notifications';
import { IconCheck, IconX } from '@tabler/icons-react';

// Success
notifications.show({
  title: 'Saved',
  message: 'Your changes have been saved.',
  color: 'green',
  icon: <IconCheck size={16} />,
});

// Error
notifications.show({
  title: 'Failed to save',
  message: err.message,
  color: 'red',
  icon: <IconX size={16} />,
});

// Loading → update on completion
const id = notifications.show({ loading: true, title: 'Saving...', message: '', autoClose: false });
await save();
notifications.update({
  id,
  loading: false,
  title: 'Saved',
  message: 'Done.',
  color: 'green',
  autoClose: 3000,
});
```

### Modal with form

```tsx
interface Props {
  opened: boolean;
  onClose: () => void;
  onSaved: (item: Item) => void;
}

function EditModal({ opened, onClose, onSaved }: Props) {
  const form = useForm<FormValues>({ initialValues: { name: '' }, validate: zodResolver(schema) });

  // Reset form when modal opens
  useEffect(() => {
    if (opened) form.reset();
  }, [opened]);

  const handleSubmit = form.onSubmit(async (values) => {
    const item = await api.create(values);
    onSaved(item);
    onClose();
  });

  return (
    <Modal opened={opened} onClose={onClose} title="Add item" centered>
      <form onSubmit={handleSubmit}>
        <Stack>
          <TextInput label="Name" {...form.getInputProps('name')} />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={form.submitting}>
              Save
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
```

### AppShell layout

```tsx
function AppLayout({ children }: { children: React.ReactNode }) {
  const [opened, { toggle }] = useDisclosure();

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md">
          <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
          <Logo />
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="md">
        <NavLink href="/dashboard" label="Dashboard" leftSection={<IconHome size={16} />} />
        <NavLink href="/settings" label="Settings" leftSection={<IconSettings size={16} />} />
      </AppShell.Navbar>

      <AppShell.Main>{children}</AppShell.Main>
    </AppShell>
  );
}
```

### Data table with mantine-datatable

```tsx
import { DataTable } from 'mantine-datatable';

<DataTable
  records={data}
  fetching={isLoading}
  columns={[
    { accessor: 'name', title: 'Name', sortable: true },
    { accessor: 'email', title: 'Email' },
    {
      accessor: 'actions',
      title: '',
      render: (row) => (
        <Group gap="xs" justify="flex-end">
          <ActionIcon variant="subtle" onClick={() => onEdit(row)}>
            <IconEdit size={16} />
          </ActionIcon>
        </Group>
      ),
    },
  ]}
  totalRecords={total}
  recordsPerPage={PAGE_SIZE}
  page={page}
  onPageChange={setPage}
  sortStatus={sortStatus}
  onSortStatusChange={setSortStatus}
  highlightOnHover
  withTableBorder
  borderRadius="sm"
/>;
```

---

## 8. Gotchas

**No `sx` prop.** It was removed in v7. Use `style`, CSS Modules, or `classNames`.

**CSS must be imported.** Each package requires its own CSS import. Forgetting this causes unstyled components with no error:

```tsx
import '@mantine/core/styles.css'; // always
import '@mantine/notifications/styles.css'; // when using notifications
import '@mantine/dates/styles.css'; // when using date pickers
```

**`theme.fn.*` is gone.** CSS variables replace it. Use `var(--mantine-color-blue-6)` instead of `theme.fn.themeColor('blue', 6)`.

**Portal components and CSS Modules.** `Modal`, `Drawer`, `Menu`, `Popover`, `Tooltip` render into a portal (outside your component's DOM node). CSS Modules scoped to a parent component won't reach them. Use `classNames` prop or global styles.

**`ColorSchemeScript` for SSR.** Without it, there's a colour flash on load in Next.js or Remix:

```tsx
// In Next.js: app/layout.tsx <head>
import { ColorSchemeScript } from '@mantine/core';
<head>
  <ColorSchemeScript />
</head>;
```

**`Notifications` component placement.** It must be inside `MantineProvider`, rendered once at the root. Rendering it more than once causes duplicate notifications.

**`Select` vs `Combobox`.** `Select` and `MultiSelect` handle the common case. For a fully custom dropdown (async search, custom option rendering, grouping), use `Combobox` directly.

**`form.submitting` is not a boolean.** It's undefined until first submit. Use `form.submitting === true` or initialise with `{ submitting: false }` if you reference it before submission.

**`useForm` `initialValues` is not reactive.** Changing `initialValues` after mount does nothing. To populate a form with async data, call `form.setValues(data)` after the data loads, or use `form.setInitialValues` + `form.reset()` together.

---

## Reference files

- `references/forms.md` — Complete `@mantine/form` patterns: nested objects, array fields, async initial values, `TransformedValues`, file uploads
- `references/theming.md` — Theme tokens, color system, dark mode, CSS variable reference
