# Server Actions Test — Template

> **Propósito:** skeleton canônico de integration test de Server Actions. Gêmeo de [`server_actions.md`](./server_actions.md) — toda Server Action tem um `.test.ts` correspondente seguindo este template.
>
> **Leitor:** `@qa-integration` (automático, após `@backend` concluir). Não é usado pelo `@qa` on-demand.
>
> **Regra de cobertura mínima** (não negociável — enforçada via [GATE 4.5](../../agents/00_TECH_LEAD.md)): por Server Action exportada, 3 testes no mínimo — happy path, falha de Zod, falha de auth. +1 teste por regra de negócio declarada no PRD/sprint file.

---

## 1. Estrutura de um arquivo de teste

Um arquivo por módulo. Nome: `tests/integration/<module>.test.ts`.

```
imports
├── vitest (describe, it, expect, beforeEach)
├── setup mocks (__mockSupabase, __mockSessionContext)
├── actions do módulo sob teste

describe('<module> actions')
├── describe('<action1>')
│   ├── it('happy path') — success: true
│   ├── it('rejeita dados inválidos via Zod') — success: false, Supabase não chamado
│   ├── it('rejeita usuário não autenticado') — success: false
│   └── it('<regras de negócio do PRD>')
├── describe('<action2>')
│   └── ...
```

---

## 2. Template completo

**Substituições obrigatórias** (o `@qa-integration` preenche antes de salvar):

| Placeholder | Significado | Exemplo |
|---|---|---|
| `{{module}}` | nome da tabela/módulo | `customers` |
| `{{Module}}` | PascalCase | `Customer` |
| `{{Entity}}` | Nome da entidade na mensagem | `Cliente` |

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { __mockSupabase, __mockSessionContext } from '../setup';
import {
  create{{Module}}Action,
  update{{Module}}Action,
  delete{{Module}}Action,
  get{{Module}}sAction,
  get{{Module}}ByIdAction,
} from '@/lib/actions/{{module}}/actions';

