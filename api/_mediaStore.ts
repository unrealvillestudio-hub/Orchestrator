/**
 * UNRLVL Orchestrator — api/_mediaStore.ts  (EL BUCKET DE MEDIOS · acceso, no decisiones)
 *
 * Aquí vive lo que toca la red; las decisiones están en `_mediaTray.ts` y se prueban sin red. La
 * separación no es estética: lo que decide QUÉ se mueve tiene que ser comprobable sin un bucket
 * delante, y lo que mueve tiene que poder fallar sin llevarse la decisión por delante.
 *
 * LISTAR UN PREFIJO NO DEVUELVE LO ANIDADO. La API de Storage trata el prefijo como carpeta: una
 * llamada con `staging/` devuelve los marcadores de subcarpeta (`id: null`), no los archivos de
 * dentro. Es la misma trampa que documenta el barredor de huérfanos del otro repositorio, y por eso
 * aquí se CAMINA el árbol en vez de listar una vez y creer el resultado.
 */
import { fetchWithTimeout } from './_fetchWithTimeout.js';
import { SB_URL, SB_KEY } from './_calibrationShared.js';

/** El bucket de medios del ecosistema. */
export const BUCKET = 'unrlvl-media';
/** Tope de páginas y de profundidad: un bucket que crece sin fin no puede colgar la bandeja. */
const PAGINA = 100;
const MAX_PAGINAS = 20;
const MAX_PROFUNDIDAD = 4;

export interface ObjetoListado {
  /** Ruta completa dentro del bucket. */
  name: string;
  created_at: string | null;
  bytes: number | null;
  mime: string | null;
}

interface ItemCrudo {
  name?: unknown;
  id?: unknown;
  created_at?: unknown;
  metadata?: { size?: unknown; mimetype?: unknown } | null;
}

function cabeceras(): Record<string, string> {
  return { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, 'Content-Type': 'application/json' };
}

async function pagina(prefix: string, offset: number): Promise<ItemCrudo[]> {
  const res = await fetchWithTimeout('db', `${SB_URL()}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST',
    headers: cabeceras(),
    body: JSON.stringify({ prefix, limit: PAGINA, offset, sortBy: { column: 'created_at', order: 'asc' } }),
  });
  if (!res.ok) throw new Error(`list '${prefix}' → ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const filas = (await res.json().catch(() => [])) as ItemCrudo[];
  return Array.isArray(filas) ? filas : [];
}

/**
 * TODOS LOS OBJETOS BAJO UN PREFIJO, bajando por las subcarpetas. Un item con `id` nulo es un
 * marcador de carpeta, no un archivo: se baja por él y no se devuelve.
 */
export async function objetosBajo(prefix: string, profundidad = 0): Promise<ObjetoListado[]> {
  if (profundidad >= MAX_PROFUNDIDAD) return [];
  const salida: ObjetoListado[] = [];
  const carpetas: string[] = [];

  for (let p = 0; p < MAX_PAGINAS; p++) {
    const filas = await pagina(prefix, p * PAGINA);
    for (const f of filas) {
      const nombre = String(f?.name ?? '');
      if (!nombre) continue;
      if (f?.id == null) { carpetas.push(`${prefix}${nombre}/`); continue; }
      const size = Number(f?.metadata?.size);
      salida.push({
        name: `${prefix}${nombre}`,
        created_at: typeof f?.created_at === 'string' ? f.created_at : null,
        bytes: Number.isFinite(size) ? size : null,
        mime: typeof f?.metadata?.mimetype === 'string' ? f.metadata.mimetype : null,
      });
    }
    if (filas.length < PAGINA) break;
  }

  for (const c of carpetas) salida.push(...await objetosBajo(c, profundidad + 1));
  return salida;
}

/** ¿Existe ese objeto exacto? Un 404 limpio vale más que un fallo de copia a medias. */
export async function existe(objectPath: string): Promise<boolean> {
  const res = await fetchWithTimeout('db',
    `${SB_URL()}/storage/v1/object/${BUCKET}/${objectPath.split('/').map(encodeURIComponent).join('/')}`,
    { method: 'HEAD', headers: { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}` } });
  return res.ok;
}

/** Copia. No borra: el borrado va después de verificar que la copia llegó. */
export async function copiar(desde: string, hacia: string): Promise<void> {
  const res = await fetchWithTimeout('db', `${SB_URL()}/storage/v1/object/copy`, {
    method: 'POST', headers: cabeceras(),
    body: JSON.stringify({ bucketId: BUCKET, sourceKey: desde, destinationKey: hacia }),
  });
  if (!res.ok) throw new Error(`copy → ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
}

export async function borrar(objectPath: string): Promise<void> {
  const res = await fetchWithTimeout('db',
    `${SB_URL()}/storage/v1/object/${BUCKET}/${objectPath.split('/').map(encodeURIComponent).join('/')}`,
    { method: 'DELETE', headers: { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}` } });
  if (!res.ok) throw new Error(`delete → ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
}
