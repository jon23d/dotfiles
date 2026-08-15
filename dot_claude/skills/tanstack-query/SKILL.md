---
name: tanstack-query
description: TanStack Query (React Query v5) implementation guide. Load whenever fetching, caching, or mutating server data in a React application. Covers setup, query key strategy, useQuery, useMutation, optimistic updates, pagination, and prefetching. Use whenever you see @tanstack/react-query imports or when implementing data fetching that needs caching, loading states, or invalidation.
---

# TanStack Query (React Query v5) for TypeScript SaaS

TanStack Query is the industry standard for server state management in React. It eliminates the need for useState + useEffect data fetching by handling caching, synchronization, background refetching, and invalidation automatically.

## 1. Setup & Configuration

### Installation

```bash
npm install @tanstack/react-query
npm install -D @tanstack/react-query-devtools  # Dev dependency
```

### QueryClient Configuration

Create a centralized `queryClient` instance with sensible defaults for SaaS:

```typescript
// lib/queryClient.ts
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes: data is fresh for this duration
      gcTime: 1000 * 60 * 10, // 10 minutes: garbage collection time (formerly cacheTime)
      retry: 1, // Retry failed requests once automatically
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000), // Exponential backoff
    },
    mutations: {
      retry: 0, // Don't retry mutations (usually user actions; explicit retry preferred)
    },
  },
});
```

**Key settings explained:**

- `staleTime`: Data is considered fresh. During this period, queries won't refetch even if they're remounted.
- `gcTime`: How long inactive queries are cached in memory. After this, they're garbage collected.
- `retry`: Automatic retry for network failures. Set to 0 for mutations to avoid duplicate operations.
- `retryDelay`: Exponential backoff prevents hammering your server on network issues.

### Provider Setup

Wrap your app with QueryClientProvider and optionally include DevTools:

```typescript
// app.tsx or main.tsx
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { queryClient } from '@/lib/queryClient';

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <MantineProvider>
        {/* Your app routes/components */}
      </MantineProvider>
      {/* Only included in development */}
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
```

ReactQueryDevtools is a browser DevTools panel showing all active queries, their state, cache entries, and mutation history. Essential for debugging.

---

## 2. Query Key Strategy (Critical Architecture)

**This is the most important architectural decision.** Query keys are string/number arrays used to identify, cache, and invalidate queries. Bad key design leads to cache misses, stale data, and hard-to-debug state.

### The Factory Pattern

Create query key factories near your API functions:

```typescript
// api/users/queries.ts
import { UserFilters } from './types';

export const userKeys = {
  all: ['users'] as const,
  lists: () => [...userKeys.all, 'list'] as const,
  list: (filters: UserFilters) => [...userKeys.lists(), filters] as const,
  details: () => [...userKeys.all, 'detail'] as const,
  detail: (id: string) => [...userKeys.details(), id] as const,
};

// api/subscriptions/queries.ts
export const subscriptionKeys = {
  all: ['subscriptions'] as const,
  lists: () => [...subscriptionKeys.all, 'list'] as const,
  list: (teamId: string) => [...subscriptionKeys.lists(), teamId] as const,
  detail: (id: string) => [...subscriptionKeys.all, 'detail', id] as const,
};
```

### Why This Pattern?

1. **Granular Invalidation**: Invalidate `userKeys.list({ search: 'john' })` without affecting `userKeys.detail('user-123')`.
2. **No Typos**: Use factories instead of magic strings (`invalidateQueries({ queryKey: userKeys.list(filters) })`).
3. **Easy Refactoring**: If you change filter structure, update the factory once; all usages follow.
4. **Hierarchical**: Parent keys (e.g., `userKeys.all`) can invalidate all child queries.

### Using Keys in Components

```typescript
const { data: user } = useQuery({
  queryKey: userKeys.detail(userId),
  queryFn: () => api.users.getById(userId),
});

// Later, after creating a user, invalidate the list:
const { mutate: createUser } = useMutation({
  mutationFn: (data: CreateUserInput) => api.users.create(data),
  onSuccess: () => {
    // Invalidate all user lists (all filter variants)
    queryClient.invalidateQueries({ queryKey: userKeys.lists() });
  },
});
```

---

## 3. useQuery Hook

`useQuery` is for fetching read-only server data. It handles loading, error, and caching automatically.

### Basic Usage

