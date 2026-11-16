"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Relatório "Custo por carro": monta o PDF (o mesmo que se baixa) com as
// opções escolhidas e mostra a prévia ao lado, atualizando a cada mudança.

type Periodo = "mes" | "mesPassado" | "30" | "90" | "ano" | "tudo" | "datas";
type Situacao = "available" | "sold" | "fora" | "outros";
type Ordem = "gasto" | "nome" | "custo" | "conversas";
export type ConfigCarros = {
  tipo: "carros";
  periodo: Periodo; de: string; ate: string;
  numeros: boolean; objetivos: boolean; carros: boolean; conversas: boolean; detalhe: boolean; imposto: boolean;
  situacoes: Situacao[]; minimo: number; ordem: Ordem;
};
type Modelo = { id: string; nome: string; config: ConfigCarros };

const PADRAO: ConfigCarros = { tipo: "carros", periodo: "tudo", de: "", ate: "", numeros: true, objetivos: true, carros: true, conversas: true, detalhe: true, imposto: true, situacoes: [], minimo: 0, ordem: "gasto" };
const PERIODOS: [Periodo, string][] = [["mes", "Este mês"], ["mesPassado", "Mês passado"], ["30", "30 dias"], ["90", "90 dias"], ["ano", "Este ano"], ["tudo", "Desde o início"], ["datas", "Escolher datas"]];
const SITUACOES: [Situacao, string][] = [["available", "À venda"], ["sold", "Vendidos"], ["fora", "Fora do Pátio"], ["outros", "Reservados e outros"]];
const ORDENS: [Ordem, string][] = [["gasto", "Mais investido"], ["conversas", "Mais conversas"], ["custo", "Menor custo por conversa"], ["nome", "Nome do carro"]];
const isoBahia = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bahia" }).format(d);
const completa = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number(s.slice(0, 4)) >= 2000;

function intervalo(c: ConfigCarros): { de: string; ate: string } | null {
  const hoje = new Date(isoBahia(new Date()) + "T12:00:00Z");
  const y = hoje.getUTCFullYear(), m = hoje.getUTCMonth();
  const menos = (n: number) => { const d = new Date(hoje); d.setUTCDate(d.getUTCDate() - n); return isoBahia(d); };
  switch (c.periodo) {
    case "mes": return { de: isoBahia(new Date(Date.UTC(y, m, 1, 12))), ate: menos(0) };
    case "mesPassado": return { de: isoBahia(new Date(Date.UTC(y, m - 1, 1, 12))), ate: isoBahia(new Date(Date.UTC(y, m, 0, 12))) };
    case "30": return { de: menos(29), ate: menos(0) };
    case "90": return { de: menos(89), ate: menos(0) };
    case "ano": return { de: `${y}-01-01`, ate: menos(0) };
    case "tudo": return { de: "", ate: "" };
    case "datas": return completa(c.de) && completa(c.ate) && c.de <= c.ate ? { de: c.de, ate: c.ate } : null;
  }
}

function consulta(c: ConfigCarros, iv: { de: string; ate: string }, formato: "pdf" | "xlsx") {
  const q = new URLSearchParams();
  if (iv.de) q.set("de", iv.de);
  if (iv.ate) q.set("ate", iv.ate);
  if (formato === "xlsx") return q;
  q.set("formato", "pdf");
  q.set("secoes", [c.numeros && "numeros", c.objetivos && "objetivos", c.carros && "carros"].filter(Boolean).join(","));
  if (!c.conversas) q.set("conversas", "0");
  if (!c.detalhe) q.set("detalhe", "0");
  if (!c.imposto) q.set("imposto", "0");
  if (c.situacoes.length) q.set("situacoes", c.situacoes.join(","));
  if (c.minimo > 0) q.set("minimo", String(c.minimo));
  if (c.ordem !== "gasto") q.set("ordem", c.ordem);
  return q;
}

