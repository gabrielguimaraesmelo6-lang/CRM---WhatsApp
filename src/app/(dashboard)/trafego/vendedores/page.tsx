"use client";

// Reescrita completa (Fase 3.5, retrabalhada na Fase 6 pra usar as classes
// exatas do artefato original) — vendedores IDENTIFICADOS a partir do nome
// das campanhas (regex `vendedorOf`, com override manual), não uma lista
// cadastrada à parte — é por isso que aqui não existe "+ Novo vendedor": o
// vendedor aparece automaticamente assim que uma campanha é atribuída a ele
// (edição inline na ficha do carro ou na tela de Campanhas). Renomear faz
// merge (aplica a nova etiqueta a toda campanha hoje atribuída ao nome
// antigo); excluir é sempre não-destrutivo — só limpa a atribuição de volta
// pra "sem vendedor" nas campanhas, nunca apaga histórico.
//
// Layout: lista mestre lateral (.sidebar/.vend-card) + detalhe inline
// (.main), igual ao padrão já usado em Carros — porte exato do artefato.

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { orgIdAtual } from "@/lib/trafego/org";
import { formatBRL, META_TAX } from "@/lib/trafego/format";
import { vendedorOf, vendedorLabel } from "@/lib/trafego/vendedorOf";
import { useWindsorSyncBar, SyncStatusLine, AtualizarAgoraButton } from "@/lib/trafego/syncBar";
import { fetchAll } from "@/lib/trafego/fetchAll";

type Campaign = { id: string; nome: string; vendedor_override: string | null; car_id: string | null };
type Car = { id: string; modelo: string; placa: string };
type MetricRow = { campaign_id: string; data: string; gasto: number; msgs: number; leads: number };

function resultadosOf(msgs: number, leads: number): number {
  return msgs > 0 ? msgs : leads > 0 ? leads : 0;
}

