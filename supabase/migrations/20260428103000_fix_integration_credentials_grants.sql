-- Migration: GRANT EXECUTE em RPCs de integration credentials para `authenticated`
-- Created: 2026-04-28
-- Sprint: bugfix admin_10
-- Schema Source: REAL DATABASE
--
-- Contexto:
-- Os 4 RPCs `admin_*_integration_credential` usam `auth.uid()` para verificar
-- se o caller é platform admin. Eles foram criados em admin_10 com GRANT
-- EXECUTE apenas para `service_role`, o que cria um deadlock:
--   - chamando como service_role: passa o GRANT mas auth.uid()=NULL, falha no
--     check `profile_id = auth.uid()` → RAISE 'unauthorized'.
--   - chamando como authenticated: respeitaria auth.uid(), mas sem GRANT.
--
-- Fix: conceder EXECUTE a `authenticated`. As RPCs continuam SECURITY DEFINER
-- e mantêm a verificação interna via `auth.uid()` + `platform_admins.role`,
-- então nenhum usuário comum ganha acesso indevido. O service_role mantém
-- EXECUTE (sem mudança) para preservar caminhos administrativos legítimos.

GRANT EXECUTE ON FUNCTION public.admin_list_integration_credentials() TO authenticated;

GRANT EXECUTE ON FUNCTION public.admin_create_integration_credential(
  p_kind             text,
  p_label            text,
  p_metadata         jsonb,
  p_secret_plaintext text,
  p_ip_address       text,
  p_user_agent       text
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.admin_rotate_integration_credential(
  p_id                   uuid,
  p_new_secret_plaintext text,
  p_new_metadata         jsonb,
  p_ip_address           text,
  p_user_agent           text
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.admin_revoke_integration_credential(
  p_id         uuid,
  p_ip_address text,
  p_user_agent text
) TO authenticated;
