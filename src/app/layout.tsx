import type { Metadata } from 'next';
import { Toaster } from 'sonner';
import './globals.css';

export const metadata: Metadata = {
  title: 'Axon AI CRM',
  description: 'AI-native CRM for modern sales teams.',
};

const themeInitScript = `(function(){try{var path=window.location.pathname;var isAdmin=path==='/admin'||path.indexOf('/admin/')===0;var key=isAdmin?'admin-theme':'theme';var def=isAdmin?'light':'system';var p=localStorage.getItem(key);if(p!=='light'&&p!=='dark'&&p!=='system'){p=def;}var r=p;if(p==='system'){r=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.setAttribute('data-theme',r);}catch(e){}})();`;

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
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}
