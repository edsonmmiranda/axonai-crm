# Tokens — contrato de authoring

Tudo nesta pasta segue o [formato W3C Design Tokens Community Group](https://tr.designtokens.org/format/). Siga o formato mesmo onde parecer verboso — consistência é o que permite o step de build gerar CSS, Tailwind e TS a partir de uma única fonte.

## Arquivos

- **`primitives.json`** — valores crus. Sem significado semântico. Um arquivo, uma marca. Para adicionar uma segunda marca, crie `primitives.<brand>.json` ao lado e aponte o build para ele via flag de env (veja [`../build/README.md`](../build/README.md)).
- **`semantic.light.json`** — a API pública do design system. Componentes leem esses nomes; não leem primitivos.
- **`semantic.dark.json`** — mapeamento de dark mode. **Deve** ter o mesmo formato de chaves do arquivo light. Chave faltando é erro de build, não warning, porque um dark mode meio tematizado é pior que nenhum dark mode.

## Formato do token — mínimo

```json
{
  "color": {
    "blue": {
      "500": {
        "$value": "#137fec",
        "$type": "color",
        "$description": "Âncora da marca"
      }
    }
  }
}
```

- `$value` — o valor. Em primitivos: um literal. Em semânticos: uma referência como `{color.blue.500}`.
- `$type` — o que é: `color`, `dimension`, `fontFamily`, `fontWeight`, `number`, `shadow`, `duration`, `cubicBezier`. O build usa isso para escolher a transformação certa.
- `$description` — opcional mas encorajado. Aparece em docs gerados. Use para explicar *por que* um valor foi escolhido, especialmente para âncoras.

## Convenções de naming

**Primitivos** são nomeados pelo que são: `color.blue.500`, `space.4`, `radius.md`, `font.size.base`. Descrevem o valor, não seu uso. `color.brand.primary` está errado na camada primitiva — "brand" e "primary" são significados, não valores.

**Semânticos** são nomeados pelo que são usados, em um padrão curto `categoria.papel` ou `categoria.papel.estado`:

- `surface.base`, `surface.raised`, `surface.sunken`, `surface.overlay`
- `text.primary`, `text.secondary`, `text.muted`, `text.inverse`, `text.link`, `text.disabled`
- `border.default`, `border.strong`, `border.subtle`, `border.focus`
- `action.<variante>.<propriedade>` → `action.primary.bg`, `action.primary.bg-hover`, `action.primary.fg`
- `field.<propriedade>` → `field.bg`, `field.border-focus`, `field.placeholder`
- `feedback.<intent>.<propriedade>` → `feedback.success.bg`, `feedback.danger.solid-fg`

Evite nomear tokens por componentes (`button.primary.bg` é pior que `action.primary.bg`) porque múltiplos componentes compartilham o mesmo papel. Um botão primário, um link primário e um badge primário todos leem `action.primary.bg`.

## Como adicionar um novo token semântico

1. Pergunte: **um token semântico existente já significa isso?** A maioria das necessidades "novas" são tokens existentes disfarçados. Se um card precisa de um fundo, é `surface.raised`, não `card.bg`.
2. Se a necessidade é genuína, adicione o token em **ambos** `semantic.light.json` e `semantic.dark.json`, com o mesmo caminho de chaves.
3. Rode o build — se as chaves não baterem, o build falha com uma mensagem clara.
4. Documente o uso pretendido em [`../components/CONTRACT.md`](../components/CONTRACT.md) se o token muda como os componentes devem ser escritos.
5. Rode a checagem de contraste (veja [`../enforcement/rules.md`](../enforcement/rules.md)). Qualquer par de cores introduzido aqui que vai renderizar texto deve passar em WCAG AA.

## Como rebrandar (para um novo tenant / produto)

Edite `primitives.json`. A camada semântica permanece idêntica. Componentes permanecem idênticos. Só os valores hex de âncora mudam. O build regenera tudo downstream.

Se a nova marca precisa de *semânticas* diferentes (não só valores diferentes), essa é uma mudança maior e deve ser discutida — você está forkando o design system, não rebrandando.

## O que NÃO fazer

- **Não coloque valores hex em arquivos semânticos.** Tokens semânticos devem referenciar primitivos. `"$value": "#137fec"` em `semantic.light.json` significa que você esqueceu de adicionar um primitivo — adicione primeiro.
- **Não adicione tokens escopados por componente** (`"button": { "primary": { "bg": ... } }`). A camada semântica não é um registro de componentes. Se você se sentir tentado a fazer isso, geralmente significa que você quer um novo papel semântico — adicione no nível de papel.
- **Não "deprecie no lugar"** renomeando um token e deixando o antigo apontando para ele. Marque-o `$deprecated: true` no objeto do token, anuncie no changelog, mantenha por um ciclo de release, depois remova.
- **Não deixe os arquivos derivarem.** Se `semantic.light.json` tem uma chave que `semantic.dark.json` não tem (ou vice-versa), o build deve falhar. Não adicione uma válvula de escape para "vamos preencher depois" — "depois" nunca chega.
