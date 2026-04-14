# Anti-padrões

Coisas que parecem razoáveis e não são. Cada entrada tem o cheiro, um exemplo concreto errado, a razão pela qual está errado e a alternativa certa. Se você é um agente de IA revisando um PR, esta é a lista de coisas para sinalizar mesmo quando as regras de lint não pegam.

---

## 1. O "só esse um hex"

**O cheiro:** um único literal hex em um único lugar, justificado como "o designer escolheu exatamente essa cor e ela ainda não está na nossa paleta".

**Errado:**
```tsx
<div className="bg-[#f0f9ff] border-[#0ea5e9]">
  <span style={{ color: "#0369a1" }}>Dica pro</span>
</div>
```

**Por que está errado:** um literal hex nunca é um único literal hex. Seis meses depois são trinta, espalhados por dez componentes, nenhum dos quais atualiza quando a marca muda. O design system tem zero conhecimento de que essa cor existe. Dark mode está quebrado. Rebranding está quebrado. A regra do linter que você desabilitou para fazer passar está desabilitada em outros lugares também, porque desabilitações se propagam.

**Certo:** ou use um token semântico existente (`bg-feedback-info-bg text-feedback-info-fg border-feedback-info-border`) ou, se a necessidade é genuína e nova, adicione um primitivo e um token semântico ao DS, rebuilde e entregue como PR separado antes do PR da feature.

---

## 2. A promessa "dark mode é fase 2"

**O cheiro:** um PR que hard-coda cores de modo light com um comentário dizendo "vamos adicionar dark mode depois".

**Errado:**
```tsx
// TODO: dark mode
<div className="bg-white text-slate-900">
```

**Por que está errado:** "depois" nunca chega, e todo componente escrito entre agora e "depois" precisa ser reescrito retroativamente. Retrofitar dark mode numa codebase que o ignorou é dez vezes mais trabalho do que escrever corretamente desde o começo. Pior, o comentário "TODO" dá falso conforto — o revisor concorda, o PR entra e a dívida se acumula.

**Certo:** use tokens semânticos desde o começo. `bg-surface-raised text-text-primary`. Dark mode chega de graça no dia que alguém adiciona `data-theme="dark"` ao `<html>`. O custo de escrever corretamente na primeira vez é zero; o custo de escrever errado é tudo.

---

## 3. O token escopado por componente

**O cheiro:** adicionar tokens nomeados por componentes na camada semântica. `button.primary.bg`, `card.shadow`, `sidebar.width`.

**Errado (em `semantic.light.json`):**
```json
{
  "button": {
    "primary": { "bg": { "$value": "{color.blue.500}" } }
  },
  "card": {
    "bg": { "$value": "{color.neutral.0}" }
  }
}
```

**Por que está errado:** a camada semântica é sobre *papéis* (surface, text, action, feedback), não sobre *componentes*. Um botão primário, um link primário e um badge primário compartilham o mesmo papel — se cada um tem seu próprio token, você tem três lugares para atualizar quando a marca muda, e eles vão derivar. Pior, um novo componente "panel" vai reutilizar `card.bg` e agora `card.bg` secretamente significa "qualquer surface elevada", ponto em que o nome é uma mentira.

**Certo:** nomeie tokens por papel. `action.primary.bg` (usado por botões, links, badges), `surface.raised` (usado por cards, panels, dialogs). Componentes compõem esses. Preocupações escopadas por componente (padding de botão, raio de borda de card) vivem na config `cva` do próprio componente, não na camada de tokens.

---

## 4. O valor arbitrário "é só spacing"

**O cheiro:** `p-[14px]`, `gap-[18px]`, `w-[342px]`. Sempre justificado como "o mockup do design diz 14, e 12 ou 16 parece errado".

**Errado:**
```tsx
<div className="grid grid-cols-2 gap-[18px] p-[14px]">
```

**Por que está errado:** o mockup do design é uma figura, não uma restrição. Um padding de 14px num lugar e um padding de 12px noutro lugar não parecem "mais precisos" para um usuário — parecem inconsistentes. O design system existe precisamente para que essas micro-decisões sejam pré-feitas e compartilhadas. Se o design genuinamente precisa de valores que a escala não provê, a escala está errada e deveria mudar — discuta com o designer. Se os valores são arbitrários ("14 pareceu certo"), o conserto é snapar para a escala e seguir em frente.

**Certo:** `gap-4 p-3` (ou `gap-5 p-4`, o que estiver mais próximo). Se você está prestes a escrever um valor arbitrário, pare e pergunte: "isso é realmente diferente do valor mais próximo na escala de alguma forma que o usuário possa perceber?" A resposta é quase sempre não.

---

## 5. O primitivo no nível do componente

**O cheiro:** um componente que referencia cores primitivas porque o nome semântico "parece muito abstrato".

**Errado:**
```tsx
<span className="text-blue-600">Ver detalhes</span>
```

**Por que está errado:** `text-blue-600` significa "isso é sempre azul". `text-text-link` significa "isso é um link". O primeiro silenciosamente amarra o componente a uma decisão de marca que vai mudar. O segundo participa do design system — se a marca move de azul para teal, todo link no app atualiza; os hard-codes de azul não.

Essa é a violação mais comum na prática, porque classes primitivas parecem limpas e familiares. Elas são o pior tipo de atalho: invisível em tempo de review, catastrófico em tempo de rebrand.

**Certo:** `text-text-link`. Sempre. Se o nome semântico não existe, adicione-o antes de escrever o componente.

---

## 6. O removedor de outline de foco

**O cheiro:** `outline-none` sem substituto, porque "o outline padrão é feio".

