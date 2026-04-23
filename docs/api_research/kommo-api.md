# Kommo API — Documentação de Referência

> Descobertas reais via testes contra a conta `blessaneconsultoria.kommo.com`.  
> Use este documento como contexto para agentes que precisam interagir com a API da Kommo.

---

## 1. Autenticação

### Tipos de token

| Tipo | Onde gerar | Validade | Uso |
|------|-----------|----------|-----|
| **Long-lived token** | Kommo → Configurações → Perfil → API | Não expira | Integrações simples, scripts |
| **OAuth 2.0 access_token** | Fluxo OAuth da integração | 24h (com refresh_token) | Integrações oficiais/produção |

### Formato do header

```http
Authorization: Bearer <token>
```

### Sobre o JWT (OAuth)

O access_token é um JWT. O payload contém informações úteis:

```json
{
  "account_id": 34027583,
  "base_domain": "kommo.com",
  "api_domain": "api-c.kommo.com",
  "sub": "12550111",
  "exp": 1861920000,
  "scopes": ["push_notifications", "files", "crm", "files_delete", "notifications"]
}
```

- `api_domain` indica o servidor de API da conta (pode variar por região)
- `sub` é o ID do usuário autenticado
- `scopes` define o que a integração pode fazer — `crm` é o necessário para leads/pipelines/contatos

### Base URL

Sempre usar o subdomínio da conta:

```
https://{subdominio}.kommo.com/api/v4/
```

Exemplo real: `https://blessaneconsultoria.kommo.com/api/v4/`

---

## 2. Pipelines

### Listar todos os pipelines

```http
GET /api/v4/leads/pipelines
```

**Resposta:** array com todos os funis e suas etapas (statuses) aninhadas.

### Estrutura de um pipeline

```json
{
  "id": 10318031,
  "name": "FUNIL DE LEADS 24HRS",
  "sort": 1,
  "is_main": true,
  "is_unsorted_on": true,
  "is_archive": false,
  "account_id": 34027583,
  "_embedded": {
    "statuses": [
      {
        "id": 79121991,
        "name": "Leads de entrada",
        "sort": 10,
        "type": 1,
        "pipeline_id": 10318031
      }
    ]
  }
}
```

### Pipelines da conta blessaneconsultoria

| ID | Nome | Principal |
|----|------|-----------|
| `10318031` | FUNIL DE LEADS 24HRS | ✅ sim |
| `12872083` | FUNIL7 TENTATIVAS | — |
| `12931687` | FUNIL FOLOW 30 DIAS - PQ.M.F | — |
| `13087559` | ALUNAS - INATIVAS - CONSULTORIA | — |
| `13256647` | FUNIL FOLOW 30 DIAS | — |
| `13291707` | FUNIL - ALUNAS ATIVAS | — |
| `13291791` | FUNIL METEÓRICOS | — |
| `13292587` | FUNIL DE OPORTUNIDADE FUTURA | — |

### Etapas especiais (presentes em todos os pipelines)

| ID | Nome | Tipo |
|----|------|------|
| `142` | Venda ganha | padrão Kommo |
| `143` | Venda perdida | padrão Kommo |
| `type: 1` | Leads de entrada (Unsorted) | entrada automática |

---

## 3. Leads

### Listar leads

```http
GET /api/v4/leads
```

### Parâmetros disponíveis

