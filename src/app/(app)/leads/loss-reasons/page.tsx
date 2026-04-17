import { XCircle } from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function LossReasonsPage() {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Motivos de Perda</CardTitle>
          <CardDescription>
            Cadastre motivos para classificar leads perdidos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <XCircle className="size-10 text-text-muted" aria-hidden="true" />
            <p className="text-sm font-medium text-text-primary">
              Em breve
            </p>
            <p className="text-sm text-text-secondary">
              O gerenciamento de motivos de perda será implementado em um sprint futuro.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
