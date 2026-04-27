import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ get: vi.fn(), set: vi.fn(), getAll: vi.fn(() => []) })),
  headers: vi.fn(() => ({ get: vi.fn().mockReturnValue(null) })),
}));

vi.mock('@/lib/auth/platformAdmin', () => ({
  requirePlatformAdmin:     vi.fn(),
  requirePlatformAdminRole: vi.fn(),
}));

const { __mockServiceClient } = vi.hoisted(() => ({
  __mockServiceClient: {
    rpc:  vi.fn().mockResolvedValue({ data: null, error: null }),
    from: vi.fn(),
  },
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => __mockServiceClient),
}));

import {
  createIntegrationCredentialAction,
  listIntegrationCredentialsAction,
  revokeIntegrationCredentialAction,
  rotateIntegrationCredentialAction,
} from '@/lib/actions/admin/integration-credentials';
import { requirePlatformAdmin, requirePlatformAdminRole } from '@/lib/auth/platformAdmin';

const FAKE_ADMIN = {
  id: 'a',
  profileId: 'test-user-id',
  role: 'owner' as const,
  isActive: true,
  createdAt: '',
  email: '',
};

const PLAINTEXT = 'supersecretXYZW1234';
const HINT = '****1234';

const FAKE_ROW = {
  id: '12345678-1234-4234-a234-567812345678',
  kind: 'email_smtp' as const,
  label: 'Production SMTP',
  metadata_jsonb: { host: 'smtp.example.com', port: 587, user: 'noreply@x.com', secure: false, fromEmail: 'noreply@x.com' },
  hint: HINT,
  created_at: '2026-04-27T00:00:00Z',
  created_by: 'test-user-id',
  last_used_at: null,
  rotated_at: null,
  revoked_at: null,
};

function makeFromQuery(result: { data: unknown; error: unknown }) {
  const q: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ['select','eq','is','order'] as const) {
    q[m] = vi.fn().mockReturnValue(q);
  }
  q.maybeSingle = vi.fn().mockResolvedValue(result);
  q.single      = vi.fn().mockResolvedValue(result);
  return q;
}

beforeEach(() => {
  vi.mocked(requirePlatformAdmin).mockReset().mockResolvedValue(FAKE_ADMIN);
  vi.mocked(requirePlatformAdminRole).mockReset().mockResolvedValue(FAKE_ADMIN);
  __mockServiceClient.rpc.mockReset().mockResolvedValue({ data: null, error: null });
  __mockServiceClient.from.mockReset();
});

// ── listIntegrationCredentialsAction ──────────────────────────────────────────

describe('listIntegrationCredentialsAction', () => {
  it('happy path — qualquer admin lista credenciais (projeção sem vault_secret_id)', async () => {
    __mockServiceClient.rpc.mockResolvedValue({ data: [FAKE_ROW], error: null });
    const result = await listIntegrationCredentialsAction();
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data![0].id).toBe(FAKE_ROW.id);
    expect(JSON.stringify(result)).not.toContain('vault_secret_id');
  });

  it('auth fail → success: false', async () => {
    vi.mocked(requirePlatformAdmin).mockRejectedValue(new Error('Unauthorized'));
    const result = await listIntegrationCredentialsAction();
    expect(result.success).toBe(false);
  });
});

// ── createIntegrationCredentialAction ─────────────────────────────────────────

describe('createIntegrationCredentialAction', () => {
  const validInput = {
    kind: 'email_smtp' as const,
    label: 'Production SMTP',
    metadata: { host: 'smtp.example.com', port: 587, user: 'noreply@x.com', secure: false, fromEmail: 'noreply@x.com' },
    secretPlaintext: PLAINTEXT,
  };

  it('happy owner — cria, retorna metadata sem plaintext, audit sem plaintext', async () => {
    __mockServiceClient.rpc.mockResolvedValue({ data: FAKE_ROW, error: null });
    const result = await createIntegrationCredentialAction(validInput);
    expect(result.success).toBe(true);
    expect(result.data?.id).toBe(FAKE_ROW.id);
    // G-14 explícito: response NÃO contém plaintext nem vault_secret_id.
    const json = JSON.stringify(result);
    expect(json).not.toContain(PLAINTEXT);
    expect(json).not.toContain('vault_secret_id');
    expect(json).not.toContain('secretPlaintext');
    expect(__mockServiceClient.rpc).toHaveBeenCalledWith(
      'admin_create_integration_credential',
      expect.objectContaining({
        p_kind: 'email_smtp',
        p_label: 'Production SMTP',
        p_secret_plaintext: PLAINTEXT,
      }),
    );
  });

  it('RBAC — support/billing falham com forbidden (requirePlatformAdminRole lança)', async () => {
    vi.mocked(requirePlatformAdminRole).mockRejectedValue(new Error('Acesso negado'));
    const result = await createIntegrationCredentialAction(validInput);
    expect(result.success).toBe(false);
    expect(__mockServiceClient.rpc).not.toHaveBeenCalled();
  });

  it('Zod fail — secretPlaintext vazio → success: false sem chamar RPC', async () => {
    const result = await createIntegrationCredentialAction({ ...validInput, secretPlaintext: '' });
    expect(result.success).toBe(false);
    expect(__mockServiceClient.rpc).not.toHaveBeenCalled();
  });

  it('Zod fail — metadata sem host', async () => {
    const result = await createIntegrationCredentialAction({
      ...validInput,
      metadata: { ...validInput.metadata, host: '' },
    });
    expect(result.success).toBe(false);
    expect(__mockServiceClient.rpc).not.toHaveBeenCalled();
  });

  it('Zod fail — kind fora do enum', async () => {
    const result = await createIntegrationCredentialAction({
      ...validInput,
      // @ts-expect-error testando rejeição de kind inválido
      kind: 'sms_twilio',
    });
    expect(result.success).toBe(false);
  });

  it('RPC retorna credential_kind_already_active → mensagem amigável tipada', async () => {
    __mockServiceClient.rpc.mockResolvedValue({ data: null, error: { message: 'credential_kind_already_active' } });
    const result = await createIntegrationCredentialAction(validInput);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Já existe credencial ativa');
  });
});

