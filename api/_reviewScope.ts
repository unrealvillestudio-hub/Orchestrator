/**
 * ALCANCE DE REVISIÓN — quién puede trabajar las bandejas, y de qué marcas (2026-10-01).
 *
 * Hasta hoy las bandejas (Calibración, Arreglos, Retenidas, Publicación) eran sólo de `admin`
 * (`requireAdmin`). Sam pidió que otra persona le ayude a despejarlas «con las mismas funciones»,
 * pero sólo en las marcas que él le asigne. Este módulo es esa puerta.
 *
 * DOS EJES, Y NINGUNO ES UNA MARCA NI UNA PERSONA:
 *   · `brand_scope` del JWT — las marcas del operador en general (lo emite `iid-inbound` desde su
 *     secret de usuarios). Es el techo: nadie revisa fuera de sus marcas.
 *   · `intel.operator_review_scope` — las marcas que un operador puede REVISAR. Es un permiso
 *     distinto: sembrar una marca no implica aprobar lo que se publica en ella. Vive en tabla, y dar
 *     o quitar acceso es un INSERT o un DELETE, nunca un despliegue.
 *   El alcance efectivo es la intersección de los dos.
 *
 * `admin` no pasa por la tabla: ve todo, igual que antes de este módulo. Así el cambio no toca el
 * trabajo de Sam.
 *
 * FAIL-CLOSED. Sin la tabla, sin filas o con un error de lectura, un no-admin recibe 403. Un permiso
 * que no se pudo leer no se presume.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  ALLOWED_ROLES, JWT_SECRET, SB_KEY, SB_URL, verifyToken, type SessionUser,
} from './_calibrationShared.js';
import { fetchWithTimeout } from './_fetchWithTimeout.js';

/** Todas las marcas. Es lo que tiene `admin`, y lo que significa `'*'` en un `brand_scope`. */
export const TODAS = '*' as const;
export type ReviewScope = typeof TODAS | readonly string[];

export interface Reviewer extends SessionUser {
  /** Las marcas que esta sesión puede revisar. */
  review: ReviewScope;
}

export const esAdmin = (role: string): boolean => ALLOWED_ROLES.includes(role);

/**
 * El alcance efectivo, sin red ni DB (se prueba en aislamiento). `null` = no puede revisar nada.
 * `granted` son las filas de `intel.operator_review_scope` del operador; `null` si no se pudieron leer.
 */
export function effectiveReviewScope(
  role: string,
  brandScope: readonly string[],
  granted: readonly string[] | null,
): ReviewScope | null {
  if (esAdmin(role)) return TODAS;
  if (!granted || granted.length === 0) return null;
  const concedidas = [...new Set(granted.filter((b) => typeof b === 'string' && b.trim()).map((b) => b.trim()))];
  const techo = brandScope.includes(TODAS) ? concedidas : concedidas.filter((b) => brandScope.includes(b));
  return techo.length ? techo : null;
}

export function inReviewScope(scope: ReviewScope, brandId: string | null | undefined): boolean {
  if (scope === TODAS) return true;
  return !!brandId && scope.includes(brandId);
}

/** Filtra filas por marca. Con `TODAS` devuelve el MISMO array: el camino de admin no cambia. */
export function filterByReviewScope<T extends { brand_id: string }>(rows: T[], scope: ReviewScope): T[] {
  if (scope === TODAS) return rows;
  return rows.filter((r) => scope.includes(r.brand_id));
}

/** Las marcas concedidas a `sub`. `null` ante cualquier fallo (tabla ausente incluida): fail-closed. */
export async function fetchReviewGrants(sub: string): Promise<string[] | null> {
  const url = `${SB_URL()}/rest/v1/operator_review_scope?operator_sub=eq.${encodeURIComponent(sub)}&select=brand_id`;
  try {
    const res = await fetchWithTimeout('db', url, {
      headers: { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, 'Accept-Profile': 'intel' },
    });
    if (!res.ok) {
      console.error(`[review-scope] lectura de intel.operator_review_scope falló: ${res.status}`);
      return null;
    }
    const rows = (await res.json().catch(() => [])) as Array<{ brand_id?: unknown }>;
    return Array.isArray(rows) ? rows.map((r) => String(r.brand_id ?? '')).filter(Boolean) : null;
  } catch (err) {
    console.error('[review-scope] lectura de intel.operator_review_scope falló:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * La puerta de las bandejas. Mismas comprobaciones que `requireAdmin` y, para quien no es admin, el
 * alcance de revisión. Si algo falla, responde y devuelve null.
 */
export async function requireReviewer(
  req: VercelRequest, res: VercelResponse, token: string | undefined,
): Promise<Reviewer | null> {
  if (!SB_URL() || !SB_KEY()) {
    res.status(503).json({ error: 'config_missing', message: 'Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el runtime' });
    return null;
  }
  if (!JWT_SECRET()) {
    res.status(503).json({ error: 'config_missing', message: 'Falta ORCHESTRATOR_NSCF_IID_INTEL_JWT_SECRET en el runtime' });
    return null;
  }
  const session = verifyToken(token, JWT_SECRET());
  if (!session) { res.status(401).json({ error: 'sesión inválida o expirada, vuelve a entrar' }); return null; }
  const granted = esAdmin(session.role) ? null : await fetchReviewGrants(session.sub);
  const review = effectiveReviewScope(session.role, session.brand_scope, granted);
  if (!review) {
    res.status(403).json({ error: `forbidden: '${session.sub}' no tiene marcas asignadas para revisar` });
    return null;
  }
  return { ...session, review };
}

/** 403 uniforme para una acción sobre una pieza de otra marca. */
export function denyOutOfScope(res: VercelResponse, brandId: string | null | undefined): void {
  res.status(403).json({ error: 'fuera_de_alcance', detail: `La marca ${brandId ?? '(sin marca)'} no está entre las que puedes revisar.` });
}

/**
 * Quién firma. Un admin puede declarar otro evaluador (comportamiento previo); quien no es admin
 * firma siempre con su sesión: un veredicto firmable con el nombre de otro no es auditable.
 */
export function signerOf(session: Reviewer, declared: unknown): string {
  if (esAdmin(session.role) && typeof declared === 'string' && declared.trim()) return declared.trim();
  return session.sub || 'sam';
}

/**
 * Guarda de una acción sobre una pieza. Admin pasa sin leer nada (el camino de antes, sin una lectura
 * más). Para un revisor lee la marca de la pieza y responde 404 o 403 si no procede.
 * Devuelve true si el handler puede seguir.
 */
export async function guardPiece(res: VercelResponse, session: Reviewer, pieceId: string): Promise<boolean> {
  if (session.review === TODAS) return true;
  const url = `${SB_URL()}/rest/v1/content_pieces?id=eq.${encodeURIComponent(pieceId)}&select=brand_id&limit=1`;
  let brandId: string | null = null;
  try {
    const r = await fetchWithTimeout('db', url, {
      headers: { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, 'Accept-Profile': 'content' },
    });
    if (!r.ok) { res.status(502).json({ error: 'piece_read_failed', status: r.status }); return false; }
    const rows = (await r.json().catch(() => [])) as Array<{ brand_id?: string }>;
    if (!Array.isArray(rows) || !rows.length) { res.status(404).json({ error: 'piece_not_found', piece_id: pieceId }); return false; }
    brandId = rows[0].brand_id ?? null;
  } catch (err) {
    res.status(502).json({ error: 'piece_read_failed', message: err instanceof Error ? err.message : String(err) });
    return false;
  }
  if (!inReviewScope(session.review, brandId)) { denyOutOfScope(res, brandId); return false; }
  return true;
}
