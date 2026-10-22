/**
 * UNRLVL Orchestrator — api/_publicadas.ts  (LO PUBLICADO EN EL HISTORIAL · 2026-10-22)
 *
 * Sam (2026-10-22), al no encontrar una pieza que el aviso de Telegram le mostró ya publicada: «cómo no voy a
 * poder ver algo ya publicado, para eso es historial».
 *
 * EL DEFECTO, MEDIDO ese día: Historial lista por FECHA DEL VEREDICTO (`approval_calibration.created_at`) y no
 * dice si la pieza salió ni cuándo. Una pieza aprobada el 12 y publicada el 21 queda diez días más abajo que lo
 * que salió ayer, sin nada que la distinga; y las pestañas de Publicación dejan fuera lo publicado por diseño.
 *
 * LO QUE HACE: lógica PURA, sin red, para que el test la ejecute tal cual.
 *   · `publishedParam`: el filtro «sólo publicadas» (`published=1`).
 *   · `conPublicacion`: cada fila del historial lleva el estado vivo de su pieza, cuándo salió y el enlace al
 *     post. Una fila sin dato de pieza queda con `null`: no se inventa que salió.
 *   · `soloPublicadas`: deja las publicadas y las ordena por FECHA DE PUBLICACIÓN, la más reciente primero.
 *
 * EJE: el estado de la pieza (`published`). Ninguna marca ni canal en este archivo.
 */

export interface PublicacionDePieza {
  status: string | null;
  published_at: string | null;
  post_url: string | null;
}

export interface ConPublicacion {
  piece_status: string | null;
  published_at: string | null;
  post_url: string | null;
}

/** `published=1|true|yes` → true. Cualquier otro valor, o ausente, → false. */
export function publishedParam(v: unknown): boolean {
  const s = (Array.isArray(v) ? v[0] : v);
  return typeof s === 'string' && ['1', 'true', 'yes', 'si', 'sí'].includes(s.trim().toLowerCase());
}

const ms = (iso: string | null | undefined): number => {
  if (!iso) return -Infinity;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : -Infinity;
};

/** Pega a cada fila el estado vivo de su pieza. Sin dato, `null` en los tres campos. */
export function conPublicacion<T extends { piece_id: string }>(
  rows: readonly T[], piezas: ReadonlyMap<string, PublicacionDePieza>,
): (T & ConPublicacion)[] {
  return rows.map((r) => {
    const p = piezas.get(r.piece_id);
    return {
      ...r,
      piece_status: p?.status ?? null,
      published_at: p?.status === 'published' ? (p.published_at ?? null) : null,
      post_url: p?.status === 'published' && typeof p.post_url === 'string' && /^https:\/\//.test(p.post_url) ? p.post_url : null,
    };
  });
}

/** Sólo las publicadas, la más reciente primero por fecha de publicación. */
export function soloPublicadas<T extends ConPublicacion>(rows: readonly T[]): T[] {
  return rows
    .filter((r) => r.piece_status === 'published')
    .slice()
    .sort((a, b) => ms(b.published_at) - ms(a.published_at));
}
