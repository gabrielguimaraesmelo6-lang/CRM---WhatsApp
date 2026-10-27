import type { SupabaseClient } from "@supabase/supabase-js";

// Loja (organização) de quem está logado — é a "conta" do módulo Tráfego.
// No painel antigo cada tela buscava a conta em account_users; aqui a loja
// vem da função my_branding() (migration 050), que funciona também para as
// contas de vendedor ligadas à loja.
export async function orgIdAtual(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase.rpc("my_branding");
  if (error) {
    console.error("[trafego] my_branding:", error.message);
    return null;
  }
  const linha = Array.isArray(data) ? data[0] : data;
  return (linha?.organization_id as string | undefined) ?? null;
}
