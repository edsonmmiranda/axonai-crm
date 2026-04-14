# 🎨 Processo de Verificação de Design e UX

Este documento centraliza as diretrizes obrigatórias para a verificação visual de qualquer entrega de frontend no SaaS Factory.
**Objetivo:** Garantir consistência absoluta entre telas novas e o Design System estabelecido (referência: Módulo de Leads).

---

## ⚙️ Parte 1 — Verificação automática (obrigatória, GATE 5 estático)

Rode **antes** da verificação manual:

```bash
node scripts/verify-design.mjs            # inspeciona todo src/
node scripts/verify-design.mjs --changed  # só arquivos do diff atual
```

O script checa (exit 1 se violado):
- Ausência de `AppLayout` em páginas internas (`src/app/**/page.tsx`, ignorando route groups `(public)`, `(marketing)`, `(auth)`).
- Widths/heights arbitrários (`w-[357px]`, `h-[Xrem]`, `max-w-[...]`).
- Cores arbitrárias Tailwind (`bg-[#fff]`, `text-[#abc]`, `border-[...]`).
- Cor hex literal dentro de `className`.
- Atributo `style={{...}}` inline.

Se falhar → **PARE, reporte, peça correção ao agente, re-rode o script**. Só siga para a Parte 2 quando a saída for `✅ 0 violações`.

## 👁️ Parte 2 — Verificação manual (resto do GATE 5)

Use os checklists abaixo **somente depois** que a Parte 1 passou. Eles cobrem o que o script **não** consegue ver: responsividade em breakpoints reais, comparação visual side-by-side com o Gold Standard, qualidade semântica de labels/placeholders, e tooltips/interações de gráficos.

---

## 💎 Regras Gerais (Aplicáveis a TUDO)
1. **Gold Standard (CRUD):** O módulo de **Leads** é a referência absoluta para *Telas de Cadastro e Listagem*.
   - Se sua tela de CRUD difere dele (fonte, cor, espaçamento), ela está errada.
2. **Design System First:** Nunca use estilos arbitrários (ex: `w-[357px]`). Use sempre as classes utilitárias do Tailwind padronizadas.
3. **Shell de Navegação:** Toda tela interna deve estar envolta no `AppLayout`. Publicas tem layout próprio.
4. **Respondividade:** Tudo deve ser testado em Mobile (375px) e Desktop (1440px).

---

## 📋 1. Processo de Verificação de CRUD
*Aplicável para:** Listagens, Formulários, Tabelas de cadastro.*

### 1.1 Verificação de Layout (Shell)
- [ ] **Sidebar:** O menu lateral está visível e ativo na opção correta?
  - *Erro comum:* Esquecer de envolver a página em `AppLayout`.
- [ ] **Breadcrumbs:** O caminho de navegação está correto (`Home > [Módulo] > [Ação]`)?
- [ ] **Container:** Usa `max-w-7xl` com `mx-auto` e padding `px-4 sm:px-6 lg:px-8`?

### 1.2 Verificação de Listagem (Data Tables)
- [ ] **Page Header:** Título claro, Descrição auxiliar e Botão de Ação ("Novo") presentes?
- [ ] **Filter Bar (Obrigatório):** 
  - [ ] Tem pesquisa de texto?
  - [ ] Tem filtros de status/tipo?
  - [ ] Estilo idêntico ao `components/common/filter-bar.tsx`?
- [ ] **Tabela:**
  - [ ] Cabeçalhos alinhados corretamente?
  - [ ] Status usam `Badge` com cores semânticas?
  - [ ] Ações (Edit/Delete) usam botões `ghost` discretos?
- [ ] **Empty State:** Tem mensagem amigável quando não há dados ou resultados de busca?

### 1.3 Verificação de Formulários (Create/Edit)
- [ ] **Estrutura:** Usa `FormSection` para agrupar campos?
- [ ] **Campos:** 
  - [ ] Labels em português?
  - [ ] Placeholders com exemplos reais?
  - [ ] Inputs tipados corretamente (Data, Moeda, Switch)?
- [ ] **Feedback:** Erros de validação aparecem em vermelho abaixo do campo? Loading spinner aparece ao salvar?

---

## 📊 2. Processo de Verificação de Relatórios (Dashboard)
*Aplicável para:** Telas de Analytics, Gráficos e KPIs.*

> ⚠️ **Under Construction:** Este processo será detalhado na Sprint de Analytics.
>
> **Checklist Preliminar:**
> - [ ] Cards de KPI (Big numbers) seguem o padrão do Dashboard Principal?
> - [ ] Gráficos têm legendas claras e tooltips?
> - [ ] Cores dos gráficos respeitam a paleta do tema (não usar cores hardcoded aleatórias)?

---

## 🚀 3. Processo de Verificação de Landing Page
*Aplicável para:** Páginas de Marketing, LP de Conversão, Site Institucional.*

> ⚠️ **Under Construction:** Este processo será detalhado na Sprint de Marketing.
>
> **Checklist Preliminar:**
> - [ ] Header Público (Sem Sidebar)?
> - [ ] Footer com links legais (Termos, Privacidade)?
> - [ ] Imagens otimizadas (Next/Image)?
> - [ ] SEO Tags (Title, Description, OG Image) presentes?

---

## 🧪 O Teste Final (Side-by-Side)
Abra a tela de referência (ex: Leads ou Dashboard) em uma aba e a **Nova Tela** em outra. Compare lado a lado:
- [ ] Tamanho da fonte.
- [ ] Espaçamentos (margins/paddings).
- [ ] Cores de borda e sombras.

**Qualquer diferença visual não intencional é um BUG.**
