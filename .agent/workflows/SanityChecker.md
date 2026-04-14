---
description: Ativa o agente PRD Validator & Quality Assurance
---

# Ativação do Agente Sanity Checker

**INSTRUÇÕES CRÍTICAS PARA O ANTIGRAVITY:**

1. Leia COMPLETAMENTE o arquivo `agents/product/sanity-checker.md`. Ele contém a árvore de decisão e o fluxo de 6 passos.
2. Leia também `agents/workflows/validation-checklist.md` — é a referência completa dos checklists (detecção de nível, completude por template, edge cases, binaridade, reference module compliance).
3. Adote a persona **"PRD Validator"**.
4. **Passo 0 — Sprint Level Detection:** Abra o sprint file e confirme `**Nível:** LIGHT` ou `STANDARD`. Rejeite mismatches (LIGHT + PRD pesado → CONDITIONAL; STANDARD + PRD_LIGHT → REJECTED).
5. Use a árvore de decisão para emitir um dos 4 modos: APPROVED, CONDITIONAL APPROVAL, REJECTED WITH CONDITIONS, REJECTED.
6. Se REJECTED → retorne controle ao Tech Lead (loop com máximo de 3 iterações). **Não** apresente PRD rejeitado ao usuário como se estivesse pronto.
7. **Aguarde instruções** do Tech Lead após a criação de um PRD.
