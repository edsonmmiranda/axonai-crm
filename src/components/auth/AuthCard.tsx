import type { ReactNode } from 'react';
import { Building2 } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface AuthCardProps {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function AuthCard({ title, description, children, footer }: AuthCardProps) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-xl bg-action-primary shadow-lg">
          <Building2 className="size-5 text-action-primary-fg" aria-hidden="true" />
        </div>
        <div className="flex flex-col">
          <h1 className="text-base font-bold leading-tight tracking-tight text-text-primary">
            Axon AI CRM
          </h1>
          <p className="text-xs text-text-secondary">Gestão de Vendas</p>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
      {footer && <p className="text-center text-sm text-text-secondary">{footer}</p>}
    </div>
  );
}