export default function VendedoresPage() {
  const supabase = createClient();
  const [accountId, setAccountId] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [cars, setCars] = useState<Car[]>([]);
  const [metrics, setMetrics] = useState<MetricRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  async function carregar() {
    setLoading(true);
    const accId = await orgIdAtual(supabase);
    if (!accId) {
      setLoading(false);
      return;
    }
    setAccountId(accId);
    const [{ data: campaignsData }, { data: carsData }, { data: metricsData }] = await Promise.all([
      supabase.from("tr_campaigns").select("id, nome, vendedor_override, car_id").eq("org_id", accId),
      supabase.from("veiculos").select("id, modelo, placa").eq("org_id", accId),
      fetchAll((de, ate) => supabase.from("tr_campaign_metrics_daily").select("campaign_id, data, gasto, msgs, leads").eq("org_id", accId).order("id").range(de, ate)),
    ]);
    setCampaigns((campaignsData ?? []) as Campaign[]);
    setCars((carsData ?? []) as Car[]);
    setMetrics((metricsData ?? []) as MetricRow[]);
    setLoading(false);
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { lastSyncAt, syncing, syncError, sincronizarAgora } = useWindsorSyncBar(accountId, carregar);

  // Totais por campanha (soma de todos os dias) — usado pros KPIs de vendedor/carro.
  const totalsByCampaign = useMemo(() => {
    const map: Record<string, { gasto: number; msgs: number; leads: number }> = {};
    for (const row of metrics) {
      const cur = map[row.campaign_id] || { gasto: 0, msgs: 0, leads: 0 };
      cur.gasto += Number(row.gasto) || 0;
      cur.msgs += Number(row.msgs) || 0;
      cur.leads += Number(row.leads) || 0;
      map[row.campaign_id] = cur;
    }
    return map;
  }, [metrics]);

  // vendedor -> { total:{gasto,resultados}, semCarro:{gasto,resultados,count}, porCarro:{carId:{gasto,resultados}} }
  const stats = useMemo(() => {
    const out: Record<
      string,
      { total: { gasto: number; resultados: number }; semCarro: { gasto: number; resultados: number; count: number }; porCarro: Record<string, { gasto: number; resultados: number }> }
    > = {};
    for (const camp of campaigns) {
      const v = vendedorOf(camp);
      if (!v) continue;
      const t = totalsByCampaign[camp.id] || { gasto: 0, msgs: 0, leads: 0 };
      const res = resultadosOf(t.msgs, t.leads);
      if (!out[v]) out[v] = { total: { gasto: 0, resultados: 0 }, semCarro: { gasto: 0, resultados: 0, count: 0 }, porCarro: {} };
      const b = out[v];
      b.total.gasto += t.gasto;
      b.total.resultados += res;
      if (camp.car_id) {
        if (!b.porCarro[camp.car_id]) b.porCarro[camp.car_id] = { gasto: 0, resultados: 0 };
        b.porCarro[camp.car_id].gasto += t.gasto;
        b.porCarro[camp.car_id].resultados += res;
      } else {
        b.semCarro.gasto += t.gasto;
        b.semCarro.resultados += res;
        b.semCarro.count++;
      }
    }
    return out;
  }, [campaigns, totalsByCampaign]);

  const names = Object.keys(stats).sort((a, b) => stats[b].total.gasto - stats[a].total.gasto);

  useEffect(() => {
    if (selected && !names.includes(selected)) setSelected(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [names.join("|")]);

  async function renameVendedorGlobal(oldLabel: string, newNameRaw: string) {
    const newName = newNameRaw.trim();
    if (!newName || newName === oldLabel) {
      setEditing(null);
      return;
    }
    const ids = campaigns.filter((c) => vendedorLabel(vendedorOf(c)) === oldLabel).map((c) => c.id);
    setCampaigns((prev) => prev.map((c) => (ids.includes(c.id) ? { ...c, vendedor_override: newName } : c)));
    setEditing(null);
    setSelected(newName);
    if (ids.length > 0) await supabase.from("tr_campaigns").update({ vendedor_override: newName }).in("id", ids);
  }

  async function confirmDelete(v: string) {
    const ids = campaigns.filter((c) => vendedorLabel(vendedorOf(c)) === v).map((c) => c.id);
    setCampaigns((prev) => prev.map((c) => (ids.includes(c.id) ? { ...c, vendedor_override: "" } : c)));
    setDeleteConfirm(null);
    if (selected === v) setSelected(null);
    if (ids.length > 0) await supabase.from("tr_campaigns").update({ vendedor_override: "" }).in("id", ids);
  }

  // Série diária (gasto + resultados) de um vendedor, somando todos os dias
  // de todas as campanhas atribuídas a ele — usada no gráfico de evolução.
  function dailySeries(vendedorName: string) {
    const byDate: Record<string, { gasto: number; resultados: number }> = {};
    const idsDoVendedor = new Set(campaigns.filter((c) => vendedorLabel(vendedorOf(c)) === vendedorName).map((c) => c.id));
    for (const row of metrics) {
      if (!idsDoVendedor.has(row.campaign_id)) continue;
      if (!byDate[row.data]) byDate[row.data] = { gasto: 0, resultados: 0 };
      byDate[row.data].gasto += Number(row.gasto) || 0;
      byDate[row.data].resultados += resultadosOf(Number(row.msgs) || 0, Number(row.leads) || 0);
    }
    return Object.keys(byDate)
      .sort()
      .map((date) => ({ date, ...byDate[date] }));
  }

  const selectedStats = selected ? stats[selected] : null;

  if (loading) {
    return (
      <div className="body-grid">
        <main className="main">
          <p className="text-sm" style={{ color: "var(--tr-text-dim)" }}>
            Carregando…
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="body-grid">
      {/* Lateral: lista mestre — porte exato de .vend-card */}
      <aside className="sidebar" style={{ top: 0, height: "100vh" }}>
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <SyncStatusLine lastSyncAt={lastSyncAt} syncing={syncing} syncError={syncError} />
          <AtualizarAgoraButton syncing={syncing} onClick={sincronizarAgora} idleLabel="↻ Atualizar" />
        </div>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--tr-text-dim)" }}>
          Vendedores identificados
        </div>

        {names.length === 0 ? (
          <div className="empty-state">Nenhum vendedor identificado ainda nas campanhas.</div>
        ) : (
          names.map((v) => {
            const t = stats[v].total;
            const isActive = v === selected;

            if (editing === v) {
              return (
                <div key={v} className="vend-card active">
                  <input
                    autoFocus
                    defaultValue={v}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") renameVendedorGlobal(v, editValue || v);
                      if (e.key === "Escape") setEditing(null);
                    }}
                    style={{ width: "100%", background: "var(--tr-surface-2)", border: "1px solid var(--tr-border)", borderRadius: 6, padding: "5px 8px", color: "var(--tr-text)", fontSize: 13.5, marginBottom: 8 }}
                  />
                  <div style={{ display: "flex", gap: 12, fontSize: 12 }}>
                    <button style={{ color: "var(--tr-good)" }} onClick={() => renameVendedorGlobal(v, editValue || v)}>
                      ✓ Salvar
                    </button>
                    <button style={{ color: "var(--tr-text-dim)" }} onClick={() => setEditing(null)}>
                      Cancelar
                    </button>
                  </div>
                </div>
              );
            }
            if (deleteConfirm === v) {
              return (
                <div key={v} className="vend-card" style={{ borderColor: "var(--tr-bad)" }}>
                  <p style={{ fontSize: 12, color: "var(--tr-bad)", marginBottom: 8 }}>
                    Excluir &quot;{v}&quot;? As campanhas voltam a &quot;sem vendedor&quot;.
                  </p>
                  <div style={{ display: "flex", gap: 12, fontSize: 12 }}>
                    <button style={{ color: "var(--tr-bad)" }} onClick={() => confirmDelete(v)}>
                      Sim, excluir
                    </button>
                    <button style={{ color: "var(--tr-text-dim)" }} onClick={() => setDeleteConfirm(null)}>
                      Cancelar
                    </button>
                  </div>
                </div>
              );
            }
            return (
              <div key={v} className={`vend-card${isActive ? " active" : ""}`} onClick={() => setSelected(v)}>
                <div className="head">
                  <span className="nome" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {v}
                  </span>
                  <span style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <button
                      className="pencil"
                      title="Renomear"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditValue(v);
                        setEditing(v);
                      }}
                    >
                      ✎
                    </button>
                    <button
                      className="pencil"
                      style={{ color: "var(--tr-bad)" }}
                      title="Excluir"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteConfirm(v);
                      }}
                    >
                      🗑
                    </button>
                  </span>
                </div>
                <div className="foot">
                  <span className="gasto">{formatBRL(t.gasto)}</span>
                  <span className="count">{t.resultados} mensagem(ns)</span>
                </div>
              </div>
            );
          })
        )}
      </aside>

      {/* Conteúdo principal */}
      <main className="main">
        {!selected || !selectedStats ? (
          <div className="placeholder-main">
            <div className="display">Selecione um vendedor</div>
            <p>Veja quantas mensagens cada vendedor recebeu, por carro, e o custo por mensagem.</p>
          </div>
        ) : (
          <VendedorDetalhe
            nome={selected}
            stats={selectedStats}
            cars={cars}
            series={dailySeries(selected)}
            onRenomear={() => {
              setEditValue(selected);
              setEditing(selected);
            }}
            onExcluir={() => setDeleteConfirm(selected)}
          />
        )}
      </main>
    </div>
  );
}