// ── rotateIntegrationCredentialAction ─────────────────────────────────────────

describe('rotateIntegrationCredentialAction', () => {
  const newSecret = 'newsecret9999';
  const validInput = {
    id: FAKE_ROW.id,
    newSecretPlaintext: newSecret,
    newMetadata: { host: 'smtp.new.com', port: 465, user: 'new@x.com', secure: true, fromEmail: 'new@x.com' },
  };

  it('happy — rotaciona, audit recebe diff de hint mascarado', async () => {
    const rotated = { ...FAKE_ROW, hint: '****9999', rotated_at: '2026-04-27T01:00:00Z', metadata_jsonb: validInput.newMetadata };
    __mockServiceClient.rpc.mockResolvedValue({ data: rotated, error: null });
    const result = await rotateIntegrationCredentialAction(validInput);
    expect(result.success).toBe(true);
    expect(result.data?.hint).toBe('****9999');
    expect(result.data?.rotatedAt).toBe('2026-04-27T01:00:00Z');
    // G-14: response sem plaintext.
    expect(JSON.stringify(result)).not.toContain(newSecret);
  });

  it('RBAC — non-owner falha', async () => {
    vi.mocked(requirePlatformAdminRole).mockRejectedValue(new Error('Acesso negado'));
    const result = await rotateIntegrationCredentialAction(validInput);
    expect(result.success).toBe(false);
  });

  it('RPC retorna credential_not_found → mensagem amigável', async () => {
    __mockServiceClient.rpc.mockResolvedValue({ data: null, error: { message: 'credential_not_found' } });
    const result = await rotateIntegrationCredentialAction(validInput);
    expect(result.success).toBe(false);
    expect(result.error).toContain('não encontrada');
  });
});

// ── revokeIntegrationCredentialAction ─────────────────────────────────────────

describe('revokeIntegrationCredentialAction', () => {
  const validInput = {
    id: FAKE_ROW.id,
    confirmKind: 'email_smtp' as const,
  };

  it('happy — revoga após verificar confirmKind contra registro real', async () => {
    __mockServiceClient.from.mockReturnValue(makeFromQuery({
      data: { kind: 'email_smtp', revoked_at: null }, error: null,
    }));
    __mockServiceClient.rpc.mockResolvedValue({ data: null, error: null });

    const result = await revokeIntegrationCredentialAction(validInput);
    expect(result.success).toBe(true);
    expect(__mockServiceClient.rpc).toHaveBeenCalledWith(
      'admin_revoke_integration_credential',
      expect.objectContaining({ p_id: validInput.id }),
    );
  });

  it('confirm mismatch — kind real não bate com confirmKind → confirm_kind_mismatch', async () => {
    // No banco existe email_smtp, mas usuário confirmou outro kind no input
    // (forçando o mismatch via type-cast — em produção Zod já bloquearia kind inválido).
    __mockServiceClient.from.mockReturnValue(makeFromQuery({
      data: { kind: 'sms_twilio', revoked_at: null }, error: null,
    }));
    const result = await revokeIntegrationCredentialAction(validInput);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Confirmação não bate');
    expect(__mockServiceClient.rpc).not.toHaveBeenCalled();
  });

  it('credencial já revogada → credential_not_found', async () => {
    __mockServiceClient.from.mockReturnValue(makeFromQuery({
      data: { kind: 'email_smtp', revoked_at: '2026-04-27T00:00:00Z' }, error: null,
    }));
    const result = await revokeIntegrationCredentialAction(validInput);
    expect(result.success).toBe(false);
    expect(result.error).toContain('não encontrada');
    expect(__mockServiceClient.rpc).not.toHaveBeenCalled();
  });

  it('RBAC — non-owner não pode revogar', async () => {
    vi.mocked(requirePlatformAdminRole).mockRejectedValue(new Error('Acesso negado'));
    const result = await revokeIntegrationCredentialAction(validInput);
    expect(result.success).toBe(false);
  });
});
