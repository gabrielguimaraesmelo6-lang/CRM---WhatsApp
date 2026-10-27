import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/trafego/admin";
import { syncEstoqueTodas } from "@/lib/trafego/estoque-sync";
import { gestorDaLoja } from "@/lib/trafego/servidor";

// Puxa o estoque do site para os veículos da loja. Chamado pela tela
// Tráfego → Carros ao abrir. O agendador chama o mesmo código em /api/trafego/sync.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  const quem = await gestorDaLoja();
  if ("erro" in quem) return NextResponse.json({ error: quem.erro }, { status: quem.status });
  try {
    const results = await syncEstoqueTodas(createAdminClient(), quem.orgId);
    return NextResponse.json({ ok: true, results });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
