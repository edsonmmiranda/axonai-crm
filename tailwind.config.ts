import type { Config } from 'tailwindcss';
import { themeExtend } from './design_system/generated/tailwind.tokens';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: themeExtend,
};

export default config;
