"use client";

import { useEffect, useState } from "react";

// Conexão da loja com o Meta Ads: conta de anúncios + token de um usuário do
// sistema do Gerenciador de Negócios (permissão ads_read). O token vai direto
// para o servidor, que confere no Meta e guarda criptografado — o navegador
// nunca mais o vê (a tela só mostra se já existe um salvo).
export function ConexaoMeta({ aoSalvar }: { aoSalvar?: () => void }) {
  const [carregando, setCarregando] = useState(true);
  const [temToken, setTemToken] = useState(false);
  const [atualizadoEm, setAtualizadoEm] = useState<string | null>(null);
  const [conta, setConta] = useState("");
  const [token, setToken] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<{ tom: "ok" | "erro"; texto: string } | null>(null);

  async function carregar() {
    const r = await fetch("/api/trafego/conexao", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      setTemToken(!!j.temToken);
      setAtualizadoEm(j.tokenAtualizadoEm ?? null);
      setConta(j.contaAnuncios ?? "");
    }
    setCarregando(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    carregar();
  }, []);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true);
    setMsg(null);
    const r = await fetch("/api/trafego/conexao", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contaAnuncios: conta, token }),
    });
    const j = await r.json().catch(() => ({}));
    setSalvando(false);
    if (!r.ok) {
      setMsg({ tom: "erro", texto: j.error || "Não foi possível salvar." });
      return;
    }
    setToken("");
    setMsg({ tom: "ok", texto: "Conexão salva. Clique em “Sincronizar agora” para puxar as campanhas." });
    carregar();
    aoSalvar?.();
  }

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="kpi-group-lbl" style={{ margin: 0 }}>Meta Ads (direto, tempo real)</div>
      <form
        onSubmit={salvar}
        className="grid gap-3"
        style={{ background: "var(--tr-surface)", border: "1px solid var(--tr-border)", borderRadius: 10, padding: 16, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", alignItems: "end" }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, color: "var(--tr-text-dim)" }}>
          Conta de anúncios (só os números)
          <input
            value={conta}
            onChange={(e) => setConta(e.target.value)}
            placeholder="ex.: 27671476219123810"
            inputMode="numeric"
            style={{ background: "var(--tr-surface-2)", border: "1px solid var(--tr-border)", borderRadius: 8, padding: "8px 10px", color: "var(--tr-text)" }}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, color: "var(--tr-text-dim)" }}>
          {temToken ? "Trocar token do Meta (deixe vazio para manter)" : "Token do usuário do sistema (Meta)"}
          <input
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={temToken ? "•••••••• salvo" : "cole aqui o token"}
            style={{ background: "var(--tr-surface-2)", border: "1px solid var(--tr-border)", borderRadius: 8, padding: "8px 10px", color: "var(--tr-text)" }}
          />
        </label>
        <button className="btn btn-accent" type="submit" disabled={salvando || carregando}>
          {salvando ? "Salvando…" : "Salvar conexão"}
        </button>
        <p style={{ gridColumn: "1 / -1", fontSize: 12, color: msg?.tom === "erro" ? "var(--tr-bad)" : "var(--tr-text-dim)", margin: 0 }}>
          {msg
            ? msg.texto
            : carregando
              ? "Carregando…"
              : temToken
                ? `Token salvo${atualizadoEm ? ` em ${new Date(atualizadoEm).toLocaleString("pt-BR")}` : ""}. Ele fica criptografado e não aparece de novo.`
                : "Sem token salvo: as campanhas não atualizam sozinhas até você salvar um."}
        </p>
      </form>
    </section>
  );
}