describe('{{module}} actions', () => {
  // ───────────────────────────────────────────
  // create{{Module}}Action
  // ───────────────────────────────────────────
  describe('create{{Module}}Action', () => {
    const validInput = {
      // preencher com um payload válido conforme o schema Zod
      name: 'Acme Corp',
      email: 'contact@acme.com',
    };

    it('cria {{module}} com dados válidos → success: true', async () => {
      const fromMock = __mockSupabase.from();
      fromMock.single.mockResolvedValueOnce({
        data: { id: 'new-id', organization_id: __mockSessionContext.organizationId, ...validInput },
        error: null,
      });

      const result = await create{{Module}}Action(validInput);

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ id: 'new-id' });
      expect(__mockSupabase.from).toHaveBeenCalledWith('{{module}}');
    });

    it('rejeita dados inválidos via Zod → success: false, Supabase não chamado', async () => {
      const invalidInput = { name: '', email: 'not-an-email' } as any;

      const result = await create{{Module}}Action(invalidInput);

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
      // Garantia crítica: validação falhou ANTES de tocar no Supabase
      expect(__mockSupabase.from).not.toHaveBeenCalled();
    });

    it('rejeita usuário não autenticado → success: false', async () => {
      __mockSupabase.auth.getUser.mockResolvedValueOnce({
        data: { user: null },
        error: null,
      });

      const result = await create{{Module}}Action(validInput);

      expect(result.success).toBe(false);
      expect(__mockSupabase.from).not.toHaveBeenCalled();
    });

    // ─── Regras de negócio do PRD/sprint file ───
    // Gere um teste por regra explícita. Exemplos:
    //
    // it('rejeita email duplicado → mensagem amigável', async () => {
    //   const fromMock = __mockSupabase.from();
    //   fromMock.single.mockResolvedValueOnce({
    //     data: null,
    //     error: { code: '23505', message: 'duplicate key' },
    //   });
    //   const result = await create{{Module}}Action(validInput);
    //   expect(result.success).toBe(false);
    //   expect(result.error).toMatch(/já existe/i);
    //   // Não vaza mensagem interna
    //   expect(result.error).not.toContain('duplicate key');
    // });
  });

  // ───────────────────────────────────────────
  // update{{Module}}Action
  // ───────────────────────────────────────────
  describe('update{{Module}}Action', () => {
    const validId = '00000000-0000-0000-0000-000000000001';
    const validUpdate = { name: 'Updated Name' };

    it('atualiza {{module}} com dados válidos → success: true', async () => {
      const fromMock = __mockSupabase.from();
      fromMock.maybeSingle.mockResolvedValueOnce({
        data: { id: validId, organization_id: __mockSessionContext.organizationId, ...validUpdate },
        error: null,
      });

      const result = await update{{Module}}Action(validId, validUpdate);

      expect(result.success).toBe(true);
    });

    it('rejeita ID inválido via Zod', async () => {
      const result = await update{{Module}}Action('not-a-uuid', validUpdate);
      expect(result.success).toBe(false);
      expect(__mockSupabase.from).not.toHaveBeenCalled();
    });

    it('rejeita usuário não autenticado', async () => {
      __mockSupabase.auth.getUser.mockResolvedValueOnce({
        data: { user: null },
        error: null,
      });

      const result = await update{{Module}}Action(validId, validUpdate);
      expect(result.success).toBe(false);
    });
  });

  // ───────────────────────────────────────────
  // delete{{Module}}Action
  // ───────────────────────────────────────────
  describe('delete{{Module}}Action', () => {
    const validId = '00000000-0000-0000-0000-000000000001';

    it('exclui {{module}} existente → success: true', async () => {
      const fromMock = __mockSupabase.from();
      fromMock.maybeSingle.mockResolvedValueOnce({
        data: { id: validId },
        error: null,
      });

      const result = await delete{{Module}}Action(validId);

      expect(result.success).toBe(true);
    });

    it('rejeita ID inválido', async () => {
      const result = await delete{{Module}}Action('not-a-uuid');
      expect(result.success).toBe(false);
    });

    it('rejeita usuário não autenticado', async () => {
      __mockSupabase.auth.getUser.mockResolvedValueOnce({
        data: { user: null },
        error: null,
      });
      const result = await delete{{Module}}Action(validId);
      expect(result.success).toBe(false);
    });
  });

  // ───────────────────────────────────────────
  // get{{Module}}sAction (list)
  // ───────────────────────────────────────────
  describe('get{{Module}}sAction', () => {
    it('lista {{module}}s com paginação default', async () => {
      const fromMock = __mockSupabase.from();
      fromMock.returns.mockResolvedValueOnce({
        data: [{ id: 'r1' }, { id: 'r2' }],
        error: null,
        count: 2,
      });

      const result = await get{{Module}}sAction({});

      expect(result.success).toBe(true);
      expect(result.metadata).toMatchObject({ total: 2, currentPage: 1 });
    });

    it('rejeita pageSize inválido via Zod', async () => {
      const result = await get{{Module}}sAction({ pageSize: 9999 } as any);
      expect(result.success).toBe(false);
      expect(__mockSupabase.from).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────
  // get{{Module}}ByIdAction
  // ───────────────────────────────────────────
  describe('get{{Module}}ByIdAction', () => {
    const validId = '00000000-0000-0000-0000-000000000001';

    it('retorna {{module}} quando existe', async () => {
      const fromMock = __mockSupabase.from();
      fromMock.maybeSingle.mockResolvedValueOnce({
        data: { id: validId, name: 'Acme' },
        error: null,
      });

      const result = await get{{Module}}ByIdAction(validId);

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ id: validId });
    });

    it('retorna success: false quando não existe', async () => {
      const fromMock = __mockSupabase.from();
      fromMock.maybeSingle.mockResolvedValueOnce({ data: null, error: null });

      const result = await get{{Module}}ByIdAction(validId);

      expect(result.success).toBe(false);
    });

    it('rejeita ID inválido', async () => {
      const result = await get{{Module}}ByIdAction('not-a-uuid');
      expect(result.success).toBe(false);
    });
  });
});
```

---

## 3. Regras invioláveis para o arquivo de teste

1. **Sem mock inline.** Todo mock de Supabase usa `__mockSupabase` do `tests/setup.ts`. Teste individual sobrescreve via `mockResolvedValueOnce`/`mockReturnValueOnce`.
2. **Sem `describe.skip`, sem `it.skip`, sem `it.todo`.** GATE 4.5 rejeita testes pulados silenciosamente.
3. **Garantir que Supabase NÃO é chamado quando Zod/auth falham.** Usar `expect(__mockSupabase.from).not.toHaveBeenCalled()` nos testes de validação e auth.
4. **Nunca depender da ordem de execução entre testes.** Cada `it` é independente — `beforeEach` já reseta os mocks.
5. **Nunca logar no teste.** Sem `console.log`. Se precisa depurar, use `expect` com mensagem descritiva.
6. **Mensagens de erro amigáveis são testadas.** Quando a regra de negócio é "não vazar mensagem interna", o teste verifica com `expect(result.error).not.toContain(...)`.
7. **Testes de regras de negócio citam o PRD/sprint file.** Comentário acima do `it` referenciando a regra de onde veio (ex: `// PRD §5.2 — email único por organization`).

