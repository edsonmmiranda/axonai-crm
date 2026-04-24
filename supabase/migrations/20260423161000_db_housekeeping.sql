-- DB Housekeeping — débitos técnicos identificados em auditoria 2026-04-23
--
-- O QUE ESTA MIGRATION FAZ:
--   1. Timestamps SET NOT NULL (created_at em 11 tabelas; updated_at só onde existe)
--   2. is_active / active SET NOT NULL DEFAULT true em 4 tabelas
--   3. DEFAULT uuid_generate_v4() → gen_random_uuid() em 3 tabelas
--   4. DEFAULT timezone('utc', now()) → now() em 2 tabelas
--   5. VARCHAR → TEXT em products, product_images, product_documents
--
-- Tabelas SEM updated_at (junction/append-only): lead_tags, loss_reasons,
--   product_documents, product_images — só created_at é corrigido nessas.
--
-- O QUE NÃO ESTÁ AQUI:
--   - categories.active → is_active (rename): requer mudança de código em
--     src/lib/actions/categories.ts antes de renomear a coluna.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Timestamps NOT NULL
-- ─────────────────────────────────────────────────────────────────────────────

-- funnel_stages (tem created_at + updated_at)
UPDATE public.funnel_stages SET created_at = now() WHERE created_at IS NULL;
UPDATE public.funnel_stages SET updated_at = now() WHERE updated_at IS NULL;
ALTER TABLE public.funnel_stages ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE public.funnel_stages ALTER COLUMN updated_at SET NOT NULL;

-- funnels (tem created_at + updated_at)
UPDATE public.funnels SET created_at = now() WHERE created_at IS NULL;
UPDATE public.funnels SET updated_at = now() WHERE updated_at IS NULL;
ALTER TABLE public.funnels ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE public.funnels ALTER COLUMN updated_at SET NOT NULL;

-- lead_origins (tem created_at + updated_at)
UPDATE public.lead_origins SET created_at = now() WHERE created_at IS NULL;
UPDATE public.lead_origins SET updated_at = now() WHERE updated_at IS NULL;
ALTER TABLE public.lead_origins ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE public.lead_origins ALTER COLUMN updated_at SET NOT NULL;

-- lead_tags (só created_at — tabela de junção, sem updated_at)
UPDATE public.lead_tags SET created_at = now() WHERE created_at IS NULL;
ALTER TABLE public.lead_tags ALTER COLUMN created_at SET NOT NULL;

-- leads (tem created_at + updated_at)
UPDATE public.leads SET created_at = now() WHERE created_at IS NULL;
UPDATE public.leads SET updated_at = now() WHERE updated_at IS NULL;
ALTER TABLE public.leads ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE public.leads ALTER COLUMN updated_at SET NOT NULL;

-- loss_reasons (só created_at — sem updated_at)
UPDATE public.loss_reasons SET created_at = now() WHERE created_at IS NULL;
ALTER TABLE public.loss_reasons ALTER COLUMN created_at SET NOT NULL;

-- product_documents (só created_at — sem updated_at)
UPDATE public.product_documents SET created_at = now() WHERE created_at IS NULL;
ALTER TABLE public.product_documents ALTER COLUMN created_at SET NOT NULL;

-- product_images (só created_at — sem updated_at)
UPDATE public.product_images SET created_at = now() WHERE created_at IS NULL;
ALTER TABLE public.product_images ALTER COLUMN created_at SET NOT NULL;

-- products (tem created_at + updated_at)
UPDATE public.products SET created_at = now() WHERE created_at IS NULL;
UPDATE public.products SET updated_at = now() WHERE updated_at IS NULL;
ALTER TABLE public.products ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE public.products ALTER COLUMN updated_at SET NOT NULL;

-- profiles (só updated_at é nullable — created_at já é NOT NULL)
UPDATE public.profiles SET updated_at = now() WHERE updated_at IS NULL;
ALTER TABLE public.profiles ALTER COLUMN updated_at SET NOT NULL;

-- tags (tem created_at + updated_at)
UPDATE public.tags SET created_at = now() WHERE created_at IS NULL;
UPDATE public.tags SET updated_at = now() WHERE updated_at IS NULL;
ALTER TABLE public.tags ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE public.tags ALTER COLUMN updated_at SET NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. is_active / active NOT NULL DEFAULT true
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE public.categories  SET active    = true WHERE active    IS NULL;
UPDATE public.funnels      SET is_active = true WHERE is_active IS NULL;
UPDATE public.lead_origins SET is_active = true WHERE is_active IS NULL;
UPDATE public.loss_reasons SET is_active = true WHERE is_active IS NULL;

ALTER TABLE public.categories  ALTER COLUMN active    SET DEFAULT true;
ALTER TABLE public.funnels      ALTER COLUMN is_active SET DEFAULT true;
ALTER TABLE public.lead_origins ALTER COLUMN is_active SET DEFAULT true;
ALTER TABLE public.loss_reasons ALTER COLUMN is_active SET DEFAULT true;

ALTER TABLE public.categories  ALTER COLUMN active    SET NOT NULL;
ALTER TABLE public.funnels      ALTER COLUMN is_active SET NOT NULL;
ALTER TABLE public.lead_origins ALTER COLUMN is_active SET NOT NULL;
ALTER TABLE public.loss_reasons ALTER COLUMN is_active SET NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. UUID default: uuid_generate_v4() → gen_random_uuid()
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.products          ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.product_images    ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.product_documents ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Timestamp default: timezone('utc', now()) → now()
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.categories      ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.categories      ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE public.whatsapp_groups ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.whatsapp_groups ALTER COLUMN updated_at SET DEFAULT now();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. VARCHAR → TEXT
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.products
  ALTER COLUMN name   TYPE text,
  ALTER COLUMN sku    TYPE text,
  ALTER COLUMN status TYPE text,
  ALTER COLUMN brand  TYPE text;

ALTER TABLE public.product_images
  ALTER COLUMN file_name TYPE text,
  ALTER COLUMN mime_type TYPE text;

ALTER TABLE public.product_documents
  ALTER COLUMN file_name     TYPE text,
  ALTER COLUMN mime_type     TYPE text,
  ALTER COLUMN document_type TYPE text;
