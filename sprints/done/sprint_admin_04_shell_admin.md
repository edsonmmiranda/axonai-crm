# Sprint admin_04: Shell admin — route group `(admin)`, MFA AAL2, login isolado, branding

> **Nível:** STANDARD
> **Ciclo:** Admin Area · Sprint 04 de 13
> **Dependências satisfeitas:** sprint_admin_01 ✅ · sprint_admin_02 ✅ · sprint_admin_03 ✅

---

## 🎯 Objetivo de Negócio

Entregar a "casca" da área administrativa: um platform admin autentica via login isolado, completa MFA TOTP (AAL2), e acessa um layout "Axon Admin" visualmente distinto do customer app. Qualquer rota sob `(admin)` rejeita silenciosamente quem não é platform admin ativo com AAL2 — não há caminho de bypass via sessão customer nem via URL direta.

Resolve as decisões D-4 (branding "Axon Admin"), D-8 (sessão 8h/12h) e entrega os gates G-01, G-04, G-05 do PRD.

---

## 👤 User Stories

- Como **Edson (platform admin owner)**, quero acessar `/admin/login`, fazer login com e-mail/senha e completar MFA TOTP, para que eu entre na área admin com AAL2 confirmado.
- Como **platform admin**, quero que o layout da área admin seja visivelmente distinto ("Axon Admin", paleta neutra escura), para que eu nunca confunda qual contexto estou operando.
- Como **platform admin**, quero que minha sessão admin expire em 8h de inatividade (12h absoluta), para que sessões esquecidas não fiquem abertas indefinidamente.
- Como **desenvolvedor**, quero que um script CI (`npm run build:check`) falhe se qualquer arquivo do customer app importar módulos admin-only, para que o isolamento de bundle seja verificável mecanicamente.

---

## 🎨 Referências Visuais

- **Layout:** `design_system/README.md` — paleta neutra escura como variação do design system existente. Tokens semânticos do design system; acento distinto do customer app (a definir no layout com variável CSS `--color-admin-accent`).
- **Design system:** tokens semânticos (`bg-surface-*`, `text-text-*`, `bg-action-*`). Sem hex literais, sem `bg-blue-500`, sem valores arbitrários Tailwind.
- **Componentes:** `AppLayout`-equivalente admin (sidebar própria, topbar própria), `LoginForm`, `MfaEnrollForm`, `MfaChallengeForm`.
- **Gold Standard:** não há módulo admin existente — usar `design_system/components/recipes/` como fonte de estrutura de formulários e layout.
- **Banner de contexto:** componente persistente no topo do layout admin exibindo "Axon Admin" para reforçar consciência de contexto.

---

## 🧬 Reference Module Compliance

Não aplicável — primeiro módulo da área admin. Sem módulo de referência existente em `src/app/(admin)/`. Usar `design_system/components/recipes/` e `design_system/components/catalog/templates/` como fonte de estrutura.

---

## 📋 Funcionalidades (Escopo)

### Backend (autor: `@backend`)

- [ ] **Middleware de autenticação admin** (`src/middleware.ts` — adicionar branch para rotas `/admin/**`):
  - `requireAdminSession()` — reusa `requirePlatformAdmin()` do Sprint 02 (`src/lib/auth/platformAdmin.ts`) + verifica `aal` na sessão via `supabase.auth.getSession()`.
  - Se sem sessão → redirect para `/admin/login`.
  - Se com sessão AAL1 (sem MFA) → redirect para `/admin/mfa-challenge`.
  - Se AAL2 mas sem `platform_admins` ativo → responde 403 (ou redirect para página de acesso negado).
  - Rotas públicas admin que não requerem auth: `/admin/login`, `/admin/mfa-enroll`, `/admin/mfa-challenge`.

- [ ] **Script CI de isolamento de imports** (`scripts/check-import-isolation.mjs`):
  - Verifica que nenhum arquivo em `src/app/(app)/**` importa de `src/app/(admin)/**`.
  - Verifica que nenhum arquivo em `src/app/(app)/**` importa de `src/lib/auth/platformAdmin.ts`.
  - Integrar como `npm run build:check` em `package.json` (adiciona ao existente ou cria novo script).
  - Sai com código 1 e mensagem de erro descritiva se violação encontrada.

- [ ] **Configuração de sessão** (documentar em `docs/admin_area/runbook_mfa_setup.md`):
  - Sessão admin: 8h inatividade, 12h absoluta (D-8) — configurado via Supabase auth settings no dashboard (tarefa manual; runbook documenta os passos).
  - MFA habilitação no projeto Supabase: também tarefa manual; runbook documenta.

> **Nota sobre Server Actions:** este sprint não cria Server Actions em `src/lib/actions/`. O login e MFA usam Supabase Auth client-side (padrão do framework). `@qa-integration` = n/a neste sprint.

### Frontend (autor: `@frontend+`)

