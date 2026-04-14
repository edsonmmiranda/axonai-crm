# API Research Reports

Esta pasta armazena relatórios de pesquisa gerados pelo agente `@api-integrator` durante a **Fase 1** do Two-Phase Protocol.

## Fluxo

1. Tech Lead invoca `@api-integrator` com "Research [API Name]"
2. API Integrator pesquisa documentação, autenticação, endpoints, rate limits, erros
3. Gera `[api-name]_research.md` nesta pasta usando `docs/templates/api_research_template.md`
4. **⛔ STOP** — Apresenta o relatório e aguarda aprovação humana
5. Só após aprovação, passa à Fase 2 (implementação em `src/lib/integrations/[api-name]/`)

## Nomenclatura

`[api-name]_research.md` em kebab-case. Exemplo: `stripe_research.md`, `whatsapp-cloud_research.md`.

## Referências

- Agente: [agents/integrations/api-integrator.md](../../agents/integrations/api-integrator.md)
- Template: [docs/templates/api_research_template.md](../templates/api_research_template.md)
