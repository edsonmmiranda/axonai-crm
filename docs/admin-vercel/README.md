# Admin Vercel — Documentação de Deploy

> Pasta dedicada ao processo de **subir o Axon AI CRM em produção via Vercel**, ativar o origin isolation entregue no Sprint admin_13, e fechar as duas dívidas técnicas conhecidas (G-16 E2E e G-17 rollback testado em staging).

## Índice

| Arquivo | Conteúdo |
|---|---|
| [`deploy_prd.md`](deploy_prd.md) | PRD enxuto — visão, problema, objetivos, escopo, decisões fixadas, riscos, o que NÃO cobre |
| [`sprint_plan.md`](sprint_plan.md) | Plano de 6 sprints — bootstrap Vercel → domínio próprio → origin isolation → validações em prod → E2E → staging/rollback |

## Relação com `docs/admin_area/`

- `docs/admin_area/` cobre o **produto** (área admin do SaaS — features, RBAC, audit, etc.)
- `docs/admin-vercel/` cobre o **operacional de produção** (como subir, validar, monitorar)

Os dois são complementares. Runbooks de processo permanente (break-glass, origin isolation operations, etc.) ficam em `docs/admin_area/runbook_*.md` e são referenciados aqui.

## Convenção de prefixo de sprint

Sprints deste plano usam prefixo `vercel_NN_`. Padrão: `sprints/active/sprint_vercel_NN_[short-name].md`.
Quando concluído, Tech Lead move para `sprints/done/sprint_vercel_NN_[short-name].md`.
