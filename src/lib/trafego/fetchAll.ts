// Lê TODAS as linhas de uma consulta, página por página.
//
// O Supabase (PostgREST) devolve no máximo 1.000 linhas por consulta — sem
// paginar, as telas que somam métricas por campanha cortavam o resto em
// silêncio: com o histórico crescendo (uma linha por campanha por dia, e uma
// por campanha por HORA no gráfico de pico), campanhas inteiras sumiam do
// painel ou apareciam com gasto menor que o real. Bug real, corrigido em
// 08/10/2026.
//
// Uso: fetchAll((de, ate) => supabase.from("x").select("...").eq(...).order("id").range(de, ate))
// A consulta PRECISA ter um .order() estável (ex.: "id"), senão as páginas
// podem repetir ou pular linhas.

const TAMANHO_PAGINA = 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Resposta<T> = { data: T[] | null; error: any };

export async function fetchAll<T = Record<string, unknown>>(
  consulta: (de: number, ate: number) => PromiseLike<Resposta<T>>
): Promise<{ data: T[]; error: unknown }> {
  const todas: T[] = [];
  for (let de = 0; ; de += TAMANHO_PAGINA) {
    const { data, error } = await consulta(de, de + TAMANHO_PAGINA - 1);
    if (error) return { data: todas, error };
    const pagina = data ?? [];
    todas.push(...pagina);
    if (pagina.length < TAMANHO_PAGINA) break;
  }
  return { data: todas, error: null };
}