**Errado:**
```tsx
<button className="outline-none bg-action-primary text-action-primary-fg ...">
```

**Por que está errado:** usuários de teclado e de leitores de tela dependem do outline de foco para saber onde estão. Removê-lo silenciosamente quebra acessibilidade para uma fração significativa de usuários — e a quebra é invisível para usuários de mouse que enxergam, então entra em produção.

**Certo:** `outline-none focus-visible:outline-none focus-visible:shadow-focus`. Isso substitui o default do browser pelo ring de foco do design system (que faz parte da camada de tokens e passa no contraste). A regra: se você remove um outline, você substitui na mesma linha. Sem exceções.

---

## 7. A prop `style` inline como válvula de escape

**O cheiro:** usar `style={{ color: ..., padding: ... }}` porque "o Tailwind não suporta isso".

**Errado:**
```tsx
<div style={{ backgroundColor: "#f6f7f8", padding: "14px" }}>
```

**Por que está errado:** `style` é uma porta dos fundos para toda regra de lint, toda regra de design system e todo mecanismo de theming. Um `style={{ color: "#..." }}` não é pego pela regra de lint do Tailwind. Não é responsivo a dark mode. Não pode ser sobrescrito por uma classe CSS. E quase nunca é realmente necessário — os casos em que o Tailwind verdadeiramente não consegue expressar um valor são raros e específicos (valores dinâmicos de runtime, animações).

**Certo:** `className="bg-surface-base p-4"` para valores estáticos. Para valores genuinamente dinâmicos (ex.: largura de uma progress bar dirigida por estado), use `style` *apenas* para a propriedade dinâmica e mantenha tudo mais em classes. E o valor dinâmico deve ser uma unidade que já existe na escala — `style={{ width: \`${percent}%\` }}` é aceitável; `style={{ width: "342px" }}` não é.

---

## 8. O componente customizado "temporário"

**O cheiro:** um componente nomeado `TempButton` ou `MyCard` ou `FastDialog` numa pasta de feature, criado porque "o botão do DS não suporta a variante X e eu preciso entregar hoje".

**Errado:** `src/features/leads/components/LeadActionButton.tsx` que é um botão hand-rolled.

**Por que está errado:** "temporário" é o adjetivo de vida mais longa em software. O componente entra, outras features copiam ele, uma segunda variante aparece, agora você tem dois sistemas de botão. O botão do DS nunca cresce a feature que você precisou, porque a válvula de escape existe.

**Certo:** ou estenda o botão do DS (adicione uma variante, entregue como PR do DS) ou componha o que você precisa a partir das variantes existentes. Se você não pode esperar por um PR do DS, o movimento certo é uma escalação comentada no PR da feature — "isso está bloqueado numa mudança do DS, rastreado em [ticket]" — não uma implementação paralela que vai durar mais que a semana.

---

## 9. A segunda biblioteca de ícones

**O cheiro:** `import { FaWhatsapp } from "react-icons/fa"` porque "o Lucide não tem um ícone de WhatsApp".

**Errado:**
```tsx
import { FaWhatsapp } from "react-icons/fa";
import { Send } from "lucide-react";
```

**Por que está errado:** as duas bibliotecas têm larguras de stroke diferentes, convenções de viewbox diferentes e metáforas diferentes. Misturá-las produz UI visualmente dissonante que nenhuma quantidade de CSS vai consertar. Uma exceção vira duas, depois três; o bundle cresce, a consistência morre.

**Certo:** logos de marca (WhatsApp, Slack, Google) são *assets*, não *ícones*. Eles vivem em `src/assets/brands/` como arquivos SVG, importados individualmente. Todo o resto é Lucide. A regra: se é um glifo representando uma ação ou objeto, é um ícone Lucide. Se é o logo registrado de uma empresa, é um asset.

---

## 10. A opacidade em semântica que não existe

**O cheiro:** `bg-action-primary/50` que renderiza como cor sólida, e então um workaround com `bg-action-primary opacity-50`.

**Errado:**
```tsx
<div className="bg-action-primary opacity-50">
```

**Por que está errado:** `opacity-50` afeta o elemento inteiro e todos os seus descendentes, incluindo o texto em cima, que fica mais difícil de ler. Também quebra stacking de formas inesperadas. A coisa certa é `bg-action-primary/50` — mas se isso renderiza sólido, a variável CSS está armazenando um valor hex em vez de canais RGB. O conserto real é rebuildar o design system.

**Certo:** garanta que o build está atualizado. As variáveis de cor baseadas em canal (veja [`../build/README.md`](../build/README.md)) fazem `bg-action-primary/50` funcionar corretamente. Se não funcionar, o bug está no pipeline de build, não no seu componente.

---

## 11. O "o agente disse que estava ok"

**O cheiro:** um PR que passa no review do `@guardian` mas viola uma das regras acima de forma sutil — ex.: usa `bg-slate-50` em vez de `bg-surface-sunken` porque os dois por acaso parecem idênticos.

**Errado:** tomar a aprovação do agente como absolvição.

**Por que está errado:** agentes enforçam bem regras baseadas em padrão. Eles erram em violações *semânticas*: usar um token sintaticamente válido para um significado para o qual não foi desenhado. `bg-slate-50` não está na lista de primitivos banidos se slate não está na paleta; `border-feedback-success-border` num alert de erro é lint-clean mas catastroficamente errado.

**Certo:** o revisor humano é a última linha de defesa para correção semântica. O agente checa a letra das regras; o humano checa o espírito. Ambos são obrigatórios; nenhum é suficiente sozinho.