```typescript
import { useQuery } from '@tanstack/react-query';
import { userKeys } from '@/api/users/queries';

function UserProfile({ userId }: { userId: string }) {
  const { data: user, isLoading, isError, error } = useQuery({
    queryKey: userKeys.detail(userId),
    queryFn: () => api.users.getById(userId),
  });

  if (isLoading) return <Skeleton height={200} />;
  if (isError) return <Alert color="red">Failed: {error.message}</Alert>;

  return <div>{user?.name}</div>;
}
```

### Advanced Options

```typescript
const { data, isLoading, isPending, isFetching, isError } = useQuery({
  queryKey: userKeys.detail(userId),
  queryFn: async () => {
    const res = await fetch(`/api/users/${userId}`);
    if (!res.ok) throw new Error('Failed to fetch user');
    return res.json();
  },
  // Data is fresh for 5 minutes (unless overridden)
  staleTime: 1000 * 60 * 5,

  // Only fetch if this condition is true (dependent queries)
  enabled: !!userId, // Don't fetch if userId is null/undefined

  // Transform the response into a different shape
  select: (user) => ({ ...user, displayName: user.firstName + ' ' + user.lastName }),

  // Provide fallback data while fetching
  placeholderData: { id: '', name: 'Loading...' },

  // Custom error handling
  retry: (failureCount, error: any) => {
    // Don't retry 401 or 403
    if (error.status === 401 || error.status === 403) return false;
    return failureCount < 2;
  },
});
```

**Key differences:**

- `isLoading`: Query has no cached data and is fetching (initial load).
- `isPending`: Alias for `isLoading` (same behavior).
- `isFetching`: Any fetch is in progress, including background refetches. Useful for showing "updating..." spinners.
- `isError`: The last fetch failed.

### The `select` Transform

Transform data without refetching:

```typescript
const { data: displayName } = useQuery({
  queryKey: userKeys.detail(userId),
  queryFn: () => api.users.getById(userId),
  select: (user) => `${user.firstName} ${user.lastName}`,
});
// data is now just the display name string
```

This is cheaper than fetching, is memoized by React Query, and updates when dependencies change.

### Dependent Queries

Fetch data conditionally using the `enabled` flag:

```typescript
function TeamMembersPage({ teamId }: { teamId: string | null }) {
  // Only fetch if teamId exists
  const { data: team } = useQuery({
    queryKey: userKeys.detail(teamId!),
    queryFn: () => api.teams.getById(teamId!),
    enabled: !!teamId,
  });

  // Only fetch members after team loads
  const { data: members } = useQuery({
    queryKey: teamMemberKeys.list(teamId!),
    queryFn: () => api.teams.getMembers(teamId!),
    enabled: !!teamId && !!team, // Both conditions required
  });
}
```

---

## 4. useMutation Hook

`useMutation` is for mutations (POST, PUT, DELETE, PATCH). Unlike queries, mutations don't cache and require explicit action to execute.

### Basic Usage

```typescript
import { useMutation } from '@tanstack/react-query';

function CreateTeamForm() {
  const { mutate, isPending, error } = useMutation({
    mutationFn: (data: CreateTeamInput) => api.teams.create(data),
  });

  const handleSubmit = (formData: CreateTeamInput) => {
    mutate(formData);
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); handleSubmit(/* ... */); }}>
      <Button loading={isPending} type="submit">Create Team</Button>
      {error && <Alert color="red">{error.message}</Alert>}
    </form>
  );
}
```

### With onSuccess & Query Invalidation

```typescript
const { mutate } = useMutation({
  mutationFn: (data: CreateTeamInput) => api.teams.create(data),
  onSuccess: (newTeam) => {
    // New team was created, invalidate the list to refetch
    queryClient.invalidateQueries({ queryKey: teamKeys.lists() });

    // Or seed the cache with the response (no refetch needed)
    queryClient.setQueryData(teamKeys.detail(newTeam.id), newTeam);
  },
  onError: (error) => {
    notifications.show({
      color: 'red',
      message: error.message,
    });
  },
  onSettled: () => {
    // Always called, success or error. Great for cleanup.
    form.reset();
  },
});
```

### Handling Mutation Variables

```typescript
type UpdateUserInput = { id: string; name: string };

const { mutate } = useMutation<void, Error, UpdateUserInput>({
  mutationFn: async ({ id, name }) => {
    await api.users.update(id, { name });
  },
  onSuccess: (_, variables) => {
    // variables contains the { id, name } passed to mutate()
    queryClient.invalidateQueries({ queryKey: userKeys.detail(variables.id) });
  },
});

mutate({ id: 'user-123', name: 'John' });
```

