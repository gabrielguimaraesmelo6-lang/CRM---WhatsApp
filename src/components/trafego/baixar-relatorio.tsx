"use client";

import { useState } from "react";

// Botão "Baixar relatório de anúncios": escolhe o período e baixa a planilha
// (.xlsx) com resumo, por carro, por campanha, divisões, sem vínculo e dia a dia,
// ou o PDF com o custo de cada carro mês a mês.

type Opcao = "tudo" | "mes" | "mesPassado" | "30" | "datas";
const iso = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bahia" }).format(d);

function periodo(o: Opcao, de: string, ate: string): { de: string; ate: string } {
  const hoje = new Date(iso(new Date()) + "T12:00:00Z");
  if (o === "mes") return { de: iso(new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1, 12))), ate: iso(hoje) };
  if (o === "mesPassado") return { de: iso(new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - 1, 1, 12))), ate: iso(new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 0, 12))) };
  if (o === "30") { const d = new Date(hoje); d.setUTCDate(d.getUTCDate() - 29); return { de: iso(d), ate: iso(hoje) }; }
  if (o === "datas") return { de, ate };
  return { de: "", ate: "" };
}

export function BaixarRelatorioAnuncios({ classeBotao, estiloBotao }: { classeBotao?: string; estiloBotao?: React.CSSProperties }) {
  const [aberto, setAberto] = useState(false);
  const [o, setO] = useState<Opcao>("tudo");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [baixando, setBaixando] = useState<"" | "pdf" | "xlsx">("");
  const [erro, setErro] = useState("");

  async function baixar(formato: "pdf" | "xlsx") {
    const p = periodo(o, de, ate);
    if (o === "datas" && (!p.de || !p.ate || p.de > p.ate)) { setErro("Escolha as duas datas (a primeira antes da segunda)."); return; }
    setBaixando(formato); setErro("");
    try {
      const qs = new URLSearchParams(Object.entries(p).filter(([, v]) => v));
      if (formato === "pdf") qs.set("formato", "pdf");
      const r = await fetch(`/api/trafego/relatorio?${qs}`, { cache: "no-store" });
      if (!r.ok) { const j = await r.json().catch(() => ({})); setErro(j.erro || "Não consegui gerar o relatório."); return; }
      const nome = /filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") ?? "")?.[1] ?? `relatorio-anuncios.${formato}`;
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setAberto(false);
    } catch {
      setErro("Sem conexão. Tente de novo.");
    } finally {
      setBaixando("");
    }
  }

  const caixa: React.CSSProperties = { position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 40, width: 300, padding: 14, borderRadius: 12, border: "1px solid var(--border, rgba(0,0,0,.15))", background: "var(--card, var(--background, #fff))", color: "var(--foreground, inherit)", boxShadow: "0 10px 30px rgba(0,0,0,.18)", display: "flex", flexDirection: "column", gap: 10, fontSize: 13.5 };
  const campo: React.CSSProperties = { border: "1px solid var(--border, rgba(0,0,0,.2))", borderRadius: 8, padding: "6px 8px", background: "transparent", color: "inherit", width: "100%", boxSizing: "border-box" };

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button type="button" className={classeBotao} style={estiloBotao} onClick={() => setAberto((x) => !x)} aria-expanded={aberto}>Baixar relatório de anúncios</button>
      {aberto && (
        <div role="dialog" aria-label="Baixar relatório de anúncios" style={caixa}>
          <b>Relatório detalhado de anúncios</b>
          <span style={{ fontSize: 12.5, opacity: 0.75 }}>PDF: custo de cada carro, mês a mês, pronto para enviar. Excel: tudo aberto (por carro, campanha, divisões e dia a dia).</span>
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            <legend style={{ fontSize: 12, opacity: 0.75, marginBottom: 4 }}>Período</legend>
            {([["tudo", "Desde o início"], ["mes", "Este mês"], ["mesPassado", "Mês passado"], ["30", "Últimos 30 dias"], ["datas", "Escolher datas"]] as [Opcao, string][]).map(([k, n]) => (
              <label key={k} style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}><input type="radio" name="periodo-relatorio" checked={o === k} onChange={() => setO(k)} />{n}</label>
            ))}
          </fieldset>
          {o === "datas" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>De<input type="date" value={de} onChange={(e) => setDe(e.target.value)} style={campo} /></label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>Até<input type="date" value={ate} onChange={(e) => setAte(e.target.value)} style={campo} /></label>
            </div>
          )}
          {erro && <span role="alert" style={{ color: "var(--destructive, #b42318)", fontSize: 12.5 }}>{erro}</span>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" onClick={() => setAberto(false)} style={{ ...campo, width: "auto", cursor: "pointer" }}>Cancelar</button>
            <button type="button" onClick={() => baixar("xlsx")} disabled={!!baixando} style={{ ...campo, width: "auto", cursor: "pointer" }}>{baixando === "xlsx" ? "Gerando…" : "Excel"}</button>
            <button type="button" onClick={() => baixar("pdf")} disabled={!!baixando} className={classeBotao} style={estiloBotao}>{baixando === "pdf" ? "Gerando…" : "Baixar PDF"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
