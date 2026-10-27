"use client";

import { useState, useMemo } from "react";

/** Tamanho de página padrão usado em toda lista paginada do Artifact original
 * (Faturamento, Por carro, Visão geral por campanha, Campanhas). */
export const LISTA_PAGE_SIZE = 10;

export interface UseVerMaisResult<T> {
  /** Itens a renderizar nesta página (já cortados). */
  visible: T[];
  /** Total de itens antes de cortar. */
  total: number;
  /** Se há mais itens além do que está visível agora. */
  hasMore: boolean;
  /** Se a lista está expandida (mostrando tudo). */
  expanded: boolean;
  /** Alterna expandido/recolhido. */
  toggle: () => void;
  /** Rótulo pronto pro botão: "Ver mais (N)" ou "Ver menos". */
  buttonLabel: string;
}

/** Porta do padrão "ver mais (N) / ver menos" do Artifact original —
 * usar em qualquer tabela/lista paginada de 10 em 10. */
export function useVerMais<T>(items: T[], pageSize = LISTA_PAGE_SIZE): UseVerMaisResult<T> {
  const [expanded, setExpanded] = useState(false);
  const total = items.length;
  const hasMore = total > pageSize;
  const visible = useMemo(
    () => (expanded ? items : items.slice(0, pageSize)),
    [items, expanded, pageSize]
  );
  return {
    visible,
    total,
    hasMore,
    expanded,
    toggle: () => setExpanded((e) => !e),
    buttonLabel: expanded ? "Ver menos" : `Ver mais (${total - pageSize})`,
  };
}
