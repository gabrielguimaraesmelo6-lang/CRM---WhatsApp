-- ============================================================
-- 051_modulo_trafego.sql — Módulo Tráfego e ficha única do veículo
-- (sistema único, Etapa 1).
--
-- Traz para o banco do CRM tudo o que o painel de tráfego (projeto
-- "dashboard-carros" / Placa a Placa) guardava, agora por LOJA
-- (organizations.id = org_id) em vez de por conta do painel:
--
--   veiculos                     ficha única do carro (estoque do site +
--                                custos, venda e margem do painel)
--   tr_sellers                   vendedores do tráfego (nome/função)
--   tr_campaigns                 campanhas do Meta (+ carro e vendedor ligados)
--   tr_campaign_metrics_daily    métricas por campanha e dia
--   tr_campaign_metrics_hourly   métricas por campanha e hora
--   tr_metrics_daily             métricas agregadas por fonte (Instagram, GA4)
--   tr_utm_links, tr_link_destinos
--   tr_automations, tr_automations_history
--   tr_integration_credentials   conta de anúncios / conectores ligados
--   tr_sync_runs                 histórico das sincronizações
--   tr_config                    configuração da loja (token do Meta
--                                criptografado, projeto do estoque do site)
--
-- Mesmas colunas do painel (para o código das telas vir igual), só que
-- `account_id` (conta do painel) vira `org_id` (loja no CRM).
--
-- Acesso (RLS):
--   - org_gestor(org): dono/administrador da conta-mãe da loja
--     (sócio/gestor). Lê e escreve tudo do Tráfego.
--   - org_membro(org): qualquer pessoa da loja, inclusive as contas de
--     vendedor ligadas a ela. Só LÊ veículos (para ver o estoque).
--   - Os jobs de sincronização usam a service_role (ignoram RLS).
--   - tr_config guarda o token do Meta CRIPTOGRAFADO e nunca é lido
--     pelo navegador: sem policy de SELECT para usuários (só servidor).
--
-- Aditivo e idempotente — não altera nenhuma tabela existente do CRM.
-- ============================================================

-- ---------- Funções de acesso ----------

CREATE OR REPLACE FUNCTION org_gestor(target_org UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM organizations o
    WHERE o.id = target_org
      AND is_account_member(o.owner_account_id, 'admin')
  );
$$;
ALTER FUNCTION org_gestor(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION org_gestor(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION org_gestor(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION org_membro(target_org UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM organizations o
    WHERE o.id = target_org
      AND is_account_member(o.owner_account_id)
  ) OR EXISTS (
    SELECT 1
    FROM profiles p
    JOIN accounts a ON a.id = p.account_id
    WHERE p.user_id = auth.uid()
      AND a.organization_id = target_org
      AND NOT is_organization_suspended(a.id)
  );
$$;
ALTER FUNCTION org_membro(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION org_membro(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION org_membro(UUID) TO authenticated, service_role;

-- ---------- Configuração da loja ----------

CREATE TABLE IF NOT EXISTS tr_config (
  org_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  meta_access_token TEXT,          -- criptografado (src/lib/whatsapp/encryption.ts)
  estoque_firestore_projeto TEXT,  -- ex.: 'ibox-site'
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE tr_config ENABLE ROW LEVEL SECURITY;
-- Sem policies: só o servidor (service_role) lê e grava.

-- ---------- Vendedores do tráfego ----------

CREATE TABLE IF NOT EXISTS tr_sellers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  funcao TEXT,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tr_sellers_org_idx ON tr_sellers (org_id);

-- ---------- Ficha única do veículo ----------

CREATE TABLE IF NOT EXISTS veiculos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  placa TEXT NOT NULL,
  modelo TEXT NOT NULL,
  ano INT,
  status TEXT NOT NULL DEFAULT 'estoque' CHECK (status IN ('estoque', 'vendido')),
  custo_aquisicao NUMERIC(12,2),
  custo_preparacao NUMERIC(12,2),
  valor_venda NUMERIC(12,2),
  vendedor_id UUID REFERENCES tr_sellers(id) ON DELETE SET NULL,
  tipo_negocio TEXT CHECK (tipo_negocio IN ('venda', 'troca')),
  veiculo_troca TEXT,
  valor_troca NUMERIC(12,2),
  valor_volta NUMERIC(12,2),
  margem_lucro NUMERIC(12,2),
  -- Estoque do site (Firestore)
  site_vehicle_id TEXT,
  origem TEXT NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual', 'site')),
  nome_site TEXT,
  modelo_site TEXT,
  preco_site NUMERIC(12,2),
  site_status TEXT,
  foto_url TEXT,
  sincronizado_em TIMESTAMPTZ,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, placa)
);
CREATE UNIQUE INDEX IF NOT EXISTS veiculos_site_vehicle_unq
  ON veiculos (org_id, site_vehicle_id) WHERE site_vehicle_id IS NOT NULL;

-- ---------- Destinos de link e campanhas ----------

CREATE TABLE IF NOT EXISTS tr_link_destinos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  nome TEXT NOT NULL,
  valor TEXT,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tr_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  external_campaign_id TEXT,
  nome TEXT NOT NULL,
  objetivo TEXT,
  status TEXT,
  car_id UUID REFERENCES veiculos(id) ON DELETE SET NULL,
  projeto TEXT NOT NULL DEFAULT 'ibox',
  categoria_objetivo TEXT,
  vendedor_override TEXT,
  tipo TEXT CHECK (tipo IN ('WhatsApp', 'Lead site', 'Outro', 'Sem resultado')),
  destino_id UUID REFERENCES tr_link_destinos(id) ON DELETE SET NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, external_campaign_id)
);

CREATE TABLE IF NOT EXISTS tr_campaign_metrics_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES tr_campaigns(id) ON DELETE CASCADE,
  data DATE NOT NULL,
  gasto NUMERIC(12,2) NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  msgs INTEGER NOT NULL DEFAULT 0,
  leads INTEGER NOT NULL DEFAULT 0,
  purchases INTEGER NOT NULL DEFAULT 0,
  v25 INTEGER NOT NULL DEFAULT 0,
  v50 INTEGER NOT NULL DEFAULT 0,
  v75 INTEGER NOT NULL DEFAULT 0,
  v100 INTEGER NOT NULL DEFAULT 0,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, data)
);
CREATE INDEX IF NOT EXISTS tr_cmd_org_idx ON tr_campaign_metrics_daily (org_id, data);

