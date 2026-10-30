/**
 * UNRLVL Orchestrator — api/_mediaStore.ts  (LOS BUCKETS DE MEDIOS · acceso, no decisiones)
 *
 * Aquí vive lo que toca la red; las decisiones están en `_mediaTray.ts` y se prueban sin red. La
 * separación no es estética: lo que decide QUÉ se mueve tiene que ser comprobable sin un bucket
 * delante, y lo que mueve tiene que poder fallar sin llevarse la decisión por delante.
 *
 * LISTAR UN PREFIJO NO DEVUELVE LO ANIDADO. La API de Storage trata el prefijo como carpeta: una
 * llamada con `staging/` devuelve los marcadores de subcarpeta (`id: null`), no los archivos de
 * dentro. Es la misma trampa que documenta el barredor de huérfanos del otro repositorio, y por eso
 * aquí se CAMINA el árbol en vez de listar una vez y creer el resultado.
 *
 * ── CAMBIOS (2026-10-30) · SON DOS BUCKETS, Y EL DE ENTRADA ES PRIVADO ────────────────────────
 *
 * Hasta hoy este archivo cableaba UN bucket, `unrlvl-media`, y daba por hecho que la zona de
 * entrada vivía dentro. Dejó de ser cierto: `unrlvl-iid-functions#537` movió la zona de aterrizaje
 * al bucket PRIVADO `unrlvl-media-staging`, porque la publicidad es del BUCKET y no del prefijo —un
 * objeto de `staging/` en el bucket público respondía HTTP 200 sin autenticación [medido
 * 2026-10-27]— y cerrar `unrlvl-media` habría roto las ~2.800 referencias públicas que el carril ya
 * sirve desde `permanent/`, `temp/` y `preview/`.
 *
 * De ahí las tres consecuencias que este archivo absorbe, y ninguna es cosmética:
 *
 *   1 · EL BUCKET DE ENTRADA ES DATO DE LA FILA, NO CONSTANTE DE CÓDIGO. Se lee de
 *       `intel.media_principals.allowed_bucket`, que es la misma fuente que usa el corredor
 *       (`media-grant`) al emitir el permiso. Si el corredor y la bandeja leyeran el bucket de dos
 *       sitios distintos, el día que cambie uno la bandeja miraría donde ya no aterriza nada — y
 *       miraría un prefijo vacío, que es indistinguible de «no hay nada pendiente».
 *
 *   2 · UN BUCKET PRIVADO NO SE LEE POR URL PÚBLICA. La tarjeta muestra el artefacto, así que la
 *       imagen necesita una URL FIRMADA y temporal. Una URL pública contra un bucket privado no
 *       falla a la vista: devuelve 400 y el navegador pinta un hueco.
 *
 *   3 · LA PROMOCIÓN CRUZA DE BUCKET. Sale del privado de entrada y entra en el público
 *       `permanent/<marca>/promovidas/`. Se hace DESCARGA + SUBIDA, no `object/copy`: el `copy` de
 *       Storage acepta un `destinationBucket` en versiones recientes, pero eso es `reportado` por
 *       la documentación y no medido contra este proyecto, y un camino que puede no existir no es
 *       sitio para el único movimiento que saca un objeto de la zona de entrada. Descargar y subir
 *       funciona en cualquier versión y cabe de sobra: el bucket de entrada tiene tope de 10 MiB.
 */
import { fetchWithTimeout } from './_fetchWithTimeout.js';
import { SB_URL, SB_KEY } from './_calibrationShared.js';
import { bucketsDeclarados } from './_mediaTray.js';

/**
 * EL BUCKET PÚBLICO del ecosistema: donde vive lo que puede verse y donde aterriza lo promovido.
 * NO cambió y sigue siendo público a propósito — las referencias de `permanent/`, `temp/`,
 * `preview/` y `blog-backfill/` se sirven desde aquí.
 */
export const BUCKET_PUBLICO = 'unrlvl-media';

/**
 * Nombre anterior, conservado: `BUCKET` significaba «el bucket» cuando sólo había uno. Hoy el
 * público es sólo uno de los dos, así que lo que se exporta con el nombre viejo es el público, que
 * es lo que seguía siendo cierto de él. No se borra porque borrar un export rompe a quien lo lea
 * sin avisar; se documenta qué es.
 */
export const BUCKET = BUCKET_PUBLICO;

/** Tope de páginas y de profundidad: un bucket que crece sin fin no puede colgar la bandeja. */
const PAGINA = 100;
const MAX_PAGINAS = 20;
const MAX_PROFUNDIDAD = 4;

/** Vida de una URL firmada: una sesión de revisión, no más. */
export const TTL_FIRMA_SEGUNDOS = 3600;

