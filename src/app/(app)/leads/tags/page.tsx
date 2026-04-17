import { Tag } from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function TagsPage() {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Tags</CardTitle>
          <CardDescription>
            Crie e gerencie tags para classificar seus leads.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <Tag className="size-10 text-text-muted" aria-hidden="true" />
            <p className="text-sm font-medium text-text-primary">
              Em breve
            </p>
            <p className="text-sm text-text-secondary">
              O gerenciamento de tags será implementado em um sprint futuro.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
