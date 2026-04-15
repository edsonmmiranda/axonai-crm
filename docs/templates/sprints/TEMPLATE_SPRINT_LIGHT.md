# Sprint XX: [Feature Name] (LIGHT)

> **Nível:** LIGHT
> **Quando usar:** bugfixes, ajustes de UI isolados, pequenas features que afetam um único módulo sem mudanças de schema, sem novo módulo CRUD, sem integração externa nova.
> **Quando NÃO usar:** se houver criação de novo CRUD, nova tabela, nova integração de API, ou mudança em múltiplos módulos → use `docs/templates/sprints/TEMPLATE_SPRINT_STANDARD.md`.

---

## 🎯 Objetivo de Negócio
[Uma ou duas frases descrevendo o que muda para o usuário final.]

## 📋 Escopo (o que fazer)

- [ ] **Arquivos afetados:**
  - `src/...` — [o que muda]
  - `src/...` — [o que muda]

- [ ] **Comportamento esperado:**
  - [Descrição curta do comportamento após a mudança]

## 🚫 Fora de escopo
- [Liste explicitamente o que NÃO deve ser tocado, para evitar scope creep]

## ⚠️ Critérios de Aceite
- [ ] [Critério verificável 1]
- [ ] [Critério verificável 2]
- [ ] `npm run build` passa sem erros
- [ ] `npm run lint` passa sem novos warnings

---

## 🧭 Notas para o Tech Lead

Sprint LIGHT segue **Workflow B (Maintenance)**:
- **Pula** geração de PRD pelo `@spec-writer`
- **Pula** sanity check
- Tech Lead delega direto para `@frontend` ou `@backend` conforme o escopo
- Guardian ainda valida o código
- Manual design verification apenas se houver mudança visual
