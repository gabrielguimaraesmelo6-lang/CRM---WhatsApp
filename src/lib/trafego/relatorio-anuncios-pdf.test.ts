import { describe, expect, it } from "vitest";
import { montarRelatorio } from "./relatorio-anuncios";
import { custoPorMes, pdfRelatorio } from "./relatorio-anuncios-pdf";

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

describe("custoPorMes", () => {
  it("separa cada carro em cada mês, com imposto, e fecha com o total da conta", () => {
    const m = custoPorMes(rel);
    expect(m.map((x) => x.mes)).toEqual(["2026-10", "2026-11"]);
    expect(m[0].carros).toHaveLength(1);
    expect(m[0].carros[0]).toMatchObject({ nome: "Toyota Corolla Altis", situacao: "À venda", gasto: 112, msgs: 10 });
    expect(m[1].carros.map((c) => c.nome)).toEqual(["Hilux SRX · XYZ9A88 (fora do Pátio)", "Toyota Corolla Altis"]);
    expect(m[1].outros[0]).toMatchObject({ situacao: "Finalidade", gasto: 11.2 });
    const soma = m.reduce((s, x) => s + x.gasto, 0);
    expect(Math.round(soma * 100) / 100).toBe(rel.total.gasto);
  });

  it("gera um PDF válido, mesmo com nomes fora do alfabeto latino", async () => {
    const r2 = { ...rel, carros: rel.carros.map((c) => ({ ...c, nome: c.nome + " 🚗 – ✓" })) };
    const b = await pdfRelatorio(r2, { periodo: "desde o início", geradoEm: "16/11/2026 11:00" });
    expect(Buffer.from(b.slice(0, 5)).toString()).toBe("%PDF-");
  });
});
