-- Hardening do GATE 1 do sprint admin 01.
--
-- Supabase aplica DEFAULT PRIVILEGES no schema public que concedem EXECUTE
-- a anon, authenticated e service_role em toda função nova. REVOKE ALL
-- FROM public (já executado pela migration base) só revoga do pseudo-role
-- PUBLIC, não do role nomeado anon.
--
-- Efeito funcional desta revoke: zero — o corpo da RPC já rejeita chamadas
-- de anon com 'not_authorized' (auth.jwt() -> organization_id é NULL).
-- Intenção: alinhar grants com o contrato do PRD ("EXECUTE apenas para
-- authenticated e service_role") como defense-in-depth.
--
-- Idempotente: REVOKE em role sem o privilégio é no-op.

REVOKE EXECUTE ON FUNCTION public.get_current_subscription(uuid) FROM anon;