| Parâmetro | Tipo | Descrição |
|-----------|------|-----------|
| `limit` | int | Máximo de resultados por página (máx: 250) |
| `page` | int | Página atual (começa em 1) |
| `with` | string | Dados extras: `tags`, `contacts`, `companies`, `catalog_elements` |
| `query` | string | Busca textual — pesquisa em nome, contato, **e nome de tags** |
| `filter[pipeline_id][]` | array | Filtra por pipeline(s) |
| `filter[statuses][N][pipeline_id]` | int | Pipeline de uma etapa específica |
| `filter[statuses][N][status_id]` | int | Etapa (status) específica |
| `filter[id][]` | array | IDs específicos de leads |
| `filter[name][]` | array | Nomes de leads |
| `filter[price]` | int | Valor do lead |
| `filter[created_by][]` | array | IDs de quem criou |
| `filter[updated_by][]` | array | IDs de quem atualizou |
| `filter[responsible_user_id][]` | array | IDs de responsáveis |
| `filter[created_at][from]` | timestamp | Data de criação — início |
| `filter[created_at][to]` | timestamp | Data de criação — fim |
| `filter[updated_at][from]` | timestamp | Data de atualização — início |
| `filter[updated_at][to]` | timestamp | Data de atualização — fim |
| `filter[closed_at][from]` | timestamp | Data de fechamento — início |
| `filter[closed_at][to]` | timestamp | Data de fechamento — fim |

### ⚠️ Filtro por tag — comportamento real

| Abordagem | Funciona? | Observação |
|-----------|-----------|-----------|
| `filter[tags_id][]=ID` | ❌ **Ignorado** | API não retorna erro, apenas ignora o parâmetro |
| `filter[tags_id]=ID` | ❌ **Ignorado** | Mesma coisa |
| `filter[tags][]=nome` | ❌ **Ignorado** | Não documentado e não funciona |
| `query=nome_da_tag` | ✅ **Funciona** | Pesquisa textual — encontra leads pela tag |

> **Conclusão:** A Kommo não oferece filtro nativo por tag ID no endpoint de leads. A única forma de filtrar por tag é via `query=`, que faz busca textual pelo nome da tag.

### Filtrar leads por tag + pipeline (abordagem correta)

```http
GET /api/v4/leads?with=tags&query=NOME_DA_TAG&filter[pipeline_id][0]=PIPELINE_ID&limit=250
```

**Exemplo real:**

```http
GET /api/v4/leads
  ?with=tags
  &query=Nao_respondeu_onboarding
  &filter[pipeline_id][0]=10318031
  &limit=250
  &page=1
```

**Atenção com acentos:** O parâmetro `query` aceita texto sem acento e encontra a tag normalmente. Caracteres especiais precisam de URL encoding se usados (ex: `Não` → `N%C3%A3o`). Usar a versão sem acento é mais seguro.

### Paginação

A API retorna até 250 leads por página. Para obter todos os leads, iterar páginas enquanto `_links.next` existir na resposta:

```json
{
  "_page": 1,
  "_links": {
    "self": { "href": "..." },
    "next": { "href": "..." }
  },
  "_embedded": {
    "leads": [...]
  }
}
```

Quando não há `next`, chegou na última página.

> **Nota:** O campo `_total_items` **não é retornado** pelo endpoint de leads. Não há como saber o total antes de paginar tudo.

### Estrutura de um lead (com `with=tags`)

```json
{
  "id": 12733670,
  "name": "Lead #12733670",
  "price": 0,
  "responsible_user_id": 12550111,
  "status_id": 143,
  "pipeline_id": 10318031,
  "created_at": 1752062609,
  "updated_at": 1752150977,
  "closed_at": 1752150977,
  "is_deleted": false,
  "custom_fields_values": null,
  "_embedded": {
    "tags": [
      { "id": 104218, "name": "Não_respondeu_onboarding", "color": null },
      { "id": 104226, "name": "Respondeu_2º_contato", "color": null }
    ],
    "companies": []
  }
}
```

---

## 4. Tags

### Comportamento observado

- Tags ficam em `lead._embedded.tags[]` quando se usa `with=tags`
- Cada tag tem `id` (numérico) e `name` (string)
- Um lead pode ter **múltiplas tags** simultaneamente
- Leads sem tag retornam `"tags": []`

### Tags encontradas na conta (exemplos reais)

| ID | Nome |
|----|------|
| `104218` | `Não_respondeu_onboarding` |
| `104226` | `Respondeu_2º_contato` |
| — | `META_ADS_INTERNACIONAL` |
| — | `Não_respondeu_2º_contato` |
| — | `Não_respondeu_3º_tentativa` |
| — | `INSTA_BIO` |

