# Telemetria de Gates

Extraído de `agents/00_TECH_LEAD.md` para reduzir carga de contexto do boot.
**Leia este arquivo apenas no momento de registrar uma avaliação de gate.**

---

**Toda avaliação de gate (pass, fail, warn) gera uma linha de log** em `docs/sprint_telemetry.jsonl`. Isso transforma o histórico de sprints em dado analisável (taxa de retry por agente, gates mais frágeis, tempo médio).

## Formato (JSON Lines, append-only)

Uma linha por evento. Campos:

```json
{"ts":"2026-04-14T15:30:00Z","sprint":"sprint_07_tasks_crud","workflow":"A","gate":"GATE_2","agent":"@frontend","attempt":1,"result":"fail","error_tag":"build_type_error","notes":"Missing import in TasksForm.tsx"}
```

**Campos obrigatórios:** `ts` (ISO 8601 UTC), `sprint`, `workflow` (`A`|`B`), `gate` (`GATE_1`..`GATE_5` | `SANITY` | `PREFLIGHT` | `CHECKLIST`), `agent`, `attempt` (1-based), `result` (`pass`|`fail`|`warn`).

**Campos opcionais (presentes em fail/warn):** `error_tag` (slug curto, ex: `build_type_error`, `rls_missing`, `lint_unused_var`, `design_hex_literal`), `notes` (uma linha).

**Campo opcional de duração:** `duration_ms` (inteiro, milissegundos que o gate levou do início ao resultado). Se disponível, o relatório `scripts/telemetry-report.mjs` calcula latência média por gate. Meça usando `date +%s%3N` antes/depois da avaliação e faça a diferença.

## Como appendar

Depois de cada avaliação de gate, rode:

```bash
echo '{"ts":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","sprint":"<name>","workflow":"<A|B>","gate":"<GATE_X>","agent":"<@agent>","attempt":<N>,"result":"<pass|fail|warn>"'"${ERR:+,\"error_tag\":\"$ERR\"}"'}' >> docs/sprint_telemetry.jsonl
```

(Em fail, defina `ERR=<tag>` antes.) Se preferir, monte o JSON manualmente — o que importa é que **a linha seja válida e aparece a cada avaliação**, não só em falhas.

## Quando logar
- **PREFLIGHT:** uma linha se falhou (com `error_tag` identificando qual passo).
- **SANITY:** uma linha por iteração do loop (result = `pass`/`fail`/`warn`; `error_tag` = modo de rejeição).
- **GATE_1..5:** uma linha por execução — inclusive retries (attempt incrementa).
- **CHECKLIST:** uma linha se < 100%.

**Não logue avaliações não rodadas** (ex: GATE 1 pulado em sprint sem DB não gera linha).

## Uso downstream

Para um resumo pronto (últimas N sprints, top gates com falha, retry rate por agente, escalações, latência média):

```bash
node scripts/telemetry-report.mjs                  # últimas 10 sprints
node scripts/telemetry-report.mjs --sprints 25     # janela maior
node scripts/telemetry-report.mjs --agent @backend # drilldown por agente
```

No closing do sprint, o Tech Lead pode rodar o relatório para alimentar entradas `[AGENT-DRIFT]` em APRENDIZADOS (um agente com `avg attempts > 1.5` já é sinalizado como drift pelo script). `grep` / `jq` continuam válidos para queries ad-hoc.
