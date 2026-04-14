// GENERATED — do not edit. Run `npm run build` in design_system/build/.
//
// Tailwind theme extension that exposes the semantic design tokens as
// Tailwind class names. Consumers import this from their tailwind.config.ts:
//
//     import type { Config } from "tailwindcss";
//     import { themeExtend } from "@/../design_system/generated/tailwind.tokens";
//
//     const config: Config = {
//       content: ["./src/**/*.{ts,tsx}"],
//       theme: themeExtend,
//     };
//     export default config;
//
// All color classes use `rgb(var(--ds-...) / <alpha-value>)` so that opacity
// modifiers (e.g. `bg-action-primary/50`) work correctly.

import type { Config } from "tailwindcss";

export const themeExtend: Config["theme"] = {
  extend: {
    colors: {
      surface: {
        base:    "rgb(var(--ds-surface-base) / <alpha-value>)",
        raised:  "rgb(var(--ds-surface-raised) / <alpha-value>)",
        sunken:  "rgb(var(--ds-surface-sunken) / <alpha-value>)",
        overlay: "rgb(var(--ds-surface-overlay) / <alpha-value>)",
        inverse: "rgb(var(--ds-surface-inverse) / <alpha-value>)",
      },
      text: {
        primary:   "rgb(var(--ds-text-primary) / <alpha-value>)",
        secondary: "rgb(var(--ds-text-secondary) / <alpha-value>)",
        muted:     "rgb(var(--ds-text-muted) / <alpha-value>)",
        inverse:   "rgb(var(--ds-text-inverse) / <alpha-value>)",
        link:      "rgb(var(--ds-text-link) / <alpha-value>)",
        disabled:  "rgb(var(--ds-text-disabled) / <alpha-value>)",
      },
      border: {
        DEFAULT: "rgb(var(--ds-border-default) / <alpha-value>)",
        strong:  "rgb(var(--ds-border-strong) / <alpha-value>)",
        subtle:  "rgb(var(--ds-border-subtle) / <alpha-value>)",
        focus:   "rgb(var(--ds-border-focus) / <alpha-value>)",
      },
      action: {
        primary: {
          DEFAULT: "rgb(var(--ds-action-primary-bg) / <alpha-value>)",
          hover:   "rgb(var(--ds-action-primary-bg-hover) / <alpha-value>)",
          active:  "rgb(var(--ds-action-primary-bg-active) / <alpha-value>)",
          fg:      "rgb(var(--ds-action-primary-fg) / <alpha-value>)",
        },
        secondary: {
          DEFAULT: "rgb(var(--ds-action-secondary-bg) / <alpha-value>)",
          hover:   "rgb(var(--ds-action-secondary-bg-hover) / <alpha-value>)",
          active:  "rgb(var(--ds-action-secondary-bg-active) / <alpha-value>)",
          fg:      "rgb(var(--ds-action-secondary-fg) / <alpha-value>)",
          border:  "rgb(var(--ds-action-secondary-border) / <alpha-value>)",
        },
        ghost: {
          hover:  "rgb(var(--ds-action-ghost-bg-hover) / <alpha-value>)",
          active: "rgb(var(--ds-action-ghost-bg-active) / <alpha-value>)",
          fg:     "rgb(var(--ds-action-ghost-fg) / <alpha-value>)",
        },
        danger: {
          DEFAULT: "rgb(var(--ds-action-danger-bg) / <alpha-value>)",
          hover:   "rgb(var(--ds-action-danger-bg-hover) / <alpha-value>)",
          active:  "rgb(var(--ds-action-danger-bg-active) / <alpha-value>)",
          fg:      "rgb(var(--ds-action-danger-fg) / <alpha-value>)",
        },
        disabled: {
          DEFAULT: "rgb(var(--ds-action-disabled-bg) / <alpha-value>)",
          fg:      "rgb(var(--ds-action-disabled-fg) / <alpha-value>)",
        },
      },
      field: {
        DEFAULT:      "rgb(var(--ds-field-bg) / <alpha-value>)",
        disabled:     "rgb(var(--ds-field-bg-disabled) / <alpha-value>)",
        fg:           "rgb(var(--ds-field-fg) / <alpha-value>)",
        placeholder:  "rgb(var(--ds-field-placeholder) / <alpha-value>)",
        border:       "rgb(var(--ds-field-border) / <alpha-value>)",
        "border-hover": "rgb(var(--ds-field-border-hover) / <alpha-value>)",
        "border-focus": "rgb(var(--ds-field-border-focus) / <alpha-value>)",
        "border-error": "rgb(var(--ds-field-border-error) / <alpha-value>)",
      },
      feedback: {
        success: {
          bg:         "rgb(var(--ds-feedback-success-bg) / <alpha-value>)",
          border:     "rgb(var(--ds-feedback-success-border) / <alpha-value>)",
          fg:         "rgb(var(--ds-feedback-success-fg) / <alpha-value>)",
          "solid-bg": "rgb(var(--ds-feedback-success-solid-bg) / <alpha-value>)",
          "solid-fg": "rgb(var(--ds-feedback-success-solid-fg) / <alpha-value>)",
        },
        warning: {
          bg:         "rgb(var(--ds-feedback-warning-bg) / <alpha-value>)",
          border:     "rgb(var(--ds-feedback-warning-border) / <alpha-value>)",
          fg:         "rgb(var(--ds-feedback-warning-fg) / <alpha-value>)",
          "solid-bg": "rgb(var(--ds-feedback-warning-solid-bg) / <alpha-value>)",
          "solid-fg": "rgb(var(--ds-feedback-warning-solid-fg) / <alpha-value>)",
        },
        danger: {
          bg:         "rgb(var(--ds-feedback-danger-bg) / <alpha-value>)",
          border:     "rgb(var(--ds-feedback-danger-border) / <alpha-value>)",
          fg:         "rgb(var(--ds-feedback-danger-fg) / <alpha-value>)",
          "solid-bg": "rgb(var(--ds-feedback-danger-solid-bg) / <alpha-value>)",
          "solid-fg": "rgb(var(--ds-feedback-danger-solid-fg) / <alpha-value>)",
        },
        info: {
          bg:         "rgb(var(--ds-feedback-info-bg) / <alpha-value>)",
          border:     "rgb(var(--ds-feedback-info-border) / <alpha-value>)",
          fg:         "rgb(var(--ds-feedback-info-fg) / <alpha-value>)",
          "solid-bg": "rgb(var(--ds-feedback-info-solid-bg) / <alpha-value>)",
          "solid-fg": "rgb(var(--ds-feedback-info-solid-fg) / <alpha-value>)",
        },
        accent: {
          bg:         "rgb(var(--ds-feedback-accent-bg) / <alpha-value>)",
          border:     "rgb(var(--ds-feedback-accent-border) / <alpha-value>)",
          fg:         "rgb(var(--ds-feedback-accent-fg) / <alpha-value>)",
          "solid-bg": "rgb(var(--ds-feedback-accent-solid-bg) / <alpha-value>)",
          "solid-fg": "rgb(var(--ds-feedback-accent-solid-fg) / <alpha-value>)",
        },
      },
    },
    spacing: {
      0:  "var(--ds-space-0)",
      1:  "var(--ds-space-1)",
      2:  "var(--ds-space-2)",
      3:  "var(--ds-space-3)",
      4:  "var(--ds-space-4)",
      5:  "var(--ds-space-5)",
      6:  "var(--ds-space-6)",
      8:  "var(--ds-space-8)",
      10: "var(--ds-space-10)",
      12: "var(--ds-space-12)",
      16: "var(--ds-space-16)",
      20: "var(--ds-space-20)",
      24: "var(--ds-space-24)",
    },
    fontFamily: {
      sans: ["var(--ds-font-family-sans)"],
      mono: ["var(--ds-font-family-mono)"],
    },
    fontSize: {
      xs:   "var(--ds-font-size-xs)",
      sm:   "var(--ds-font-size-sm)",
      base: "var(--ds-font-size-base)",
      lg:   "var(--ds-font-size-lg)",
      xl:   "var(--ds-font-size-xl)",
      "2xl": "var(--ds-font-size-2xl)",
      "3xl": "var(--ds-font-size-3xl)",
      "4xl": "var(--ds-font-size-4xl)",
    },
    fontWeight: {
      regular:  "var(--ds-font-weight-regular)",
      medium:   "var(--ds-font-weight-medium)",
      semibold: "var(--ds-font-weight-semibold)",
      bold:     "var(--ds-font-weight-bold)",
    },
    lineHeight: {
      tight:   "var(--ds-font-line-height-tight)",
      snug:    "var(--ds-font-line-height-snug)",
      normal:  "var(--ds-font-line-height-normal)",
      relaxed: "var(--ds-font-line-height-relaxed)",
    },
    letterSpacing: {
      tight:  "var(--ds-font-tracking-tight)",
      normal: "var(--ds-font-tracking-normal)",
      wide:   "var(--ds-font-tracking-wide)",
    },
    borderRadius: {
      none: "var(--ds-radius-none)",
      sm:   "var(--ds-radius-sm)",
      md:   "var(--ds-radius-md)",
      lg:   "var(--ds-radius-lg)",
      xl:   "var(--ds-radius-xl)",
      full: "var(--ds-radius-full)",
    },
    boxShadow: {
      sm:    "var(--ds-shadow-sm)",
      md:    "var(--ds-shadow-md)",
      lg:    "var(--ds-shadow-lg)",
      xl:    "var(--ds-shadow-xl)",
      focus: "var(--ds-shadow-focus)",
    },
    transitionDuration: {
      fast:   "var(--ds-motion-duration-fast)",
      normal: "var(--ds-motion-duration-normal)",
      slow:   "var(--ds-motion-duration-slow)",
    },
    transitionTimingFunction: {
      standard: "var(--ds-motion-easing-standard)",
      emphasis: "var(--ds-motion-easing-emphasis)",
      exit:     "var(--ds-motion-easing-exit)",
    },
    zIndex: {
      base:     "var(--ds-z-base)",
      dropdown: "var(--ds-z-dropdown)",
      sticky:   "var(--ds-z-sticky)",
      overlay:  "var(--ds-z-overlay)",
      modal:    "var(--ds-z-modal)",
      popover:  "var(--ds-z-popover)",
      toast:    "var(--ds-z-toast)",
    },
  },
};