### Reset Mutation State

```typescript
const mutation = useMutation(/* ... */);

// Later, clear error/isPending state
mutation.reset();
```

### When to Extract a Hook

Extract a custom hook only when it earns its existence — complex query
configuration (optimistic updates, polling, cache invalidation, dependent
queries) justifies one. A straightforward `useQuery({ queryKey, queryFn })`
or `useMutation({ mutationFn })` call can stay inlined in the component; a
pass-through wrapper around it adds indirection without value.

---

## 5. Optimistic Updates

When user confidence is high (e.g., toggling a like, updating a subscription), update the UI immediately while the request is in flight. If it fails, rollback.

```typescript
interface Post {
  id: string;
  title: string;
  likes: number;
  liked: boolean;
}

function LikeButton({ post }: { post: Post }) {
  const { mutate } = useMutation({
    mutationFn: async (liked: boolean) => {
      await api.posts.updateLike(post.id, { liked });
    },
    onMutate: async (liked) => {
      // Cancel ongoing queries to prevent race conditions
      await queryClient.cancelQueries({ queryKey: postKeys.detail(post.id) });

      // Save current data as backup
      const previousData = queryClient.getQueryData<Post>(postKeys.detail(post.id));

      // Update cache optimistically
      queryClient.setQueryData(postKeys.detail(post.id), (old: Post) => ({
        ...old,
        liked,
        likes: old.likes + (liked ? 1 : -1),
      }));

      // Return rollback function
      return { previousData };
    },
    onError: (err, _, context) => {
      // Restore on error
      if (context?.previousData) {
        queryClient.setQueryData(postKeys.detail(post.id), context.previousData);
      }
      notifications.show({ color: 'red', message: 'Failed to update like' });
    },
    onSettled: () => {
      // Invalidate to sync with server (though we're likely already in sync)
      queryClient.invalidateQueries({ queryKey: postKeys.detail(post.id) });
    },
  });

  return (
    <Button
      variant={post.liked ? 'filled' : 'outline'}
      onClick={() => mutate(!post.liked)}
    >
      {post.likes} Likes
    </Button>
  );
}
```

**Key points:**

- `onMutate` runs before the mutation, updates the cache, and can return a context object for `onError`.
- `cancelQueries` prevents stale refetches from overwriting optimistic updates.
- Always provide a rollback path in `onError`.
- `onSettled` is your last chance to sync with the server.

---

## 6. Pagination

### Offset Pagination with keepPreviousData

Fetch pages without losing the previous page's data (smooth transitions):

```typescript
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pagination } from '@mantine/core';
import { userKeys } from '@/api/users/queries';

function UsersList() {
  const [page, setPage] = useState(1);

  const { data, isPending } = useQuery({
    queryKey: userKeys.list({ page, limit: 20 }),
    queryFn: () => api.users.list({ page, limit: 20 }),
    // Keep previous page visible while fetching new page
    placeholderData: (previousData) => previousData,
  });

  return (
    <>
      <UserTable users={data?.users} isLoading={isPending} />
      <Pagination
        value={page}
        onChange={setPage}
        total={data?.totalPages || 1}
        disabled={isPending}
      />
    </>
  );
}
```

### Cursor-Based Pagination with useInfiniteQuery

For "Load More" buttons or infinite scroll:

```typescript
import { useInfiniteQuery } from '@tanstack/react-query';

interface UsersResponse {
  users: User[];
  nextCursor: string | null;
}

function InfiniteUsersList() {
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    status,
  } = useInfiniteQuery<UsersResponse>({
    queryKey: userKeys.infinite(),
    queryFn: ({ pageParam = null }) =>
      api.users.listInfinite({ cursor: pageParam, limit: 20 }),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: null,
  });

  const allUsers = data?.pages.flatMap((page) => page.users) ?? [];

  return (
    <>
      {allUsers.map((user) => (
        <UserCard key={user.id} user={user} />
      ))}
      <Button
        onClick={() => fetchNextPage()}
        disabled={!hasNextPage || isFetchingNextPage}
        loading={isFetchingNextPage}
      >
        {isFetchingNextPage ? 'Loading...' : hasNextPage ? 'Load More' : 'Done'}
      </Button>
    </>
  );
}
```

