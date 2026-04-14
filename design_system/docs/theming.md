# Theming

O design system suporta três tipos de theming, todos construídos sobre a mesma arquitetura de tokens:

1. **Modo light / dark** — dois mapeamentos semânticos sobre um único conjunto de primitivos.
2. **Multi-brand** — dois (ou mais) conjuntos de primitivos mapeados pela mesma camada semântica.
3. **Accent por tenant** — overrides de variável CSS em runtime, escopados a um container, para casos whitelabel onde só alguns poucos valores diferem.

Cada um deles custa quase nada de adicionar *se a arquitetura de três camadas for respeitada*. Eles se tornam caros ou impossíveis se componentes consomem primitivos diretamente.

---

## Modo light / dark

### Como está conectado

O `variables.css` gerado emite dois blocos:

```css
:root {
  /* primitivos + tokens semânticos light */
  --ds-surface-base: var(--ds-color-neutral-50);
  --ds-text-primary: var(--ds-color-neutral-900);
  /* ... */
}

[data-theme="dark"] {
  /* tokens semânticos dark — primitivos são herdados de :root */
  --ds-surface-base: var(--ds-color-neutral-950);
  --ds-text-primary: var(--ds-color-neutral-50);
  /* ... */
}
```

Primitivos vivem só em `:root` — dark mode **não** os re-declara. Isso é deliberado: a paleta primitiva é invariante ao tema, e dark mode é puramente um remapeamento de *qual primitivo um dado papel semântico aponta*.

### Como a aplicação troca

Três linhas de código:

```tsx
// src/components/theme-provider.tsx
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}
```

Sem resolução de tokens em runtime, sem recálculo de cores em JavaScript. A cascata do CSS faz todo o trabalho.

### Como suportar preferência "system"

```tsx
useEffect(() => {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const resolved = theme === "system" ? (mq.matches ? "dark" : "light") : theme;
  document.documentElement.dataset.theme = resolved;
  // re-rodar quando mq mudar
}, [theme]);
```

### Regras para adicionar suporte a dark mode a um componente

Você não adiciona. Todo componente que consome tokens semânticos ganha dark mode automaticamente. Se togglar `data-theme="dark"` muda o fundo da página mas não o seu componente, seu componente está referenciando um primitivo em algum lugar — vá encontrá-lo.

---

## Multi-brand

### O cenário

Você entrega o framework para dois clientes. Cliente A usa azul (`#137fec`). Cliente B usa verde e quer seu primário em `#16a34a`. Todo o resto — spacing, tipografia, raios, formas de componente — permanece idêntico.

### O jeito errado

Forkar a codebase. Rebuildar o design system. Manter dois repos divergentes. (Isso é o que acontece quando componentes consomem primitivos diretamente — você não tem escolha.)

### O jeito certo

Adicionar um segundo arquivo de primitivos:

```
design_system/tokens/
├── primitives.json          # default / brand-a
├── primitives.brand-b.json  # overrides de brand-b — mesmo formato, valores diferentes
├── semantic.light.json
└── semantic.dark.json
```

`primitives.brand-b.json` só precisa redefinir as cores que mudam. O pipeline de build é parametrizado por brand:

```bash
BRAND=brand-b npm run build
```

O driver carrega `primitives.json` como base e faz shallow-merge de `primitives.${BRAND}.json` por cima antes de alimentar o Style Dictionary.

### Opções de output

Dois modelos de deployment:

**A. Um build por brand, bundles de CSS diferentes.** Cada tenant carrega um `variables.css` diferente. Payload de CSS menor, runtime mais simples. Preferido quando brands são deployados em domínios separados.

**B. Build único, múltiplos escopos `[data-brand="..."]`.** Todos os brands vivem num único arquivo CSS, selecionados em runtime por um atributo data no `<html>`. CSS maior, mas suporta um único deployment servindo múltiplos brands (ex.: um SaaS multi-tenant com theming por conta).

O build suporta ambos. A escolha pertence ao projeto que está fazendo o deploy, não ao design system.

### Regras para um segundo brand

