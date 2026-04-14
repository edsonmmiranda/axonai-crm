---
name: escalation-protocol
description: Protocolo para escalar requisitos ambíguos ou bloqueadores técnicos ao usuário — formatos obrigatórios e protocolo de resumo
---

# Protocolo de Escalação

## Propósito

Este workflow define **quando** e **como** escalar requisitos ambíguos, conflitos ou bloqueadores técnicos ao usuário. Toda escalação obedece ao mesmo contrato: **resumo → opções numeradas → recomendação**. Nunca "dê melhor chute".

---

## Quando escalar

Pare e peça esclarecimento se **qualquer uma** das condições abaixo for verdadeira:

1. **Requisito vago** — falta detalhe, múltiplas interpretações possíveis, escopo/limite incerto.
2. **Requisitos conflitantes** — contradizem entre si ou contradizem o sistema existente, violam padrões estabelecidos.
3. **Lógica de negócio não especificada** — regras de negócio, edge cases ou regras de validação ambíguas.
4. **Informação crítica faltando** — schema de banco, contrato de API, especificação de UI/UX incompletos.
5. **Incerteza do usuário** — o próprio usuário mudou de ideia várias vezes, faz afirmações contraditórias ou hesita visivelmente.

Quando a condição é disparada, **pare a execução imediatamente**. Não prossiga com "melhor chute".

---

## Protocolo de resumo obrigatório

Toda escalação precisa carregar contexto suficiente para o usuário tomar a decisão **sem abrir arquivos**. Inclua, em ordem:

1. **Agente e tarefa** — quem está escalando e o que estava fazendo.
2. **Onde parou** — qual arquivo/seção, última coisa que estava sendo feita.
3. **O que já foi feito** — passos concluídos, arquivos alterados (sem diff, só a lista).
4. **O que descobriu** — a evidência que tornou o problema visível (erro, ambiguidade, conflito).
5. **Opções** — numeradas de 2 a 3, com impacto concreto (tempo, arquivos afetados, risco).
6. **Recomendação** — sua escolha + uma frase de justificativa.

Sem esse resumo, a escalação força o usuário a reconstruir o contexto do zero. É o motivo central deste protocolo existir.

---

## Formato: Ambiguidade

```
AMBIGUITY DETECTED

Agent: [@agent-name]
Task: [resumo da tarefa]
State: [onde parou — arquivo, função, linha se aplicável]
Progress so far: [passos concluídos]

Requirement: "[texto exato do sprint/PRD]"
Location: [sprint file, linha X] ou [PRD seção Y]

INTERPRETATION A:
- What: [descrição]
- Impact: [tempo estimado, arquivos afetados, risco]
- Example: [exemplo concreto]

INTERPRETATION B:
- What: [descrição]
- Impact: [tempo estimado, arquivos afetados, risco]
- Example: [exemplo concreto]

RECOMMENDATION: [qual escolheria e por quê, 1 frase]

QUESTION: Qual interpretação é correta, ou existe uma terceira opção?
```

---

## Formato: Bloqueador técnico

```
TECHNICAL BLOCKER

Agent: [@agent-name]
Sprint: [sprint file]
Task: [resumo da tarefa]
State: [onde parou]
Progress so far: [passos concluídos — incluir arquivos já modificados]

ORIGINAL REQUIREMENT:
[texto exato do PRD]

TECHNICAL DISCOVERY:
[o que foi descoberto durante a implementação que mudou o jogo]

CONFLICT:
[por que o requisito não pode ser implementado como especificado]

OPTIONS:
1. [Opção A — prós/contras]
2. [Opção B — prós/contras]
3. [Opção C — prós/contras]

RECOMMENDATION: [qual opção + por quê]
```

---

## Exemplos

### Exemplo 1 — Canais de notificação ambíguos

```
AMBIGUITY DETECTED

Agent: @spec-writer
Task: Gerar PRD para sprint_05_notifications.md
State: Seção 3 (API Contract), escrevendo schemas Zod
Progress so far:
- Seções 1 (Visão Geral) e 2 (Database) completas
- Tabela notifications_log proposta

Requirement: "Sistema deve enviar notificações aos usuários"
Location: sprints/sprint_05_notifications.md, linha 12

INTERPRETATION A:
- What: Apenas email
- Impact: Implementação simples, ~5 min, usa o serviço de email existente
- Example: Usuário recebe email quando status de [entity] muda

INTERPRETATION B:
- What: Email + Push + In-app
- Impact: Complexo, ~30 min, requer setup de Firebase + componentes de UI
- Example: Usuário recebe email, push no browser e toast in-app

RECOMMENDATION: A — escopo do sprint parece pequeno, push/in-app podem virar um sprint separado.

QUESTION: Quais canais de notificação devem ser implementados?
```

