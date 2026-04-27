# PRD: [Nome da Feature]

**Template:** PRD_STANDARD
**Complexity Score:** [X] points
**Sprint:** [Número do Sprint]
**Created:** [Data]
**Status:** Draft

---

## 1. Visão Geral

### Objetivo de Negócio
[Que problema de negócio isso resolve?]

### User Story
Como [tipo de usuário], eu quero [ação] para que [benefício].

### Métricas de Sucesso
- [Métrica 1]: [Meta]
- [Métrica 2]: [Meta]

---

## 2. Requisitos de Banco de Dados

### Novas Tabelas

#### Tabela: [nome_da_tabela]

**Propósito:** [O que esta tabela armazena e por quê]

**Campos:**
- `id` — UUID, Primary Key, auto-gerado
- `user_id` — UUID, Foreign Key para `auth.users(id)`, Cascade Delete
- `[nome_do_campo]` — [TIPO], [obrigatório/opcional], [descrição]
- `created_at` — Timestamp with timezone, auto-gerado
- `updated_at` — Timestamp with timezone, auto-atualizado

**Índices:**
- Índice em `[campo]` para [razão]

**Segurança (RLS):**
- [Descrição da política]

### Tabelas Modificadas (se houver)
- **[tabela]:** [mudanças]

### Tabelas Existentes Usadas
- **[tabela]:** [como é usada]

---

## 3. Contrato de API

### Server Actions

#### [nomeDaAction]
**Arquivo:** `src/lib/actions/[entity].ts`

**Input Schema:**
```typescript
const Schema = z.object({
  field1: z.string().min(1),
  field2: z.string().email(),
});
```

**Output:** `ActionResponse<T>` — veja [`agents/skills/error-handling/SKILL.md`](../../agents/skills/error-handling/SKILL.md)

**Lógica de negócio:**
1. Validar input
2. Checar autenticação
3. [Regra de negócio]
4. Operação no banco
5. Revalidar path
6. Retornar resposta

---

## 4. Componentes de UI

### Árvore de componentes
```
Page: /[route]
├── [PageComponent]
│   ├── [ChildComponent1]
│   └── [ChildComponent2]
```

### [NomeDoComponente]
**Arquivo:** `src/components/[path]/[Component].tsx`

**Props:**
```typescript
interface Props {
  prop1: string;
  onAction: () => void;
}
```

**Componentes do design system usados:**
- `[ComponentName]` from `src/components/ui/[component]` (variant: `[variant]`, size: `[size]`)
- `[ComponentName]` from `src/components/ui/[component]`

**Tokens semânticos usados:**
- Background: `bg-[token]` ([propósito])
- Text: `text-[token]` ([propósito])
- Border: `border-[token]` ([propósito])

**Estado:**
- [state]: [propósito]

**Comportamento:**
- On mount: [ação]
- On submit: [ação]

> 🎨 Não redeclare as regras do design system aqui. Liste apenas os componentes de `src/components/ui/` e tokens semânticos que este componente consome — o `@frontend+` usa essas assinaturas como contrato, sem precisar vasculhar `design_system/`.

---

## 5. Edge Cases

### Estados vazios
- [ ] Sem dados: mostrar empty state com CTA

### Erros de validação
- [ ] Input inválido: mostrar mensagem de erro
- [ ] Campo obrigatório vazio: mostrar "[Campo] é obrigatório"

### Erros de rede
- [ ] Timeout de API: mostrar "Request timed out"
- [ ] Erro de servidor: mostrar "Algo deu errado"

### Autenticação
- [ ] Não logado: redirecionar para /login

---

## 6. Critérios de Aceite

### Banco de dados
- [ ] Migração roda com sucesso
- [ ] Políticas RLS previnem acesso não autorizado

### Backend
- [ ] Todas as Server Actions validam input com Zod
- [ ] Todas as Server Actions checam autenticação
- [ ] Erros retornam mensagens amigáveis ao usuário
- [ ] Retorno segue o padrão `ActionResponse<T>` do skill [`agents/skills/error-handling/SKILL.md`](../../agents/skills/error-handling/SKILL.md)

### Frontend
- [ ] **Design system:** o código passa em **todas as checagens** do [`agents/quality/guardian.md`](../../agents/quality/guardian.md) § 1a (regras automáticas) e § 1b (correção semântica). A fonte normativa das regras é [`design_system/enforcement/rules.md`](../../design_system/enforcement/rules.md) e o contrato de authoring é [`design_system/components/CONTRACT.md`](../../design_system/components/CONTRACT.md). **Não duplique a lista de regras neste PRD** — o Guardian rejeitará o PR se qualquer uma falhar.
- [ ] Formulários têm estados de loading e erro.
- [ ] Componente verificado com `data-theme="dark"` togglado no `<html>`.

---

## 7. Rollback

**Se problemas forem encontrados:**
1. Reverter commit: `git revert [commit-hash]`
2. Rollback de banco (se necessário): [comandos SQL]
3. Limpar cache: [comandos]

**Tempo estimado de rollback:** 5 minutos
