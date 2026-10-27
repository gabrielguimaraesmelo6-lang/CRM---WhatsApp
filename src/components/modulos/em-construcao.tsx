import { Hammer } from "lucide-react";

// Tela provisória dos módulos que estão sendo trazidos para dentro do
// sistema (Tráfego e Site). Some quando a tela de verdade entrar.
export function EmConstrucao({
  modulo,
  etapa,
  descricao,
}: {
  modulo: string;
  etapa: string;
  descricao: string;
}) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-start gap-3 py-16">
      <span className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-[11px] font-semibold tracking-[0.12em] text-primary uppercase">
        <Hammer className="size-3.5" />
        {modulo} · {etapa}
      </span>
      <h1 className="text-2xl font-semibold text-foreground">Esta tela está chegando ao sistema</h1>
      <p className="text-sm leading-relaxed text-muted-foreground">{descricao}</p>
    </div>
  );
}