- [ ] **Route group e layout** (`src/app/(admin)/layout.tsx`):
  - Layout próprio, completamente separado de `src/app/(app)/layout.tsx`.
  - Sidebar e topbar distintos do customer app.
  - Tokens de tema "Axon Admin": variável CSS `--color-admin-accent` definida no layout, paleta neutra escura.
  - Banner persistente de contexto exibindo "Axon Admin" com ícone de escudo (Lucide `Shield`).
  - Dark mode suportado desde o primeiro commit.

- [ ] **Login isolado** (`src/app/(admin)/login/page.tsx`):
  - Formulário: e-mail + senha.
  - Após autenticação bem-sucedida: verificar AAL. Se AAL1 → redirecionar para `/admin/mfa-challenge`.  
  - Se MFA não enrolado → redirecionar para `/admin/mfa-enroll`.
  - Se AAL2 e platform admin ativo → redirecionar para `/admin/dashboard`.
  - Error handling: credenciais inválidas, conta desativada, plataforma sem admins configurados.
  - Visual distinto do login do customer app (sem compartilhar componentes de página).

- [ ] **Enrollment de MFA** (`src/app/(admin)/mfa-enroll/page.tsx`):
  - Fluxo TOTP via `supabase.auth.mfa.enroll()`.
  - Exibir QR code + chave manual para apps de autenticação.
  - Campo de verificação do primeiro código TOTP para confirmar enrollment.
  - Após enrollment bem-sucedido: AAL sobe para 2 → redirecionar para `/admin/dashboard`.
  - Instrução clara: "Salve esta chave em local seguro — não será exibida novamente."

- [ ] **Challenge de MFA** (`src/app/(admin)/mfa-challenge/page.tsx`):
  - Para usuários com MFA já enrolado mas sessão em AAL1.
  - Campo para código TOTP do autenticador.
  - Após verificação bem-sucedida: AAL sobe para 2 → redirecionar para `/admin/dashboard`.
  - Link "Problemas com o autenticador?" → página informativa (não implementa recuperação — Sprint 11).

- [ ] **Página de acesso negado** (`src/app/(admin)/unauthorized/page.tsx`):
  - Exibida quando AAL2 mas não é platform admin ativo.
  - Mensagem clara: "Seu perfil não tem acesso à área administrativa. Contate um platform admin owner."
  - Sem link para o customer app (contextos isolados).

- [ ] **Dashboard stub** (`src/app/(admin)/dashboard/page.tsx`):
  - Placeholder mínimo ("Bem-vindo à Axon Admin — dashboard em construção") para validar que a rota protegida funciona end-to-end.
  - Usa o layout admin (sidebar, topbar, banner).

---

## 🧪 Edge Cases

- [ ] **Sem sessão**: acesso direto a `/admin/dashboard` → redireciona para `/admin/login` (não 404, não 500).
- [ ] **Sessão AAL1 (sem MFA completado)**: acesso a rota protegida → redireciona para `/admin/mfa-challenge`.
- [ ] **MFA não enrolado**: após login → redireciona para `/admin/mfa-enroll` antes de qualquer rota admin.
- [ ] **AAL2 mas não platform_admin**: acesso a rota protegida → 403 / página de acesso negado (não revela estrutura interna).
- [ ] **Session customer ativa no mesmo browser**: não concede acesso à área admin (sessões coexistem, nenhum caminho cross-app).
- [ ] **Código TOTP incorreto no challenge**: mensagem de erro sem revelar se o problema é o código ou a sessão.
- [ ] **Enrollment com QR code expirado** (Supabase expira o factor antes de verificar): mensagem de erro + botão "reiniciar enrollment".
- [ ] **Import isolation**: adição acidental de `import '../../lib/auth/platformAdmin'` em arquivo `(app)/` → `npm run build:check` sai com código 1.

---

## 🚫 Fora de escopo

- Dashboard com KPIs reais (Sprint 09).
- CRUD de organizations, plans, platform admins (Sprints 05, 06, 11).
- Convite de platform admin e reset de senha (Sprint 11).
- Rate limit em login admin (Sprint 12).
- Origin isolation de deploy via subdomínio (Sprint 13).
- Configuração de sessão via UI admin (D-8 é configuração manual de dashboard Supabase).
- Recuperação de MFA / break-glass (Sprint 12).
- Sidebar com itens de navegação definitivos (cada sprint seguinte adiciona seus links).

---

## ⚠️ Critérios de Aceite

- [ ] Acesso a `/admin/dashboard` sem sessão → redireciona para `/admin/login` (verificável em browser e por teste de middleware).
- [ ] Login sem MFA enrolado → força `/admin/mfa-enroll` antes de liberar qualquer rota admin.
- [ ] Login com MFA enrolado mas AAL1 → força `/admin/mfa-challenge`.
- [ ] Usuário com AAL2 mas **sem** entrada ativa em `platform_admins` → 403 / acesso negado.
- [ ] `npm run build:check` falha se adicionado `import '@/lib/auth/platformAdmin'` em qualquer arquivo sob `(app)/`.
- [ ] Layout admin visivelmente distinto do customer app (paleta neutra escura, banner "Axon Admin").
- [ ] Dark mode funcional no layout admin desde o primeiro commit.
- [ ] `npm run build` passa sem erros.
- [ ] `npm run lint` passa sem novos warnings.
- [ ] Guardian aprova o código.
- [ ] Runbook `docs/admin_area/runbook_mfa_setup.md` criado com passos para: (a) habilitar MFA no projeto Supabase, (b) configurar duração de sessão 8h/12h.
- [ ] Decisão D-8 marcada como resolvida em `docs/PROJECT_CONTEXT.md` (já está — confirmar que o runbook referencia os valores).

