"use client";

import { useState, useCallback } from "react";

/** Chaves de métricas mascaráveis — hoje só as duas margens (lucro e após
 * tráfego), igual ao Artifact original ("olhinho" ao lado do valor). */
export type MaskKey = "lucro" | "aposTrafego" | (string & {});

export interface UseMaskedResult {
  isMasked: (key: MaskKey) => boolean;
  toggle: (key: MaskKey) => void;
}

/** Estado de mascaramento de margens — só de sessão (não persiste, como no
 * Artifact original: recarregar a página volta a mostrar os valores). */
export function useMasked(): UseMaskedResult {
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const isMasked = useCallback((key: MaskKey) => !!hidden[key], [hidden]);
  const toggle = useCallback((key: MaskKey) => {
    setHidden((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);
  return { isMasked, toggle };
}

/** Texto a exibir quando uma métrica está com o "olhinho" fechado. */
export const MASKED_PLACEHOLDER = "••••••";
