#!/usr/bin/env bash
# Sincroniza o projeto atual com a versão COMPLETA do axonai-framework,
# incluindo telas_prontas (mockups/protótipos de referência).
#
# Uso (dentro de um projeto derivado do template):
#   bash scripts/update-framework-complete.sh              # pega o branch main
#   bash scripts/update-framework-complete.sh v1.2.0       # pega uma tag/branch específica
#
# Diferença para update-framework.sh:
#   - update-framework.sh       → NÃO sincroniza design_system/telas_prontas/
#   - update-framework-complete → SOBRESCREVE design_system/telas_prontas/ com a versão do framework
#
# ⚠️  Se o projeto filho customizou mockups em telas_prontas/, eles serão sobrescritos.
#     Revise o git diff antes de commitar.

set -euo pipefail

FRAMEWORK_REPO="https://github.com/edsonmmiranda/axonai-framework.git"
REF="${1:-main}"

# ──────────────────────────────────────────────────────────────────────────────
# Pastas/arquivos que o framework é dono (serão sobrescritos a cada update)
# ──────────────────────────────────────────────────────────────────────────────
FRAMEWORK_PATHS=(
  "agents"
  "docs/conventions"
  "docs/templates"
  "design_system/build"
  "design_system/components"
  "design_system/docs"
  "design_system/enforcement"
  "design_system/generated"
  "design_system/telas_prontas"
  "design_system/tokens"
  "design_system/README.md"
  ".agent"
  "CLAUDE.md"
  "AGENTS.md"
  "scripts/verify-design.mjs"
  "scripts/update-framework.sh"
  "scripts/update-framework-complete.sh"
  "docs/templates/sprints/TEMPLATE_SPRINT_LIGHT.md"
  "docs/templates/sprints/TEMPLATE_SPRINT_STANDARD.md"
  "docs/APRENDIZADOS_FORMATO.md"
)

# ──────────────────────────────────────────────────────────────────────────────
# Pastas protegidas (NUNCA tocadas — apenas referência/documentação)
# ──────────────────────────────────────────────────────────────────────────────
# sprints/active/, sprints/done/ — sprints do projeto
# prds/ — PRDs gerados pelo @spec-writer (artefato de trabalho)
# src/, app/, public/, components/ — código da aplicação
# docs/APRENDIZADOS.md, docs/stack.md, docs/schema_snapshot.json
# supabase/migrations/ (exceto bootstrap inicial)
# .env*, package.json, package-lock.json, pnpm-lock.yaml

# ──────────────────────────────────────────────────────────────────────────────

# Confere que estamos num repo git
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "❌ Este diretório não é um repositório git."
  exit 1
fi

PROJECT_ROOT="$(git rev-parse --show-toplevel)"
cd "$PROJECT_ROOT"

# Aviso se houver mudanças não commitadas
if ! git diff-index --quiet HEAD -- 2>/dev/null; then
  echo "⚠️  Há mudanças não commitadas no projeto."
  echo "    Recomendado: commit ou stash antes de sincronizar."
  read -rp "Continuar mesmo assim? [y/N] " ans
  [[ "$ans" =~ ^[Yy]$ ]] || { echo "Cancelado."; exit 1; }
fi

# ──────────────────────────────────────────────────────────────────────────────
# Migrações one-shot do layout do framework
# Cada bloco é idempotente: só roda se o estado antigo existir.
# ──────────────────────────────────────────────────────────────────────────────

# 2026-04-16: mover PRDs de docs/prds/ para prds/ (artefato de trabalho no root)
if [[ -d "$PROJECT_ROOT/docs/prds" ]]; then
  echo "🔀 Migração: docs/prds/ → prds/"
  mkdir -p "$PROJECT_ROOT/prds"
  shopt -s nullglob dotglob
  for f in "$PROJECT_ROOT/docs/prds/"*; do
    name="$(basename "$f")"
    if git ls-files --error-unmatch "docs/prds/$name" >/dev/null 2>&1; then
      git mv "docs/prds/$name" "prds/$name"
    else
      mv "$f" "$PROJECT_ROOT/prds/$name"
    fi
    echo "   ✅ $name"
  done
  shopt -u nullglob dotglob
  rmdir "$PROJECT_ROOT/docs/prds" 2>/dev/null || true
fi

TMP_DIR="$(mktemp -d -t framework-sync-XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "📥 Clonando framework ($REF)..."
git clone --depth 1 --branch "$REF" "$FRAMEWORK_REPO" "$TMP_DIR" >/dev/null 2>&1

echo "🔄 Sincronizando pastas do framework (modo completo — inclui telas_prontas)..."
for path in "${FRAMEWORK_PATHS[@]}"; do
  src="$TMP_DIR/$path"
  dst="$PROJECT_ROOT/$path"

  if [[ ! -e "$src" ]]; then
    echo "   ⏭️  $path (não existe no framework, pulando)"
    continue
  fi

  mkdir -p "$(dirname "$dst")"

  if [[ -d "$src" ]]; then
    rm -rf "$dst"
    cp -r "$src" "$dst"
  else
    cp "$src" "$dst"
  fi
  echo "   ✅ $path"
done

echo ""
echo "✨ Sync completo concluído. Revise as mudanças:"
echo ""
cd "$PROJECT_ROOT"
git status --short

echo ""
echo "Próximos passos:"
echo "  git diff              # ver o que mudou em detalhe"
echo "  git add <paths>       # selecionar o que quer manter"
echo "  git commit -m 'chore: sync framework updates (complete)'"
