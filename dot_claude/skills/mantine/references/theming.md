# Mantine v7 Theming Reference

## Theme structure

```ts
import { createTheme, MantineColorsTuple, rem } from '@mantine/core'

export const theme = createTheme({
  // Color system
  primaryColor: 'brand',          // must match a key in colors
  primaryShade: { light: 6, dark: 8 },
  colors: { brand: [...10 shades] },

  // Typography
  fontFamily: 'Inter, sans-serif',
  fontFamilyMonospace: 'JetBrains Mono, monospace',
  headings: { fontFamily: 'Inter, sans-serif', fontWeight: '700' },

  // Sizing
  defaultRadius: 'sm',
  scale: 1,                        // scales all rem values — useful for density adjustments

  // Spacing scale (overrides defaults: xs=10, sm=12, md=16, lg=20, xl=32)
  spacing: { xs: rem(8), sm: rem(12), md: rem(16), lg: rem(24), xl: rem(40) },

  // Component default props and styles
  components: {
    Button: {
      defaultProps: { radius: 'md' },
      styles: { root: { fontWeight: 600 } },
    },
    Modal: {
      defaultProps: { centered: true, radius: 'md', overlayProps: { blur: 3 } },
    },
    TextInput: {
      defaultProps: { radius: 'sm' },
    },
  },

  // Other
  white: '#ffffff',
  black: '#1a1a1a',
  defaultGradient: { from: 'brand.5', to: 'brand.8', deg: 135 },
  focusRing: 'auto',               // 'auto' | 'always' | 'never'
  respectReducedMotion: true,
})
```

## Generating a color palette

Mantine requires exactly 10 shades per color (index 0–9). Use the palette generator at https://mantine.dev/colors-generator/ to convert a single brand hex into 10 shades.

```ts
// Example: a blue brand color
const brand: MantineColorsTuple = [
  '#e8f0ff', // 0 — lightest tint (backgrounds)
  '#c6d5ff', // 1
  '#9ab4ff', // 2
  '#6b8fff', // 3
  '#4270ff', // 4
  '#2457fa', // 5 — often the "default" shade
  '#1a49e8', // 6 — primaryShade.light
  '#0f38d0', // 7
  '#082ab8', // 8 — primaryShade.dark
  '#021da0', // 9 — darkest tint
];
```

## CSS variable reference

All Mantine values are exposed as CSS variables. Use them in CSS Modules and `style` props.

### Colors

```css
var(--mantine-color-blue-5)          /* specific shade */
var(--mantine-color-primary)         /* primaryColor index 6 (light) */
var(--mantine-color-primary-filled)  /* filled button background */
var(--mantine-color-text)            /* body text color */
var(--mantine-color-body)            /* page background */
var(--mantine-color-error)           /* error text color */
var(--mantine-color-dimmed)          /* secondary/muted text */

/* Dynamic light/dark — use light-dark() in CSS Modules */
background: light-dark(var(--mantine-color-white), var(--mantine-color-dark-6));
```

### Spacing

```css
var(--mantine-spacing-xs)   /* 10px default */
var(--mantine-spacing-sm)   /* 12px */
var(--mantine-spacing-md)   /* 16px */
var(--mantine-spacing-lg)   /* 20px */
var(--mantine-spacing-xl)   /* 32px */
```

### Typography

```css
var(--mantine-font-size-xs)      /* 12px */
var(--mantine-font-size-sm)      /* 14px */
var(--mantine-font-size-md)      /* 16px */
var(--mantine-font-size-lg)      /* 18px */
var(--mantine-font-size-xl)      /* 20px */
var(--mantine-line-height)       /* 1.55 */
var(--mantine-font-family)
var(--mantine-font-family-monospace)
```

### Radii and shadows

```css
var(--mantine-radius-xs)
var(--mantine-radius-sm)
var(--mantine-radius-md)
var(--mantine-radius-lg)
var(--mantine-radius-xl)

var(--mantine-shadow-xs)
var(--mantine-shadow-sm)
var(--mantine-shadow-md)
var(--mantine-shadow-lg)
var(--mantine-shadow-xl)
```

### Breakpoints (for use in media queries)

```css
var(--mantine-breakpoint-xs)   /* 36em */
var(--mantine-breakpoint-sm)   /* 48em */
var(--mantine-breakpoint-md)   /* 62em */
var(--mantine-breakpoint-lg)   /* 75em */
var(--mantine-breakpoint-xl)   /* 88em */
```

PostCSS mixin equivalents:

```css
@mixin smaller-than $mantine-breakpoint-sm {
  /* mobile styles */
}
@mixin larger-than $mantine-breakpoint-md {
  /* desktop styles */
}
@mixin hover {
  /* hover styles */
}
@mixin light {
  /* light mode override */
}
@mixin dark {
  /* dark mode override */
}
@mixin rtl {
  /* RTL override */
}
```

## Dark mode

Mantine supports light/dark/auto modes. The recommended approach in v7:

```tsx
import { useLocalStorage } from '@mantine/hooks';

function ColorSchemeToggle() {
  const [colorScheme, setColorScheme] = useLocalStorage<'light' | 'dark'>({
    key: 'mantine-color-scheme',
    defaultValue: 'light',
  });

  return (
    <MantineProvider
      theme={theme}
      forceColorScheme={colorScheme} // or omit to follow system
    >
      {children}
    </MantineProvider>
  );
}
```

For Next.js App Router, use `next-themes`:

```tsx
// app/layout.tsx
import { ColorSchemeScript } from '@mantine/core';

<head>
  <ColorSchemeScript defaultColorScheme="auto" />
</head>;
```

## Component theming patterns

### Override styles for specific variants

```ts
Button: {
  styles: (theme, props) => ({
    root: {
      // Different styles per variant
      ...(props.variant === 'subtle' && {
        backgroundColor: 'transparent',
        '&:hover': { backgroundColor: 'var(--mantine-color-gray-0)' },
      }),
    },
  }),
},
```

### Data attributes for state-based styles

Mantine uses `data-*` attributes on component internals for state:

- `data-checked` — Checkbox, Radio when checked
- `data-disabled` — disabled state
- `data-active` — NavLink active state
- `data-with-icon` — input with leftSection
- `data-error` — input with error

```css
/* Target checked state */
.checkbox[data-checked] {
  background: var(--mantine-color-blue-6);
}

/* Target disabled */
.input[data-disabled] {
  opacity: 0.6;
  cursor: not-allowed;
}
```

## rem() utility

Always use `rem()` when specifying sizes in theme config — it respects the user's browser font size and Mantine's `scale` setting:

```ts
import { rem } from '@mantine/core'

// In theme
spacing: {
  xs: rem(8),
  sm: rem(12),
  md: rem(16),
}

// In component styles
<Box style={{ width: rem(200), height: rem(48) }}>
```