1. O segundo brand **deve** ter o mesmo formato de chaves do primeiro — você sobrescreve valores, não adiciona nem remove chaves. Tokens semânticos específicos de brand são um cheiro ruim; se brand B precisa de uma cor "loyalty gold", pergunte se brand A também precisa.
2. A checagem de contraste (`npm run contrast`) roda contra todo brand. Um brand que falha em AA é rejeitado em tempo de build, igual ao brand primário.
3. A camada semântica nunca referencia um nome de brand. Sem `action.primary.bg-brand-b`. Nunca.

---

## Overrides de accent por tenant

### O cenário

Você tem 500 tenants whitelabel. Cada um quer "a cor do nosso logo" como cor do botão primário. Todo o resto é idêntico. Criar 500 arquivos `primitives.*.json` e 500 bundles de CSS é absurdo.

### A solução

Um override de variável CSS escopado ao container do tenant:

```tsx
// Carrega a cor de brand do usuário a partir do perfil, aplica como style inline
// no root do app. Como é uma variável CSS, todo componente que referencia
// `--ds-action-primary-bg` reflete a mudança instantaneamente.
<div
  style={{
    "--ds-action-primary-bg": hexToRgbChannels(tenant.primaryColor),
    "--ds-action-primary-bg-hover": hexToRgbChannels(darken(tenant.primaryColor, 0.08)),
    "--ds-action-primary-bg-active": hexToRgbChannels(darken(tenant.primaryColor, 0.16)),
  } as CSSProperties}
>
  <App />
</div>
```

### Regras para accents em runtime

1. **Apenas as variáveis listadas num conjunto "overridável por tenant" documentado podem ser sobrescritas em runtime.** Overrides arbitrários de variáveis viram pesadelo de debug. O conjunto deve ser pequeno: background primário, hover primário, active primário, ring de foco. Talvez preenchimento do logo.
2. **Contraste não pode ser enforçado em tempo de build para accents de runtime** — o tenant pode escolher `#ffff00`. Portanto a aplicação deve validar a cor escolhida no momento do input (painel admin, configurações do tenant) e rejeitar cores que falhariam em AA contra `action.primary.fg`. Um helper de contraste em runtime vive em `src/lib/design-system/contrast.ts`.
3. **Valores derivados (hover, active) devem ser computados a partir da base**, não pegos do tenant. Caso contrário, você está pedindo para o tenant ser um designer.

---

## Adicionando um novo tema (alto contraste, impressão, etc.)

Mesmo padrão do dark mode: um novo arquivo `semantic.<name>.json`, um novo seletor no CSS gerado. O checklist:

1. Criar `tokens/semantic.<name>.json` com o mesmo formato de chaves dos outros arquivos semânticos.
2. Atualizar `design_system/build/build.mjs` para iterar sobre o novo tema além de light/dark.
3. Atualizar o seletor: `[data-theme="<name>"]` é appendado ao `variables.css` junto de `:root` e `[data-theme="dark"]`.
4. Estender `PAIRS` em `contrast-check.mjs` — todo par precisa ser checado contra o novo tema.
5. Documentar o uso pretendido do tema neste arquivo.

Alto contraste e impressão são os próximos temas óbvios. Ambos são aditivos; nenhum quebra nada que já existe.

---

## Erros comuns e seus sintomas

| Sintoma | Quase certamente causado por |
|---|---|
| Componente não responde a `data-theme="dark"` | Componente referencia um primitivo (`bg-blue-500`) em vez de um token semântico. |
| Texto do botão fica ilegível em dark mode | `text-white` hard-coded em vez de `text-action-primary-fg`. |
| Build de brand B "funciona" mas parece estranho | Camada semântica foi editada em vez de primitivos. Dark mode agora está quebrado em brand A. |
| Override de accent em runtime só muda o fundo do botão, estado hover continua azul | Estado hover referencia `action-primary-bg-hover` que ainda está apontando para o primitivo default. Solução: sobrescrever hover também, ou fazer hover derivar da base via `color-mix()`. |
| `bg-action-primary/50` renderiza cor sólida, sem transparência | Variável CSS armazena um literal hex em vez de canais RGB. Rebuilde — a transformação de canais deve consertar isso. |