CREATE TABLE IF NOT EXISTS tr_campaign_metrics_hourly (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES tr_campaigns(id) ON DELETE CASCADE,
  data DATE NOT NULL,
  hora SMALLINT NOT NULL CHECK (hora BETWEEN 0 AND 23),
  gasto NUMERIC(12,2) NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  msgs INTEGER NOT NULL DEFAULT 0,
  leads INTEGER NOT NULL DEFAULT 0,
  purchases INTEGER NOT NULL DEFAULT 0,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, data, hora)
);
CREATE INDEX IF NOT EXISTS tr_cmh_org_idx ON tr_campaign_metrics_hourly (org_id, data);

CREATE TABLE IF NOT EXISTS tr_metrics_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  fonte TEXT NOT NULL CHECK (fonte IN ('facebook', 'instagram', 'ga4', 'ga4_quiz')),
  data DATE NOT NULL,
  campos JSONB NOT NULL DEFAULT '{}'::jsonb,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, fonte, data)
);

-- ---------- Links, automações, conectores, histórico ----------

CREATE TABLE IF NOT EXISTS tr_utm_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  url_destino TEXT NOT NULL,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  url_gerada TEXT NOT NULL,
  cliques INTEGER NOT NULL DEFAULT 0,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tr_automations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('mensagem', 'relatorio', 'lembrete', 'alerta', 'sistema')),
  nome TEXT NOT NULL,
  canal TEXT NOT NULL DEFAULT 'whatsapp',
  group_jid TEXT,
  conteudo TEXT,
  horario SMALLINT CHECK (horario BETWEEN 0 AND 23),
  dias SMALLINT[],
  cond_operador TEXT CHECK (cond_operador IN ('>', '>=', '<', '<=')),
  cond_valor NUMERIC,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at TIMESTAMPTZ,
  last_run_status TEXT,
  last_run_summary TEXT,
  last_run_date DATE,
  run_requested BOOLEAN NOT NULL DEFAULT FALSE,
  run_requested_at TIMESTAMPTZ,
  horario_secundario SMALLINT CHECK (horario_secundario BETWEEN 0 AND 23),
  last_run_at_secundario TIMESTAMPTZ,
  last_run_status_secundario TEXT,
  last_run_summary_secundario TEXT,
  last_run_date_secundario DATE,
  run_requested_secundario BOOLEAN NOT NULL DEFAULT FALSE,
  run_requested_at_secundario TIMESTAMPTZ,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tr_automations_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  automation_id UUID REFERENCES tr_automations(id) ON DELETE SET NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT,
  summary TEXT
);

CREATE TABLE IF NOT EXISTS tr_integration_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provedor TEXT NOT NULL,
  referencia_externa TEXT,
  conectado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ativo BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS tr_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provedor TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'erro', 'em_andamento')),
  iniciado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  concluido_em TIMESTAMPTZ,
  erro TEXT
);
CREATE INDEX IF NOT EXISTS tr_sync_runs_org_idx ON tr_sync_runs (org_id, concluido_em DESC);

-- ---------- RLS ----------

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tr_sellers', 'tr_link_destinos', 'tr_campaigns', 'tr_campaign_metrics_daily',
    'tr_campaign_metrics_hourly', 'tr_metrics_daily', 'tr_utm_links', 'tr_automations',
    'tr_automations_history', 'tr_integration_credentials'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_gestor', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (org_gestor(org_id)) WITH CHECK (org_gestor(org_id))',
      t || '_gestor', t
    );
  END LOOP;
END $$;

ALTER TABLE tr_sync_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tr_sync_runs_gestor ON tr_sync_runs;
CREATE POLICY tr_sync_runs_gestor ON tr_sync_runs FOR SELECT USING (org_gestor(org_id));

ALTER TABLE veiculos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS veiculos_membro_le ON veiculos;
CREATE POLICY veiculos_membro_le ON veiculos FOR SELECT USING (org_membro(org_id));
DROP POLICY IF EXISTS veiculos_gestor_escreve ON veiculos;
CREATE POLICY veiculos_gestor_escreve ON veiculos FOR ALL USING (org_gestor(org_id)) WITH CHECK (org_gestor(org_id));