---

## 🤖 Recomendação de Execução

> Seção preenchida pelo `@sprint-creator` com base em rubrica objetiva.

**Análise:**
- Nível: STANDARD
- Complexity Score: **12**
  - DB: 0 (sem tabela nova — usa `auth.mfa_factors` existente)
  - API/Actions: +4 (helpers de auth +2, múltiplos handlers de rota +2)
  - UI: +2 (4 páginas novas + layout novo — conta como "novos componentes" +2)
  - Lógica: +5 (MFA AAL2 enforcement +3, session isolation +2)
  - Deps: +1 (interna: `requirePlatformAdmin` do Sprint 02)
- Reference Module: não — primeiro módulo admin
- Integração com API externa: não (Supabase Auth é SDK interno)
- Lógica de negócio nova/ambígua: **sim** — fluxo de AAL2, isolamento de sessão cross-app, redirecionamentos condicionais
- Ambiguity Risk: **médio** — fluxo de estados de sessão tem múltiplas ramificações; script de isolamento de imports é novo no projeto

---

### Opção 1 — SIMPLES (sem PRD)
- **Fluxo:** Tech Lead → @backend → @frontend+ → @guardian → gates → @git-master
- **PRD:** pulado; sprint file é o contrato
- **Modelo sugerido:** Sonnet — fluxo curto, sem lógica de negócio de domínio
- **Quando faz sentido:** se a lógica de redirecionamento e o script de isolamento já foram discutidos em detalhe nesta sessão e não há ambiguidade pendente.

### Opção 2 — COMPLETA (com PRD)
- **Fluxo:** Tech Lead → @spec-writer → @sanity-checker (loop ≤3×) → STOP & WAIT → execução idêntica à Opção 1
- **PRD:** gerado em `prds/prd_admin_04_shell.md` e validado
- **Modelo sugerido:** Opus — score 12 + lógica de sessão com múltiplas ramificações condicionais
- **Quando faz sentido:** para documentar formalmente os estados de sessão, os redirecionamentos e o contrato do script CI — garante que `@backend` e `@frontend+` recebam spec sem ambiguidade.

---

**Recomendação do @sprint-creator:** Opção 2 — Opus

**Justificativa:**
Score 12 (acima do threshold ≥9 para Opção 2 forçada). Lógica de sessão MFA tem múltiplos estados condicionais (sem sessão / AAL1 sem MFA / AAL1 com MFA / AAL2 sem platform_admin / AAL2 com platform_admin) que precisam ser especificados sem ambiguidade antes de implementar. O `@spec-writer` vai mapear o diagrama de estados e o `@sanity-checker` vai verificar que não há buracos. Sem PRD, existe risco real de `@backend` e `@frontend+` implementarem redirecionamentos conflitantes.

**Aguardando escolha do usuário:** responda ao Tech Lead com `"execute opção 1"`, `"execute opção 2"` ou `"execute"` (aceita a recomendação).

---

## 🔄 Execução

> Esta seção é preenchida durante a execução. Cada agente atualiza sua linha antes de reportar conclusão ao Tech Lead.

| Etapa | Agente | Status | Artefatos |
|---|---|---|---|
| Banco de dados | `@db-admin` | n/a — sem tabela nova | — |
| Server Actions | `@backend` | ✅ Concluído | `src/middleware.ts`, `scripts/check-admin-isolation.mjs` (atualizado), `package.json` (`build:check`), `docs/admin_area/runbook_mfa_setup.md` |
| Integration tests | `@qa-integration` | n/a — sem Server Actions novas | — |
| Frontend | `@frontend+` | ✅ Concluído | `src/app/admin/layout.tsx`, `login/`, `mfa-enroll/`, `mfa-challenge/`, `unauthorized/`, `dashboard/` + `src/components/admin/AdminShell.tsx`, `AdminContextBanner.tsx`, `AdminSidebar.tsx`, `AdminTopbar.tsx`, `AdminLoginForm.tsx`, `AdminMfaEnrollForm.tsx`, `AdminMfaChallengeForm.tsx` + globals.css `[data-admin]` |
| Guardian | `@guardian` | ✅ Concluído | 3 violações corrigidas: rgb literal em globals.css, focus-visible faltando em AdminLoginForm, admin.profileId como nome em AdminShell |
| Git | `@git-master` | ⬜ Pendente | — |

**Legenda:** ⬜ Pendente · ▶️ Em andamento · ✅ Concluído · ⏸️ Aguarda review · n/a — não aplicável
