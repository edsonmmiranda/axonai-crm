# Regras de enforcement

Um design system que não é enforçado por máquinas é um design system que deriva. Este arquivo é o conjunto consolidado de regras que mantém o código da aplicação alinhado com a camada de tokens. Toda regra aqui deve ser uma checagem automatizada — um erro de lint, um erro de build, ou uma falha de CI. **Se uma regra não pode ser automatizada, ela não pertence a este arquivo.** Diretrizes culturais vão em [`../components/CONTRACT.md`](../components/CONTRACT.md).

As checagens são feitas em camadas:

1. **Tempo de editor** — ESLint e Stylelint dão feedback instantâneo enquanto você digita.
2. **Pre-commit** — um hook roda lint nos arquivos em stage e bloqueia o commit em caso de erro.
3. **CI** — lint completo, checagem de paridade de chaves de token, checagem de contraste e checagem de "generated está fresco".
4. **Review** — `@guardian` roda as mesmas checagens como a dupla leitura humana.

---

## Regra 1 — Nenhum literal de cor crua em código de aplicação

**O quê:** `#...`, `rgb(...)`, `rgba(...)`, `hsl(...)`, `hsla(...)`, `oklch(...)`, `oklab(...)` são proibidos em qualquer arquivo sob `src/` e em qualquer arquivo `.css`, `.tsx`, `.ts` fora de `design_system/generated/`.

**Por quê:** O único lugar onde literais de cor podem existir é `design_system/tokens/primitives.json`. Tudo downstream consome tokens semânticos.

**Como (ESLint, via regra customizada ou `eslint-plugin-no-raw-colors`):**

```js
// eslint.config.mjs
import noRawColors from "./eslint/no-raw-colors.mjs";

export default [
  {
    files: ["src/**/*.{ts,tsx,js,jsx}"],
    plugins: { ds: { rules: { "no-raw-colors": noRawColors } } },
    rules: {
      "ds/no-raw-colors": "error",
    },
  },
];
```

Uma implementação mínima de `no-raw-colors` varre literais de string e valores de atributos JSX em busca das notações de cor proibidas e reporta cada ocorrência com uma sugestão para usar um token semântico.

**Como (Stylelint, para arquivos `.css`):**

```json
{
  "rules": {
    "color-no-hex": true,
    "declaration-property-value-disallowed-list": {
      "/^(color|background|border|fill|stroke)/": ["/rgb|rgba|hsl|hsla|oklch|oklab/"]
    }
  },
  "ignoreFiles": ["design_system/generated/**/*.css"]
}
```

---

## Regra 2 — Nenhum valor arbitrário do Tailwind

**O quê:** `p-[17px]`, `w-[350px]`, `bg-[#fff]`, `text-[14px]`, `rounded-[6px]` e similares são proibidos. Os únicos valores aceitos são as escalas nomeadas declaradas em `generated/tailwind.tokens.ts`.

**Por quê:** Valores arbitrários são uma válvula de escape que, uma vez aceita, destrói o sistema. Um design system com paddings de 17px não é um design system.

**Como (ESLint, via `eslint-plugin-tailwindcss`):**

```js
{
  plugins: { tailwindcss },
  rules: {
    "tailwindcss/no-custom-classname": "error",
    "tailwindcss/no-arbitrary-value": "error",
    "tailwindcss/classnames-order": "warn",
  },
  settings: {
    tailwindcss: {
      config: "tailwind.config.ts",
      whitelist: [],
    },
  },
}
```

A regra `no-arbitrary-value` pega `bg-[#...]`, `p-[17px]`, `w-[350px]`, etc. sem exceções. Se você se pegar querendo uma exceção, a resposta é adicionar um token, não enfraquecer a regra.

---

## Regra 3 — Nenhuma classe primitiva de cor em componentes

**O quê:** Classes Tailwind como `bg-blue-500`, `text-neutral-900`, `border-red-500` são proibidas em `src/`. Componentes devem referenciar classes semânticas: `bg-action-primary`, `text-text-primary`, `border-field-border-error`.

**Por quê:** Primitivos existem para que a camada semântica possa referenciá-los. Se componentes consomem primitivos diretamente, rebranding vira uma operação de rename em centenas de arquivos, e dark mode se torna impossível.

**Como:** Regra ESLint customizada `ds/no-primitive-color-classes` que casa atributos `className` contra uma lista de regex:

```js
const PRIMITIVE_COLOR_CLASS_REGEX = /\b(bg|text|border|ring|fill|stroke|outline|divide|placeholder)-(blue|neutral|green|amber|red)-\d{2,3}\b/;
```

Qualquer match é um erro com a mensagem: *"Classes primitivas de cor são proibidas em código de aplicação. Use um token semântico (ex.: bg-action-primary, text-text-primary)."*

---

## Regra 4 — Paridade de chaves de tokens semânticos

**O quê:** Toda chave em `tokens/semantic.light.json` deve existir em `tokens/semantic.dark.json`, e vice-versa.

**Por quê:** Um token de dark mode faltando silenciosamente cai de volta no valor light, produzindo combinações inacessíveis. Um dark mode meio-tematizado é pior que nenhum dark mode, porque usuários confiam no toggle.

