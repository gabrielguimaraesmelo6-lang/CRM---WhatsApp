import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { Relatorio } from "./relatorio-anuncios";

// PDF do relatório de anúncios: custo de cada carro, mês a mês.
// Mesmas contas do Excel (montarRelatorio); valores com o imposto de 12% do Meta.
// Páginas: resumo (total, mês a mês, para onde foi) → um bloco por mês com os
// carros daquele mês → ranking dos carros no período todo.

const A4 = { w: 595.28, h: 841.89 };
const M = 36; // margem
const LARGURA = A4.w - M * 2;
const COR = {
  tinta: rgb(0.09, 0.1, 0.11),
  mudo: rgb(0.42, 0.43, 0.45),
  linha: rgb(0.87, 0.87, 0.86),
  faixa: rgb(0.965, 0.962, 0.955),
  preto: rgb(0.09, 0.1, 0.11),
  branco: rgb(1, 1, 1),
  ouro: rgb(0.72, 0.55, 0.2),
};
const STATUS: Record<string, string> = { available: "À venda", reserved: "Reservado", sold: "Vendido", unavailable: "Indisponível", review: "Em revisão", fora: "Fora do Pátio" };
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const mesBr = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} de ${m.slice(0, 4)}`;
const Mes = (m: string) => mesBr(m).replace(/^./, (c) => c.toUpperCase());
const dataBr = (d: string) => d.slice(0, 10).split("-").reverse().join("/");
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ /g, " ");
const num = (n: number) => Math.round(n).toLocaleString("pt-BR");
const porConversa = (g: number, m: number) => (m > 0 ? brl(g / m) : "—");

// As fontes padrão do PDF só têm o alfabeto latino (WinAnsi): o resto vira espaço.
const EXTRAS = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
const limpo = (s: string) => [...(s ?? "").normalize("NFC")].map((c) => { const k = c.codePointAt(0)!; return (k >= 32 && k < 127) || (k >= 160 && k <= 255) || EXTRAS.has(c) ? c : " "; }).join("").replace(/\s+/g, " ").trim();

type Col = { titulo: string; w: number; dir?: boolean };
type Celula = string;
type Linha = { cels: Celula[]; negrito?: boolean; fundo?: boolean };

export type LinhaMesCarro = { chave: string; nome: string; placa: string; situacao: string; campanhas: number; gasto: number; msgs: number; carro: boolean };

/** Agrupa o dia a dia em mês → carro (ou finalidade / sem vínculo). Parte pura, testada. */
export function custoPorMes(r: Relatorio) {
  const carros = new Map(r.carros.map((c) => [c.chave, c]));
  const meses = new Map<string, Map<string, LinhaMesCarro & { camps: Set<string> }>>();
  for (const d of r.dias) {
    const mes = d.data.slice(0, 7);
    const grupo = meses.get(mes) ?? new Map();
    meses.set(mes, grupo);
    const c = d.carroId ? carros.get(d.carroId) : undefined;
    const chave = d.carroId ?? `${d.destino}:${d.alvo}`;
    const x = grupo.get(chave) ?? {
      chave,
      nome: c ? (c.noPatio ? c.nome : `${c.nome} (fora do Pátio)`) : d.destino === "finalidade" ? d.alvo : "Sem vínculo com carro",
      placa: c?.placa ?? "",
      situacao: c ? STATUS[c.status] ?? c.status : d.destino === "finalidade" ? "Finalidade" : "Sem vínculo",
      campanhas: 0, gasto: 0, msgs: 0, carro: !!d.carroId, camps: new Set<string>(),
    };
    x.gasto += d.gasto; x.msgs += d.msgs; x.camps.add(d.campanhaId);
    grupo.set(chave, x);
  }
  return [...meses.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([mes, g]) => {
    const linhas = [...g.values()].map(({ camps, ...x }) => ({ ...x, campanhas: camps.size, gasto: Math.round(x.gasto * 100) / 100, msgs: Math.round(x.msgs) }));
    const ordem = (a: LinhaMesCarro, b: LinhaMesCarro) => b.gasto - a.gasto;
    const emCarros = linhas.filter((l) => l.carro).sort(ordem);
    const outros = linhas.filter((l) => !l.carro).sort(ordem);
    const soma = (ls: LinhaMesCarro[], k: "gasto" | "msgs") => ls.reduce((s, l) => s + l[k], 0);
    return { mes, carros: emCarros, outros, gasto: soma(linhas, "gasto"), msgs: soma(linhas, "msgs"), gastoCarros: soma(emCarros, "gasto"), qtdCarros: emCarros.length };
  });
}

export async function pdfRelatorio(r: Relatorio, o: { periodo: string; geradoEm: string }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Relatório de anúncios por carro — ${o.periodo}`);
  doc.setAuthor("Sistema iBox");
  doc.setCreator("Sistema iBox");
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const fb = await doc.embedFont(StandardFonts.HelveticaBold);

  let pg: PDFPage = doc.addPage([A4.w, A4.h]);
  let y = A4.h - M;
  let secao = ""; // repetido no topo das páginas de continuação

  const texto = (t: string, x: number, yy: number, o2: { font?: PDFFont; size?: number; cor?: ReturnType<typeof rgb>; dir?: number } = {}) => {
    const font = o2.font ?? f, size = o2.size ?? 9, s = limpo(t);
    const xx = o2.dir != null ? o2.dir - font.widthOfTextAtSize(s, size) : x;
    pg.drawText(s, { x: xx, y: yy, size, font, color: o2.cor ?? COR.tinta });
  };
  const corta = (t: string, font: PDFFont, size: number, w: number) => {
    let s = limpo(t);
    if (font.widthOfTextAtSize(s, size) <= w) return s;
    while (s.length > 1 && font.widthOfTextAtSize(s + "…", size) > w) s = s.slice(0, -1);
    return s.trimEnd() + "…";
  };
  const novaPagina = () => { pg = doc.addPage([A4.w, A4.h]); y = A4.h - M; cabecalhoPequeno(); };
  const precisa = (h: number) => { if (y - h < M + 24) novaPagina(); };
  function cabecalhoPequeno() {
    texto(`iBox Prime · Relatório de anúncios por carro${secao ? ` · ${secao} (continuação)` : ""}`, M, y - 8, { size: 8, cor: COR.mudo });
    texto(o.periodo, 0, y - 8, { size: 8, cor: COR.mudo, dir: A4.w - M });
    y -= 22;
  }

  function tabela(cols: Col[], linhas: Linha[], opc: { tamanho?: number } = {}) {
    const size = opc.tamanho ?? 8.5, alt = 17;
    const total = cols.reduce((s, c) => s + c.w, 0);
    const esc = LARGURA / total;
    const ws = cols.map((c) => c.w * esc);
    const cab = () => {
      pg.drawRectangle({ x: M, y: y - alt, width: LARGURA, height: alt, color: COR.preto });
      let x = M;
      cols.forEach((c, i) => {
        const t = corta(c.titulo, fb, 7.5, ws[i] - 8);
        texto(t, x + 4, y - 11.5, { font: fb, size: 7.5, cor: COR.branco, dir: c.dir ? x + ws[i] - 4 : undefined });
        x += ws[i];
      });
      y -= alt;
    };
    precisa(alt * 3);
    cab();
    linhas.forEach((l, n) => {
      if (y - alt < M + 24) { novaPagina(); cab(); }
      if (l.fundo || n % 2 === 1) pg.drawRectangle({ x: M, y: y - alt, width: LARGURA, height: alt, color: l.fundo ? COR.faixa : rgb(0.985, 0.983, 0.978) });
      let x = M;
      const font = l.negrito ? fb : f;
      l.cels.forEach((c, i) => {
        const t = corta(c, font, size, ws[i] - 8);
        texto(t, x + 4, y - 11.5, { font, size, dir: cols[i].dir ? x + ws[i] - 4 : undefined });
        x += ws[i];
      });
      pg.drawLine({ start: { x: M, y: y - alt }, end: { x: M + LARGURA, y: y - alt }, thickness: 0.4, color: COR.linha });
      y -= alt;
    });
    y -= 14;
  }

  function titulo(t: string, sub?: string) {
    precisa(60);
    texto(t, M, y - 14, { font: fb, size: 14 });
    y -= 20;
    if (sub) { texto(sub, M, y - 9, { size: 9, cor: COR.mudo }); y -= 15; }
    y -= 4;
  }

  // ---------- Capa / resumo ----------
  pg.drawRectangle({ x: 0, y: A4.h - 118, width: A4.w, height: 118, color: COR.preto });
  texto("iBox Prime Veículos", M, A4.h - 40, { size: 10, cor: COR.ouro, font: fb });
  texto("Relatório de anúncios por carro, mês a mês", M, A4.h - 66, { size: 19, cor: COR.branco, font: fb });
  texto(`Período: ${o.periodo}`, M, A4.h - 88, { size: 10, cor: COR.branco });
  texto(`Gerado em ${o.geradoEm} pelo Sistema iBox. Gasto do Meta (Facebook e Instagram), com imposto de 12%.`, M, A4.h - 104, { size: 8, cor: rgb(0.75, 0.75, 0.75) });
  y = A4.h - 140;

  const kpis: [string, string, string?][] = [
    ["Investido (com imposto)", brl(r.total.gasto)],
    ["Sem imposto (Gerenciador)", brl(r.total.bruto), `imposto ${brl(r.total.imposto)}`],
    ["Conversas", num(r.total.msgs)],
    ["Custo por conversa", porConversa(r.total.gasto, r.total.msgs)],
  ];
  const kw = LARGURA / kpis.length;
  kpis.forEach(([rot, val, sub], i) => {
    const x = M + i * kw;
    pg.drawRectangle({ x: x + (i ? 4 : 0), y: y - 58, width: kw - 4, height: 58, borderColor: COR.linha, borderWidth: 0.8, color: COR.branco });
    texto(rot, x + 12, y - 16, { size: 7.5, cor: COR.mudo });
    texto(val, x + 12, y - 36, { size: 14, font: fb, cor: i === 0 ? COR.ouro : COR.tinta });
    if (sub) texto(sub, x + 12, y - 50, { size: 7, cor: COR.mudo });
  });
  y -= 80;

  const meses = custoPorMes(r);
  titulo("Mês a mês", "Quanto foi investido em cada mês e quanto disso foi para carros.");
  tabela(
    [{ titulo: "Mês", w: 120 }, { titulo: "Investido", w: 90, dir: true }, { titulo: "Conversas", w: 70, dir: true }, { titulo: "Por conversa", w: 80, dir: true }, { titulo: "Em carros", w: 90, dir: true }, { titulo: "Carros anunciados", w: 80, dir: true }],
    [
      ...meses.map((m) => ({ cels: [Mes(m.mes), brl(m.gasto), num(m.msgs), porConversa(m.gasto, m.msgs), brl(m.gastoCarros), String(m.qtdCarros)] })),
      { cels: ["Total", brl(r.total.gasto), num(r.total.msgs), porConversa(r.total.gasto, r.total.msgs), brl(meses.reduce((s, m) => s + m.gastoCarros, 0)), String(r.carros.length)], negrito: true, fundo: true },
    ],
  );

  titulo("Para onde foi o dinheiro");
  tabela(
    [{ titulo: "Destino", w: 200 }, { titulo: "Investido", w: 100, dir: true }, { titulo: "% do total", w: 80, dir: true }, { titulo: "Conversas", w: 80, dir: true }, { titulo: "Por conversa", w: 90, dir: true }],
    r.porDestino.map((d) => ({ cels: [d.nome, brl(d.gasto), r.total.gasto ? `${((d.gasto / r.total.gasto) * 100).toFixed(1).replace(".", ",")}%` : "—", num(d.msgs), porConversa(d.gasto, d.msgs)] })),
  );
  texto("Carro do Pátio: campanha ligada a um carro cadastrado. Fora do Pátio: cadastro antigo do Marketing ainda não ligado.", M, y, { size: 7.5, cor: COR.mudo });
  texto("Finalidade: campanha sem carro (Instagram, site, marca, alcance). Campanhas divididas entram na parte de cada carro.", M, y - 10, { size: 7.5, cor: COR.mudo });
  y -= 24;

  // ---------- Um bloco por mês ----------
  const cols: Col[] = [{ titulo: "Carro", w: 200 }, { titulo: "Placa", w: 52 }, { titulo: "Situação", w: 62 }, { titulo: "Camp.", w: 34, dir: true }, { titulo: "Investido", w: 72, dir: true }, { titulo: "Conversas", w: 52, dir: true }, { titulo: "Por conversa", w: 64, dir: true }];
  for (const m of meses) {
    secao = "";
    novaPagina();
    secao = Mes(m.mes);
    titulo(Mes(m.mes), `${brl(m.gasto)} investidos · ${num(m.msgs)} conversas · ${porConversa(m.gasto, m.msgs)} por conversa · ${m.qtdCarros} ${m.qtdCarros === 1 ? "carro anunciado" : "carros anunciados"}`);
    const linhas: Linha[] = m.carros.map((l) => ({ cels: [l.nome, l.placa, l.situacao, String(l.campanhas), brl(l.gasto), num(l.msgs), porConversa(l.gasto, l.msgs)] }));
    if (m.carros.length) linhas.push({ cels: ["Subtotal em carros", "", "", "", brl(m.gastoCarros), num(m.carros.reduce((s, l) => s + l.msgs, 0)), porConversa(m.gastoCarros, m.carros.reduce((s, l) => s + l.msgs, 0))], negrito: true, fundo: true });
    for (const l of m.outros) linhas.push({ cels: [l.nome, "", l.situacao, String(l.campanhas), brl(l.gasto), num(l.msgs), porConversa(l.gasto, l.msgs)] });
    linhas.push({ cels: [`Total de ${mesBr(m.mes)}`, "", "", "", brl(m.gasto), num(m.msgs), porConversa(m.gasto, m.msgs)], negrito: true, fundo: true });
    tabela(cols, linhas);
  }

  // ---------- Período todo por carro ----------
  secao = "";
  novaPagina();
  secao = "Cada carro no período todo";
  titulo("Cada carro no período todo", "Soma de todos os meses, do carro que mais recebeu anúncio para o que menos recebeu.");
  const mesesDoCarro = new Map<string, number>();
  for (const m of meses) for (const l of m.carros) mesesDoCarro.set(l.chave, (mesesDoCarro.get(l.chave) ?? 0) + 1);
  tabela(
    [{ titulo: "Carro", w: 190 }, { titulo: "Situação", w: 60 }, { titulo: "Investido", w: 70, dir: true }, { titulo: "Conversas", w: 50, dir: true }, { titulo: "Por conversa", w: 60, dir: true }, { titulo: "Meses", w: 36, dir: true }, { titulo: "Primeiro dia", w: 56 }, { titulo: "Último dia", w: 56 }],
    [
      ...r.carros.map((c) => ({ cels: [[c.noPatio ? c.nome : `${c.nome} (fora do Pátio)`, c.placa].filter(Boolean).join(" · "), STATUS[c.status] ?? c.status, brl(c.gasto), num(c.msgs), porConversa(c.gasto, c.msgs), String(mesesDoCarro.get(c.chave) ?? 0), dataBr(c.de), dataBr(c.ate)] })),
      { cels: ["Total em carros", "", brl(r.carros.reduce((s, c) => s + c.gasto, 0)), num(r.carros.reduce((s, c) => s + c.msgs, 0)), "", "", "", ""], negrito: true, fundo: true },
    ],
    { tamanho: 8 },
  );

  // Rodapé com número da página
  const paginas = doc.getPages();
  paginas.forEach((p, i) => {
    const t = limpo(`Sistema iBox · página ${i + 1} de ${paginas.length}`);
    p.drawText(t, { x: A4.w - M - f.widthOfTextAtSize(t, 7.5), y: 20, size: 7.5, font: f, color: COR.mudo });
  });
  return doc.save();
}
