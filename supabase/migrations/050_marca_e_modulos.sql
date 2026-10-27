-- ============================================================
-- 050_marca_e_modulos.sql — Marca própria por loja + módulos do
-- sistema único (Tráfego e Estoque do site).
--
-- Contexto: o CRM é um produto para várias lojas. Cada organização
-- (loja) pode ter a própria marca — nome, logo e tema — que aparece
-- para todos os usuários da loja (dono, gestores e vendedores, inclusive
-- as contas de vendedor ligadas à organização). Lojas sem marca
-- configurada continuam com o visual padrão do produto (WGA).
--
-- `modules` liga, por loja, os módulos que vieram dos outros sistemas:
--   {"trafego": true, "estoque": true}
-- Sem a chave (ou false) o módulo não aparece no menu daquela loja.
--
-- Leitura: vendedores não conseguem ler `organizations` pelo RLS
-- (só membros da conta dona). Por isso a marca é lida pela função
-- my_branding(), SECURITY DEFINER, que devolve só os campos visuais da
-- organização de quem chama — nada de credenciais (meta_capi_* etc.).
--
-- Escrita: só o dono da loja (policy organizations_update já existente).
--
-- Aditivo e idempotente — seguro rodar de novo. Não altera nenhum dado.
-- ============================================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS brand_name TEXT,
  ADD COLUMN IF NOT EXISTS brand_logo_url TEXT,
  ADD COLUMN IF NOT EXISTS brand_theme TEXT,
  ADD COLUMN IF NOT EXISTS modules JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION my_branding()
RETURNS TABLE (
  organization_id UUID,
  brand_name TEXT,
  brand_logo_url TEXT,
  brand_theme TEXT,
  modules JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.id, o.brand_name, o.brand_logo_url, o.brand_theme, o.modules
  FROM profiles p
  JOIN accounts a ON a.id = p.account_id
  JOIN organizations o
    ON o.id = a.organization_id
    OR o.owner_account_id = a.id
  WHERE p.user_id = auth.uid()
  ORDER BY (o.id = a.organization_id) DESC
  LIMIT 1;
$$;

ALTER FUNCTION my_branding() OWNER TO postgres;
REVOKE ALL ON FUNCTION my_branding() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION my_branding() TO authenticated, service_role;
