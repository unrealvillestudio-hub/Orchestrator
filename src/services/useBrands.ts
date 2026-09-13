/**
 * useBrands.ts — U-9 · UNA SOLA CARGA DE MARCAS PARA TODAS LAS PANTALLAS.
 *
 * Cuatro módulos —Hub, Planner, Executor y Monitor— necesitan el catálogo. Si cada uno
 * escribiera su `useEffect`, cada uno decidiría por su cuenta qué hacer mientras carga y
 * qué hacer si falla, y divergirían: es la misma lección que dejó `pieceActions` en U-5.
 *
 * El hook no interpreta nada. Devuelve las marcas, SU PROCEDENCIA y el motivo del
 * respaldo, y deja que cada pantalla decida cómo mostrarlo — que es distinto en una con
 * selector y en una que sólo resuelve un id.
 */

import { useEffect, useState } from 'react';
import { BrandProfile } from '../core/types';
import { loadBrands, type BrandsResult } from './brandsLoader';

export interface UseBrands {
  brands: BrandProfile[];
  /** `loading` es un estado propio: «todavía no sé» no es «vino del respaldo». */
  source: 'loading' | 'db' | 'fallback';
  reason: string | null;
}

export function useBrands(): UseBrands {
  const [estado, setEstado] = useState<UseBrands>({ brands: [], source: 'loading', reason: null });

  useEffect(() => {
    let vivo = true;
    loadBrands().then((r: BrandsResult) => {
      // Si el componente se desmontó, no se escribe estado: un `setState` sobre un árbol
      // que ya no existe avisa por consola y esconde el aviso que sí importa.
      if (vivo) setEstado({ brands: r.brands, source: r.source, reason: r.reason });
    });
    return () => { vivo = false; };
  }, []);

  return estado;
}