**Como:** `npm run check` em `design_system/build/`. O script driver em [`../build/build.mjs`](../build/build.mjs) caminha ambas as árvores JSON e sai com código não-zero em qualquer mismatch. CI roda isso em todo PR que toca `design_system/tokens/`.

---

## Regra 5 — Contraste AA em todo par semântico

**O quê:** Todo par foreground/background semântico que realmente renderiza texto (veja o array `PAIRS` em [`../build/contrast-check.mjs`](../build/contrast-check.mjs)) deve ter razão de contraste de pelo menos 4.5:1, tanto para tema light quanto dark.

**Por quê:** Conformidade com WCAG AA é o básico. Enforçar isso no nível do token significa que nenhum componente pode jamais entrar em produção com uma combinação inacessível, porque a combinação não existe no conjunto de tokens.

**Como:** `npm run contrast` em `design_system/build/`. Lê os primitivos e ambos os arquivos semânticos, resolve cada par, calcula a razão de luminância e sai com código não-zero em qualquer falha. CI roda isso em todo PR que toca `design_system/tokens/` ou `design_system/build/contrast-check.mjs`.

**Se você está adicionando um novo par de cores ao design system**, adicione-o ao `PAIRS` em `contrast-check.mjs`. A checagem é tão completa quanto a lista de pares.

---

## Regra 6 — `generated/` está sempre fresco

**O quê:** Commitar uma mudança em `design_system/tokens/` sem rebuildar `design_system/generated/` é proibido.

**Por quê:** Arquivos generated velhos significam que o código rodando não bate com a fonte de tokens. Isso leva ao pior tipo de bug de DS: *"Eu mudei o token mas nada mudou na UI."*

**Como:** Step de CI que roda o build e falha se `git diff --exit-code` reportar mudanças depois:

```yaml
- name: Verify design system is built
  run: |
    cd design_system/build
    npm ci
    npm run build
    cd ../..
    git diff --exit-code design_system/generated/
```

A mensagem de erro deve direcionar o contribuinte a rodar `npm run build` localmente e commitar a saída.

---

## Regra 7 — Ícones são Lucide apenas

**O quê:** `import { ... } from "lucide-react"` é a única fonte de ícones permitida. Imports customizados de SVG em componentes (além de brand marks e ilustrações em `src/assets/` dedicado) são proibidos.

**Por quê:** Misturar bibliotecas de ícones produz inconsistência visual (larguras de stroke diferentes, raios de canto diferentes, metáforas diferentes para o mesmo conceito). SVGs customizados são uma porta de entrada comum para a segunda biblioteca de ícones, depois a terceira.

**Como:** Regra ESLint customizada que sinaliza `import` statements para qualquer pacote de ícones exceto `lucide-react`, e sinaliza imports `.svg` dentro de `src/components/` (permitido em `src/assets/` para assets de marca/ilustração).

---

## Regra 8 — Visibilidade de foco

**O quê:** Todo elemento interativo deve ter um estado de foco visível usando `shadow-focus` ou um ring semântico equivalente. Remover contornos de foco sem substituí-los é proibido.

**Por quê:** Usuários de teclado e de tecnologias assistivas não podem navegar sem indicadores de foco. Isso é uma regressão de acessibilidade esperando para acontecer.

**Como:** Regra ESLint que sinaliza `outline-none` sem uma classe `focus-visible:` no mesmo elemento. Isso é uma heurística — o checklist de review do Guardian faz a dupla checagem tabulando manualmente pelo PR.

---

## Hook de pre-commit

O hook mínimo de pre-commit, instalado via Husky ou lefthook:

```sh
#!/bin/sh
# .husky/pre-commit
npx lint-staged
```

Com config `lint-staged`:

```json
{
  "lint-staged": {
    "src/**/*.{ts,tsx}": ["eslint --max-warnings=0", "prettier --write"],
    "src/**/*.css":      ["stylelint --max-warnings=0"],
    "design_system/tokens/**/*.json": ["node design_system/build/build.mjs --check"]
  }
}
```

Isso pega as regras 1, 2, 3 e 4 antes de um commit aterrissar. Regras 5 e 6 rodam no CI.

---

## O que o agente Guardian checa (além do lint)

`@guardian` roda toda a suíte lint/stylelint/build-check, mas também faz uma passagem manual que checagens automatizadas não conseguem cobrir:

1. **Composição antes de reinvenção** — esse PR introduz um componente que poderia ter sido composto a partir de componentes DS existentes?
2. **Intenção semântica** — o PR usa um token semântico tecnicamente válido para seu significado real? `bg-feedback-danger-bg` num dialog de confirmação é lint-clean mas semanticamente errado.
3. **Cobertura de interação** — o componente trata todos os estados (default, hover, active, focus, disabled, loading, error)?
4. **Paridade de dark mode** — togglar `data-theme="dark"` no `<html>` produz um resultado sensato, ou algo desaparece?

Essas são preocupações de tempo de review e não podem ser totalmente automatizadas, mas o checklist do Guardian em `agents/quality/guardian.md` as codifica em um gate sim/não.
