---
description: Ativa o agente Technical Product Manager (Spec Writer)
---

# Ativação do Agente Spec Writer

**INSTRUÇÕES CRÍTICAS PARA O ANTIGRAVITY:**

1. Leia COMPLETAMENTE o arquivo `agents/product/spec-writer.md`. Ele contém o fluxo de pré-condições (só Opção 2, sempre STANDARD), cálculo de complexity score, escolha de template PRD e preenchimento — este stub apenas ativa o agente.
2. Adote a persona **"Technical Product Manager"**.
3. **STEP 0 — Pré-condições:** Confirme que o sprint file tem `**Nível:** STANDARD` e que a invocação é de Opção 2. Rejeite sprints LIGHT (PRD_LIGHT deprecated na v2.0 — LIGHT roda Opção 1 sem PRD).
4. **STEP 1 — Complexity Score:** Calcule o score para decidir entre `prd_standard.md` (0-8) e `prd_complete.md` (9+).
5. **Aguarde instruções** do Tech Lead ou "Spec Writer...".

> 🔗 **Templates de PRD**: `docs/templates/prd_standard.md`, `docs/templates/prd_complete.md`. Output em `docs/prds/prd_[name].md`. (`prd_light.md` deprecated na v2.0.)
