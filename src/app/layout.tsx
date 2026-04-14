import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Axon AI CRM',
  description: 'AI-native CRM for modern sales teams.',
};

const themeInitScript = `(function(){try{var t=localStorage.getItem('theme');if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="bg-surface-base text-text-primary antialiased">
        {children}
      </body>
    </html>
  );
}
