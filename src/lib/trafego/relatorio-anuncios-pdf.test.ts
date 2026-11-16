import { describe, expect, it } from "vitest";
import { montarRelatorio } from "./relatorio-anuncios";
import { custoPorCarro, filtrarCarros, objetivoDaCampanha, pdfRelatorio } from "./relatorio-anuncios-pdf";

const base = { status: "ACTIVE", categoria_objetivo: null, destino_id: null, divisao: null };
const rel = montarRelatorio({
  campanhas: [
    { ...base, id: "a", nome: "Corolla", car_id: "v1" },
    { ...base, id: "b", nome: "Hilux", car_id: "v2" },
    { ...base, id: "c", nome: "Engajamento", car_id: null, categoria_objetivo: "instagram" },
  ] as never,
  metricas: [
    { campaign_id: "a", data: "2026-10-30", gasto: 100, msgs: 10 },
    { campaign_id: "a", data: "2026-11-02", gasto: 50, msgs: 5 },
    { campaign_id: "b", data: "2026-11-03", gasto: 200, msgs: 4 },
    { campaign_id: "c", data: "2026-11-03", gasto: 10, msgs: 0 },
  ] as never,
  linhasCarro: [], divisoes: [],
  patio: [{ id: "p1", nome: "Toyota Corolla Altis", placa: "ABC1D23", status: "available", preco: 159000 }],
  veiculos: [{ id: "v1", modelo: "Corolla", placa: null, site_vehicle_id: "p1" }, { id: "v2", modelo: "Hilux SRX", placa: "XYZ9A88", site_vehicle_id: null }],
});

describe("custoPorCarro", () => {
  it("uma linha por carro com o custo de cada mês, somando as campanhas, e fecha com o total da conta", () => {
    const d = custoPorCarro(rel);
    expect(d.meses).toEqual(["2026-10", "2026-11"]);
    expect(d.carros.map((c) => c.nome)).toEqual(["Hilux SRX · XYZ9A88", "Toyota Corolla Altis"]);
    expect(d.carros[0].situacao).toBe("Fora do Pátio");
    expect(d.carros[1]).toMatchObject({ situacao: "À venda", placa: "ABC1D23", porMes: { "2026-10": 112, "2026-11": 56 }, gasto: 168, msgs: 15 });
    expect(d.semCarro).toMatchObject({ porMes: { "2026-11": 11.2 }, gasto: 11.2 });
    expect(d.total.gasto).toBe(rel.total.gasto);
    expect(d.total.porMes["2026-11"]).toBe(291.2);
  });

  it("gera um PDF válido, mesmo com nomes fora do alfabeto latino", async () => {
    const r2 = { ...rel, carros: rel.carros.map((c) => ({ ...c, nome: c.nome + " 🚗 – ✓" })) };
    const b = await pdfRelatorio(r2, { periodo: "desde o início", geradoEm: "16/11/2026 11:00" });
    expect(Buffer.from(b.slice(0, 5)).toString()).toBe("%PDF-");
  });
});

describe("objetivoDaCampanha", () => {
  it("usa a finalidade do sistema e, sem ela, sugere pelo objetivo do Meta e pelo nome", () => {
    expect(objetivoDaCampanha({ nome: "x", categoria_objetivo: "alcance", destino_id: null })).toEqual({ chave: "alcance", sugerido: false });
    expect(objetivoDaCampanha({ nome: "Engajamento Insta", categoria_objetivo: null, destino_id: null, objetivo: "OUTCOME_ENGAGEMENT" })).toEqual({ chave: "perfil_engajamento", sugerido: true });
    expect(objetivoDaCampanha({ nome: "Campanha marca", categoria_objetivo: null, destino_id: null, objetivo: null })).toEqual({ chave: "reconhecimento", sugerido: true });
    expect(objetivoDaCampanha({ nome: "Vendas WhatsApp", categoria_objetivo: null, destino_id: null, objetivo: "OUTCOME_SALES" })).toEqual({ chave: "sem", sugerido: false });
  });

  it("separa o gasto sem carro por objetivo, agrupado (Instagram, Site, Visibilidade…)", () => {
    const d = custoPorCarro(rel, [{ id: "c", nome: "Engajamento", categoria_objetivo: "perfil_engajamento", destino_id: null } as never]);
    expect(d.objetivos).toHaveLength(1);
    expect(d.objetivos[0]).toMatchObject({ nome: "Instagram", gasto: 11.2, itens: [{ chave: "perfil_engajamento", nome: "Engajamento", gasto: 11.2 }] });
  });
});

describe("objetivoDaCampanha com link de destino", () => {
  it("campanha de Instagram ligada a um link vai para Instagram; sem pista, fica como link", () => {
    expect(objetivoDaCampanha({ nome: "25/10 | Engajamento Insta", categoria_objetivo: null, destino_id: "d1", objetivo: "OUTCOME_ENGAGEMENT" })).toEqual({ chave: "perfil_engajamento", sugerido: true });
    expect(objetivoDaCampanha({ nome: "Promo", categoria_objetivo: null, destino_id: "d1", objetivo: "OUTCOME_SALES" })).toEqual({ chave: "destino", sugerido: false });
  });
});

describe("opções do PDF", () => {
  it("sem imposto divide tudo por 1,12 e o total bate com o Gerenciador", () => {
    const d = custoPorCarro(rel, [], 1 / 1.12);
    expect(d.total.gasto).toBe(rel.total.bruto);
    expect(d.carros[1].porMes["2026-10"]).toBe(100);
  });

  it("filtra carros por situação e gasto mínimo, e ordena", () => {
    const d = custoPorCarro(rel);
    expect(filtrarCarros(d.carros, { situacoes: ["available"] }).map((c) => c.grupo)).toEqual(["available"]);
    expect(filtrarCarros(d.carros, { minimo: 200 }).map((c) => c.nome)).toEqual(["Hilux SRX · XYZ9A88"]);
    expect(filtrarCarros(d.carros, { ordem: "nome" }).map((c) => c.nome)).toEqual(["Hilux SRX · XYZ9A88", "Toyota Corolla Altis"]);
    expect(filtrarCarros(d.carros, { ordem: "custo" })[0].nome).toBe("Toyota Corolla Altis");
  });

  it("gera o PDF só com as partes escolhidas", async () => {
    const b = await pdfRelatorio(rel, { periodo: "x", geradoEm: "y", opcoes: { numeros: false, objetivos: false, conversas: false, imposto: false, situacoes: ["sold"] } });
    expect(Buffer.from(b.slice(0, 5)).toString()).toBe("%PDF-");
  });
});
