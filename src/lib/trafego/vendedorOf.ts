// Detecção de vendedor a partir do nome da campanha — porta EXATA da regex do
// Artifact original ("Placa a Placa"). Não alterar os padrões sem conferir
// contra o nome de campanhas reais da conta, pois cada padrão corresponde a
// uma convenção de nomenclatura que o time realmente usa no Meta Ads:
//
//   "[20/08] (Whats Rapha) | [Duster]"   -> Rapha
//   "[22/08] | wpp Gabriel | Duster"     -> Gabriel
//   "25/08 | WP [CRM] Duster"            -> CRM
//   "CAMP [CAIO] [FSA] 80KM [25+]"       -> CAIO
//   "(25/08) [WP] Duster"                -> null (institucional, sem vendedor)

export interface VendedorCampaignLike {
  id: number | string;
  nome: string | null;
  /** Sobrescrita manual salva no banco (coluna `campaigns.vendedor_override`).
   * String vazia significa "sem vendedor", explicitamente definido pelo usuário —
   * diferente de `null`/`undefined`, que significa "nunca editado, use a detecção automática". */
  vendedor_override?: string | null;
}

/** Retorna o nome do vendedor detectado (ou a sobrescrita manual), ou `null`
 * quando a campanha não tem vendedor identificável (institucional/geral). */
export function vendedorOf(camp: VendedorCampaignLike): string | null {
  if (camp.vendedor_override !== undefined && camp.vendedor_override !== null) {
    return camp.vendedor_override || null;
  }
  const nome = camp.nome || "";
  let v: string | null = null;
  let m: RegExpMatchArray | null;

  if ((m = nome.match(/\(\s*whats\s+([^)]+?)\s*\)/i))) v = m[1];
  else if ((m = nome.match(/\bwpp\s+([a-zà-ú]+)/i))) v = m[1];
  else if (/\[\s*crm\s*\]/i.test(nome)) v = "CRM";
  else if ((m = nome.match(/^camp\s*\[\s*([^\]]+?)\s*\]/i))) v = m[1];

  if (v) {
    v = v.trim();
    v = v.charAt(0).toUpperCase() + v.slice(1);
  }
  return v;
}

/** Rótulo de exibição — nunca deixa a UI mostrar vazio/null cru. */
export function vendedorLabel(v: string | null): string {
  return v || "Sem vendedor";
}
