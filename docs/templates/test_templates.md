# Test Templates — Vitest + Playwright (on-demand)

Templates usados por [`@qa`](../../agents/on-demand/qa.md) quando invocado sob demanda para **unit tests, component tests e E2E**.

> **Importante:** para **integration tests de Server Actions** use [`server_actions_test.md`](./server_actions_test.md) — esse fluxo é automático e rodado pelo [`@qa-integration`](../../agents/stack/qa-integration.md) em todo sprint com backend, não por este `@qa` on-demand.
>
> A infra base de Vitest (`vitest.config.ts` + `tests/setup.ts`) é instalada pelo sprint de bootstrap seguindo [`vitest_setup.md`](./vitest_setup.md). Para E2E ou component tests, o `@qa` on-demand instala apenas as dependências incrementais com aprovação do usuário.

---

## Unit test — função pura

```typescript
// tests/utils/validation.test.ts
import { describe, it, expect } from 'vitest';
import { validateEmail, validatePhone } from '@/lib/utils/validation';

describe('validateEmail', () => {
  it('deve aceitar email válido', () => {
    expect(validateEmail('user@example.com')).toBe(true);
  });

  it('deve rejeitar email inválido', () => {
    expect(validateEmail('invalid-email')).toBe(false);
  });

  it('deve rejeitar string vazia', () => {
    expect(validateEmail('')).toBe(false);
  });
});
```

---

## Integration test — Server Action com Supabase mockado

```typescript
// tests/actions/leads.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createLeadAction } from '@/lib/actions/leads';

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'test-user-id' } },
        error: null,
      }),
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      insert: vi.fn().mockReturnThis(),
    })),
  }),
}));

describe('createLeadAction', () => {
  it('deve criar lead com dados válidos', async () => {
    const formData = new FormData();
    formData.append('name', 'John Doe');
    formData.append('email', 'john@example.com');

    const result = await createLeadAction(formData);

    expect(result.success).toBe(true);
  });

  it('deve rejeitar email inválido', async () => {
    const formData = new FormData();
    formData.append('name', 'John Doe');
    formData.append('email', 'invalid-email');

    const result = await createLeadAction(formData);

    expect(result.success).toBe(false);
    expect(result.error).toContain('email');
  });
});
```

---

## E2E test — Playwright

```typescript
// tests/e2e/leads.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Lead Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('[name="email"]', 'test@example.com');
    await page.fill('[name="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard');
  });

  test('deve criar novo lead', async ({ page }) => {
    await page.goto('/dashboard/leads');
    await page.click('button:has-text("New Lead")');

    await page.fill('[name="name"]', 'Test Lead');
    await page.fill('[name="email"]', 'lead@example.com');
    await page.click('button:has-text("Submit")');

    await expect(page.locator('text=Lead created successfully')).toBeVisible();
  });
});
```

---

## Execução

```bash
npm test                 # Vitest unit/integration
npx playwright test      # E2E (se configurado)
```

---

## Formato de relatório (inline, não criar arquivos em tests/reports/)

```
## QA Report: [Module Name]

**Scope:** [o que foi testado]
**Total:** 12
**Passed:** 11
**Failed:** 1

### Falhas
- `should reject duplicate email` — Esperado erro "already exists", recebido "Lead created"
  - Arquivo: tests/actions/leads.test.ts:45
  - Causa provável: checagem de duplicata faltando em createLeadAction

### Recomendação
Corrigir lógica de checagem de duplicata antes do merge.
```

---

## Referências

- Agente: [`agents/on-demand/qa.md`](../../agents/on-demand/qa.md)
