import { Badge } from '@/components/ui/badge';

interface Props {
  isArchived: boolean;
  isPublic: boolean;
}

export function PlanStatusBadge({ isArchived, isPublic }: Props) {
  if (isArchived) {
    return <Badge variant="status-inactive">Arquivado</Badge>;
  }
  if (isPublic) {
    return <Badge variant="role-owner">Público</Badge>;
  }
  return <Badge variant="neutral">Privado</Badge>;
}
