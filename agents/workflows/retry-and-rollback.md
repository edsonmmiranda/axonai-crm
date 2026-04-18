# Retry & Rollback — Protocolo de Falhas

Extraído de `agents/00_TECH_LEAD.md` para reduzir carga de contexto do boot.
**Leia este arquivo apenas quando um agente falhar ou um gate reprovar.**

---

## 🛠️ TRATAMENTO DE FALHAS

Se um agente produzir um output incorreto:

### Passo 1: PARE o agente
Interrompa a execução imediatamente. Não permita que o agente continue.

### Passo 2: Identifique a violação
Categorize a falha:
- **Scope creep:** Agente adicionou features que não estavam no PRD
- **Padrão errado:** Agente usou abordagem proibida (ex.: cores hard-coded)
- **Arquivo proibido:** Agente modificou arquivos fora do seu escopo
- **Implementação incorreta:** Lógica não casa com os requisitos

### Passo 3: ROLLBACK

**Matriz de responsabilidade:**

| Situação | Executor | Comando |
|---|---|---|
| Mudanças no working tree (não commitadas) | **Tech Lead direto** | `git restore <arquivos>` ou `git restore .` |
| Arquivos novos não rastreados (criados pelo agente) | **Tech Lead direto** | `git clean -fd <paths>` restrito ao escopo do agente |
| Commit já feito (precisa de revert) | **Delegar a `@git-master`** | `git revert <hash>` |
| Múltiplos commits em sequência | **Delegar a `@git-master`** | `git revert` em ordem inversa |
| Migração criada mas não aplicada | **Tech Lead direto** | `rm supabase/migrations/<timestamp>_bad.sql` |
| Migração já aplicada ao banco | **Delegar a `@db-admin`** | cria migração inversa |

**Regra:** o `@git-master` só entra em cena quando a história do git já registrou algo (commit) ou a operação é destrutiva/irreversível. Rollback de working tree é trivial e **não** justifica uma troca de persona — o Tech Lead executa direto para evitar fricção.

**Template de delegação ao `@git-master` (apenas nos casos acima):**

```
@git-master, faça rollback via `git revert` das mudanças do agente [@agent-name]:

SITUAÇÃO: commit <hash> / múltiplos commits da sprint <XX>
ARQUIVOS AFETADOS: [lista]
MOTIVO: [descrição da falha]
```

### Passo 4: RETRY com instruções mais claras
Re-delegue ao agente com:
- **Escopo específico:** "Modifique apenas src/components/[module]/[Entity]Form.tsx"
- **Restrições explícitas:** "Use o `Button` do design system em `src/components/ui/button`, sem estilização custom" (o contrato vive em [`design_system/components/CONTRACT.md`](../../design_system/components/CONTRACT.md))
- **Output esperado:** "Criar formulário com 3 campos: nome, email, empresa"
- **Condições de parada:** "Pare se precisar modificar o schema do banco"

**Exemplo:**
```
@frontend+, refaça a criação do [Entity]Form com estas restrições:

ESCOPO: Criar apenas src/components/[module]/[Entity]Form.tsx
REQUISITOS:
  - Usar os componentes `Form`, `Input`, `Button` do design system
    em `src/components/ui/` (contrato: design_system/components/CONTRACT.md)
  - Apenas tokens semânticos (bg-surface-*, text-text-*, bg-action-*, etc.)
  - 3 campos: nome (obrigatório), email (obrigatório), empresa (opcional)
  - Chamar create[Entity]Action no submit
  - Mostrar estado de loading durante submissão
  - Mostrar toast de erro em caso de falha
PROIBIDO:
  - NÃO criar novos componentes
  - NÃO modificar nenhum outro arquivo
  - NÃO usar valores arbitrários de Tailwind (p-[17px], bg-[#...], w-[350px])
  - NÃO usar classes primitivas de cor (bg-blue-500, text-neutral-900)
  - NÃO usar literais hex em lugar nenhum sob src/
PARE SE: Você precisar modificar o banco de dados ou criar novas actions
```

### Passo 5: ESCALAR
Se a falha persistir após 2 tentativas:

**Reportar ao usuário:**
```
🚨 FALHA DE AGENTE — ESCALAÇÃO NECESSÁRIA

Agente: [@agent-name]
Tarefa: [descrição]
Tentativas: 2/2 falharam

PADRÃO DE FALHA:
[o que continua dando errado]

CORREÇÕES TENTADAS:
1. [primeira abordagem de retry] - Resultado: [falhou porque...]
2. [segunda abordagem de retry] - Resultado: [falhou porque...]

HIPÓTESE DE CAUSA RAIZ:
[por que você acha que isso está falhando]

RECOMENDAÇÃO:
[intervenção manual necessária / PRD precisa de revisão / agente precisa de update]
```

---

## 🔄 Protocolo de falha em gate de validação

**Quando qualquer gate falha:**

1. **PARE** — Interrompa toda a execução imediatamente
2. **REPORTE** — Mostre mensagem clara de erro ao usuário
3. **ROLLBACK** — Reverta as mudanças do agente que falhou
4. **CONTEXTO** — Forneça detalhes do erro ao agente
5. **RETRY** — Re-rode o agente com contexto do erro
6. **LIMITE** — Máximo de 2 retries por agente
7. **ESCALAR** — Se 2 retries falharem, escale ao usuário

**Exemplo de retry:**
```
@db-admin, refaça a criação da migração:

ERRO ANTERIOR:
Linha 4: erro de sintaxe próximo a "email"
Vírgula faltando depois de "name text NOT NULL"

REQUISITOS:
- Consertar o erro de sintaxe
- Validar SQL antes de salvar
- Seguir sintaxe PostgreSQL rigorosamente
```
