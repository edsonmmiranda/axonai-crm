# verify-design — convenção de shells

`scripts/verify-design.mjs` roda no GATE 5 (estático) e exige que toda página interna em `src/app/**/page.tsx` esteja envolta por um **shell** — um componente que define chrome (header, nav, slot de conteúdo).

Por padrão o único shell reconhecido é `AppLayout`. Projetos com áreas que precisam de chrome próprio (admin operacional, portal parceiro, modo embed, etc.) declaram shells adicionais via opt-in.

## Como registrar shells extras

Duas formas, uma só por projeto. Se as duas existirem, `verify-design.config.json` vence.

### Opção A — `package.json`

```json
{
  "verifyDesign": {
    "shells": ["AppLayout", "AdminShell"]
  }
}
```

### Opção B — `verify-design.config.json` na raiz

```json
{
  "shells": ["AppLayout", "AdminShell"]
}
```

## Regras

- Cada shell listado é um **identificador PascalCase** (`^[A-Z]\w*$`). Nomes inválidos são descartados com aviso no stderr.
- Lista vazia ou config malformada cai no default `["AppLayout"]` e emite warn.
- O verificador faz match por nome literal nas páginas e em layouts ancestrais — o componente precisa aparecer escrito assim no JSX (ex.: `<AdminShell>`). Wrappers que escondem o nome real do shell não são detectados; nesse caso, ou exponha o shell diretamente, ou registre o wrapper na config.
- Telas que **não** usam shell por design (login, MFA, unauthorized) devem ficar em route groups marcados como público: `(public)`, `(marketing)` ou `(auth)`. Esses grupos são invisíveis na URL no Next.js — `src/app/admin/(auth)/login/page.tsx` continua respondendo em `/admin/login`. Não crie regra de exclusão por path no script.

## Default permanece compatível

Projetos que só usam `AppLayout` não precisam de config. O default cobre o caso comum.

## Validação

Depois de registrar shells novos:

```bash
node scripts/verify-design.mjs
```

Esperado: `verify-design ✅ N arquivo(s) inspecionado(s), 0 violações.` Se ainda bater `missing-applayout`:

1. Confira se a página (ou um `layout.tsx` ancestor) referencia o shell pelo nome literal registrado.
2. Confira se a config foi salva no formato correto e o nome bate (PascalCase, sem typo).
3. Para telas auth/standalone, confira se estão dentro de route group `(auth)` e não diretamente sob o path real.

## Por que opt-in e não convenção implícita

O framework não pode hardcodar nomes de shells inventados pelos consumidores — isso vira acoplamento invertido (framework conhecendo nomes que ele não define nem documenta). Config opt-in mantém o framework neutro: cada projeto declara seus shells, e a validação é responsabilidade do consumidor. Doc histórica: este doc nasceu da decisão de evitar hardcode de `AdminShell` no script.