---

## 4. Ajustes por tipo de Server Action

O template acima assume o CRUD padrão. Ajuste quando o módulo tiver particularidades:

| Caso | Ajuste |
|---|---|
| Soft delete (archive/restore) | Trocar `delete{{Module}}Action` por `archive{{Module}}Action` + `restore{{Module}}Action` com 3 testes cada |
| Hard delete com verificação de vínculos | +1 teste: "rejeita delete quando há vínculos" (simular `count > 0`) |
| Entidade sem list paginada | Remover o `describe` de list |
| Action que chama API externa | Mockar o client externo no mesmo padrão do Supabase (via `tests/setup.ts` — adicionar mock global lá) |
| Stats (getStatsAction) | +1 teste happy path + 1 teste de erro agregado |
| `assertRole` (create/update/delete) | +1 teste: "rejeita role sem permissão" (sobrescrever `__mockSessionContext.role`) |

---

## 5. Como o `@qa-integration` preenche o template

1. Lê `src/lib/actions/{{module}}/actions.ts` recém-criado pelo `@backend`
2. Identifica as actions exportadas
3. Lê o schema Zod em `src/lib/actions/{{module}}/schemas.ts` para derivar:
   - Um input válido (happy path)
   - Um input inválido (para teste de Zod)
4. Lê a seção de **regras de negócio** do sprint file/PRD:
   - Cada regra explícita → +1 teste dedicado
   - Cita a regra no comentário acima do `it`
5. Substitui todos os placeholders `{{...}}`
6. Salva em `tests/integration/{{module}}.test.ts`
7. Roda `npm test -- --run tests/integration/{{module}}.test.ts`
8. Se algum teste falhar, reporta ao Tech Lead — **não corrige** nem a action nem o teste; Tech Lead delega correção ao `@backend`

---

## 6. Referências

- Templates de Server Actions que este arquivo testa: [`server_actions.md`](./server_actions.md)
- Setup do Vitest e mocks centralizados: [`vitest_setup.md`](./vitest_setup.md)
- Agente que produz estes arquivos: [`agents/stack/qa-integration.md`](../../agents/stack/qa-integration.md)
- Gate que executa os testes: [`agents/00_TECH_LEAD.md`](../../agents/00_TECH_LEAD.md) → GATE 4.5
- Contrato `ActionResponse<T>` e regras invioláveis: [`docs/conventions/standards.md`](../conventions/standards.md)
