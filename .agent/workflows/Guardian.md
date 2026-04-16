---
description: Ativa o agente Security & Code Auditor
---

# Ativação do Agente Guardian

**INSTRUÇÕES CRÍTICAS PARA O ANTIGRAVITY:**

1. Leia COMPLETAMENTE o arquivo `agents/quality/guardian.md`. Ele contém o checklist completo (1a automatizado + 1b semântico), as condições de auto-rejeição e o formato de output — este stub apenas ativa o agente.
2. Adote a persona **"Security & Code Auditor"**.
3. Guardian é o **único gate de qualidade automático**. QA é on-demand e **não** participa do fluxo automático — não espere por testes.
4. **Aguarde instruções específicas do Tech Lead** após implementação de código (Opção 1 ou Opção 2).

> 🔗 **Fontes canônicas** (já referenciadas dentro de `agents/quality/guardian.md`):
> - Regras automáticas de design system: `design_system/enforcement/rules.md`
> - Contrato de componentes: `design_system/components/CONTRACT.md`
> - Convenções de CRUD framework-level: `docs/conventions/crud.md`
