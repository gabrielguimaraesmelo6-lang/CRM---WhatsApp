// Componente de funil geral — porte EXATO do "funnelSilhouetteSvg" + a lista
// "fg-*" do Artifact original (index_1.html linhas 2021-3129). A silhueta é
// só decorativa (nunca carrega texto dentro, pra nunca ficar ilegível); os
// números reais ficam sempre na lista ao lado, usando as classes
// .fg-wrap/.fg-list/.fg-item/.fg-bar-* portadas em app/globals.css.

export interface FunnelStage {
  name: string;
  /** Linha secundária, ex.: "726 contatos · 8 compras". */
  sub?: string;
  /** Valor absoluto da etapa (ex.: impressões, cliques, resultados). `null` quando não há dado. */
  value: number | null;
  /** % em relação ao topo do funil. `null` na primeira etapa (sempre 100%) ou quando não há dado. */
  pctTotal: number | null;
  /** % de conversão vindo da etapa anterior. `null` na primeira etapa. */
  conv: number | null;
  /** Custo por unidade desta etapa (ex.: custo por clique, por resultado), já formatado em BRL, se aplicável. */
  cost?: string | null;
  costLbl?: string;
  /** Cor da barra de proporção desta etapa (segue a paleta dourada do funil). */
  color: string;
  /** % de preenchimento da barra de proporção (mínimo 1.5 pra nunca ficar invisível). */
  barPct: number;
}

/** Silhueta decorativa de funil clássico (3 trapézios), só visual — idêntica à
 * do Artifact original em proporção e cores (viewBox 0 0 280 220). */
export function FunnelSilhouette({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 280 220" xmlns="http://www.w3.org/2000/svg" className={className} style={style}>
      <path d="M10 10 H270 L190 78 H90 Z" fill="#F9F295" />
      <path d="M90 82 H190 L165 140 H115 Z" fill="#F8C45B" />
      <path d="M115 144 H165 L150 205 H130 Z" fill="#AB7C35" />
    </svg>
  );
}

function fmtNum(n: number | null): string {
  return n === null ? "—" : n.toLocaleString("pt-BR");
}
function fmtPct(n: number | null): string {
  return n === null ? "—" : n.toFixed(2) + "%";
}

/** Lista detalhada de etapas ao lado da silhueta — porte exato de ".fg-item"
 * do artefato: nome+sub à esquerda com bolinha colorida, valor+métricas à
 * direita, barra de proporção embaixo. */
export function FunnelStageList({ stages }: { stages: FunnelStage[] }) {
  return (
    <div className="fg-list">
      {stages.map((s, i) => (
        <div key={s.name} className="fg-item">
          <div className="fg-item-top">
            <div className="fg-item-l">
              <span className="dot" style={{ background: s.color }} />
              <div>
                <div className="name">{s.name}</div>
                {s.sub ? <div className="sub">{s.sub}</div> : null}
              </div>
            </div>
            <div className="fg-item-r">
              <div className="val">{fmtNum(s.value)}</div>
              <div className="metrics">
                {i === 0 ? (
                  <span>
                    <b>100%</b> do total
                  </span>
                ) : (
                  <>
                    <span>
                      <b>{fmtPct(s.conv)}</b> da etapa anterior
                    </span>
                    <span>{fmtPct(s.pctTotal)} do total</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="fg-bar-track">
            <div className="fg-bar-fill" style={{ width: `${Math.max(s.barPct, 1.5).toFixed(1)}%`, background: s.color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Composição pronta: silhueta + lista, lado a lado (empilha em telas
 * estreitas) — é o bloco ".fg-wrap" do Artifact original. */
export function FunnelGeral({ stages }: { stages: FunnelStage[] }) {
  return (
    <div className="fg-wrap">
      <div className="fg-svg-col">
        <FunnelSilhouette />
      </div>
      <FunnelStageList stages={stages} />
    </div>
  );
}
