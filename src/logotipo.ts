/**
 * LOGOTIPO DE LA APP — «>Orchestrator» (Sam, 2026-10-26). Regla para todos los labs: `unrlvl-context` →
 * `ecosystem.json` → `labs._logotipo`.
 *
 * El logotipo va en Bebas Neue, que sólo tiene mayúsculas, así que cada tramo en minúscula se dibuja más
 * pequeño (`.lt-minuscula`, 0.72em, como «studio» en la marca) para que el nombre se lea con su caja:
 * «Orchestrator», no «ORCHESTRATOR».
 */
export interface TramoDeCaja { texto: string; minuscula: boolean }

/** Parte el nombre en tramos de minúsculas y de todo lo demás, en orden: 'Orchestrator' → O · rchestrator. */
export function tramosDeCaja(nombre: string): TramoDeCaja[] {
  return (nombre.match(/[a-zà-ÿ]+|[^a-zà-ÿ]+/g) ?? []).map((t) => ({ texto: t, minuscula: /^[a-zà-ÿ]/.test(t) }));
}