### Infinite Scroll with Intersection Observer

```typescript
import { useRef, useEffect } from 'react';

function InfiniteScrollUsers() {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery(/* ... */);

  const observerTarget = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!observerTarget.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(observerTarget.current);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <>
      {data?.pages.flatMap((page) => page.users).map((user) => (
        <UserCard key={user.id} user={user} />
      ))}
      <div ref={observerTarget} style={{ height: '100px' }}>
        {isFetchingNextPage && <Spinner />}
      </div>
    </>
  );
}
```

---

## 7. Prefetching & Seeding

### Prefetch on Hover/Navigation Intent

Prefetch before the user navigates:

```typescript
import { useMutation } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';

function UserLink({ userId, children }: { userId: string; children: React.ReactNode }) {
  const queryClient = useQueryClient();

  const handleMouseEnter = () => {
    queryClient.prefetchQuery({
      queryKey: userKeys.detail(userId),
      queryFn: () => api.users.getById(userId),
      staleTime: 1000 * 60, // Optional: different staleTime for prefetch
    });
  };

  return (
    <Link to={`/users/${userId}`} onMouseEnter={handleMouseEnter}>
      {children}
    </Link>
  );
}
```

### Seed Cache from Server-Rendered Data

If you're using Next.js or SSR, seed the cache with initial data to avoid refetching:

```typescript
// Server-side (getServerSideProps / getStaticProps)
export async function getServerSideProps({ params }: { params: { userId: string } }) {
  const dehydratedState = dehydrate(queryClient);
  const user = await api.users.getById(params.userId);

  // Seed the cache
  queryClient.setQueryData(userKeys.detail(params.userId), user);

  return {
    props: {
      dehydratedState,
      userId: params.userId,
    },
  };
}

// Client-side component
function UserPage({ dehydratedState, userId }: PageProps) {
  return (
    <HydrationBoundary state={dehydratedState}>
      <UserProfile userId={userId} />
    </HydrationBoundary>
  );
}
```

---

## 8. Mantine Integration

### Loading States on Buttons

```typescript
import { Button, Group } from '@mantine/core';
import { useMutation } from '@tanstack/react-query';

function SubscribeButton({ teamId }: { teamId: string }) {
  const { mutate, isPending } = useMutation({
    mutationFn: () => api.subscriptions.create(teamId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.list(teamId) });
    },
  });

  return (
    <Button
      onClick={() => mutate()}
      loading={isPending}
      disabled={isPending}
    >
      Subscribe
    </Button>
  );
}
```

### Skeleton Loading States

```typescript
import { Skeleton, Stack } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';

function UserProfileCard({ userId }: { userId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: userKeys.detail(userId),
    queryFn: () => api.users.getById(userId),
  });

  if (isLoading) {
    return (
      <Stack gap="md">
        <Skeleton height={40} radius="md" />
        <Skeleton height={20} radius="md" width="70%" />
        <Skeleton height={20} radius="md" width="50%" />
      </Stack>
    );
  }

  return (
    <Card>
      <h2>{data?.name}</h2>
      <p>{data?.email}</p>
      <p>{data?.role}</p>
    </Card>
  );
}
```

### Notifications on Success/Error

```typescript
import { notifications } from '@mantine/notifications';
import { useMutation } from '@tanstack/react-query';

function InviteUserForm() {
  const { mutate } = useMutation({
    mutationFn: (email: string) => api.teams.inviteUser(email),
    onSuccess: () => {
      notifications.show({
        color: 'green',
        title: 'Success',
        message: 'User invited successfully',
        autoClose: 3000,
      });
      // Invalidate team members list
      queryClient.invalidateQueries({ queryKey: teamMemberKeys.lists() });
    },
    onError: (error) => {
      notifications.show({
        color: 'red',
        title: 'Error',
        message: error.message,
        autoClose: 5000,
      });
    },
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); mutate(/* ... */); }}>
      {/* form fields */}
    </form>
  );
}
```

---

## 9. TypeScript Patterns

### Typed Query Functions

```typescript
import { QueryFunctionContext } from '@tanstack/react-query';

type UserParams = { id: string };

const getUserDetail = async (context: QueryFunctionContext<ReturnType<typeof userKeys.detail>>) => {
  const [, , userId] = context.queryKey;
  const res = await fetch(`/api/users/${userId}`);
  if (!res.ok) throw new Error('Failed to fetch');
  return res.json() as Promise<User>;
};

// Usage
const { data } = useQuery({
  queryKey: userKeys.detail('user-123'),
  queryFn: getUserDetail,
});
```