export function CustoPorCarro() {
  const [c, setC] = useState<ConfigCarros>(PADRAO);
  const [previa, setPrevia] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [baixando, setBaixando] = useState<"" | "pdf" | "xlsx">("");
  const [modelos, setModelos] = useState<Modelo[]>([]);
  const [aviso, setAviso] = useState("");
  const ultimaUrl = useRef<string | null>(null);
  const mudar = (p: Partial<ConfigCarros>) => setC((x) => ({ ...x, ...p }));
  const iv = intervalo(c);
  const chave = iv ? consulta(c, iv, "pdf").toString() : "";
  const nenhumaSecao = !c.numeros && !c.objetivos && !c.carros;

  // Prévia: gera o PDF de verdade (inline) um instante depois da última mudança.
  useEffect(() => {
    if (!chave) return;
    let vivo = true;
    const t = setTimeout(async () => {
      setCarregando(true); setErro("");
      try {
        const r = await fetch(`/api/trafego/relatorio?${chave}&inline=1`, { cache: "no-store" });
        if (!r.ok) { const j = await r.json().catch(() => ({})); if (vivo) setErro(j.erro || "Não consegui gerar o relatório."); return; }
        const url = URL.createObjectURL(await r.blob());
        if (!vivo) { URL.revokeObjectURL(url); return; }
        if (ultimaUrl.current) URL.revokeObjectURL(ultimaUrl.current);
        ultimaUrl.current = url;
        setPrevia(url);
      } catch {
        if (vivo) setErro("Sem conexão. Tente de novo.");
      } finally {
        if (vivo) setCarregando(false);
      }
    }, 600);
    return () => { vivo = false; clearTimeout(t); };
  }, [chave]);
  useEffect(() => () => { if (ultimaUrl.current) URL.revokeObjectURL(ultimaUrl.current); }, []);

  useEffect(() => {
    createClient().from("relatorio_modelos").select("id, nome, config").order("criado_em")
      .then(({ data }) => setModelos(((data ?? []) as { id: string; nome: string; config: { tipo?: string } }[]).filter((m) => m.config?.tipo === "carros") as Modelo[]));
  }, []);

  async function baixar(formato: "pdf" | "xlsx") {
    if (!iv) { setErro("Escolha as duas datas (a primeira antes da segunda)."); return; }
    setBaixando(formato); setErro("");
    try {
      const r = await fetch(`/api/trafego/relatorio?${consulta(c, iv, formato)}`, { cache: "no-store" });
      if (!r.ok) { const j = await r.json().catch(() => ({})); setErro(j.erro || "Não consegui gerar o arquivo."); return; }
      const nome = /filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") ?? "")?.[1] ?? `relatorio-ibox.${formato}`;
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch {
      setErro("Sem conexão. Tente de novo.");
    } finally {
      setBaixando("");
    }
  }

  async function salvarModelo() {
    const nome = prompt("Nome do modelo:", "Custo por carro · mensal");
    if (!nome) return;
    const sb = createClient();
    const { data: org } = await sb.rpc("my_branding");
    const orgId = (Array.isArray(org) ? org[0] : org)?.organization_id;
    const { data, error } = await sb.from("relatorio_modelos").insert({ org_id: orgId, nome, config: c }).select("id, nome, config").single();
    if (error) setAviso("Não foi possível salvar o modelo.");
    else { setModelos([...modelos, data as Modelo]); setAviso(`Modelo “${nome}” salvo.`); }
  }

  const alternar = (s: Situacao) => mudar({ situacoes: c.situacoes.includes(s) ? c.situacoes.filter((x) => x !== s) : [...c.situacoes, s] });
  const resumoPeriodo = useMemo(() => {
    if (!iv) return "Escolha as duas datas";
    if (!iv.de) return "Todo o histórico da conta";
    const br = (s: string) => s.split("-").reverse().join("/");
    return `${br(iv.de)} a ${br(iv.ate)}`;
  }, [iv]);
  const marca = (on: boolean, rotulo: string, onChange: () => void, dica?: string) => (
    <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 14, cursor: "pointer" }}>
      <input type="checkbox" checked={on} onChange={onChange} style={{ marginTop: 3 }} />
      <span>{rotulo}{dica && <span className="rot" style={{ display: "block", fontSize: 12 }}>{dica}</span>}</span>
    </label>
  );
  const bloco: React.CSSProperties = { borderTop: "1px solid var(--p-linha-2)", paddingTop: 14, display: "flex", flexDirection: "column", gap: 8 };

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start", maxWidth: 1480 }}>
      <aside className="card" aria-label="Opções do relatório de custo por carro" style={{ flex: "1 1 280px", maxWidth: 330, padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <div className="rot" style={{ marginBottom: 8 }}>Período</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {PERIODOS.map(([k, n]) => <button key={k} type="button" className="chip" aria-pressed={c.periodo === k} onClick={() => mudar({ periodo: k, ...(k === "datas" && !c.de && iv?.de ? { de: iv.de, ate: iv.ate } : {}) })}>{n}</button>)}
          </div>
          {c.periodo === "datas" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
              <label className="campo">De<input type="date" value={c.de} onChange={(e) => mudar({ de: e.target.value })} /></label>
              <label className="campo">Até<input type="date" value={c.ate} onChange={(e) => mudar({ ate: e.target.value })} /></label>
            </div>
          )}
          <div className="rot" style={{ marginTop: 8, fontSize: 12.5 }}>{resumoPeriodo}</div>
        </div>

        <fieldset style={{ ...bloco, border: 0, margin: 0, padding: "14px 0 0" }}>
          <legend className="rot" style={{ float: "left", width: "100%", marginBottom: 2 }}>O que entra no relatório</legend>
          {marca(c.numeros, "Números do topo", () => mudar({ numeros: !c.numeros }), "Total, carros, Instagram, site e visibilidade")}
          {marca(c.objetivos, "Investimento por objetivo, mês a mês", () => mudar({ objetivos: !c.objetivos }))}
          {c.objetivos && <div style={{ paddingLeft: 26 }}>{marca(c.detalhe, "Detalhar cada objetivo", () => mudar({ detalhe: !c.detalhe }), "Engajamento, visitas ao perfil, marca, alcance…")}</div>}
          {marca(c.carros, "Custo de cada carro, mês a mês", () => mudar({ carros: !c.carros }))}
          {marca(c.conversas, "Conversas e custo por conversa", () => mudar({ conversas: !c.conversas }))}
          {nenhumaSecao && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--destructive, #b42318)" }}>Marque pelo menos uma parte. Sem nenhuma, sai só o custo de cada carro.</p>}
        </fieldset>

        {c.carros && (
          <div style={bloco}>
            <div className="rot">Quais carros</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button type="button" className="chip" aria-pressed={!c.situacoes.length} onClick={() => mudar({ situacoes: [] })}>Todos</button>
              {SITUACOES.map(([k, n]) => <button key={k} type="button" className="chip" aria-pressed={c.situacoes.includes(k)} onClick={() => alternar(k)}>{n}</button>)}
            </div>
            <label className="campo" style={{ marginTop: 4 }}>Gasto mínimo do carro no período (R$)
              <input inputMode="numeric" placeholder="0" value={c.minimo ? String(c.minimo) : ""} onChange={(e) => mudar({ minimo: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
            </label>
            <label className="campo">Ordenar carros por
              <select value={c.ordem} onChange={(e) => mudar({ ordem: e.target.value as Ordem })}>{ORDENS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
            </label>
          </div>
        )}

        <div style={bloco}>
          <div className="rot">Valores</div>
          <div className="seg" role="group" aria-label="Imposto">
            <button type="button" aria-pressed={c.imposto} onClick={() => mudar({ imposto: true })}>Com 12% de imposto</button>
            <button type="button" aria-pressed={!c.imposto} onClick={() => mudar({ imposto: false })}>Sem imposto</button>
          </div>
          <span className="rot" style={{ fontSize: 12 }}>{c.imposto ? "Igual ao painel do sistema." : "Igual ao Gerenciador de Anúncios do Meta."}</span>
        </div>

        <div style={{ ...bloco, gap: 8 }}>
          <button type="button" className="btnp" onClick={() => baixar("pdf")} disabled={!!baixando}>{baixando === "pdf" ? "Gerando…" : "Baixar PDF"}</button>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btns" style={{ flex: 1 }} onClick={() => baixar("xlsx")} disabled={!!baixando}>{baixando === "xlsx" ? "Gerando…" : "Baixar Excel"}</button>
            <button type="button" className="btns" style={{ flex: 1 }} onClick={salvarModelo}>Salvar modelo</button>
          </div>
          {modelos.length > 0 && (
            <div className="rot" style={{ fontSize: 13 }}>
              Modelos: {modelos.map((m, i) => (<span key={m.id}>{i > 0 && " · "}<button type="button" onClick={() => setC({ ...PADRAO, ...m.config })} style={{ border: 0, background: "none", color: "var(--p-ink)", textDecoration: "underline", cursor: "pointer", padding: 0, font: "inherit" }}>{m.nome}</button></span>))}
            </div>
          )}
          {aviso && <p role="status" style={{ margin: 0, fontSize: 13 }}>{aviso}</p>}
          {erro && <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--destructive, #b42318)" }}>{erro}</p>}
        </div>
      </aside>

      <section aria-label="Prévia do PDF" className="card" style={{ flex: "999 1 560px", minWidth: 0, padding: 0, overflow: "hidden", position: "relative", height: "calc(100vh - 140px)", minHeight: 560 }}>
        {previa ? <iframe title="Prévia do relatório em PDF" src={`${previa}#view=FitH&toolbar=1`} style={{ width: "100%", height: "100%", border: 0, display: "block" }} />
          : <div className="rot" style={{ display: "grid", placeItems: "center", height: "100%", fontSize: 14 }}>{!iv ? "Escolha as duas datas para ver a prévia." : "Montando a prévia do relatório…"}</div>}
        {carregando && previa && <div className="rot" role="status" style={{ position: "absolute", top: 10, right: 14, background: "var(--p-papel)", border: "1px solid var(--p-linha)", borderRadius: 999, padding: "4px 10px", fontSize: 12 }}>Atualizando…</div>}
      </section>
    </div>
  );
}
