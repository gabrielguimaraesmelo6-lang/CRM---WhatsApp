import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Cliente Supabase com a service_role key — só usado por jobs de servidor
// (rotas de sincronização, cron) que rodam sem sessão de usuário. Ignora RLS
// de propósito, então NUNCA deve ser importado por código que roda no
// navegador nem por Server Components que atendem requisições de usuário.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