/**
 * Cuántas URLs se firman por carga de bandeja. Firmar no es gratis y la ventana de la función es
 * finita; lo que pase de aquí llega sin URL y la bandeja LO DICE, en vez de pintar huecos.
 */
export const MAX_FIRMAS = 200;

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

function cabecerasSimples(): Record<string, string> {
  return { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}` };
}

/** La ruta, segmento a segmento, como la quiere la API de Storage. */
function enc(objectPath: string): string {
  return objectPath.split('/').map(encodeURIComponent).join('/');
}

// ── 1 · DE DÓNDE SALE EL BUCKET DE ENTRADA ───────────────────────────────────────────────────

/**
 * LOS BUCKETS DE ATERRIZAJE, leídos de la fila del principal. Son los que el corredor declara, así
 * que la bandeja mira exactamente donde el corredor deja las cosas.
 *
 * Si la lectura falla, NO se adivina y NO se cae al público en silencio: se propaga el error. La
 * bandeja prefiere decir que no pudo leer antes que listar un prefijo vacío de otro bucket, que se
 * lee igual que «no hay nada pendiente». Si la tabla todavía no existe —o no declara ninguno—, el
 * valor por defecto es el público, que es donde la zona de entrada vivía antes de #537.
 */
export async function bucketsDeAterrizaje(): Promise<string[]> {
  const res = await fetchWithTimeout('db',
    `${SB_URL()}/rest/v1/media_principals?select=allowed_bucket,active`,
    { headers: { ...cabecerasSimples(), 'Accept-Profile': 'intel' } });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    // La relación que no existe es el único «no hay dato» legítimo; cualquier otro fallo se dice.
    if (res.status === 404 || txt.includes('42P01')) return [BUCKET_PUBLICO];
    throw new Error(`media_principals → ${res.status} ${txt.slice(0, 200)}`);
  }
  const filas = await res.json().catch(() => []);
  return bucketsDeclarados(filas, BUCKET_PUBLICO);
}

// ── 2 · LISTAR ───────────────────────────────────────────────────────────────────────────────

async function pagina(bucket: string, prefix: string, offset: number): Promise<ItemCrudo[]> {
  const res = await fetchWithTimeout('db', `${SB_URL()}/storage/v1/object/list/${encodeURIComponent(bucket)}`, {
    method: 'POST',
    headers: cabeceras(),
    body: JSON.stringify({ prefix, limit: PAGINA, offset, sortBy: { column: 'created_at', order: 'asc' } }),
  });
  if (!res.ok) throw new Error(`list ${bucket} '${prefix}' → ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const filas = (await res.json().catch(() => [])) as ItemCrudo[];
  return Array.isArray(filas) ? filas : [];
}

/**
 * TODOS LOS OBJETOS BAJO UN PREFIJO, bajando por las subcarpetas. Un item con `id` nulo es un
 * marcador de carpeta, no un archivo: se baja por él y no se devuelve.
 */
