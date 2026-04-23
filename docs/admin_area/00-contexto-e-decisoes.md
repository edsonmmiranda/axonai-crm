# 00 — Contexto e Decisões

## Problema

O Axon AI CRM hoje é um SaaS multi-tenant onde cada `organization` é um cliente-tenant. Toda a UI existente em `src/app/(app)/` (leads, funnels, products, pipeline, settings, etc) é o **app cliente** — a interface que as empresas-usuárias do SaaS acessam.

**O que falta:** o dashboard dos **donos do SaaS** (Edson Miranda + equipe Axon AI) para operar o próprio negócio do CRM — cadastrar empresas-clientes, definir planos, configurar o produto e dar suporte.

## Escopo

### Dentro do MVP (Sprints S0 a S9)

| Área | Detalhamento |
|---|---|
| **Foundation DB** | 7 tabelas novas + seed inicial de planos + backfill de `subscriptions` a partir de `organizations.plan` |
| **Shell admin** | Login admin, middleware de guarda, layout, dashboard home vazio, ESLint rules de cross-import |
| **Customer app — suporte a impersonation** | Endpoints e middleware do customer reconhecendo token de impersonation, banner na UI |
| **Organizations module** | List, filtros, detalhe, suspender/ativar, botão impersonar |
| **Plans module** | CRUD de planos, configuração de features (jsonb) e limites |
| **Subscriptions module** | Atribuir plano, trocar plano, estender trial, cancelar, reativar |
| **Platform admins + Audit log** | CRUD de super admins com MFA forçado + visualização do log de ações |
| **Platform settings** | Feature flags por plano + limites padrão de trial + chaves de integração cifradas + usage policies |
| **Métricas v1** | 3 KPIs no dashboard home — orgs ativas, users totais, leads totais |

### Fora do MVP (fase 2+)

- Integração real com Stripe (webhooks, `invoices`, `payment_methods`, sincronização bidirecional)
- Dashboard de métricas avançado (MRR, churn, LTV, cohort analysis)
- Support tickets / sistema de chamados
- Alertas automáticos (quota excedida, risco de churn, inatividade)
- Impersonation com gravação/replay
- Relatórios exportáveis

## Decisões fixadas

### 1. Arquitetura — Opção 3 (route group `(admin)`)

Três opções foram consideradas:

| Opção | Descrição | Status |
|---|---|---|
| **1 — Monorepo** | pnpm workspaces com `apps/customer` + `apps/admin` + `packages/ui` | ❌ Rejeitada |
| **2 — Repo separado** | `axonai-admin` como projeto Next.js independente | ❌ Rejeitada |
| **3 — Route group** | `src/app/(admin)/` ao lado de `src/app/(app)/` no mesmo Next.js | ✅ **Escolhida** |

**Razões pela Opção 3:**
- Zero custo de migração (começa direto no Sprint 0 com ajustes leves de framework)
- Next.js faz bundle split automático por rota → isolamento de bundle garantido em produção (admin JS nunca é baixado em sessão customer e vice-versa)
- Compartilha types do Supabase, client factory, design system sem overhead manual
- Middleware + ESLint rules + `assertPlatformAdmin()` dão isolamento lógico estrito

**Limitações aceitas conscientemente:**
- Deploy único — build quebrado de um lado impede o deploy do outro (mitigado pelos gates do framework)
- `SUPABASE_SERVICE_ROLE_KEY` fica no runtime do processo Next.js — mitigado por uso restrito a `src/app/(admin)/**/actions.ts` e regra ESLint que bloqueia import fora desse escopo
- Domínio principal compartilhado (pode ser resolvido com subdomain rewrite opcional no Sprint 2)

### 2. Identidade do super admin — tabela `platform_admins`

Super admin é um `auth.users` **sem entrada em `profiles`** (portanto sem `organization_id`), com entrada correspondente em `platform_admins`.

| Tipo de user | Tem entrada em `profiles`? | Tem entrada em `platform_admins`? | Pode logar em |
|---|---|---|---|
| Customer user | ✅ Sim (com `organization_id`) | ❌ Não | Customer app |
| Platform admin | ❌ Não | ✅ Sim | Admin app |
| Híbrido (dev/teste) | ✅ Sim | ✅ Sim | Ambos (contextos separados) |

**Por que essa opção:**
- Preserva a invariante `profiles.organization_id NOT NULL` do modelo multi-tenant atual
- RLS das tabelas de tenant continua intacta
- Audit trail fica natural (admin_id → platform_admins.id, sem cruzamento com user de org)
- Cenários de suporte (dev vira platform admin para debugar) ficam possíveis sem ambiguidade

### 3. Billing — fase 2

MVP **não** integra com gateway de pagamento. A tabela `subscriptions` registra plano e período, mas o dono do SaaS cobra externamente (boleto, pix, cartão por fora) e atualiza o `status` manualmente pelo admin dashboard.

**Fase 2** adiciona: tabelas `invoices` e `payment_methods`, webhook Stripe, sincronização bidirecional assinatura ↔ Stripe customer, emissão de invoices automáticas.

