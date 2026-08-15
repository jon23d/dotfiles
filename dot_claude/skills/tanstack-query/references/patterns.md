# Advanced TanStack Query Patterns

This document covers advanced patterns for complex SaaS scenarios.

---

## Suspense Mode (v5)

Use `useSuspenseQuery` to leverage React's Suspense for cleaner data loading:

```typescript
import { useSuspenseQuery } from '@tanstack/react-query';
import { Suspense } from 'react';
import { Skeleton } from '@mantine/core';

function UserProfile({ userId }: { userId: string }) {
  // Throws a promise if data is loading; throws Error if fetch fails
  const { data: user } = useSuspenseQuery({
    queryKey: userKeys.detail(userId),
    queryFn: () => api.users.getById(userId),
  });

  return <div>{user.name}</div>;
}

function UserPage({ userId }: { userId: string }) {
  return (
    <Suspense fallback={<Skeleton height={200} />}>
      <ErrorBoundary fallback={<Alert color="red">Failed to load user</Alert>}>
        <UserProfile userId={userId} />
      </ErrorBoundary>
    </Suspense>
  );
}
```

**When to use:** For layouts where you always need the data before rendering. Avoid if you want granular loading states (isLoading vs. isFetching).

---

## Parallel Queries with useQueries

Fetch multiple queries in parallel, waiting for all to complete:

```typescript
import { useQueries } from '@tanstack/react-query';

interface QueryConfigs {
  userId: string;
  teamId: string;
}

function UserDashboard({ userId, teamId }: QueryConfigs) {
  const results = useQueries({
    queries: [
      {
        queryKey: userKeys.detail(userId),
        queryFn: () => api.users.getById(userId),
      },
      {
        queryKey: teamKeys.detail(teamId),
        queryFn: () => api.teams.getById(teamId),
      },
      {
        queryKey: subscriptionKeys.list(teamId),
        queryFn: () => api.subscriptions.list(teamId),
      },
    ],
  });

  const [userQuery, teamQuery, subscriptionQuery] = results;

  if (userQuery.isLoading || teamQuery.isLoading || subscriptionQuery.isLoading) {
    return <Skeleton />;
  }

  return (
    <div>
      <h1>{userQuery.data?.name}</h1>
      <p>Team: {teamQuery.data?.name}</p>
      <p>Subscription: {subscriptionQuery.data?.[0]?.plan}</p>
    </div>
  );
}
```

**Benefit:** Single render for all parallel fetches instead of waterfall (query 1 → 2 → 3).

---

## Query Cancellation

Cancel in-flight requests when:

- User unmounts the component
- User navigates away
- New query is triggered (prevent stale overwrites)

```typescript
const { mutate } = useMutation({
  mutationFn: async (formData) => {
    // Create an AbortController for this request
    const controller = new AbortController();
    const signal = controller.signal;

    return fetch('/api/users', {
      method: 'POST',
      body: JSON.stringify(formData),
      signal, // Pass signal to fetch
    });
  },
  onMutate: async () => {
    // Cancel ongoing queries before optimistic update
    await queryClient.cancelQueries({ queryKey: userKeys.lists() });
    // Returns the old data for rollback
    return queryClient.getQueryData(userKeys.lists());
  },
});
```

`useQuery` automatically cancels requests on unmount via AbortController.

---

## Polling with refetchInterval

Automatically refetch data at intervals (useful for real-time dashboards):

```typescript
function LiveSubscriptionStatus({ teamId }: { teamId: string }) {
  const { data: subscription } = useQuery({
    queryKey: subscriptionKeys.detail(teamId),
    queryFn: () => api.subscriptions.get(teamId),
    refetchInterval: 1000 * 10, // Refetch every 10 seconds
  });

  // Stop polling when component unmounts
  // Or conditionally:
  // refetchInterval: subscription?.status === 'active' ? 10000 : false,
}
```

**Best practice:** Disable polling when data is stable (`refetchInterval: false`).

---

## Window Focus Refetching

By default, queries refetch when the window regains focus (user switches tabs). Disable if inappropriate:

```typescript
const { data: user } = useQuery({
  queryKey: userKeys.detail(userId),
  queryFn: () => api.users.getById(userId),
  refetchOnWindowFocus: false, // Don't refetch on tab focus
});

// Or globally in QueryClient config:
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false, // Disable for all queries
    },
  },
});
```

**When to disable:** Payment forms, unsaved draft editors, sensitive operations.

---

## Mutations with File Uploads & Progress Tracking

Track upload progress and handle file uploads:

