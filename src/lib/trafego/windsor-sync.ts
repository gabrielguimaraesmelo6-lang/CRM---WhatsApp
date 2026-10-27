import { SupabaseClient } from "@supabase/supabase-js";
import { syncMeta, type ModoSync } from "@/lib/trafego/meta-sync";

// Motor de sync v2 — Fase 3.1 do plano de paridade com o Artifact "Placa a
// Placa". Reescrito do zero em cima do v1 (que só gravava spend/clicks/
// impressions agregados por conta em metrics_daily). Compartilhado entre a
// rota do cron (app/api/sync/windsor/route.ts, roda para todas as contas) e
// a rota de disparo manual (app/api/sync/windsor/manual/route.ts, roda só
// para a conta do usuário logado).
//
// Regra crítica preservada do Artifact original (comentário do código-fonte):
// gasto e resultados da Meta Ads precisam vir de chamadas SEPARADAS à
// Windsor.ai — combinar os dois numa chamada só faz a Meta cruzar as
// tabelas Campaign+Actions e sub-relatar o gasto. Mesma regra para GA4: cada
// "tabela" (Sessão, Usuários, Novos usuários, Página) numa chamada própria.

const WINDSOR_BASE_URL = "https://connectors.windsor.ai";
const SYNC_WINDOW_DAYS = 30;
// A sync horária busca MUITO mais linhas por dia (uma por campanha por
// hora, em vez de uma por campanha por dia) — usar a mesma janela de 30
// dias da sync diária estourava o limite de tempo da função serverless
// (maxDuration 60s). 10 dias é suficiente pro gráfico de "horário de pico"
// (o objetivo é o padrão recente de horário, não histórico longo) e mantém
// a sync inteira dentro do limite.
const HOURLY_SYNC_WINDOW_DAYS = 10;

function formatDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

