// Utilitários de formatação compartilhados por todas as páginas do painel —
// porta exata das funções equivalentes do Artifact original ("Placa a Placa"),
// pra manter os números e textos idênticos ao sistema antigo.

/** Imposto padrão do Meta Ads (Meta cobra 12% sobre o valor investido no Brasil). */
export const META_TAX = 0.12;

/** "R$ 1.234,56" — sempre 2 casas decimais, separador de milhar brasileiro. */
export function formatBRL(value: number): string {
  const n = Number.isFinite(value) ? value : 0;
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Segundos (o GA4 devolve duração média de sessão em segundos, com casas
 * decimais) -> "Nm Ss", ex.: 216.4 -> "3m 36s". */
export function formatDuracaoSessao(segundos: number): string {
  const total = Math.round(segundos || 0);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m ${s < 10 ? "0" : ""}${s}s`;
}

/** Formata um número inteiro com separador de milhar brasileiro (ex.: contagens, impressões). */
export function formatInt(value: number): string {
  const n = Number.isFinite(value) ? Math.round(value) : 0;
  return n.toLocaleString("pt-BR");
}

/** Percentual com 1 casa decimal e vírgula, ex.: 3.104 -> "3,1%". */
export function formatPercent(value: number, digits = 1): string {
  const n = Number.isFinite(value) ? value : 0;
  return (
    n.toLocaleString("pt-BR", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }) + "%"
  );
}

/** ROAS no mesmo formato do Artifact original: "217.6x" (ponto decimal, sufixo x). */
export function formatRoas(roas: number): string {
  if (!Number.isFinite(roas)) return "0.0x";
  return roas.toFixed(1) + "x";
}
