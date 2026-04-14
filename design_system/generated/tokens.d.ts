// GENERATED — do not edit. Run `npm run build` in design_system/build/.
//
// TypeScript literal types of every semantic token name. Gives component
// authors autocomplete and compile-time safety when passing token names
// across component APIs (e.g. a <Text color="..." /> prop).

export type SemanticSurface =
  | "surface.base"
  | "surface.raised"
  | "surface.sunken"
  | "surface.overlay"
  | "surface.inverse";

export type SemanticText =
  | "text.primary"
  | "text.secondary"
  | "text.muted"
  | "text.inverse"
  | "text.link"
  | "text.disabled";

export type SemanticBorder =
  | "border.default"
  | "border.strong"
  | "border.subtle"
  | "border.focus";

export type SemanticAction =
  | "action.primary.bg"
  | "action.primary.bg-hover"
  | "action.primary.bg-active"
  | "action.primary.fg"
  | "action.secondary.bg"
  | "action.secondary.bg-hover"
  | "action.secondary.bg-active"
  | "action.secondary.fg"
  | "action.secondary.border"
  | "action.ghost.bg-hover"
  | "action.ghost.bg-active"
  | "action.ghost.fg"
  | "action.danger.bg"
  | "action.danger.bg-hover"
  | "action.danger.bg-active"
  | "action.danger.fg"
  | "action.disabled.bg"
  | "action.disabled.fg";

export type SemanticField =
  | "field.bg"
  | "field.bg-disabled"
  | "field.fg"
  | "field.placeholder"
  | "field.border"
  | "field.border-hover"
  | "field.border-focus"
  | "field.border-error";

export type SemanticFeedback =
  | "feedback.success.bg"
  | "feedback.success.border"
  | "feedback.success.fg"
  | "feedback.success.solid-bg"
  | "feedback.success.solid-fg"
  | "feedback.warning.bg"
  | "feedback.warning.border"
  | "feedback.warning.fg"
  | "feedback.warning.solid-bg"
  | "feedback.warning.solid-fg"
  | "feedback.danger.bg"
  | "feedback.danger.border"
  | "feedback.danger.fg"
  | "feedback.danger.solid-bg"
  | "feedback.danger.solid-fg"
  | "feedback.info.bg"
  | "feedback.info.border"
  | "feedback.info.fg"
  | "feedback.info.solid-bg"
  | "feedback.info.solid-fg"
  | "feedback.accent.bg"
  | "feedback.accent.border"
  | "feedback.accent.fg"
  | "feedback.accent.solid-bg"
  | "feedback.accent.solid-fg";

export type SemanticColorToken =
  | SemanticSurface
  | SemanticText
  | SemanticBorder
  | SemanticAction
  | SemanticField
  | SemanticFeedback;

export type SemanticRadius = "none" | "sm" | "md" | "lg" | "xl" | "full";
export type SemanticShadow = "sm" | "md" | "lg" | "xl" | "focus";
export type SemanticSpace =
  | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12 | 16 | 20 | 24;

export type SemanticFontSize =
  | "xs" | "sm" | "base" | "lg" | "xl" | "2xl" | "3xl" | "4xl";

export type SemanticFontWeight =
  | "regular" | "medium" | "semibold" | "bold";
