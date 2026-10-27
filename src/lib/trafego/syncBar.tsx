"use client";

// Barra "Última sincronização/atualização + botão" — porta o mesmo padrão
// já usado no Dashboard (Fase 6, item 1) pras outras páginas, sem duplicar
// a lógica em cada uma. Dois jeitos de usar:
//
// - useWindsorSyncBar: pra páginas cujo número exibido (gasto, campanhas)
//   vem direto da sync do Meta/GA4/Instagram — mostra o horário do último
//   `sync_runs` bem-sucedido (verdade do servidor) e o botão dispara
//   /api/sync/windsor/manual antes de recarregar os dados da própria
//   página. Usado em Campanhas, Carros, Vendedores (mesmo dado do
//   Dashboard, só que recortado por página).
//
// - AtualizarAgoraButton + a própria página controlando um `lastLoadedAt`
//   local: pra páginas cujo dado é só do Postgres e não depende de nenhuma
//   sync externa (Automações, Links UTM) — aí não faz sentido chamar de
//   "sincronização", só "atualização" (reflete a hora que os dados foram
//   recarregados no navegador).
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function useWindsorSyncBar(accountId: string | null, onSynced: () => void | Promise<void>) {
  const supabase = createClient();
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  async function carregarUltimaSync(accId: string) {
    const { data } = await supabase
      .from("tr_sync_runs")
      .select("concluido_em")
      .eq("org_id", accId)
      .eq("status", "ok")
      .order("concluido_em", { ascending: false, nullsFirst: false })
      .limit(1);
    setLastSyncAt(((data ?? [])[0] as { concluido_em?: string } | undefined)?.concluido_em ?? null);
  }

  useEffect(() => {
    if (accountId) carregarUltimaSync(accountId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  // Tempo real: ao abrir a página, se a última sync tem mais de 10 min,
  // sincroniza sozinho (sem precisar clicar). E, com a página aberta,
  // repete a cada 10 min. O agendador do Supabase já roda a cada 15 min em
  // segundo plano — isto só garante que quem está olhando vê o dado de agora.
  const [autoFeita, setAutoFeita] = useState(false);
  useEffect(() => {
    if (!accountId || autoFeita) return;
    const t = setTimeout(() => {
      setAutoFeita(true);
      const idadeMin = lastSyncAt ? (Date.now() - new Date(lastSyncAt).getTime()) / 60000 : Infinity;
      if (idadeMin > 10) sincronizarAgora();
    }, 1500); // espera carregar a hora da última sync antes de decidir
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, lastSyncAt, autoFeita]);

  useEffect(() => {
    if (!accountId) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") sincronizarAgora();
    }, 10 * 60 * 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  async function sincronizarAgora() {
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch("/api/trafego/sync/manual", { method: "POST" });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setSyncError((json && json.error) || "Falha ao sincronizar");
      } else {
        if (accountId) await carregarUltimaSync(accountId);
        await onSynced();
      }
    } catch {
      setSyncError("Falha ao sincronizar");
    } finally {
      setSyncing(false);
    }
  }

  return { lastSyncAt, syncing, syncError, sincronizarAgora };
}

export function SyncStatusLine({
  lastSyncAt,
  syncing,
  syncError,
  labelPrefix = "Última sincronização",
}: {
  lastSyncAt: string | null;
  syncing: boolean;
  syncError: string | null;
  labelPrefix?: string;
}) {
  return (
    <p className="text-[11px] mt-1" style={{ color: "var(--tr-text-dim)" }}>
      {syncing ? "Sincronizando…" : lastSyncAt ? `${labelPrefix}: ${new Date(lastSyncAt).toLocaleString("pt-BR")}` : "Ainda sem sincronização registrada"}
      {syncError && <span style={{ color: "#e58170" }}> · {syncError}</span>}
    </p>
  );
}

export function AtualizarAgoraButton({
  syncing,
  onClick,
  idleLabel = "↻ Atualizar agora",
  busyLabel = "Sincronizando…",
}: {
  syncing: boolean;
  onClick: () => void;
  idleLabel?: string;
  busyLabel?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={syncing}
      className="text-xs font-semibold px-4 py-2 rounded-md disabled:opacity-50"
      style={{ background: "var(--tr-gold-2)", color: "#2a1f04" }}
    >
      {syncing ? busyLabel : idleLabel}
    </button>
  );
}
