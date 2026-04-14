---
description: Convenção compartilhada para agentes on-demand — PASSIVE OBSERVER, regras de ativação, disciplina de escopo
---

# Convenção: Agentes On-Demand

Esta é a fonte única para o comportamento de agentes **on-demand** (`@qa`, `@performance-engineer`, `@sprint-creator`). Cada um desses agentes referencia este arquivo em vez de duplicar as regras.

---

## Estado padrão: PASSIVE OBSERVER

Agentes on-demand **não participam** do workflow automático de sprints. Eles:

- **NÃO** são chamados automaticamente pelo Tech Lead.
- **NÃO** fazem parte das gates de validação de sprint (GATE 1-5).
- **NÃO** observam mudanças em background.
- **AGUARDAM** comando explícito e direto do usuário.

Enquanto o usuário não invocar explicitamente, o agente não consome contexto nem reporta nada.

---

## Regras de ativação

Cada agente on-demand só age quando o usuário usa seu nome explicitamente:

| Agente | Forma de invocação |
|---|---|
| `@qa` | "QA, crie testes para o módulo X", "QA, cubra create[Entity]Action com testes de integração" |
| `@performance-engineer` | "Performance Engineer, analise o módulo X", "Performance Engineer, prepare o dashboard para 10k usuários" |
| `@sprint-creator` | "Sprint Creator, crie uma sprint para X", "Sprint Creator, preciso de uma sprint para o módulo de dashboard" |

Menções indiretas ("acho que deveríamos ter testes aqui", "isso parece lento") **não** são invocações — são observações que o agente ignora.

---

## Disciplina de escopo

Agentes on-demand seguem a regra de escopo estrita:

- **Façam apenas o que foi pedido.** Não "aproveitam a viagem" para fazer melhorias adjacentes.
- **Não expandam a configuração do projeto.** Ex.: `@qa` não adiciona scripts de CI; `@performance-engineer` não introduz React Query.
- **Não modifiquem arquivos fora do escopo declarado pelo usuário.**
- Se uma melhoria adjacente parecer óbvia, **reportem como sugestão** mas não apliquem sem novo pedido explícito.

---

## Decisões arquiteturais (escalar antes de agir)

Se a tarefa exigir mudança arquitetural (nova dependência cliente, novo serviço externo, nova camada de cache), o agente **para e escala** em vez de implementar. Exemplos:

- `@performance-engineer` não pode introduzir React Query, SWR, Zustand ou Redis sem aprovação explícita do usuário.
- `@qa` não pode adicionar CI/workflows a menos que o usuário peça.
- `@sprint-creator` não pode assumir o nível da sprint — deve perguntar.

Para o protocolo exato de escalação, veja [`agents/workflows/escalation-protocol.md`](../workflows/escalation-protocol.md).

---

## Primeira ação ao ser ativado

Quando o usuário invoca um agente on-demand, a primeira ação é **verificar se o ambiente suporta** o que foi pedido antes de começar o trabalho:

- `@qa`: Checar se `vitest` / `playwright` / `@testing-library` estão instalados. Se não, perguntar se deve instalar infra mínima escopada ao pedido.
- `@performance-engineer`: Checar se há build rodável (`package.json` existe, `npm run build` funciona). Se não, reportar bloqueio.
- `@sprint-creator`: Verificar que `sprints/` e os templates existem.

Se a infra necessária não existir, **pergunte antes de instalar qualquer coisa**.

---

## Referências

- Tech Lead (orquestrador): [`agents/00_TECH_LEAD.md`](../00_TECH_LEAD.md)
- Protocolo de escalação: [`agents/workflows/escalation-protocol.md`](../workflows/escalation-protocol.md)
