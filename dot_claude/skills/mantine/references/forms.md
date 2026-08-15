# @mantine/form — Complete Patterns

## Nested objects

```tsx
const form = useForm({
  initialValues: {
    user: { name: '', email: '' },
    address: { street: '', city: '', country: '' },
  },
})

// Spread nested field props
<TextInput label="Name" {...form.getInputProps('user.name')} />
<TextInput label="Street" {...form.getInputProps('address.street')} />
```

## Array fields

Use `useListState` for simple cases. For arrays that need validation inside `@mantine/form`, use the built-in list helpers:

```tsx
const form = useForm({
  initialValues: {
    emails: [{ value: '', key: randomId() }],
  },
})

const emailFields = form.values.emails.map((item, index) => (
  <Group key={item.key} mt="xs">
    <TextInput
      placeholder="user@example.com"
      withAsterisk
      style={{ flex: 1 }}
      {...form.getInputProps(`emails.${index}.value`)}
    />
    <ActionIcon color="red" onClick={() => form.removeListItem('emails', index)}>
      <IconTrash size={16} />
    </ActionIcon>
  </Group>
))

// Add item
<Button onClick={() => form.insertListItem('emails', { value: '', key: randomId() })}>
  Add email
</Button>
```

## Async initial values

`useForm`'s `initialValues` is not reactive — setting it after mount has no effect. Two patterns:

**Pattern 1: Reset after load**

```tsx
const { data } = useQuery({ queryKey: ['record', id], queryFn: () => api.get(id) });

const form = useForm<FormValues>({ initialValues: { name: '', email: '' } });

useEffect(() => {
  if (data) {
    form.setValues({ name: data.name, email: data.email });
    form.resetDirty({ name: data.name, email: data.email });
  }
}, [data]);

// form.isDirty() now correctly reflects changes from the loaded values
```

**Pattern 2: Don't render until data is available**

```tsx
if (!data) return <Skeleton height={200} />;

return <EditForm initialValues={data} />;

// EditForm receives stable initialValues and mounts once
function EditForm({ initialValues }: { initialValues: FormValues }) {
  const form = useForm({ initialValues });
  // ...
}
```

## TransformedValues

When your submitted values differ from your form state (e.g., you store a string but submit a number):

```tsx
const form = useForm({
  initialValues: {
    age: '', // string in the input
    tags: [] as string[],
  },
  transformValues: (values) => ({
    age: parseInt(values.age, 10),
    tags: values.tags.map((t) => t.trim().toLowerCase()),
  }),
});

// form.onSubmit receives the TRANSFORMED values
const handleSubmit = form.onSubmit((values) => {
  // values.age is number, values.tags are trimmed lowercase
  api.create(values);
});
```

## Server-side error mapping

Map API validation errors back to fields after a failed submission:

```tsx
const handleSubmit = form.onSubmit(async (values) => {
  try {
    await api.create(values);
  } catch (err) {
    if (err instanceof ApiValidationError) {
      // err.errors: Record<string, string>  e.g. { 'user.email': 'Already in use' }
      form.setErrors(err.errors);
    } else {
      // Non-field error — show it on a general field or notification
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  }
});
```

## File uploads with forms

```tsx
const form = useForm<{ name: string; avatar: File | null }>({
  initialValues: { name: '', avatar: null },
})

// In the submit handler, convert to FormData
const handleSubmit = form.onSubmit(async (values) => {
  const formData = new FormData()
  formData.append('name', values.name)
  if (values.avatar) formData.append('avatar', values.avatar)
  await api.upload(formData)
})

<FileInput
  label="Avatar"
  accept="image/*"
  {...form.getInputProps('avatar')}
/>
```

## Validation on change vs blur

The default is validate on submit only. Change this per-form based on complexity:

```tsx
useForm({
  // For short forms where instant feedback helps
  validateInputOnChange: true,

  // For long forms — validate on blur to avoid premature errors
  validateInputOnBlur: true,
  validateInputOnChange: false,

  // Hybrid: validate on change only after first submit attempt
  // (This is the best UX for most forms)
  validateInputOnChange: false,
  validateInputOnBlur: true,
  // Then on first failed submit, errors appear — after that, fields validate on change
});
```

## Conditional fields

Show/hide fields based on form state without needing separate state:

```tsx
const form = useForm({
  initialValues: { type: 'email', email: '', phone: '' },
})

<Select
  label="Contact type"
  data={['email', 'phone']}
  {...form.getInputProps('type')}
/>

{form.values.type === 'email' && (
  <TextInput label="Email" {...form.getInputProps('email')} />
)}

{form.values.type === 'phone' && (
  <TextInput label="Phone" {...form.getInputProps('phone')} />
)}
```

Clear the other field on type change to avoid submitting stale hidden values:

```tsx
<Select
  {...form.getInputProps('type')}
  onChange={(value) => {
    form.setFieldValue('type', value);
    form.setFieldValue('email', '');
    form.setFieldValue('phone', '');
  }}
/>
```

## Multi-step forms

```tsx
const [step, setStep] = useState(0);
const form = useForm({ initialValues: { name: '', email: '', plan: '' } });

// Validate only the current step's fields before advancing
const handleNext = async () => {
  const fieldsToValidate = step === 0 ? ['name', 'email'] : ['plan'];
  const result = form.validate();
  const stepErrors = Object.keys(result.errors).filter((k) => fieldsToValidate.includes(k));
  if (stepErrors.length === 0) setStep((s) => s + 1);
};
```
