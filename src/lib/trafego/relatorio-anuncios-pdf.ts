import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { Relatorio } from "./relatorio-anuncios";

// PDF do relatório de anúncios: o custo de cada CARRO, mês a mês (uma linha
// por carro, uma coluna por mês). Campanhas não aparecem: todo o gasto das
// campanhas de um carro (e a parte dele nas campanhas divididas) soma no carro.
// Mesmas contas do Excel (montarRelatorio); valores com o imposto de 12% do Meta.

const A4 = { w: 841.89, h: 595.28 }; // paisagem: cabem os meses lado a lado
const M = 32;
const LARGURA = A4.w - M * 2;
const MESES_POR_TABELA = 8;
const COR = {
  tinta: rgb(0.09, 0.1, 0.11),
  mudo: rgb(0.42, 0.43, 0.45),
  linha: rgb(0.87, 0.87, 0.86),
  faixa: rgb(0.955, 0.952, 0.945),
  zebra: rgb(0.985, 0.983, 0.978),
  preto: rgb(0.09, 0.1, 0.11),
  branco: rgb(1, 1, 1),
  ouro: rgb(0.72, 0.55, 0.2),
};
const STATUS: Record<string, string> = { available: "À venda", reserved: "Reservado", sold: "Vendido", unavailable: "Indisponível", review: "Em revisão", fora: "Fora do Pátio" };
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const mesCurto = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ /g, " ");
const num = (n: number) => Math.round(n).toLocaleString("pt-BR");
const porConversa = (g: number, m: number) => (m > 0 ? brl(g / m) : "—");
const r2 = (n: number) => Math.round(n * 100) / 100;

// As fontes padrão do PDF só têm o alfabeto latino (WinAnsi): o resto vira espaço.
const EXTRAS = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
const limpo = (s: string) => [...(s ?? "").normalize("NFC")].map((c) => { const k = c.codePointAt(0)!; return (k >= 32 && k < 127) || (k >= 160 && k <= 255) || EXTRAS.has(c) ? c : " "; }).join("").replace(/\s+/g, " ").trim();

export type CarroMes = { chave: string; nome: string; placa: string; situacao: string; porMes: Record<string, number>; gasto: number; msgs: number };

/** Custo de cada carro em cada mês (parte pura, testada). Tudo que não é carro vai para `semCarro`. */
export function custoPorCarro(r: Relatorio) {
  const info = new Map(r.carros.map((c) => [c.chave, c]));
  const carros = new Map<string, CarroMes>();
  const semCarro = { porMes: {} as Record<string, number>, gasto: 0, msgs: 0 };
  const meses = new Set<string>();
  for (const d of r.dias) {
    const mes = d.data.slice(0, 7);
    meses.add(mes);
    if (!d.carroId) {
      semCarro.porMes[mes] = (semCarro.porMes[mes] ?? 0) + d.gasto;
      semCarro.gasto += d.gasto; semCarro.msgs += d.msgs;
      continue;
    }
    const c = info.get(d.carroId);
    const x = carros.get(d.carroId) ?? {
      chave: d.carroId,
      nome: c?.nome ?? d.alvo,
      placa: c?.placa ?? "",
      situacao: c ? STATUS[c.status] ?? c.status : "",
      porMes: {}, gasto: 0, msgs: 0,
    };
    x.porMes[mes] = (x.porMes[mes] ?? 0) + d.gasto;
    x.gasto += d.gasto; x.msgs += d.msgs;
    carros.set(d.carroId, x);
  }
  const fecha = <T extends { porMes: Record<string, number>; gasto: number; msgs: number }>(x: T): T => ({
    ...x, gasto: r2(x.gasto), msgs: Math.round(x.msgs), porMes: Object.fromEntries(Object.entries(x.porMes).map(([k, v]) => [k, r2(v)])),
  });
  const lista = [...carros.values()].map(fecha).sort((a, b) => b.gasto - a.gasto);
  const listaMeses = [...meses].sort();
  const totalCarros = { porMes: Object.fromEntries(listaMeses.map((m) => [m, r2(lista.reduce((s, c) => s + (c.porMes[m] ?? 0), 0))])), gasto: r2(lista.reduce((s, c) => s + c.gasto, 0)), msgs: lista.reduce((s, c) => s + c.msgs, 0) };
  const sem = fecha(semCarro);
  // O total vem da conta (montarRelatorio), para bater centavo a centavo com o Excel e o painel.
  const total = { porMes: Object.fromEntries(listaMeses.map((m) => [m, r2((totalCarros.porMes[m] ?? 0) + (sem.porMes[m] ?? 0))])), gasto: r.total.gasto, msgs: r.total.msgs };
  return { meses: listaMeses, carros: lista, totalCarros, semCarro: sem, total };
}