> Os IDs acima foram descobertos via listagem de leads. Não há endpoint dedicado para listar todas as tags da conta no plano atual.

---

## 5. Padrões de uso

### Agrupar leads de um pipeline por tag (relatório)

Estratégia: paginar todos os leads do pipeline com `with=tags` e agregar no cliente.

```python
import urllib.request, json
from collections import Counter

TOKEN = "seu_token"
PIPELINE_ID = 10318031
BASE = "https://blessaneconsultoria.kommo.com/api/v4/leads"

tag_counter = Counter()
total_leads = 0
sem_tag = 0
page = 1

while True:
    url = f"{BASE}?with=tags&limit=250&page={page}&filter[pipeline_id][0]={PIPELINE_ID}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {TOKEN}"})
    with urllib.request.urlopen(req) as r:
        data = json.loads(r.read())

    leads = data.get("_embedded", {}).get("leads", [])
    if not leads:
        break

    for lead in leads:
        total_leads += 1
        tags = lead.get("_embedded", {}).get("tags", [])
        if not tags:
            sem_tag += 1
        for t in tags:
            tag_counter[t["name"]] += 1

    if "next" not in data.get("_links", {}):
        break
    page += 1

# Resultado
for tag, count in tag_counter.most_common():
    pct = count / total_leads * 100
    print(f"{tag}: {count} leads ({pct:.1f}%)")
```

### Buscar leads de um pipeline com uma tag específica

```http
GET /api/v4/leads
  ?with=tags
  &query=NOME_DA_TAG
  &filter[pipeline_id][0]=PIPELINE_ID
  &limit=250
  &page=1
```

> Iterar páginas até não haver `_links.next`.  
> Validar no cliente que o lead realmente contém a tag (o `query` é busca textual, pode trazer falsos positivos em casos raros).

### Filtrar por etapa específica de um pipeline

```http
GET /api/v4/leads
  ?filter[statuses][0][pipeline_id]=10318031
  &filter[statuses][0][status_id]=81353939
  &limit=250
```

---

## 6. Webhooks

### O que são

Notificações HTTP enviadas pela Kommo para uma URL configurada **quando eventos ocorrem** na conta.

### O que NÃO são

Webhooks **não são** mecanismo de consulta. Não é possível:
- Assinar webhooks filtrados por tag
- Assinar webhooks filtrados por pipeline específico
- Consultar/listar leads via webhook

### Eventos disponíveis

Webhooks disparam em eventos de entidades: leads, contatos, empresas, tarefas, catálogos, conversas e notas. Exemplos:
- Lead adicionado
- Lead com status alterado
- Responsável alterado

### Caso de uso combinado (tempo real + filtro)

Para reagir em tempo real apenas a leads de um pipeline com uma tag específica:

1. Webhook dispara em `lead_status_changed` (ou `lead_add`)
2. Seu backend recebe o evento com o `lead_id`
3. Faz `GET /api/v4/leads/{id}?with=tags` para buscar os detalhes
4. Verifica se `pipeline_id` e tags correspondem ao critério
5. Processa ou descarta

---

## 7. Limitações conhecidas

| Limitação | Detalhe |
|-----------|---------|
| Sem filtro nativo por tag | `filter[tags_id]` é ignorado silenciosamente |
| Sem total de itens em leads | `_total_items` não é retornado — é preciso paginar tudo |
| `query=` é busca textual | Pode trazer falsos positivos se o nome da tag aparecer no nome do lead |
| Rate limit | Não testado, mas a Kommo limita requisições por segundo — adicionar delay entre páginas em scripts grandes |
| Tags sem endpoint dedicado | Não há `GET /api/v4/tags` para leads no plano atual — descobrir IDs via listagem de leads |

---

## 8. Referências

- [Documentação oficial (EN)](https://developers.kommo.com/reference/leads-list)
- [Documentação PT](https://pt-developers.kommo.com/docs/webhooks)
- [Leads list endpoint](https://developers.kommo.com/reference/leads-list)
- [Pipelines e etapas](https://developers.kommo.com/reference/leads-pipelines-and-stages)