export async function objetosBajo(bucket: string, prefix: string, profundidad = 0): Promise<ObjetoListado[]> {
  if (profundidad >= MAX_PROFUNDIDAD) return [];
  const salida: ObjetoListado[] = [];
  const carpetas: string[] = [];

  for (let p = 0; p < MAX_PAGINAS; p++) {
    const filas = await pagina(bucket, prefix, p * PAGINA);
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

  for (const c of carpetas) salida.push(...await objetosBajo(bucket, c, profundidad + 1));
  return salida;
}

// ── 3 · FIRMAR ───────────────────────────────────────────────────────────────────────────────

/** La URL absoluta a partir del `signedURL` relativo que devuelve Storage. */
function absoluta(signedURL: unknown): string | null {
  const s = String(signedURL ?? '').trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  const raiz = SB_URL().replace(/\/+$/, '');
  return `${raiz}/storage/v1${s.startsWith('/') ? '' : '/'}${s}`;
}

/** Una sola firma. Es el reparador de lo que el lote no devuelva, y el camino de un objeto suelto. */
export async function urlFirmada(bucket: string, objectPath: string, ttl = TTL_FIRMA_SEGUNDOS): Promise<string | null> {
  const res = await fetchWithTimeout('db',
    `${SB_URL()}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${enc(objectPath)}`,
    { method: 'POST', headers: cabeceras(), body: JSON.stringify({ expiresIn: ttl }) });
  if (!res.ok) return null;
  const cuerpo = await res.json().catch(() => null) as { signedURL?: unknown } | null;
  return absoluta(cuerpo?.signedURL);
}

/**
 * LAS FIRMAS DE VARIAS RUTAS DE UNA VEZ. Firmar una por una no cabe en la ventana cuando la zona de
 * entrada acumula decenas de objetos; el endpoint de lote existe por eso.
 *
 * Lo que el lote no devuelva se firma suelto, UNA vez por ruta: así una respuesta de forma distinta
 * a la esperada degrada a lento, nunca a tarjetas en blanco. Una ruta que tampoco se pueda firmar
 * suelta sale FUERA del mapa, y quien llama decide qué contar de eso — nunca una URL inventada.
 */
export async function urlesFirmadas(
  bucket: string, rutas: string[], ttl = TTL_FIRMA_SEGUNDOS,
): Promise<Map<string, string>> {
  const salida = new Map<string, string>();
  if (!rutas.length) return salida;

  try {
    const res = await fetchWithTimeout('db', `${SB_URL()}/storage/v1/object/sign/${encodeURIComponent(bucket)}`, {
      method: 'POST', headers: cabeceras(), body: JSON.stringify({ expiresIn: ttl, paths: rutas }),
    });
    if (res.ok) {
      const filas = await res.json().catch(() => null);
      if (Array.isArray(filas)) {
        for (const f of filas as Array<{ path?: unknown; signedURL?: unknown }>) {
          const ruta = String(f?.path ?? '');
          const url = absoluta(f?.signedURL);
          if (ruta && url) salida.set(ruta, url);
        }
      }
    }
  } catch {
    // El lote es una optimización: que falle no decide nada, lo decide el reparo de abajo.
  }

  const faltan = rutas.filter((r) => !salida.has(r));
  for (const r of faltan) {
    const url = await urlFirmada(bucket, r, ttl).catch(() => null);
    if (url) salida.set(r, url);
  }
  return salida;
}

// ── 4 · EXISTIR, COPIAR ENTRE BUCKETS Y BORRAR ───────────────────────────────────────────────

/** ¿Existe ese objeto exacto? Un 404 limpio vale más que un fallo de copia a medias. */
export async function existe(bucket: string, objectPath: string): Promise<boolean> {
  const res = await fetchWithTimeout('db',
    `${SB_URL()}/storage/v1/object/${encodeURIComponent(bucket)}/${enc(objectPath)}`,
    { method: 'HEAD', headers: cabecerasSimples() });
  return res.ok;
}

/**
 * COPIA, CRUCE DE BUCKET INCLUIDO. No borra: el borrado va después de verificar que la copia llegó.
 *
 * Descarga y sube, por lo que dice la cabecera de este archivo: `object/copy` con
 * `destinationBucket` es `reportado`, no medido contra este proyecto, y el único movimiento que
 * saca un objeto de la zona de entrada no se apoya en un camino que puede no existir. El
 * `content-type` se conserva del origen; si el origen no lo declara, se sube como binario genérico
 * en vez de inventar uno.
 */
export async function copiar(
  bucketOrigen: string, desde: string, bucketDestino: string, hacia: string,
): Promise<void> {
  const bajada = await fetchWithTimeout('db',
    `${SB_URL()}/storage/v1/object/${encodeURIComponent(bucketOrigen)}/${enc(desde)}`,
    { method: 'GET', headers: cabecerasSimples() });
  if (!bajada.ok) {
    throw new Error(`bajada ${bucketOrigen}/${desde} → ${bajada.status} ${(await bajada.text().catch(() => '')).slice(0, 200)}`);
  }
  const tipo = bajada.headers.get('content-type') || 'application/octet-stream';
  const bytes = new Uint8Array(await bajada.arrayBuffer());
  if (!bytes.byteLength) throw new Error(`bajada ${bucketOrigen}/${desde} → 0 bytes: no se sube un objeto vacío`);

  const subida = await fetchWithTimeout('db',
    `${SB_URL()}/storage/v1/object/${encodeURIComponent(bucketDestino)}/${enc(hacia)}`,
    {
      method: 'POST',
      headers: { ...cabecerasSimples(), 'Content-Type': tipo, 'x-upsert': 'false' },
      body: bytes,
    });
  if (!subida.ok) {
    throw new Error(`subida ${bucketDestino}/${hacia} → ${subida.status} ${(await subida.text().catch(() => '')).slice(0, 200)}`);
  }
}

export async function borrar(bucket: string, objectPath: string): Promise<void> {
  const res = await fetchWithTimeout('db',
    `${SB_URL()}/storage/v1/object/${encodeURIComponent(bucket)}/${enc(objectPath)}`,
    { method: 'DELETE', headers: cabecerasSimples() });
  if (!res.ok) throw new Error(`delete ${bucket}/${objectPath} → ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
}
