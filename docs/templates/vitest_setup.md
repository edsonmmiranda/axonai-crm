# Vitest Setup — Template de Bootstrap

> **Propósito:** este arquivo é lido **uma única vez** pelo Tech Lead durante o sprint de bootstrap (quando `src/` é criado). Instala e configura a infraestrutura mínima de testes que o framework exige para satisfazer o **GATE 4.5** (veja [`agents/00_TECH_LEAD.md`](../../agents/00_TECH_LEAD.md)).
>
> **Escopo:** integration tests de Server Actions via Vitest + mock centralizado do Supabase server client. Não instala Playwright, não instala Testing Library para componentes — essas são responsabilidades do `@qa` on-demand quando pedidas explicitamente.

---

## 1. Quando usar

Durante o sprint de bootstrap, logo após criar `package.json` e `src/`. Antes do primeiro sprint de CRUD rodar.

---

## 2. Instalação

```bash
npm install -D vitest @vitest/ui
```

Adicione os scripts no `package.json`:

```json
{
  "scripts": {
    "test": "vitest",
    "test:run": "vitest run",
    "test:ui": "vitest --ui"
  }
}
```

---

## 3. Arquivos a criar

### 3.1 `vitest.config.ts` (raiz do projeto)

```typescript
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', '.next'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

### 3.2 `tests/setup.ts` (mock centralizado do Supabase)

```typescript
import { vi, beforeEach } from 'vitest';

/**
 * Mock centralizado do Supabase server client.
 * Toda integration test de Server Action depende desse setup.
 *
 * Cada teste individual pode **sobrescrever** o comportamento usando:
 *   import { __mockSupabase } from '../setup';
 *   __mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
 *
 * Regra: nunca crie mock inline dentro do arquivo de teste.
 * Sempre use o mock central e sobrescreva com mockResolvedValueOnce/mockReturnValueOnce.
 */

type MockClient = {
  auth: {
    getUser: ReturnType<typeof vi.fn>;
  };
  from: ReturnType<typeof vi.fn>;
};

const createMockClient = (): MockClient => {
  const query = {
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

  // Todos os métodos encadeáveis retornam o próprio objeto query
  for (const key of ['select', 'insert', 'update', 'delete', 'eq', 'or', 'order', 'range', 'returns'] as const) {
    query[key].mockReturnValue(query);
  }

  // Defaults razoáveis — testes sobrescrevem com mockResolvedValueOnce
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

// Reset entre testes para evitar vazamento de estado
beforeEach(() => {
  vi.clearAllMocks();
  // Restaurar defaults do auth
  __mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id' } },
    error: null,
  });
});
```

### 3.3 `tests/.gitkeep`

Crie um `.gitkeep` vazio em `tests/` para versionar a pasta antes dos primeiros testes existirem:

```bash
mkdir -p tests
touch tests/.gitkeep
```

---

## 4. Estrutura de diretórios resultante

```
<project-root>/
├── src/
├── tests/
│   ├── setup.ts
│   ├── integration/
│   │   └── <module>.test.ts   ← criados pelo @qa-integration
│   └── unit/                  ← on-demand (@qa)
├── vitest.config.ts
└── package.json
```

---

## 5. Validação do setup

Após criar os arquivos, rode:

```bash
npm run test:run
```

Resultado esperado (sem testes ainda): `No test files found, exiting with code 0`.

Se o comando retornar erro de configuração ou módulo, revise os 3 arquivos acima.

---

## 6. Referências

- Agente que consome essa infra: [`agents/stack/qa-integration.md`](../../agents/stack/qa-integration.md)
- Template de teste que popula `tests/integration/`: [`docs/templates/server_actions_test.md`](./server_actions_test.md)
- Gate que executa os testes no workflow: [`agents/00_TECH_LEAD.md`](../../agents/00_TECH_LEAD.md) → GATE 4.5
- Contrato de `ActionResponse<T>` e Server Actions: [`docs/conventions/standards.md`](../conventions/standards.md)