### Inferring Return Types

```typescript
const queryFn = async () => {
  const res = await fetch('/api/users');
  return res.json() as Promise<User[]>;
};

type UserData = Awaited<ReturnType<typeof queryFn>>;

const { data }: { data?: UserData } = useQuery({
  queryKey: userKeys.lists(),
  queryFn,
});
```

### QueryFunctionContext

Automatically passes query keys to your function:

```typescript
interface ListParams {
  page: number;
  search: string;
}

const listUsers = async ({ queryKey }: QueryFunctionContext<[string, string, ListParams]>) => {
  const [, , { page, search }] = queryKey;
  return api.users.list({ page, search });
};

const { data } = useQuery({
  queryKey: userKeys.list({ page: 1, search: 'john' }),
  queryFn: listUsers,
});
```

---

## 10. Common Mistakes

### ❌ Storing Server State in useState

```typescript
// WRONG: useEffect + useState for server data
const [users, setUsers] = useState<User[]>([]);
const [loading, setLoading] = useState(false);

useEffect(() => {
  setLoading(true);
  api.users
    .list()
    .then(setUsers)
    .finally(() => setLoading(false));
}, []);

// RIGHT: useQuery handles all of this
const { data: users } = useQuery({
  queryKey: userKeys.lists(),
  queryFn: () => api.users.list(),
});
```

### ❌ Stale Closures in onSuccess

```typescript
// WRONG: userId captured at closure time
const { mutate } = useMutation({
  mutationFn: () => api.users.update(userId, data),
  onSuccess: () => {
    // userId might be stale if prop changes during mutation
    queryClient.invalidateQueries({ queryKey: userKeys.detail(userId) });
  },
});

// RIGHT: Extract from mutation variables
const { mutate } = useMutation({
  mutationFn: ({ userId, data }: UpdateUserInput) => api.users.update(userId, data),
  onSuccess: (_, { userId }) => {
    queryClient.invalidateQueries({ queryKey: userKeys.detail(userId) });
  },
});
```

### ❌ Over-Invalidating

```typescript
// WRONG: Invalidates everything
queryClient.invalidateQueries();

// RIGHT: Be surgical
queryClient.invalidateQueries({ queryKey: userKeys.lists() });
queryClient.invalidateQueries({ queryKey: userKeys.detail(userId) });
```

### ❌ Missing enabled Flag on Dependent Queries

```typescript
// WRONG: Fetches even if userId is undefined
const { data } = useQuery({
  queryKey: userKeys.detail(userId),
  queryFn: () => api.users.getById(userId), // Runtime error if userId is undefined
});

// RIGHT: Guard with enabled
const { data } = useQuery({
  queryKey: userKeys.detail(userId!),
  queryFn: () => api.users.getById(userId!),
  enabled: !!userId, // Only fetch when userId exists
});
```

### ❌ Forgetting to Pass Context in Optimistic Updates

```typescript
// WRONG: No rollback
const { mutate } = useMutation({
  mutationFn: (data) => api.update(data),
  onMutate: (data) => {
    const previous = queryClient.getQueryData(/* ... */);
    queryClient.setQueryData(/* ... */, optimistic);
    // Forgot to return context!
  },
  onError: (err, _, context) => {
    // context is undefined
  },
});

// RIGHT: Return context
const { mutate } = useMutation({
  mutationFn: (data) => api.update(data),
  onMutate: (data) => {
    const previous = queryClient.getQueryData(/* ... */);
    queryClient.setQueryData(/* ... */, optimistic);
    return { previous }; // Return for onError
  },
  onError: (err, _, context) => {
    queryClient.setQueryData(/* ... */, context?.previous);
  },
});
```

---

## Summary

TanStack Query transforms how you build React applications:

- **Setup once**: Configure QueryClient, wrap app with provider.
- **Design keys**: Use factory pattern for granular control and refactoring.
- **useQuery**: Fetch and cache read-only data.
- **useMutation**: Handle mutations with invalidation and error handling.
- **Optimize**: Prefetch, seed cache, use infinite queries for large datasets.
- **Integrate**: Mantine provides UI components; React Query handles state.

For advanced patterns (SSR, suspense, global error handling), see `references/patterns.md`.
