import { candidatoNoPainel, lerEstoqueSite, normPlaca, type CarroPainel, type VeiculoSite } from "@/lib/trafego/estoqueSite";

// Copia o estoque do site para a tabela `cars` da conta (só servidor).
//
// Regras — nada existente é apagado nem renomeado:
// 1. Carro já ligado ao site (site_vehicle_id): atualiza preço, status, foto e nome do site.
//    Vendido no site → vira "vendido" no painel. O inverso não: quem marca venda no painel decide.
// 2. Carro do painel com a MESMA placa: liga sozinho.
// 3. Carro do painel parecido (placa com 1 letra trocada, ou mesmo modelo): NÃO liga sozinho —
//    fica para conferir na tela Carros, para não juntar dois carros diferentes.
// 4. Nenhum parecido: cria o carro no painel (origem "site").

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supa = any;

export type ResultadoEstoque = { criados: number; atualizados: number; ligados: number; paraConferir: number; noSite: number };

type Linha = CarroPainel & {
  origem: string;
  status: string;
  nome_site?: string | null;
  modelo_site?: string | null;
  preco_site?: number | string | null;
  site_status?: string | null;
  foto_url?: string | null;
};

function camposDoSite(v: VeiculoSite, agora: string) {
  return {
    nome_site: v.nome,
    modelo_site: v.modelo,
    preco_site: v.preco,
    site_status: v.status,
    foto_url: v.foto,
    sincronizado_em: agora,
  };
}

export async function syncEstoque(supabase: Supa, accountId: string, projeto: string): Promise<ResultadoEstoque> {
  const veiculos = await lerEstoqueSite(projeto);
  const { data, error } = await supabase
    .from("veiculos")
    .select("id, placa, modelo, ano, status, origem, site_vehicle_id, nome_site, modelo_site, preco_site, site_status, foto_url")
    .eq("org_id", accountId);
  if (error) throw new Error(`cars: ${error.message}`);
  const cars = (data || []) as Linha[];
  const agora = new Date().toISOString();
  const res: ResultadoEstoque = { criados: 0, atualizados: 0, ligados: 0, paraConferir: 0, noSite: veiculos.length };

  const porSite = new Map(cars.filter((c) => c.site_vehicle_id).map((c) => [c.site_vehicle_id as string, c]));
  const placasUsadas = new Set(cars.map((c) => String(c.placa || "").toUpperCase()));

  for (const v of veiculos) {
    const ligado = porSite.get(v.id);
    if (ligado) {
      // Roda a cada 15 min: só grava quando algo mudou no site.
      const mudou =
        ligado.nome_site !== v.nome ||
        ligado.modelo_site !== v.modelo ||
        (ligado.preco_site == null ? null : Number(ligado.preco_site)) !== v.preco ||
        ligado.site_status !== v.status ||
        (ligado.foto_url ?? null) !== v.foto ||
        (v.status === "sold" && ligado.status !== "vendido") ||
        (ligado.origem === "site" && (ligado.modelo !== (v.nome || ligado.modelo) || (ligado.ano ?? null) !== v.ano));
      if (!mudou) continue;
      const patch: Record<string, unknown> = camposDoSite(v, agora);
      if (v.status === "sold" && ligado.status !== "vendido") patch.status = "vendido";
      if (ligado.origem === "site") {
        patch.modelo = v.nome || ligado.modelo;
        patch.ano = v.ano;
      }
      const { error: e } = await supabase.from("veiculos").update(patch).eq("id", ligado.id);
      if (e) throw new Error(`cars (atualizar ${v.id}): ${e.message}`);
      res.atualizados++;
      continue;
    }

    const cand = candidatoNoPainel(v, cars);
    if (cand && cand.forte) {
      const patch: Record<string, unknown> = { site_vehicle_id: v.id, ...camposDoSite(v, agora) };
      if (v.status === "sold" && cand.car.status !== "vendido") patch.status = "vendido";
      const { error: e } = await supabase.from("veiculos").update(patch).eq("id", cand.car.id);
      if (e) throw new Error(`cars (ligar ${v.id}): ${e.message}`);
      cand.car.site_vehicle_id = v.id;
      porSite.set(v.id, cand.car as Linha);
      res.ligados++;
      continue;
    }
    if (cand) {
      res.paraConferir++;
      continue;
    }

    // Placa é obrigatória e única por conta: sem placa no site, usa um marcador estável.
    let placa = normPlaca(v.placa) || `SITE-${v.id.slice(0, 8).toUpperCase()}`;
    if (placasUsadas.has(placa)) placa = `${placa}-${v.id.slice(0, 4).toUpperCase()}`;
    const { data: novo, error: e } = await supabase
      .from("veiculos")
      .insert({
        org_id: accountId,
        placa,
        modelo: v.nome || v.modelo || "Carro do site",
        ano: v.ano,
        status: v.status === "sold" ? "vendido" : "estoque",
        origem: "site",
        site_vehicle_id: v.id,
        ...camposDoSite(v, agora),
      })
      .select("id, placa, modelo, ano, status, origem, site_vehicle_id")
      .single();
    if (e) throw new Error(`cars (criar ${v.id}): ${e.message}`);
    placasUsadas.add(placa);
    cars.push(novo as Linha);
    porSite.set(v.id, novo as Linha);
    res.criados++;
  }
  return res;
}

// Todas as contas que têm estoque de site configurado.
export async function syncEstoqueTodas(supabase: Supa, apenasConta?: string) {
  let q = supabase.from("tr_config").select("org_id, estoque_firestore_projeto").not("estoque_firestore_projeto", "is", null);
  if (apenasConta) q = q.eq("org_id", apenasConta);
  const { data, error } = await q;
  if (error) throw new Error(`tr_config: ${error.message}`);
  const saida: Array<{ org_id: string } & (ResultadoEstoque | { erro: string })> = [];
  for (const a of ((data || []) as { org_id: string; estoque_firestore_projeto: string }[]).map((c) => ({ id: c.org_id, estoque_firestore_projeto: c.estoque_firestore_projeto }))) {
    try {
      saida.push({ org_id: a.id, ...(await syncEstoque(supabase, a.id, a.estoque_firestore_projeto)) });
    } catch (err) {
      saida.push({ org_id: a.id, erro: err instanceof Error ? err.message : String(err) });
    }
  }
  return saida;
}