function VendedorDetalhe({
  nome,
  stats,
  cars,
  series,
  onRenomear,
  onExcluir,
}: {
  nome: string;
  stats: { total: { gasto: number; resultados: number }; semCarro: { gasto: number; resultados: number; count: number }; porCarro: Record<string, { gasto: number; resultados: number }> };
  cars: Car[];
  series: { date: string; gasto: number; resultados: number }[];
  onRenomear: () => void;
  onExcluir: () => void;
}) {
  const custoMedio = stats.total.resultados > 0 ? stats.total.gasto / stats.total.resultados : null;
  const impostoMeta = stats.total.gasto * META_TAX;
  const carrosAtendidos = Object.keys(stats.porCarro).length;

  const rows = Object.keys(stats.porCarro)
    .map((carId) => {
      const car = cars.find((c) => c.id === carId);
      const d = stats.porCarro[carId];
      const custo = d.resultados > 0 ? d.gasto / d.resultados : null;
      return { car, d, custo };
    })
    .filter((r): r is { car: Car; d: { gasto: number; resultados: number }; custo: number | null } => !!r.car)
    .sort((a, b) => b.d.gasto - a.d.gasto);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16, flexWrap: "wrap" }}>
        <h2 style={{ fontFamily: "inherit", fontWeight: 700, fontSize: 28, color: "var(--tr-text)" }}>{nome}</h2>
        <button className="clear-link" onClick={onRenomear}>
          ✎ Renomear
        </button>
        <button className="clear-link" style={{ color: "var(--tr-bad)" }} onClick={onExcluir}>
          🗑 Excluir
        </button>
      </div>

      {/* KPIs — porte exato de .detail-kpis */}
      <div className="detail-kpis">
        <div className="kpi">
          <div className="label">Mensagens recebidas</div>
          <div className="value accent">{stats.total.resultados}</div>
        </div>
        <div className="kpi">
          <div className="label">Gasto total</div>
          <div className="value">{formatBRL(stats.total.gasto)}</div>
        </div>
        <div className="kpi tax">
          <div className="label">Imposto META (12%)</div>
          <div className="value">{formatBRL(impostoMeta)}</div>
        </div>
        <div className="kpi">
          <div className="label">Custo por mensagem</div>
          <div className="value">{custoMedio !== null ? formatBRL(custoMedio) : "—"}</div>
        </div>
        <div className="kpi">
          <div className="label">Carros atendidos</div>
          <div className="value">{carrosAtendidos}</div>
        </div>
      </div>

      {series.length >= 2 && (
        <>
          <div className="section-ttl">Evolução (mensagens e gasto)</div>
          <Sparkline series={series} />
        </>
      )}

      <div className="section-ttl">Mensagens e custo por veículo</div>
      {rows.length === 0 ? (
        <div className="empty-state">Nenhuma campanha desse vendedor está vinculada a um carro ainda.</div>
      ) : (
        <div className="vendtable-wrap">
          <table className="vendtable">
            <thead>
              <tr>
                <th>Carro</th>
                <th className="num">Mensagens</th>
                <th className="num">Gasto</th>
                <th className="num">Custo/mensagem</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.car.id}>
                  <td className="nomecell">
                    {r.car.modelo}{" "}
                    <span style={{ color: "var(--tr-text-dim)", fontFamily: "ui-monospace, monospace", fontSize: 11 }}>{r.car.placa}</span>
                  </td>
                  <td className="num">{r.d.resultados}</td>
                  <td className="num">{formatBRL(r.d.gasto)}</td>
                  <td className="num">{r.custo !== null ? formatBRL(r.custo) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {stats.semCarro.count > 0 && (
        <p className="text-xs" style={{ color: "var(--tr-text-dim)", marginTop: 10 }}>
          {stats.semCarro.count} campanha(s) desse vendedor ainda sem carro vinculado — {formatBRL(stats.semCarro.gasto)} em gasto e{" "}
          {stats.semCarro.resultados} mensagem(ns) não aparecem na tabela acima até serem atribuídas a um carro.
        </p>
      )}
    </div>
  );
}