### Exemplo 2 — Modelo de dados ambíguo

```
AMBIGUITY DETECTED

Agent: @db-admin
Task: Migração para relacionamento [entity_a] ↔ [entity_b]
State: Design da migração, ainda não salvou arquivo
Progress so far: Introspecção da tabela [entity_a] concluída (não tem [entity_b]_id)

Requirement: "Adicionar relacionamento entre [entity_a] e [entity_b]"
Location: sprints/sprint_07_[entity_b].md, linha 8

INTERPRETATION A:
- What: Relacionamento 1:1 (cada [entity_a] tem um [entity_b])
- Impact: FK simples, campo [entity_b]_id em [entity_a]
- Example: [Entity_A] "John Doe" → [Entity_B] "Acme Corp"

INTERPRETATION B:
- What: Relacionamento N:N ([entity_a] podem ter múltiplos [entity_b])
- Impact: Tabela de junção, queries mais complexas
- Example: [Entity_A] "John Doe" → [Entity_B] ["Acme Corp", "Tech Inc"]

RECOMMENDATION: A — é o padrão mais comum; se virar N:N depois, é migração aditiva.

QUESTION: Um [entity_a] pode pertencer a múltiplos [entity_b]?
```

### Exemplo 3 — Bloqueador técnico

```
TECHNICAL BLOCKER

Agent: @backend
Sprint: sprints/sprint_08_export.md
Task: Implementar exportação de [entities] para Excel
State: Aprox. 60% — client XLSX instalado, action get[Entities]ForExportAction criada
Progress so far:
- Instalado xlsx no package.json
- Criado src/lib/actions/exports.ts com get[Entities]ForExportAction
- Rota /api/export/[entities] criada

ORIGINAL REQUIREMENT:
"Exportar todos os [entities] para Excel com todos os campos"

TECHNICAL DISCOVERY:
Tabela [entities] tem campo JSONB 'custom_fields' com estrutura dinâmica.
Cada [entity] pode ter custom_fields diferentes.

CONFLICT:
Excel exige colunas fixas. Não dá para criar colunas dinâmicas a partir
dos custom_fields únicos de cada [entity].

OPTIONS:
1. Exportar apenas campos padrão (name, email, company, phone)
   - Prós: simples, rápido, colunas previsíveis
   - Contras: perde dados dos custom_fields

2. Exportar custom_fields como única coluna JSON
   - Prós: inclui todos os dados
   - Contras: não é amigável, exige parsing de JSON pelo usuário

3. Criar aba separada para custom_fields (key-value por [entity])
   - Prós: inclui todos os dados, legível
   - Contras: mais complexo, duas abas

RECOMMENDATION: 1 para MVP, adicionar 3 em sprint futuro se necessário.
```

---

## Boas práticas

### Faça
- Pare imediatamente quando detectar ambiguidade — não prossiga no "talvez".
- Dê exemplos concretos por interpretação.
- Estime impacto (tempo, complexidade, arquivos) por opção.
- Aguarde esclarecimento **explícito** antes de continuar.
- Documente a decisão no sprint/PRD após recebê-la.

### Não faça
- "Best guess assumptions".
- Continuar sem esclarecimento.
- Perguntas vagas ("como devo fazer isso?").
- Mais de 3 opções — paralisia de escolha.
- Pular a análise de impacto.

---

## Contrato

**Inputs:** sprint file ou PRD com ambiguidade/bloqueio; progresso atual do agente que escala.
**Outputs:** mensagem em um dos dois formatos acima (`AMBIGUITY DETECTED` ou `TECHNICAL BLOCKER`), apresentada ao usuário via Tech Lead.
**Arquivos tocados:** nenhum (só produz texto).

---

## Relacionados

- **Agentes que usam este workflow:** `@tech-lead`, `@spec-writer`, `@sprint-creator`, qualquer agente que bata em bloqueio.
- **Workflow relacionado:** [`validation-checklist.md`](validation-checklist.md)
