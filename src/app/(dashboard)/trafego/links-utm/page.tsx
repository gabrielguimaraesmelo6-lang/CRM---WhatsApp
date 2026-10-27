"use client";

// Reescrita (retrabalhada na Fase 6 pra usar as classes exatas do artefato
// original: .utm-wrap/.utm-card/.utm-field/.utm-row2/.utm-block/.utm-result/
// .utm-history-item, todas já portadas em app/globals.css).

import { useEffect, useState } from "react";
import { AtualizarAgoraButton } from "@/lib/trafego/syncBar";
import { createClient } from "@/lib/supabase/client";
import { orgIdAtual } from "@/lib/trafego/org";


type UtmLink = {
  id: string;
  nome: string;
  url_destino: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  url_gerada: string;
  cliques: number;
  criado_em: string;
};

const ORIGENS = ["meta", "google", "tiktok", "instagram", "whatsapp"];
const MEIOS: [string, string][] = [
  ["cpc", "cpc (anúncio pago)"],
  ["organic", "organic (post orgânico)"],
  ["stories", "stories"],
  ["reels", "reels"],
];

// Porta exata do slugify do Artifact: normaliza acentos (NFD + remove
// diacríticos) e troca espaço por "+" — carro/campanha/criativo nunca podem
// ter espaço/acento cru numa URL de anúncio.
function slugify(str: string): string {
  if (!str) return "";
  return str
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/\s+/g, "+");
}

function buildParts(baseUrlRaw: string, carroRaw: string, source: string, medium: string, campaignRaw: string, contentRaw: string) {
  const base = baseUrlRaw.trim();
  const carro = slugify(carroRaw);
  if (!base || !carro) return null;
  const baseComProtocolo = /^https?:\/\//i.test(base) ? base : `https://${base}`;
  const parts = [`carro=${carro}`, `utm_source=${source}`, `utm_medium=${medium}`];
  const campaign = slugify(campaignRaw);
  if (campaign) parts.push(`utm_campaign=${campaign}`);
  const content = slugify(contentRaw);
  if (content) parts.push(`utm_content=${content}`);
  return { base: baseComProtocolo, params: parts.join("&") };
}

