import 'server-only';

export interface AdminInvitationVars {
  inviterName: string;
  role:        'owner' | 'support' | 'billing';
  acceptUrl:   string;
  expiresAt:   Date;
}

const ROLE_LABEL: Record<AdminInvitationVars['role'], string> = {
  owner:   'Owner (acesso total)',
  support: 'Support (atendimento)',
  billing: 'Billing (financeiro)',
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatExpires(d: Date): string {
  return d.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

export function adminInvitationHtml(v: AdminInvitationVars): string {
  const inviterSafe  = escapeHtml(v.inviterName);
  const roleLabel    = escapeHtml(ROLE_LABEL[v.role]);
  const acceptUrlSafe = escapeHtml(v.acceptUrl);
  const expiresSafe   = escapeHtml(formatExpires(v.expiresAt));

  return `<!doctype html>
<html lang="pt-BR">
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background-color: #f4f4f7; padding: 24px; color: #111827;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 560px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; padding: 32px;">
      <tr>
        <td>
          <h1 style="margin: 0 0 16px; font-size: 22px; color: #111827;">Convite para a Área Admin Axon</h1>
          <p style="margin: 0 0 16px; font-size: 14px; line-height: 1.6;">
            Olá! ${inviterSafe} convidou você para acessar a Área Administrativa da plataforma Axon como <strong>${roleLabel}</strong>.
          </p>
          <p style="margin: 0 0 24px; font-size: 14px; line-height: 1.6;">
            Para aceitar o convite, clique no botão abaixo. Você precisará criar uma senha e configurar autenticação em duas etapas (TOTP) antes de acessar.
          </p>
          <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 0 auto;">
            <tr>
              <td style="background-color: #1f2937; border-radius: 6px;">
                <a href="${acceptUrlSafe}" style="display: inline-block; padding: 12px 24px; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px;">Aceitar convite</a>
              </td>
            </tr>
          </table>
          <p style="margin: 24px 0 0; font-size: 12px; color: #6b7280; line-height: 1.6;">
            O convite expira em <strong>${expiresSafe}</strong>. Se você não solicitou esse acesso, ignore este email.
          </p>
          <hr style="margin: 24px 0; border: none; border-top: 1px solid #e5e7eb;">
          <p style="margin: 0; font-size: 11px; color: #9ca3af; word-break: break-all;">
            Se o botão não funcionar, copie e cole este link no navegador:<br>
            ${acceptUrlSafe}
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function adminInvitationText(v: AdminInvitationVars): string {
  return [
    `Convite para a Área Admin Axon`,
    ``,
    `${v.inviterName} convidou você para acessar a Área Administrativa Axon como ${ROLE_LABEL[v.role]}.`,
    ``,
    `Aceite o convite no link abaixo. Você precisará criar uma senha e configurar TOTP antes de acessar.`,
    ``,
    v.acceptUrl,
    ``,
    `O convite expira em ${formatExpires(v.expiresAt)}.`,
    ``,
    `Se você não solicitou esse acesso, ignore este email.`,
  ].join('\n');
}