```typescript
import { useCallback } from 'react';

interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

function FileUploadForm() {
  const [progress, setProgress] = useState<UploadProgress>({ loaded: 0, total: 0, percent: 0 });

  const { mutate, isPending } = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);

      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        // Track progress
        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            const percentComplete = (event.loaded / event.total) * 100;
            setProgress({
              loaded: event.loaded,
              total: event.total,
              percent: percentComplete,
            });
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status === 200) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            reject(new Error(`Upload failed: ${xhr.status}`));
          }
        });

        xhr.addEventListener('error', () => reject(new Error('Upload failed')));

        xhr.open('POST', '/api/upload');
        xhr.send(formData);
      });
    },
    onSuccess: () => {
      setProgress({ loaded: 0, total: 0, percent: 0 });
      queryClient.invalidateQueries({ queryKey: fileKeys.lists() });
    },
  });

  return (
    <div>
      <input
        type="file"
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          if (file) mutate(file);
        }}
        disabled={isPending}
      />
      {isPending && (
        <Progress
          value={progress.percent}
          label={`${Math.round(progress.percent)}%`}
        />
      )}
    </div>
  );
}
```

---

## Hydration & SSR (Next.js, Remix)

### Dehydrating on Server

```typescript
// app.server.ts or api/route.ts
import { dehydrate } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';

export async function GET(req: Request) {
  // Prefetch data server-side
  await queryClient.prefetchQuery({
    queryKey: userKeys.detail('user-123'),
    queryFn: () => api.users.getById('user-123'),
  });

  // Dehydrate to JSON
  const dehydratedState = dehydrate(queryClient);
  return Response.json({ dehydratedState });
}
```

### Hydrating on Client

```typescript
import { HydrationBoundary, dehydrate } from '@tanstack/react-query';

export default function RootLayout({ children, dehydratedState }) {
  return (
    <HydrationBoundary state={dehydratedState}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </HydrationBoundary>
  );
}
```