### 4. Impersonation — day-1

Sprint S3 implementa no customer app o suporte a "entrar como" usuário de uma org. Toda impersonation:
- Gera entrada imutável em `impersonation_sessions`
- Exibe banner permanente na UI do customer: **"Você está visualizando como [nome do user] da org [nome da org] — admin: [nome do admin]"**
- Termina automaticamente após TTL (30 min por default) ou encerramento manual
- É registrada no `platform_audit_log` com `action = 'impersonation.start'` e `action = 'impersonation.end'`

### 5. Métricas v1 — mínimas

Dashboard home do admin mostra apenas:

1. **Orgs ativas** — `count(*) from organizations where is_active = true`
2. **Users totais** — `count(*) from profiles where is_active = true`
3. **Leads totais** — `count(*) from leads where is_active = true`

Queries diretas executadas no carregamento da página. Sem agregação offline, sem materialized views, sem cache. Se volume virar problema, adiciona cache/materialized view em sprint futuro.

**Não v1:** MRR, churn rate, LTV, CAC, cohort analysis, gráficos de evolução — todos deixados para fase 2.

### 6. Banco compartilhado, service role gated

Admin app e customer app apontam para o **mesmo projeto Supabase**. Admin usa `SUPABASE_SERVICE_ROLE_KEY` para bypassar RLS quando precisa ler/escrever dados cross-org (ex: listar todas as organizations).

**Toda** Server Action em `src/app/(admin)/**/actions.ts` começa com:
```ts
const admin = await assertPlatformAdmin()  // lança se não for platform admin ativo
```

**Nenhuma** Server Action em `src/app/(admin)/` usa o client de sessão comum (`createServerClient()`) — sempre `createServiceRoleClient()`.

**Inversamente:** nenhuma Server Action em `src/app/(app)/` usa `createServiceRoleClient()` — sempre client de sessão comum.

### 7. Auth compartilhado, separação lógica

`auth.users` é único. O que separa customer de admin é:
- Customer login → valida `profile` ativo e retorna redirect para `/dashboard`
- Admin login → valida `platform_admins.is_active = true` **E** MFA satisfeito → redirect para `/admin/dashboard`

Se o mesmo user aparecer em ambas as tabelas (caso do dev que também é platform admin), ele faz duas sessões independentes — uma em cada app/domínio.

### 8. Configurações do SaaS no Sprint 8

Conforme definido com o PO:

- **Feature flags por plano** — liga/desliga módulos (ex: módulo WhatsApp só em planos Pro+)
- **Limites padrão de trial** — ex: 14 dias, 3 users, 100 leads
- **Chaves de integração** — Stripe secret, SMTP credentials, WhatsApp API token — armazenadas **cifradas** via `pgsodium` ou Supabase Vault
- **Policies de uso** — retention de dados, rate limits de API, tamanho máximo de upload

## Timeline alvo

| Sprint | Esforço estimado | Pode paralelizar com |
|---|---|---|
| S0 — Framework adjustments | LIGHT — ~45 min | — |
| S1 — DB Foundation | STANDARD | — |
| S2 — Admin shell | STANDARD | S3 (outro dev, se tivesse) |
| S3 — Customer impersonation support | STANDARD | S2 |
| S4 — Organizations module | STANDARD | — (depende S1 + S2 + S3) |
| S5 — Plans module | STANDARD | — (depende S1 + S2) |
| S6 — Subscriptions module | STANDARD | — (depende S4 + S5) |
| S7 — Platform admins + Audit log | STANDARD | — (depende S1 + S2) |
| S8 — Platform settings | STANDARD | — (depende S2) |
| S9 — Dashboard metrics v1 | LIGHT | — (depende S4 + S6) |

**Total MVP admin:** 9 sprints após o S0. Em cadência de 1 sprint/semana, ~2 meses corridos.

## Options descartadas (histórico para evitar rediscussão)

### Monorepo (Opção 1) — por que não

Exigiria Sprint 0 de migração (~1 sprint STANDARD) para:
- Introduzir `pnpm workspaces` e `turborepo`
- Mover `src/` → `apps/customer/src/` preservando history via `git mv`
- Extrair `packages/ui`, `packages/database`, `packages/supabase-client`
- Atualizar `tailwind.config`, `next.config`, `tsconfig` de cada app
- Atualizar `standards.md`, `crud.md`, agentes para multi-app
- Revalidar build, lint, deploy do customer

Custo alto + risco real de regressão no customer em produção. Ganhos (type sharing automático, deploy separado) não compensam hoje dado que o admin pode compartilhar tudo via route group com isolamento de bundle já garantido.

### Repo separado (Opção 2) — por que não

Duplica continuamente:
- Types do Supabase (regerar em ambos a cada mudança de schema)
- Design system (replicar componentes ou publicar NPM privado)
- Config (tailwind, tsconfig, eslint em cada repo)
- Setup de CI/CD

Ganho operacional (deploy totalmente independente, env vars por repo) não compensa o atrito contínuo de manutenção cruzada. A Opção 3 entrega isolamento de bundle + runtime + código suficiente para o objetivo.
