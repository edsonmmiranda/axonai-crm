import type { Config } from 'tailwindcss';
import { themeExtend } from './design_system/generated/tailwind.tokens';

const baseExtend = (themeExtend?.extend ?? {}) as Record<string, unknown>;
const baseMaxWidth = (baseExtend.maxWidth ?? {}) as Record<string, string>;

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    ...themeExtend,
    extend: {
      ...baseExtend,
      maxWidth: {
        ...baseMaxWidth,
        page: '1400px',
      },
    },
  },
};

export default config;
