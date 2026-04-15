import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import type { TeamMember } from '@/lib/actions/invitations';

const ROLE_LABEL: Record<TeamMember['role'], string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Membro',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR');
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function TeamMembersList({ members }: { members: TeamMember[] }) {
  if (members.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-text-secondary">
        Nenhum membro ainda. Convide alguém acima.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-subtle text-left text-xs uppercase tracking-wide text-text-muted">
            <th scope="col" className="px-4 py-3 font-semibold">
              Nome
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              Email
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              Role
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              Status
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              Desde
            </th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => {
            const roleVariant =
              m.role === 'owner' ? 'role-owner' : m.role === 'admin' ? 'role-admin' : 'role-member';
            return (
              <tr key={m.id} className="border-b border-subtle">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Avatar className="size-8">
                      {m.avatar_url ? (
                        <AvatarImage src={m.avatar_url} alt={m.full_name} />
                      ) : null}
                      <AvatarFallback className="text-xs">
                        {getInitials(m.full_name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="font-medium text-text-primary">{m.full_name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-text-secondary">{m.email ?? '—'}</td>
                <td className="px-4 py-3">
                  <Badge variant={roleVariant}>{ROLE_LABEL[m.role]}</Badge>
                </td>
                <td className="px-4 py-3">
                  <Badge variant={m.is_active ? 'role-admin' : 'status-inactive'}>
                    {m.is_active ? 'Ativo' : 'Inativo'}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-text-secondary">{formatDate(m.created_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
