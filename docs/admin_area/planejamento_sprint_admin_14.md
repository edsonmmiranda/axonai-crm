# Planejamento — Sprint admin_14

**Tipo:** brief de input para o Tech Lead (não é PRD, não é sprint file).
**Data:** 2026-04-30
**Autor:** Edson (product owner) + Claude (research auxiliar)
**Sprint proposto:** `admin_14` — Toggle global de obrigatoriedade de MFA para administradores da plataforma

---

## 1. Problema

Hoje a obrigatoriedade de autenticação em dois fatores (MFA / aal2) para qualquer admin que acesse `/admin/*` é **hard-coded no middleware** — não existe forma de desligar essa exigência sem alterar código e fazer deploy.

Preciso de uma configuração **dentro da própria área admin** que permita ao `owner` da plataforma habilitar ou desabilitar essa obrigatoriedade para todos os administradores, com audit log e cuidados de segurança apropriados.

## 2. Estado atual (verificado em código)

- **Enforcement:** [src/middleware.ts:180-187](../../src/middleware.ts#L180-L187) — bloco que chama `supabase.auth.mfa.getAuthenticatorAssuranceLevel()` e redireciona qualquer rota admin não-pública para `/admin/mfa-challenge` (quem tem fator) ou `/admin/mfa-enroll` (quem não tem).
- **Rotas públicas admin** (já isentas): `/admin/login`, `/admin/mfa-enroll`, `/admin/mfa-challenge`, `/admin/unauthorized`, `/admin/accept-invite`.
- **Re-enroll forçado:** flag `profiles.mfa_reset_required` (per-admin, pós-reset Sprint 11) — **ortogonal** ao toggle global proposto, deve continuar funcionando.
- **Infra disponível para reuso:**
  - `FEATURE_FLAG_REGISTRY` em [src/lib/featureFlags/registry.ts](../../src/lib/featureFlags/registry.ts).
  - Tabela `feature_flags` + RPC `admin_set_feature_flag` (owner-only, com IP/UA no audit log).
  - Página [/admin/settings/feature-flags](../../src/app/admin/settings/feature-flags/page.tsx) já lista flags do registry e expõe toggle controlado por role.

## 3. Proposta de solução (a refinar com o TL)

Modelar como **feature flag** chamada `require_admin_mfa` com `defaultEnabled: true`. A flag aparece automaticamente na tela de Feature Flags existente, herda o controle owner-only, e se beneficia do audit log já implementado.

**Ajustes esperados:**

| Camada | Mudança |
|---|---|
| Registry | Adicionar `require_admin_mfa` em `FEATURE_FLAG_REGISTRY` com `isPublic: false`, `defaultEnabled: true`. |
| Middleware | Antes do bloco aal2, ler a flag (com cache); se `false`, pular o redirect para mfa-challenge/mfa-enroll. **Não** mexer em `mfa_reset_required` nem nas rotas públicas. |
| Cache | Middleware roda em todo request `/admin/*`. Sem cache = +1 query por request. Resolver com `unstable_cache` invalidado pela mutation **ou** cache em memória com TTL curto (~30s). Decisão fica com o TL. |
| UI | A `FeatureFlagsList` hoje tem toggle direto. Para essa flag específica, exigir **modal de confirmação destacado** explicando o impacto (admins não-enrolled passarão a entrar com aal1) antes de desligar. |
| Telas MFA | `/admin/mfa-enroll` e `/admin/mfa-challenge` continuam acessíveis — só o forçamento sai. Admin pode optar por enrollar manualmente mesmo com flag desligada. |

## 4. Riscos de segurança a tratar no PRD

1. **Default seguro:** linha não criada em `feature_flags` cai em `defaultEnabled = true`. Greenfield e ambientes recém-deployados ficam protegidos automaticamente.
2. **Mutação restrita a `owner`:** já garantido pela RPC existente — confirmar que o sprint não relaxa isso.
3. **Audit obrigatório:** RPC já registra `who/when/IP/UA`. Verificar que o evento aparece no histórico de auditoria com label legível ("Toggle MFA admin desligado/ligado").
4. **Confirmação de ação destrutiva:** modal de UI deve forçar leitura — não apenas um "tem certeza?" boilerplate.
5. **Não confundir com `mfa_reset_required`:** este sprint **não** mexe na flag per-admin do Sprint 11. Documentar a relação.
6. **Caso ninguém tenha aal2 e MFA seja desligada:** estado válido (era exatamente o pedido). Próximo login do owner terá aal1 e ele acessa normalmente. Fica sob responsabilidade dele reativar.

## 5. Pontos abertos para o Tech Lead decidir

- **Estratégia de cache no middleware** — `unstable_cache` com `revalidateTag` na mutation, ou cache de processo + TTL? Tradeoff: invalidação imediata vs. simplicidade.
- **Granularidade futura:** queremos só toggle global agora, ou já deixar campo `config jsonb` da `feature_flags` preparado para evolução (ex.: per-role, per-admin)? Sugiro **manter simples no MVP** — booleano global.
- **Texto do modal de confirmação** — quem escreve? @ux ou copy direto pelo @frontend?
- **Backfill / migração:** nenhuma — a ausência de linha no DB já é "ligada por default". Confirmar com @db-admin.
- **Telemetria:** queremos métrica de "quantas plataformas desligaram MFA admin"? Provavelmente fora do escopo deste sprint.

## 6. Critérios de aceite (alto nível, para o PRD detalhar)

- [ ] Owner consegue desligar e religar MFA admin pela página `/admin/settings/feature-flags`.
- [ ] Toggle gera entrada no audit log com IP e UA.
- [ ] Admin não-owner não vê o controle ativável (UI desabilitada + RPC bloqueia).
- [ ] Com flag desligada, admin sem fator MFA acessa `/admin/dashboard` direto após login.
- [ ] Com flag ligada, comportamento atual é preservado integralmente.
- [ ] `mfa_reset_required` continua forçando re-enroll mesmo com flag desligada (regressão proibida).
- [ ] Modal de confirmação aparece **somente ao desligar**, não ao religar.
- [ ] Cache da flag no middleware não excede 60s de stale aceitável.

## 7. Escopo fora deste sprint

- MFA por organização/cliente (este sprint trata só admins da plataforma).
- Per-admin opt-in/opt-out (continua sendo decisão global).
- Tipos de fator alternativos (WebAuthn, SMS) — segue só TOTP.
- Reescrita da `FeatureFlagsList` — só adicionar o modal específico para essa flag.

## 8. Referências

- Middleware atual: [src/middleware.ts](../../src/middleware.ts)
- Registry de flags: [src/lib/featureFlags/registry.ts](../../src/lib/featureFlags/registry.ts)
- Action de flags: [src/lib/actions/admin/feature-flags.ts](../../src/lib/actions/admin/feature-flags.ts)
- Página de flags: [src/app/admin/settings/feature-flags/page.tsx](../../src/app/admin/settings/feature-flags/page.tsx)
- Sprint 11 (origem do `mfa_reset_required`): [sprints/done/sprint_admin_11_admins_invite_mfa_reset.md](../../sprints/done/sprint_admin_11_admins_invite_mfa_reset.md)
- RBAC matrix (verificar se precisa atualizar): [docs/admin_area/rbac_matrix.md](rbac_matrix.md)
