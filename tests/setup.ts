import { vi, beforeEach } from 'vitest';

// server-only é um guard do Next.js — no ambiente de teste é no-op
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: vi.fn(() => ({ get: vi.fn(), set: vi.fn() })) }));

type MockQuery = {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  or: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  range: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  returns: ReturnType<typeof vi.fn>;
};

type MockClient = {
  auth: {
    getUser: ReturnType<typeof vi.fn>;
  };
  from: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
};

const createMockClient = (): MockClient => {
  const query: MockQuery = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    eq: vi.fn(),
    or: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
    single: vi.fn(),
    maybeSingle: vi.fn(),
    returns: vi.fn(),
  };

  for (const key of ['select', 'insert', 'update', 'delete', 'eq', 'or', 'order', 'range', 'returns'] as const) {
    query[key].mockReturnValue(query);
  }

  query.single.mockResolvedValue({ data: null, error: null });
  query.maybeSingle.mockResolvedValue({ data: null, error: null });

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'test-user-id' } },
        error: null,
      }),
    },
    from: vi.fn().mockReturnValue(query),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
};

export const __mockSupabase = createMockClient();
export const __mockSessionContext = {
  userId: 'test-user-id',
  organizationId: 'test-org-id',
  role: 'owner' as const,
};

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve(__mockSupabase)),
}));

vi.mock('@/lib/supabase/getSessionContext', () => ({
  getSessionContext: vi.fn(() => Promise.resolve(__mockSessionContext)),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  __mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id' } },
    error: null,
  });
  __mockSupabase.rpc.mockResolvedValue({ data: null, error: null });
});