function fullUrl(base: string, params: string): string {
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${params}`;
}

function QueryHighlight({ query }: { query: string }) {
  return (
    <>
      {query.split("&").map((pair, i) => {
        const eq = pair.indexOf("=");
        const key = pair.slice(0, eq);
        const val = pair.slice(eq + 1);
        return (
          <span key={i}>
            {i > 0 && <span className="amp">&amp;</span>}
            {key}=<span className="val">{val}</span>
          </span>
        );
      })}
    </>
  );
}

function CopyButton({ text, disabled, onCopied }: { text: string; disabled: boolean; onCopied?: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copiar() {
    if (disabled) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      onCopied?.();
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard indisponível — ignora silenciosamente
    }
  }
  return (
    <button className="btn btn-ghost btn-sm utm-copybtn" onClick={copiar} disabled={disabled}>
      {copied ? "✓ Copiado" : "📋 Copiar"}
    </button>
  );
}

// Gerador de link UTM — porta exata da lógica do Artifact ("Gerador de link —
// iBox Prime"): monta o link do quiz com carro+UTM certos pra colar no Meta
// Ads (link de destino + parâmetros em campos separados) ou usar completo
// (WhatsApp/bio/post). Cada link copiado é salvo em `utm_links` (Postgres) em
// vez do histórico local do Artifact — fica compartilhado entre quem usa o
// painel, não preso ao navegador de quem gerou.
export default function LinksUtmPage() {
  const supabase = createClient();
  const [accountId, setAccountId] = useState<string | null>(null);
  const [links, setLinks] = useState<UtmLink[]>([]);
  const [loading, setLoading] = useState(true);

  const [baseUrl, setBaseUrl] = useState("");
  const [carro, setCarro] = useState("");
  const [source, setSource] = useState("meta");
  const [medium, setMedium] = useState("cpc");
  const [campaign, setCampaign] = useState("");
  const [content, setContent] = useState("");
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);

  async function carregarTudo() {
    const accId = await orgIdAtual(supabase);
    if (!accId) {
      setLoading(false);
      return;
    }
    setAccountId(accId);

    const { data } = await supabase
      .from("tr_utm_links")
      .select("id, nome, url_destino, utm_source, utm_medium, utm_campaign, utm_content, url_gerada, cliques, criado_em")
      .eq("org_id", accId)
      .order("criado_em", { ascending: false })
      .limit(20);

    setLinks((data ?? []) as UtmLink[]);
    setLoading(false);
    setLastLoadedAt(new Date());
  }

  useEffect(() => {
    carregarTudo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const parts = buildParts(baseUrl, carro, source, medium, campaign, content);
  const linkCompleto = parts ? fullUrl(parts.base, parts.params) : null;

  async function registrarGeracao() {
    if (!accountId || !parts || !linkCompleto) return;
    await supabase.from("tr_utm_links").insert({
      org_id: accountId,
      nome: carro.trim() || "(sem carro)",
      url_destino: parts.base,
      utm_source: source,
      utm_medium: medium,
      utm_campaign: slugify(campaign) || null,
      utm_content: slugify(content) || null,
      url_gerada: linkCompleto,
    });
    carregarTudo();
  }

  function limparForm() {
    setCarro("");
    setCampaign("");
    setContent("");
  }

  async function excluirLink(id: string) {
    if (!window.confirm("Excluir este link do histórico?")) return;
    await supabase.from("tr_utm_links").delete().eq("id", id);
    carregarTudo();
  }

  return (
    <main className="utm-wrap">
      <div className="utm-card">
        <h2>Gerador de link — iBox Prime</h2>
        <p style={{ fontSize: 13, color: "var(--tr-text)" }}>Monta o link do quiz pra cada anúncio, com carro e UTM certos, sem erro de digitação.</p>
      </div>

      <div className="utm-card">
        <h2>Dados do anúncio</h2>

        <div className="utm-field">
          <label>Link do quiz</label>
          <input type="text" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://quiz.iboxprime.com.br/" />
          <p className="hint">Cole aqui a URL onde o quiz está publicado.</p>
        </div>

        <div className="utm-field">
          <label>Carro do anúncio</label>
          <input type="text" value={carro} onChange={(e) => setCarro(e.target.value)} placeholder="Corolla 2023" />
          <p className="hint">Um anúncio = um carro. Chega na mensagem do vendedor, não aparece pro lead.</p>
        </div>

        <div className="utm-row2">
          <div className="utm-field">
            <label>Origem</label>
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              {ORIGENS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="utm-field">
            <label>Meio</label>
            <select value={medium} onChange={(e) => setMedium(e.target.value)}>
              {MEIOS.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="utm-field">
          <label>Nome da campanha</label>
          <input type="text" value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="lancamento_corolla_setembro" />
          <p className="hint">Sem espaço/acento — é convertido automaticamente enquanto você digita.</p>
        </div>

        <div className="utm-field">
          <label>Criativo (opcional)</label>
          <input type="text" value={content} onChange={(e) => setContent(e.target.value)} placeholder="foto_frente" />
          <p className="hint">Ajuda a saber qual imagem/vídeo gerou o lead, quando testa mais de um.</p>
        </div>
      </div>

      <div className="utm-card">
        <h2>Link pronto pro Meta Ads</h2>

        <div className="utm-block">
          <div className="utm-block-label">
            <span>Link de destino</span>
            <CopyButton text={parts?.base ?? ""} disabled={!parts} />
          </div>
          <div className="utm-result">{parts ? parts.base : <span className="placeholder">Preencha o link do quiz e o carro pra gerar…</span>}</div>
        </div>

        <div className="utm-block">
          <div className="utm-block-label">
            <span>Parâmetros da URL</span>
            <CopyButton text={parts?.params ?? ""} disabled={!parts} onCopied={registrarGeracao} />
          </div>
          <div className="utm-result">{parts ? <QueryHighlight query={parts.params} /> : <span className="placeholder">Preencha o link do quiz e o carro pra gerar…</span>}</div>
          <p className="hint" style={{ marginTop: 8 }}>
            No Meta Ads: cole o <b>link de destino</b> no campo &quot;URL do site&quot; e os <b>parâmetros</b> no campo &quot;Parâmetros de URL&quot; do anúncio.
          </p>
        </div>

        <div className="utm-block">
          <div className="utm-block-label">
            <span>Link completo (opcional — WhatsApp, bio, post)</span>
            <CopyButton text={linkCompleto ?? ""} disabled={!parts} onCopied={registrarGeracao} />
          </div>
          <div className="utm-result">
            {parts ? (
              <>
                {parts.base}
                <span className="amp">?</span>
                <QueryHighlight query={parts.params} />
              </>
            ) : (
              <span className="placeholder">—</span>
            )}
          </div>
        </div>

        <div className="utm-clear-row">
          <button className="btn btn-ghost btn-sm" onClick={limparForm}>
            Limpar carro/campanha/criativo
          </button>
        </div>
      </div>

      <div className="utm-card">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <h2>Últimos gerados</h2>
            <p className="text-[11px]" style={{ color: "var(--tr-text-dim)" }}>
              {lastLoadedAt ? `Última atualização: ${lastLoadedAt.toLocaleString("pt-BR")}` : "Carregando…"}
            </p>
          </div>
          <AtualizarAgoraButton syncing={loading} onClick={carregarTudo} idleLabel="↻ Atualizar" busyLabel="Atualizando…" />
        </div>
        {loading ? (
          <div className="empty-state">Carregando…</div>
        ) : links.length === 0 ? (
          <div className="empty-state">Nenhum link gerado ainda.</div>
        ) : (
          <div className="utm-history">
            {links.map((link) => (
              <div key={link.id} className="utm-history-item">
                <div className="meta">
                  <div className="car">{link.nome}</div>
                  <div className="sub">{link.utm_campaign || link.url_gerada}</div>
                </div>
                <CopyButton text={link.url_gerada} disabled={false} />
                <button className="btn btn-danger btn-sm" onClick={() => excluirLink(link.id)}>
                  🗑
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
