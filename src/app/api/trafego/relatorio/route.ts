import { quemNoPatio } from "@/lib/patio/servidor";
import { situacaoChave } from "@/lib/patio/google";
import { listarPublicos, lerPrivados } from "@/lib/patio/firestore";
import { montarCarro } from "@/lib/patio/veiculo";
import { custoTotal, valorVenda } from "@/lib/patio/resumo";
import { createAdminClient } from "@/lib/trafego/admin";
import { fetchAll } from "@/lib/trafego/fetchAll";
import { carregarGastoPorCarro } from "@/lib/trafego/gasto-carro";
import { montarRelatorio, type CarroRel, type VeiculoRel } from "@/lib/trafego/relatorio-anuncios";
import { planilhaRelatorio } from "@/lib/trafego/relatorio-anuncios-xlsx";
import { pdfRelatorio, type GrupoSituacao, type OpcoesPdf, type OrdemCarros } from "@/lib/trafego/relatorio-anuncios-pdf";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/trafego/relatorio?de=AAAA-MM-DD&ate=AAAA-MM-DD[&formato=pdf] — planilha (.xlsx)
// ou PDF com o custo de cada carro mês a mês.
// Opções do PDF: secoes=numeros,objetivos,carros · conversas=0 · detalhe=0 · imposto=0
// · situacoes=available,sold,fora,outros · minimo=100 · ordem=gasto|nome|custo|conversas
// · inline=1 (abre na prévia em vez de baixar).
// com resumo, por carro, por campanha, divisões, sem vínculo e dia a dia.
// Sem datas = desde o início. Custo e lucro dos carros só para sócio.
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const erro = (msg: string, status: number) => new Response(JSON.stringify({ erro: msg }), { status, headers: { "Content-Type": "application/json" } });

const SITUACOES: GrupoSituacao[] = ["available", "sold", "fora", "outros"];
const ORDENS: OrdemCarros[] = ["gasto", "nome", "custo", "conversas"];
function lerOpcoes(q: URLSearchParams): OpcoesPdf {
  const secoes = q.get("secoes")?.split(",") ?? null;
  const nao = (k: string) => q.get(k) === "0";
  const ordem = q.get("ordem") as OrdemCarros | null;
  const minimo = Number(q.get("minimo"));
  return {
    numeros: !secoes || secoes.includes("numeros"),
    objetivos: !secoes || secoes.includes("objetivos"),
    carros: !secoes || secoes.includes("carros"),
    conversas: !nao("conversas"), detalhe: !nao("detalhe"), imposto: !nao("imposto"),
    situacoes: (q.get("situacoes")?.split(",") ?? []).filter((x): x is GrupoSituacao => SITUACOES.includes(x as GrupoSituacao)),
    minimo: Number.isFinite(minimo) && minimo > 0 ? minimo : 0,
    ordem: ordem && ORDENS.includes(ordem) ? ordem : "gasto",
  };
}

export async function GET(req: Request) {
  const q = await quemNoPatio();
  if ("erro" in q) return erro(q.erro, q.status);
  if (q.papel === "vendedor") return erro("Só sócios e marketing.", 403);
  const u = new URL(req.url);
  const de = u.searchParams.get("de") || "";
  const ate = u.searchParams.get("ate") || "";
  if ((de && !DATA.test(de)) || (ate && !DATA.test(ate)) || (de && ate && de > ate)) return erro("período inválido", 400);
  const pdf = u.searchParams.get("formato") === "pdf";
  const opcoes = lerOpcoes(u.searchParams);
  const inline = u.searchParams.get("inline") === "1";
  const socio = q.papel === "socio";
  const admin = createAdminClient();
  try {
    const [g, veic, dest, pub] = await Promise.all([
      carregarGastoPorCarro(admin, q.orgId, { desde: de || undefined, ate: ate || undefined }),
      fetchAll<VeiculoRel>((a, b) => admin.from("veiculos").select("id, modelo, placa, site_vehicle_id").eq("org_id", q.orgId).order("id").range(a, b)),
      admin.from("tr_link_destinos").select("id, nome").eq("org_id", q.orgId),
      situacaoChave() === "ok" ? listarPublicos(q.projeto) : Promise.resolve([]),
    ]);
    const priv = socio && pub.length ? await lerPrivados(q.projeto, pub.map((p) => p.id)) : {};
    const s = (v: unknown) => (v == null ? "" : String(v)).trim();
    const patio: CarroRel[] = pub.map((p) => {
      const c = montarCarro(p.id, p.dados, priv[p.id] ?? {}, { criadoEm: p.criadoEm, atualizadoEm: p.atualizadoEm });
      const custo = socio ? custoTotal(c) : 0;
      return {
        id: p.id,
        nome: [s(c.brand), s(c.model), s(c.versao), s(c.year)].filter(Boolean).join(" ") || "Carro sem nome",
        placa: s(c.plate) || null, status: s(c.status), preco: Number(c.finance?.sale_price) || null,
        custo: socio && custo > 0 ? custo : null,
        venda: socio && c.status === "sold" ? valorVenda(c) || null : null,
      };
    });
    const r = montarRelatorio({
      campanhas: g.campanhas, metricas: g.metricas, linhasCarro: g.linhas, divisoes: g.divisoes, patio, veiculos: veic.data,
      destinos: Object.fromEntries(((dest.data ?? []) as { id: string; nome: string }[]).map((d) => [d.id, d.nome])),
    });
    const fmt = (d: string) => d.split("-").reverse().join("/");
    const periodo = de || ate ? `${de ? fmt(de) : "início"} a ${ate ? fmt(ate) : "hoje"}` : "desde o início";
    const agora = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Bahia", dateStyle: "short", timeStyle: "short" }).format(new Date());
    const base = `relatorio-anuncios-ibox-${de || "inicio"}-a-${ate || new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bahia" }).format(new Date())}`;
    if (pdf) {
      const arquivo = await pdfRelatorio(r, { periodo, geradoEm: agora, campanhas: g.campanhas, opcoes });
      return new Response(new Uint8Array(arquivo), {
        headers: { "Content-Type": "application/pdf", "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${base}-por-carro-mes-a-mes.pdf"`, "Cache-Control": "no-store" },
      });
    }
    const arquivo = await planilhaRelatorio(r, { periodo, socio, geradoEm: agora });
    return new Response(new Uint8Array(arquivo), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${base}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[trafego/relatorio]", e);
    return erro("Não foi possível gerar o relatório agora.", 502);
  }
}