// Gráfico de área simples (gasto + resultados normalizados ao próprio
// máximo) — porte exato do "sparkline" do Artifact original, usando as
// classes .sparkline-wrap/.sparkline/.line-gasto/.line-res/.sparkline-legend.
function Sparkline({ series }: { series: { date: string; gasto: number; resultados: number }[] }) {
  const w = 760;
  const h = 160;
  const pad = 8;
  const maxGasto = Math.max(...series.map((d) => d.gasto), 1);
  const maxRes = Math.max(...series.map((d) => d.resultados), 1);
  function pts(key: "gasto" | "resultados", max: number): string {
    return series
      .map((d, i) => {
        const x = pad + (i / (series.length - 1)) * (w - 2 * pad);
        const y = h - pad - (d[key] / max) * (h - 2 * pad);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }
  const first = series[0].date;
  const last = series[series.length - 1].date;
  return (
    <div className="sparkline-wrap">
      <svg className="sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <polyline className="line-gasto" points={pts("gasto", maxGasto)} />
        <polyline className="line-res" points={pts("resultados", maxRes)} />
      </svg>
      <div className="sparkline-legend">
        <span>
          <i className="dot-gasto" />
          Gasto (máx {formatBRL(maxGasto)})
        </span>
        <span>
          <i className="dot-res" />
          Resultados (máx {maxRes})
        </span>
        <span className="range">
          {first} → {last}
        </span>
      </div>
    </div>
  );
}