export async function pdfRelatorio(r: Relatorio, o: { periodo: string; geradoEm: string }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Custo de anúncio por carro, mês a mês — ${o.periodo}`);
  doc.setAuthor("Sistema iBox");
  doc.setCreator("Sistema iBox");
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const fb = await doc.embedFont(StandardFonts.HelveticaBold);

  let pg: PDFPage = doc.addPage([A4.w, A4.h]);
  let y = A4.h - M;
  let secao = "";

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
  const novaPagina = () => {
    pg = doc.addPage([A4.w, A4.h]); y = A4.h - M;
    texto(`iBox Prime · Custo de anúncio por carro${secao ? ` · ${secao} (continuação)` : ""}`, M, y - 8, { size: 8, cor: COR.mudo });
    texto(o.periodo, 0, y - 8, { size: 8, cor: COR.mudo, dir: A4.w - M });
    y -= 22;
  };

  type Col = { titulo: string; w: number; dir?: boolean };
  type Linha = { cels: string[]; negrito?: boolean; fundo?: boolean; mudo?: boolean };
  function tabela(cols: Col[], linhas: Linha[]) {
    const size = 8, alt = 16.5;
    const esc = LARGURA / cols.reduce((s, c) => s + c.w, 0);
    const ws = cols.map((c) => c.w * esc);
    const cab = () => {
      pg.drawRectangle({ x: M, y: y - alt, width: LARGURA, height: alt, color: COR.preto });
      let x = M;
      cols.forEach((c, i) => { texto(corta(c.titulo, fb, 7.5, ws[i] - 8), x + 4, y - 11, { font: fb, size: 7.5, cor: COR.branco, dir: c.dir ? x + ws[i] - 4 : undefined }); x += ws[i]; });
      y -= alt;
    };
    if (y - alt * 3 < M + 20) novaPagina();
    cab();
    linhas.forEach((l, n) => {
      if (y - alt < M + 20) { novaPagina(); cab(); }
      if (l.fundo || n % 2 === 1) pg.drawRectangle({ x: M, y: y - alt, width: LARGURA, height: alt, color: l.fundo ? COR.faixa : COR.zebra });
      let x = M;
      const font = l.negrito ? fb : f;
      l.cels.forEach((c, i) => {
        const vazio = c === "—";
        texto(corta(c, font, size, ws[i] - 8), x + 4, y - 11, { font, size, cor: vazio || l.mudo ? COR.mudo : COR.tinta, dir: cols[i].dir ? x + ws[i] - 4 : undefined });
        x += ws[i];
      });
      pg.drawLine({ start: { x: M, y: y - alt }, end: { x: M + LARGURA, y: y - alt }, thickness: 0.4, color: COR.linha });
      y -= alt;
    });
    y -= 14;
  }

  const d = custoPorCarro(r);

  // ---------- Cabeçalho e números ----------
  pg.drawRectangle({ x: 0, y: A4.h - 96, width: A4.w, height: 96, color: COR.preto });
  texto("iBox Prime Veículos", M, A4.h - 32, { size: 10, cor: COR.ouro, font: fb });
  texto("Custo de anúncio por carro, mês a mês", M, A4.h - 56, { size: 19, cor: COR.branco, font: fb });
  texto(`Período: ${o.periodo}  ·  gerado em ${o.geradoEm} pelo Sistema iBox  ·  Meta (Facebook e Instagram), com imposto de 12%`, M, A4.h - 78, { size: 8.5, cor: rgb(0.78, 0.78, 0.78) });
  y = A4.h - 114;

  const kpis: [string, string, string][] = [
    ["Investido no total", brl(d.total.gasto), `${num(d.total.msgs)} conversas · ${porConversa(d.total.gasto, d.total.msgs)} cada`],
    ["Investido em carros", brl(d.totalCarros.gasto), d.total.gasto ? `${((d.totalCarros.gasto / d.total.gasto) * 100).toFixed(0)}% do total` : ""],
    ["Carros anunciados", String(d.carros.length), `${porConversa(d.totalCarros.gasto, d.totalCarros.msgs)} por conversa`],
    ["Anúncios sem carro", brl(d.semCarro.gasto), "Instagram, site, marca, alcance"],
  ];
  const kw = LARGURA / kpis.length;
  kpis.forEach(([rot, val, sub], i) => {
    const x = M + i * kw;
    pg.drawRectangle({ x: x + (i ? 4 : 0), y: y - 54, width: kw - 4, height: 54, borderColor: COR.linha, borderWidth: 0.8, color: COR.branco });
    texto(rot, x + 12, y - 15, { size: 7.5, cor: COR.mudo });
    texto(val, x + 12, y - 33, { size: 14, font: fb, cor: i === 0 ? COR.ouro : COR.tinta });
    texto(sub, x + 12, y - 46, { size: 7, cor: COR.mudo });
  });
  y -= 74;

  // ---------- Tabela carro × mês ----------
  const grupos: string[][] = [];
  for (let i = 0; i < d.meses.length; i += MESES_POR_TABELA) grupos.push(d.meses.slice(i, i + MESES_POR_TABELA));
  if (!grupos.length) grupos.push([]);
  const v = (n: number | undefined) => (n ? brl(n) : "—");
  grupos.forEach((ms, gi) => {
    const ultimo = gi === grupos.length - 1;
    secao = "";
    if (gi > 0) novaPagina();
    const tit = grupos.length > 1 && ms.length ? `Custo por carro: ${mesCurto(ms[0])} a ${mesCurto(ms[ms.length - 1])}` : "Custo por carro, mês a mês";
    texto(tit, M, y - 13, { font: fb, size: 13 });
    texto("Uma linha por carro, do que mais recebeu anúncio para o que menos recebeu. Todas as campanhas do carro somadas.", M, y - 26, { size: 8.5, cor: COR.mudo });
    y -= 38;
    secao = tit;
    const cols: Col[] = [
      { titulo: "Carro", w: 170 }, { titulo: "Placa", w: 50 }, { titulo: "Situação", w: 64 },
      ...ms.map((m) => ({ titulo: mesCurto(m), w: 58, dir: true })),
      ...(ultimo ? [{ titulo: "Total", w: 66, dir: true }, { titulo: "Conversas", w: 52, dir: true }, { titulo: "R$/conversa", w: 58, dir: true }] : []),
    ];
    const resto = (x: { gasto: number; msgs: number }) => (ultimo ? [brl(x.gasto), num(x.msgs), porConversa(x.gasto, x.msgs)] : []);
    tabela(cols, [
      ...d.carros.map((c) => ({ cels: [c.nome, c.placa, c.situacao, ...ms.map((m) => v(c.porMes[m])), ...resto(c)] })),
      { cels: ["Total em carros", "", "", ...ms.map((m) => v(d.totalCarros.porMes[m])), ...resto(d.totalCarros)], negrito: true, fundo: true },
      { cels: ["Anúncios sem carro", "", "", ...ms.map((m) => v(d.semCarro.porMes[m])), ...resto(d.semCarro)], mudo: true },
      { cels: ["Total da conta", "", "", ...ms.map((m) => v(d.total.porMes[m])), ...resto(d.total)], negrito: true, fundo: true },
    ]);
  });
  secao = "";
  if (y < M + 50) novaPagina();
  texto("Cada carro soma todas as campanhas dele e a parte dele nas campanhas divididas entre vários carros. “Fora do Pátio”: cadastro antigo do Marketing ainda não ligado a um carro do Pátio.", M, y, { size: 7.5, cor: COR.mudo });
  texto("“Anúncios sem carro”: campanhas de Instagram, site, marca ou alcance, e campanhas ainda sem vínculo. Valores com o imposto de 12% do Meta.", M, y - 10, { size: 7.5, cor: COR.mudo });

  const paginas = doc.getPages();
  paginas.forEach((p, i) => {
    const t = limpo(`Sistema iBox · página ${i + 1} de ${paginas.length}`);
    p.drawText(t, { x: A4.w - M - f.widthOfTextAtSize(t, 7.5), y: 16, size: 7.5, font: f, color: COR.mudo });
  });
  return doc.save();
}