async function fetchWindsorData(
  connector: string,
  accountExternalId: string,
  fields: string[],
  dateFrom: string,
  dateTo: string,
  apiKey: string
) {
  const url = new URL(`${WINDSOR_BASE_URL}/${connector}`);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("fields", fields.join(","));
  url.searchParams.set("date_from", dateFrom);
  url.searchParams.set("date_to", dateTo);
  url.searchParams.set("accounts", accountExternalId);

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Windsor.ai HTTP ${res.status}: ${body.slice(0, 500)}`);
  }
  const json = await res.json();
  const rows = Array.isArray(json) ? json : json?.data ?? json?.result ?? [];
  if (!Array.isArray(rows)) {
    throw new Error(`Formato de resposta inesperado da Windsor.ai: ${JSON.stringify(json).slice(0, 300)}`);
  }
  // Quando o plano não cobre as contas conectadas, a Windsor devolve linhas FALSAS
  // ("Uh-oh! These are not your real numbers…"). Nunca gravar isso como dado real.
  const aviso = rows.find((r) => /not your real numbers|reads are paused/i.test(JSON.stringify(r)));
  if (aviso) {
    throw new Error("Windsor.ai pausou a leitura (plano não cobre as contas conectadas) — nenhum dado gravado. Assine o plano ou deixe só 1 conta conectada.");
  }
  return rows as Record<string, unknown>[];
}

// ---------------------------------------------------------------------
// Detecção de vendedor por nome de campanha (porta da lógica do Artifact).
// Padrões observados nos nomes reais das campanhas da iBox Prime: "(Whats
// Nome)", "wpp Nome", "CAMP [Nome]". "[CRM]" marca campanha de CRM/remarketing
// e não indica vendedor. vendedor_override, quando setado manualmente na UI,
// sempre tem prioridade sobre a detecção automática.
// ---------------------------------------------------------------------
export function vendedorOf(nomeCampanha: string, override?: string | null): string | null {
  if (override && override.trim()) return override.trim();
  const nome = nomeCampanha || "";

  const padroes: RegExp[] = [
    /\(\s*whats?\s+([a-zà-úA-ZÀ-Ú]+)\s*\)/i,
    /\bwpp\s+([a-zà-úA-ZÀ-Ú]+)\b/i,
    /\bwhats(?:app)?\s+([a-zà-úA-ZÀ-Ú]+)\b/i,
    /\bcamp\s*\[\s*([a-zà-úA-ZÀ-Ú]+)\s*\]/i,
  ];

  for (const padrao of padroes) {
    const match = nome.match(padrao);
    if (match && match[1]) {
      const candidato = match[1].trim();
      if (candidato.toLowerCase() === "crm") continue;
      return candidato.charAt(0).toUpperCase() + candidato.slice(1).toLowerCase();
    }
  }
  return null;
}

// Tipo de resultado da campanha, calculado a partir dos resultados reais —
// mesma regra do Artifact: prioriza mensagens (o canal principal de vendas),
// depois leads, depois qualquer outra atividade, senão "Sem resultado".
export function tipoDeCampanha(msgs: number, leads: number, purchases: number, impressions: number): string {
  if (msgs > 0) return "WhatsApp";
  if (leads > 0) return "Lead site";
  if (purchases > 0 || impressions > 0) return "Outro";
  return "Sem resultado";
}

export type CredentialRow = {
  id: string;
  org_id: string;
  provedor: string;
  referencia_externa: string | null;
};

export type SyncResult = {
  org_id: string;
  provedor: string;
  status: string;
  linhas?: number;
  erro?: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supa = SupabaseClient<any>;

// ---------------------------------------------------------------------
// Facebook (Meta Ads) — sync por campanha, por dia.
// ---------------------------------------------------------------------
async function syncFacebook(
  supabase: Supa,
  accountId: string,
  externalAccountId: string,
  dateFrom: string,
  dateTo: string,
  apiKey: string
): Promise<number> {
  // Chamada 1: gasto + identificação + status da campanha.
  const spendRows = await fetchWindsorData(
    "facebook",
    externalAccountId,
    ["date", "campaign_id", "campaign", "objective", "campaign_status", "spend", "impressions", "clicks"],
    dateFrom,
    dateTo,
    apiKey
  );

  // Chamada 2: resultados — SEPARADA da chamada de gasto (ver comentário no
  // topo do arquivo sobre por que a Meta sub-relata o gasto se juntar as duas).
  const resultRows = await fetchWindsorData(
    "facebook",
    externalAccountId,
    [
      "date",
      "campaign_id",
      "actions_onsite_conversion_messaging_conversation_started_7d",
      "actions_lead",
      "actions_purchase",
      "video_p25_watched_actions_video_view",
      "video_p50_watched_actions_video_view",
      "video_p75_watched_actions_video_view",
      "video_p100_watched_actions_video_view",
    ],
    dateFrom,
    dateTo,
    apiKey
  );

  type Linha = {
    campaignId: string;
    nome?: string;
    objetivo?: string;
    status?: string;
    gasto: number;
    impressions: number;
    clicks: number;
    msgs: number;
    leads: number;
    purchases: number;
    v25: number;
    v50: number;
    v75: number;
    v100: number;
  };

  const porChaveData = new Map<string, Map<string, Linha>>(); // data -> campaignId -> linha

  for (const row of spendRows) {
    const data = String(row.date ?? "");
    const campaignId = String(row.campaign_id ?? "");
    if (!data || !campaignId) continue;
    if (!porChaveData.has(data)) porChaveData.set(data, new Map());
    const porCampanha = porChaveData.get(data)!;
    porCampanha.set(campaignId, {
      campaignId,
      nome: row.campaign ? String(row.campaign) : undefined,
      objetivo: row.objective ? String(row.objective) : undefined,
      status: row.campaign_status ? String(row.campaign_status) : undefined,
      gasto: Number(row.spend ?? 0),
      impressions: Number(row.impressions ?? 0),
      clicks: Number(row.clicks ?? 0),
      msgs: 0,
      leads: 0,
      purchases: 0,
      v25: 0,
      v50: 0,
      v75: 0,
      v100: 0,
    });
  }

  for (const row of resultRows) {
    const data = String(row.date ?? "");
    const campaignId = String(row.campaign_id ?? "");
    if (!data || !campaignId) continue;
    if (!porChaveData.has(data)) porChaveData.set(data, new Map());
    const porCampanha = porChaveData.get(data)!;
    const existente = porCampanha.get(campaignId) ?? {
      campaignId,
      gasto: 0,
      impressions: 0,
      clicks: 0,
      msgs: 0,
      leads: 0,
      purchases: 0,
      v25: 0,
      v50: 0,
      v75: 0,
      v100: 0,
    };
    existente.msgs = Number(row.actions_onsite_conversion_messaging_conversation_started_7d ?? 0);
    existente.leads = Number(row.actions_lead ?? 0);
    existente.purchases = Number(row.actions_purchase ?? 0);
    existente.v25 = Number(row.video_p25_watched_actions_video_view ?? 0);
    existente.v50 = Number(row.video_p50_watched_actions_video_view ?? 0);
    existente.v75 = Number(row.video_p75_watched_actions_video_view ?? 0);
    existente.v100 = Number(row.video_p100_watched_actions_video_view ?? 0);
    porCampanha.set(campaignId, existente);
  }

  // Cache local de campanhas já resolvidas nesta rodada (campaignId externo -> uuid interno).
  const cacheCampanhas = new Map<string, string>();

  async function resolverCampanhaId(
    externalCampaignId: string,
    nome: string | undefined,
    objetivo: string | undefined,
    status: string | undefined,
    msgsTotais: number,
    leadsTotais: number,
    purchasesTotais: number,
    impressionsTotais: number
  ): Promise<string | null> {
    if (cacheCampanhas.has(externalCampaignId)) return cacheCampanhas.get(externalCampaignId)!;

    const { data: existente } = await supabase
      .from("tr_campaigns")
      .select("id, vendedor_override, nome")
      .eq("org_id", accountId)
      .eq("external_campaign_id", externalCampaignId)
      .maybeSingle();

    const tipo = tipoDeCampanha(msgsTotais, leadsTotais, purchasesTotais, impressionsTotais);

    if (existente) {
      await supabase
        .from("tr_campaigns")
        .update({
          nome: nome ?? existente.nome,
          objetivo: objetivo ?? undefined,
          status: status ?? undefined,
          tipo,
        })
        .eq("id", existente.id);
      cacheCampanhas.set(externalCampaignId, existente.id);
      return existente.id;
    }

    const { data: criada, error } = await supabase
      .from("tr_campaigns")
      .insert({
        org_id: accountId,
        external_campaign_id: externalCampaignId,
        nome: nome ?? `Campanha ${externalCampaignId}`,
        objetivo: objetivo ?? null,
        status: status ?? null,
        tipo,
      })
      .select("id")
      .single();

    if (error || !criada) {
      // Corrida entre syncs concorrentes (ou constraint única ainda não
      // aplicada nesta conta) pode gerar um 409 aqui — tenta buscar de novo
      // antes de desistir desta linha.
      const { data: retry } = await supabase
        .from("tr_campaigns")
        .select("id")
        .eq("org_id", accountId)
        .eq("external_campaign_id", externalCampaignId)
        .maybeSingle();
      if (retry) {
        cacheCampanhas.set(externalCampaignId, retry.id);
        return retry.id;
      }
      return null;
    }

    cacheCampanhas.set(externalCampaignId, criada.id);
    return criada.id;
  }

  let linhasGravadas = 0;
  const upsertsMetricas: Record<string, unknown>[] = [];

  for (const [data, porCampanha] of porChaveData.entries()) {
    for (const linha of porCampanha.values()) {
      const campaignUuid = await resolverCampanhaId(
        linha.campaignId,
        linha.nome,
        linha.objetivo,
        linha.status,
        linha.msgs,
        linha.leads,
        linha.purchases,
        linha.impressions
      );
      if (!campaignUuid) continue;

      upsertsMetricas.push({
        org_id: accountId,
        campaign_id: campaignUuid,
        data,
        gasto: linha.gasto,
        impressions: linha.impressions,
        clicks: linha.clicks,
        msgs: linha.msgs,
        leads: linha.leads,
        purchases: linha.purchases,
        v25: linha.v25,
        v50: linha.v50,
        v75: linha.v75,
        v100: linha.v100,
        atualizado_em: new Date().toISOString(),
      });
    }
  }

  if (upsertsMetricas.length > 0) {
    const { error } = await supabase
      .from("tr_campaign_metrics_daily")
      .upsert(upsertsMetricas, { onConflict: "campaign_id,data" });
    if (error) throw new Error(error.message);
    linhasGravadas = upsertsMetricas.length;
  }

  return linhasGravadas;
}

// ---------------------------------------------------------------------
// Facebook (Meta Ads) — sync por campanha, por HORA do dia (usado só pelo
// gráfico "Horário de pico de resultados" em Campanhas). Mesmo padrão da
// versão diária: duas chamadas separadas à Windsor.ai (gasto e resultados),
// usando "hourly_stats_aggregated_by_advertiser_time_zone" como campo extra
// de agrupamento — a API então devolve uma linha por campanha por hora, com
// o bucket de hora vindo como string ("13:00:00 - 13:59:59"). A campanha em
// si já foi resolvida/criada pela sync diária (syncFacebook), que roda
// sempre antes desta na mesma rodada — aqui só resolvemos o id via cache
// local, sem criar campanha nova a partir do dado horário.
// ---------------------------------------------------------------------
function horaDoBucket(bucket: unknown): number | null {
  const texto = String(bucket ?? "");
  const match = texto.match(/^(\d{1,2}):/);
  if (!match) return null;
  const hora = Number(match[1]);
  if (Number.isNaN(hora) || hora < 0 || hora > 23) return null;
  return hora;
}

async function syncFacebookHourly(
  supabase: Supa,
  accountId: string,
  externalAccountId: string,
  dateFrom: string,
  dateTo: string,
  apiKey: string
): Promise<number> {
  const CAMPO_HORA = "hourly_stats_aggregated_by_advertiser_time_zone";

  // As duas chamadas (spend e resultados) são independentes — rodar em
  // paralelo corta o tempo total pela metade, importante porque essa sync
  // é a mais pesada da rodada (uma linha por campanha por HORA).
  const [spendRows, resultRows] = await Promise.all([
    fetchWindsorData(
      "facebook",
      externalAccountId,
      ["date", CAMPO_HORA, "campaign_id", "spend", "impressions", "clicks"],
      dateFrom,
      dateTo,
      apiKey
    ),
    fetchWindsorData(
      "facebook",
      externalAccountId,
      [
        "date",
        CAMPO_HORA,
        "campaign_id",
        "actions_onsite_conversion_messaging_conversation_started_7d",
        "actions_lead",
        "actions_purchase",
      ],
      dateFrom,
      dateTo,
      apiKey
    ),
  ]);

  type LinhaHora = {
    campaignId: string;
    gasto: number;
    impressions: number;
    clicks: number;
    msgs: number;
    leads: number;
    purchases: number;
  };

  // chave: `${data}|${hora}|${campaignId}`
  const porChave = new Map<string, LinhaHora>();

  for (const row of spendRows) {
    const data = String(row.date ?? "");
    const campaignId = String(row.campaign_id ?? "");
    const hora = horaDoBucket(row[CAMPO_HORA]);
    if (!data || !campaignId || hora === null) continue;
    const chave = `${data}|${hora}|${campaignId}`;
    porChave.set(chave, {
      campaignId,
      gasto: Number(row.spend ?? 0),
      impressions: Number(row.impressions ?? 0),
      clicks: Number(row.clicks ?? 0),
      msgs: 0,
      leads: 0,
      purchases: 0,
    });
  }

  for (const row of resultRows) {
    const data = String(row.date ?? "");
    const campaignId = String(row.campaign_id ?? "");
    const hora = horaDoBucket(row[CAMPO_HORA]);
    if (!data || !campaignId || hora === null) continue;
    const chave = `${data}|${hora}|${campaignId}`;
    const existente = porChave.get(chave) ?? {
      campaignId,
      gasto: 0,
      impressions: 0,
      clicks: 0,
      msgs: 0,
      leads: 0,
      purchases: 0,
    };
    existente.msgs = Number(row.actions_onsite_conversion_messaging_conversation_started_7d ?? 0);
    existente.leads = Number(row.actions_lead ?? 0);
    existente.purchases = Number(row.actions_purchase ?? 0);
    porChave.set(chave, existente);
  }

  const cacheCampanhas = new Map<string, string | null>();

  async function idInterno(externalCampaignId: string): Promise<string | null> {
    if (cacheCampanhas.has(externalCampaignId)) return cacheCampanhas.get(externalCampaignId)!;
    const { data: existente } = await supabase
      .from("tr_campaigns")
      .select("id")
      .eq("org_id", accountId)
      .eq("external_campaign_id", externalCampaignId)
      .maybeSingle();
    const id = existente?.id ?? null;
    cacheCampanhas.set(externalCampaignId, id);
    return id;
  }

  const upserts: Record<string, unknown>[] = [];

  for (const [chave, linha] of porChave.entries()) {
    const [data, horaStr] = chave.split("|");
    const campaignUuid = await idInterno(linha.campaignId);
    if (!campaignUuid) continue;

    upserts.push({
      org_id: accountId,
      campaign_id: campaignUuid,
      data,
      hora: Number(horaStr),
      gasto: linha.gasto,
      impressions: linha.impressions,
      clicks: linha.clicks,
      msgs: linha.msgs,
      leads: linha.leads,
      purchases: linha.purchases,
      atualizado_em: new Date().toISOString(),
    });
  }

  let linhasGravadas = 0;
  if (upserts.length > 0) {
    const { error } = await supabase
      .from("tr_campaign_metrics_hourly")
      .upsert(upserts, { onConflict: "campaign_id,data,hora" });
    if (error) throw new Error(error.message);
    linhasGravadas = upserts.length;
  }

  return linhasGravadas;
}

// ---------------------------------------------------------------------
// Instagram — só métricas de conta inteira (seguidores), sem campanha.
// ---------------------------------------------------------------------
async function syncInstagram(
  supabase: Supa,
  accountId: string,
  externalAccountId: string,
  dateFrom: string,
  dateTo: string,
  apiKey: string
): Promise<number> {
  // "followers_count" (plural) é o total ATUAL de seguidores da conta — vem
  // igual em toda linha retornada pela Windsor.ai, então gravamos junto de
  // cada dia (redundante, mas simples e é exatamente o que o Artifact
  // original fazia: guardava separado só o último valor visto). O painel lê
  // esse campo do dia mais recente disponível pra mostrar "Total hoje".
  const rows = await fetchWindsorData("instagram", externalAccountId, ["date", "follower_count", "followers_count"], dateFrom, dateTo, apiKey);

  // A Windsor.ai pode devolver mais de uma linha pro mesmo dia (ex.: depois
  // de reconectar a conta, vem quebrado por breakdown interno que não
  // pedimos) — sem agrupar por data, o upsert em lote manda 2+ objetos com
  // a mesma chave (org_id, fonte, data) numa única chamada, e o
  // Postgres rejeita com "ON CONFLICT DO UPDATE command cannot affect row a
  // second time" (bug real, corrigido em 2026-09-17). Agrupa num Map por
  // data primeiro; a última linha vista pra cada dia (a mais completa, já
  // que followers_count_total costuma vir preenchido nas últimas) vence.
  const porData = new Map<string, { follower_count: number; followers_count_total?: number }>();
  for (const row of rows) {
    const data = String(row.date ?? "");
    if (!data) continue;
    const campos: { follower_count: number; followers_count_total?: number } = { follower_count: Number(row.follower_count ?? 0) };
    if (row.followers_count !== null && row.followers_count !== undefined) {
      campos.followers_count_total = Number(row.followers_count) || 0;
    }
    const existente = porData.get(data);
    porData.set(data, existente ? { ...existente, ...campos } : campos);
  }

  const upserts = Array.from(porData.entries()).map(([data, campos]) => ({
    org_id: accountId,
    fonte: "instagram",
    data,
    campos,
    atualizado_em: new Date().toISOString(),
  }));

  if (upserts.length > 0) {
    const { error } = await supabase.from("tr_metrics_daily").upsert(upserts, { onConflict: "org_id,fonte,data" });
    if (error) throw new Error(error.message);
  }
  return upserts.length;
}

// ---------------------------------------------------------------------
// GA4 — cada "tabela" numa chamada própria (Sessão, Usuários, Novos
// usuários, Página), + evento click_whatsapp. Usado para os 2 properties:
// site principal (fonte "ga4") e quiz (fonte "ga4_quiz", que também soma os
// eventos de funil do quiz).
// ---------------------------------------------------------------------
async function syncGA4(
  supabase: Supa,
  accountId: string,
  fonte: "ga4" | "ga4_quiz",
  externalAccountId: string,
  dateFrom: string,
  dateTo: string,
  apiKey: string
): Promise<number> {
  const porData = new Map<string, Record<string, unknown>>();

  function mergeRows(rows: Record<string, unknown>[], mapCampo: (row: Record<string, unknown>) => Record<string, unknown>) {
    for (const row of rows) {
      const data = String(row.date ?? "");
      if (!data) continue;
      const atual = porData.get(data) ?? {};
      porData.set(data, { ...atual, ...mapCampo(row) });
    }
  }

  const conector = "googleanalytics4";

  // Tabela Sessão (+ duração média da sessão, mesma chamada no Artifact original)
  const sessoes = await fetchWindsorData(conector, externalAccountId, ["date", "sessions", "engaged_sessions", "average_session_duration"], dateFrom, dateTo, apiKey);
  mergeRows(sessoes, (r) => ({
    sessions: Number(r.sessions ?? 0),
    engaged_sessions: Number(r.engaged_sessions ?? 0),
    average_session_duration: Number(r.average_session_duration ?? 0),
  }));

  // Tabela Usuários
  const usuarios = await fetchWindsorData(conector, externalAccountId, ["date", "active_users"], dateFrom, dateTo, apiKey);
  mergeRows(usuarios, (r) => ({ active_users: Number(r.active_users ?? 0) }));

  // Tabela Novos usuários
  const novosUsuarios = await fetchWindsorData(conector, externalAccountId, ["date", "newusers"], dateFrom, dateTo, apiKey);
  mergeRows(novosUsuarios, (r) => ({ new_users: Number(r.newusers ?? 0) }));

  // Tabela Página (visualizações totais do property)
  const paginas = await fetchWindsorData(conector, externalAccountId, ["date", "screen_page_views"], dateFrom, dateTo, apiKey);
  mergeRows(paginas, (r) => ({ screen_page_views: Number(r.screen_page_views ?? 0) }));

  // Evento click_whatsapp — chamada própria, evita cruzar com as agregações acima.
  try {
    const clicksWhats = await fetchWindsorData(
      conector,
      externalAccountId,
      ["date", "event_name", "event_count"],
      dateFrom,
      dateTo,
      apiKey
    );
    for (const row of clicksWhats) {
      if (String(row.event_name ?? "") !== "click_whatsapp") continue;
      const data = String(row.date ?? "");
      if (!data) continue;
      const atual = porData.get(data) ?? {};
      porData.set(data, { ...atual, click_whatsapp: Number(row.event_count ?? 0) });
    }
  } catch {
    // Evento customizado pode não existir neste property — não deve derrubar o resto do sync.
  }

  // Funil do quiz — só para o property do quiz, e isolado em try/catch
  // (é a seção mais frágil no Artifact original por depender de evento
  // customizado que pode não estar configurado).
  if (fonte === "ga4_quiz") {
    try {
      const eventosQuiz = await fetchWindsorData(
        conector,
        externalAccountId,
        ["date", "event_name", "event_count"],
        dateFrom,
        dateTo,
        apiKey
      );
      const eventosDeInteresse = new Set(["quiz_start", "quiz_complete", "generate_lead"]);
      for (const row of eventosQuiz) {
        const nomeEvento = String(row.event_name ?? "");
        if (!eventosDeInteresse.has(nomeEvento)) continue;
        const data = String(row.date ?? "");
        if (!data) continue;
        const atual = porData.get(data) ?? {};
        porData.set(data, { ...atual, [nomeEvento]: Number(row.event_count ?? 0) });
      }
    } catch {
      // Funil do quiz é best-effort — segue o sync mesmo se essa parte falhar.
    }
  }

  const upserts = Array.from(porData.entries()).map(([data, campos]) => ({
    org_id: accountId,
    fonte,
    data,
    campos,
    atualizado_em: new Date().toISOString(),
  }));

  if (upserts.length > 0) {
    const { error } = await supabase.from("tr_metrics_daily").upsert(upserts, { onConflict: "org_id,fonte,data" });
    if (error) throw new Error(error.message);
  }
  return upserts.length;
}

// `tokensMeta`: token do Meta de cada loja (org_id → token já descriptografado,
// guardado em tr_config). Sem token da loja, usa META_ACCESS_TOKEN do servidor.
export async function syncCredentials(
  supabase: Supa,
  credentials: CredentialRow[],
  apiKey: string,
  modo: ModoSync = "completo",
  tokensMeta: Record<string, string> = {},
): Promise<SyncResult[]> {
  const dateTo = formatDate(new Date());
  const dateFrom = formatDate(new Date(Date.now() - SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000));
  const hourlyDateFrom = formatDate(new Date(Date.now() - HOURLY_SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000));

  const results: SyncResult[] = [];

  for (const cred of credentials) {
    if (!cred.referencia_externa) continue;

    const { data: syncRun } = await supabase
      .from("tr_sync_runs")
      .insert({ org_id: cred.org_id, provedor: cred.provedor, status: "em_andamento" })
      .select("id")
      .single();

    try {
      let linhas = 0;
      let aviso: string | null = null;
      let feitoPeloMeta = false;
      const tokenMeta = tokensMeta[cred.org_id] || process.env.META_ACCESS_TOKEN;
      if (cred.provedor === "facebook" && tokenMeta) {
        // Meta direto (lib/meta-sync.ts): tempo real e todas as campanhas.
        // Se o Meta recusar (token bloqueado/expirado), cai para o Windsor na mesma
        // rodada — o painel não fica mais dias sem dados por causa do token.
        try {
          linhas = await syncMeta(supabase, cred.org_id, cred.referencia_externa, tokenMeta, modo);
          feitoPeloMeta = true;
        } catch (erroMeta) {
          if (!apiKey) throw erroMeta;
          aviso = `Meta recusou (${erroMeta instanceof Error ? erroMeta.message : String(erroMeta)}); dados puxados pelo Windsor.`;
          console.error(aviso);
        }
      }
      if (feitoPeloMeta) {
        // já sincronizado acima
      } else if (cred.provedor === "facebook") {
        if (!apiKey) throw new Error("Sem token do Meta (Conexões) nem WINDSOR_API_KEY configurados");
        linhas = await syncFacebook(supabase, cred.org_id, cred.referencia_externa, dateFrom, dateTo, apiKey);
        // Sync horário roda depois da diária (mesma rodada) — precisa que as
        // campanhas já estejam resolvidas/criadas antes de gravar por hora.
        // Isolado em try/catch: se falhar, não deve derrubar a sync diária
        // que já foi gravada com sucesso acima.
        try {
          // Corta a sync horária num teto próprio (25s) — se a Windsor.ai
          // estiver lenta, prefere deixar o horário pra próxima rodada a
          // estourar o maxDuration da rota inteira e derrubar TUDO,
          // inclusive a sync diária que já tinha sido gravada com sucesso.
          await Promise.race([
            syncFacebookHourly(supabase, cred.org_id, cred.referencia_externa, hourlyDateFrom, dateTo, apiKey),
            new Promise((_, reject) => setTimeout(() => reject(new Error("timeout de 25s na sync horária")), 25000)),
          ]);
        } catch (erroHorario) {
          console.error("Falha na sync horária do Facebook (não bloqueia a sync diária):", erroHorario);
        }
      } else if (!apiKey) {
        continue;
      } else if (cred.provedor === "instagram") {
        linhas = await syncInstagram(supabase, cred.org_id, cred.referencia_externa, dateFrom, dateTo, apiKey);
      } else if (cred.provedor === "ga4" || cred.provedor === "ga4_quiz") {
        linhas = await syncGA4(supabase, cred.org_id, cred.provedor, cred.referencia_externa, dateFrom, dateTo, apiKey);
      } else {
        continue;
      }

      if (syncRun) {
        // "erro" guarda só o aviso quando deu certo por outro caminho (aparece em Conexões).
        await supabase.from("tr_sync_runs").update({ status: "ok", concluido_em: new Date().toISOString(), erro: aviso }).eq("id", syncRun.id);
      }
      results.push({ org_id: cred.org_id, provedor: cred.provedor, status: "ok", linhas, ...(aviso ? { erro: aviso } : {}) });
    } catch (err) {
      const mensagem = err instanceof Error ? err.message : String(err);
      if (syncRun) {
        await supabase
          .from("tr_sync_runs")
          .update({ status: "erro", concluido_em: new Date().toISOString(), erro: mensagem })
          .eq("id", syncRun.id);
      }
      results.push({ org_id: cred.org_id, provedor: cred.provedor, status: "erro", erro: mensagem });
    }
  }

  return results;
}