This prevents duplicate requests (server fetched data, client won't refetch immediately).

---

## Global Error Handling with QueryCache Callbacks

Handle all query errors in one place:

```typescript
import { QueryCache } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';

const queryCache = new QueryCache({
  onError: (error, query) => {
    // Ignore certain errors
    if (error.message === 'Cancelled') return;

    // Handle 401 (Unauthorized) globally
    if (error.status === 401) {
      window.location.href = '/login';
      return;
    }

    // Show notification for other errors
    notifications.show({
      color: 'red',
      title: 'Error',
      message: error.message || 'Something went wrong',
    });
  },
});

export const queryClient = new QueryClient({ queryCache });
```

Similar patterns exist for `MutationCache`:

```typescript
const mutationCache = new MutationCache({
  onError: (error) => {
    notifications.show({
      color: 'red',
      message: error.message,
    });
  },
  onSuccess: (data) => {
    notifications.show({
      color: 'green',
      message: 'Operation successful',
      autoClose: 2000,
    });
  },
});
```

---

## Testing: Mocking Queries

### Setup: QueryClientProvider in Tests

```typescript
import { render } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';

function renderWithQuery(component: React.ReactNode) {
  return render(
    <QueryClientProvider client={queryClient}>
      {component}
    </QueryClientProvider>
  );
}

export default renderWithQuery;
```

### Mock Query Success

```typescript
import { userKeys } from '@/api/users/queries';
import renderWithQuery from '@/test/render-with-query';

test('displays user name', async () => {
  // Seed cache with mock data
  queryClient.setQueryData(userKeys.detail('user-123'), {
    id: 'user-123',
    name: 'John Doe',
  });

  const { getByText } = renderWithQuery(<UserProfile userId="user-123" />);

  expect(getByText('John Doe')).toBeInTheDocument();
});
```

### Mock Query Failure

```typescript
test('shows error on fetch failure', async () => {
  // Set query data to error state
  queryClient.setQueryData(userKeys.detail('user-123'), undefined);

  // Manually trigger error
  const queryInfo = queryClient.getQueryState(userKeys.detail('user-123'));
  queryClient.setQueryData(
    userKeys.detail('user-123'),
    undefined,
    { updatedAt: Date.now() }
  );

  // Or use msw (Mock Service Worker) for network interception:
  server.use(
    http.get('/api/users/:id', () => {
      return new HttpResponse(null, { status: 500 });
    })
  );

  const { getByText } = renderWithQuery(<UserProfile userId="user-123" />);

  await waitFor(() => {
    expect(getByText(/Error|Failed/)).toBeInTheDocument();
  });
});
```

### Mock Mutations

```typescript
test('creates team successfully', async () => {
  const { getByText, getByRole } = renderWithQuery(<CreateTeamForm />);

  // Mock mutation success
  queryClient.setMutationDefaults(
    { mutationKey: ['teams', 'create'] },
    { mutationFn: async () => ({ id: 'team-123', name: 'New Team' }) }
  );

  fireEvent.click(getByRole('button', { name: /Create/i }));

  await waitFor(() => {
    expect(getByText('New Team')).toBeInTheDocument();
  });
});
```

---

## useCallback with Query Dependencies

Avoid recreating callback functions unnecessarily:

```typescript
import { useCallback } from 'react';

function UserList() {
  const { data: users } = useQuery({
    queryKey: userKeys.lists(),
    queryFn: () => api.users.list(),
  });

  // This callback is stable and won't change unless users changes
  const handleSelectUser = useCallback(
    (userId: string) => {
      const user = users?.find((u) => u.id === userId);
      console.log('Selected:', user);
    },
    [users]
  );

  return (
    <UserTable
      users={users}
      onSelectUser={handleSelectUser} // Stable reference
    />
  );
}
```

---

## Conditional Query Execution

Sometimes you need to manually control when queries run:

```typescript
import { useQuery } from '@tanstack/react-query';

function SearchUsers() {
  const [searchTerm, setSearchTerm] = useState('');

  const { data: results } = useQuery({
    queryKey: userKeys.list({ search: searchTerm }),
    queryFn: () => api.users.search(searchTerm),
    // Only fetch if search term is at least 3 characters
    enabled: searchTerm.length >= 3,
    staleTime: 1000 * 60, // Cache search results for 1 minute
  });

  return (
    <>
      <TextInput
        placeholder="Search users..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.currentTarget.value)}
      />
      {results && results.length > 0 && (
        <List>
          {results.map((user) => (
            <List.Item key={user.id}>{user.name}</List.Item>
          ))}
        </List>
      )}
    </>
  );
}
```

---

## Optimizing Re-renders with select

The `select` option is powerful for preventing unnecessary re-renders:

```typescript
function TeamMembersCount({ teamId }: { teamId: string }) {
  // Only subscribes to count changes, not full members array
  const { data: count } = useQuery({
    queryKey: teamMemberKeys.list(teamId),
    queryFn: () => api.teams.getMembers(teamId),
    select: (members) => members.length, // Returns just the count
  });

  return <Badge>{count} members</Badge>;
}
```

This component only re-renders if the count changes, not if individual member data changes.

---

## Rate Limiting & Debouncing

Prevent hammering your API with searches or autocompletion:

```typescript
import { useDebouncedValue } from '@mantine/hooks';

function AutocompleteUsers() {
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch] = useDebouncedValue(searchInput, 300);

  const { data: suggestions } = useQuery({
    queryKey: userKeys.autocomplete(debouncedSearch),
    queryFn: () => api.users.autocomplete(debouncedSearch),
    enabled: debouncedSearch.length >= 2,
    staleTime: 1000 * 60 * 5, // Suggestions valid for 5 minutes
  });

  return (
    <Autocomplete
      data={suggestions?.map((u) => ({ label: u.name, value: u.id })) ?? []}
      value={searchInput}
      onChange={setSearchInput}
    />
  );
}
```

---

## Background Updates (Stale While Revalidate)

Keep UI responsive by using stale data while refetching in background:

```typescript
function LatestPosts() {
  const { data: posts } = useQuery({
    queryKey: postKeys.lists(),
    queryFn: () => api.posts.list(),
    staleTime: 1000 * 60, // Fresh for 1 minute
    // Component shows stale data immediately while refetching in background
  });

  return (
    <div>
      {posts?.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
      {/* If data is being refetched, you can show a subtle indicator */}
    </div>
  );
}
```

The query refetches in the background after `staleTime` expires, and users see the new data as soon as it's ready.

---

## Chaining Mutations

Execute mutations in sequence:

```typescript
function CreateAndSubscribe() {
  const { mutate: createTeam, isPending: creatingTeam } = useMutation({
    mutationFn: (name: string) => api.teams.create(name),
  });

  const { mutate: subscribe, isPending: subscribing } = useMutation({
    mutationFn: (teamId: string) => api.subscriptions.create(teamId),
    onSuccess: () => {
      notifications.show({
        color: 'green',
        message: 'Team created and subscribed!',
      });
    },
  });

  const handleCreateAndSubscribe = (teamName: string) => {
    createTeam(teamName, {
      onSuccess: (newTeam) => {
        // Chain: after team created, subscribe
        subscribe(newTeam.id);
      },
    });
  };

  return (
    <Button
      onClick={() => handleCreateAndSubscribe('My Team')}
      loading={creatingTeam || subscribing}
      disabled={creatingTeam || subscribing}
    >
      Create & Subscribe
    </Button>
  );
}
```

---

## Summary

These patterns handle complex real-world scenarios:

- **Suspense**: Cleaner loading UI with React Suspense.
- **Parallel queries**: Fetch multiple data sources efficiently.
- **Cancellation**: Prevent stale updates and free resources.
- **Polling**: Keep data fresh for live dashboards.
- **File uploads**: Track progress and handle large data.
- **SSR**: Seed client cache from server-rendered data.
- **Global errors**: Handle all query/mutation errors centrally.
- **Testing**: Mock queries and mutations in unit tests.
- **Optimization**: Use `select` and `useCallback` to prevent re-renders.

For additional info, refer to the official docs: https://tanstack.com/query/latest
