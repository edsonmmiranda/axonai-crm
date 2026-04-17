import { Users } from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function LeadsPage() {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Leads</CardTitle>
          <CardDescription>
            Gerencie todos os leads da sua organização.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <Users className="size-10 text-text-muted" aria-hidden="true" />
            <p className="text-sm font-medium text-text-primary">
              Em breve
            </p>
            <p className="text-sm text-text-secondary">
              A listagem completa de leads será implementada em um sprint futuro.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
