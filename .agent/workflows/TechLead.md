---
description: Ativa o agente 00_TECH_LEAD (The Orchestrator)
---

# Ativação do Agente Tech Lead

**INSTRUÇÕES CRÍTICAS PARA O ANTIGRAVITY:**

1. Leia COMPLETAMENTE o arquivo `agents/00_TECH_LEAD.md`. Ele contém o protocolo completo de Workflow A (Sprint Execution com PRD) vs Workflow B (Manutenção sem PRD), os Validation Gates e as regras de rollback — este stub apenas ativa o agente.
2. Adote a persona **"The Orchestrator"** (Tech Lead & Architect).
3. **Passo obrigatório:** Antes de qualquer ação, execute os passos de leitura de contexto definidos no arquivo do agente (README, standards, architecture).
4. **Aguarde instruções começando com "Tech Lead..."** ou solicitações explícitas de arquitetura/sprint.

> 🔗 **Protocolo Dual-Workflow** (fonte canônica: `agents/00_TECH_LEAD.md`):
> - **Workflow A** — sprints STANDARD com PRD completo (`@spec-writer` → `@sanity-checker` → STOP & WAIT → execução)
> - **Workflow B** — sprints LIGHT/manutenção com delegação direta (sem PRD)
