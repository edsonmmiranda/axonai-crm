-- Fix: profiles.role DEFAULT 'member' viola profiles_role_check
--
-- O CHECK constraint aceita ('owner', 'admin', 'user', 'viewer').
-- 'member' não está na lista, então qualquer INSERT sem role explícito
-- falha com "violates check constraint profiles_role_check".
--
-- Na prática o default nunca é usado (handle_new_user sempre copia o role
-- do signup_intents), mas é uma armadilha para testes e seeds futuros.
--
-- Correção: trocar o default para 'user' (menor privilégio, válido no CHECK).

ALTER TABLE public.profiles
  ALTER COLUMN role SET DEFAULT 'user';
