import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parsePieceSearch, idMatchesSearch, SearchTooShort, SearchNotAnId, SEARCH_MIN_PREFIX,
} from './_calibrationShared.js';

/**
 * U-7 — ENCONTRAR UNA PIEZA POR SU ID.
 *
 * El resolvedor es puro: se prueba entero sin red y sin base.
 *
 * Lo que estas pruebas fijan no es que la búsqueda encuentre —eso se ve en la pantalla—,
 * sino que **los dos ceros se distingan**: «no hay ninguna» y «no pude mirarlo todo» son
 * estados distintos, y confundirlos hace que la búsqueda mienta en el único caso en que
 * este camino puede mentir.
 *
 * Los uuid de las fixtures son ficticios: si algo dependiera de una pieza, una marca o una
 * plataforma reales, estas pruebas fallarían.
 */

const UUID = '5b14caa7-0000-4000-8000-000000000001';

// ── 1 · uuid completo ────────────────────────────────────────────────────────────
describe('uuid completo', () => {
  it('va como filtro directo, sin lote y sin truncamiento posible', () => {
    const s = parsePieceSearch(UUID)!;
    expect(s.mode).toBe('uuid');
    expect(s.exact).toBe(UUID);
    expect(s.prefix).toBeNull();
  });

  it('encuentra sólo el suyo', () => {
    const s = parsePieceSearch(UUID);
    expect(idMatchesSearch(UUID, s)).toBe(true);
    expect(idMatchesSearch('5b14caa7-0000-4000-8000-000000000002', s)).toBe(false);
  });
});

// ── 2 · prefijo, normalizado ─────────────────────────────────────────────────────
describe('prefijo de 8, como lo pinta la tarjeta', () => {
  it('en MAYÚSCULAS y con espacios alrededor → normaliza y encuentra', () => {
    const s = parsePieceSearch('  5B14CAA7  ')!;
    expect(s.mode).toBe('prefix');
    expect(s.q).toBe('5b14caa7');
    expect(idMatchesSearch(UUID, s)).toBe(true);
  });

  it('el id también se compara en minúsculas: puede venir de cualquier sitio', () => {
    const s = parsePieceSearch('5b14caa7');
    expect(idMatchesSearch(UUID.toUpperCase(), s)).toBe(true);
  });

  it('un prefijo que no coincide no encuentra', () => {
    expect(idMatchesSearch(UUID, parsePieceSearch('deadbeef'))).toBe(false);
  });
});

// ── 3 · demasiado corto ──────────────────────────────────────────────────────────
describe('prefijos que no se buscan', () => {
  it('menos del mínimo → lanza, no devuelve lista vacía', () => {
    // Devolver vacío se leería como «no existe». Un prefijo de 3 devolvería medio catálogo
    // y parecería una búsqueda rota; las dos lecturas son falsas.
    expect(() => parsePieceSearch('5b1')).toThrow(SearchTooShort);
    expect(SEARCH_MIN_PREFIX).toBe(4);
  });

  it('los guiones no cuentan como longitud', () => {
    // `5b1-` son 3 caracteres de id, no 4.
    expect(() => parsePieceSearch('5b1-')).toThrow(SearchTooShort);
    expect(parsePieceSearch('5b14-')!.mode).toBe('prefix');
  });

  it('texto libre → lanza: buscar por título no existe, y no se finge que sí', () => {
    expect(() => parsePieceSearch('cabello fino')).toThrow(SearchNotAnId);
    expect(() => parsePieceSearch('NeuroneSCF')).toThrow(SearchNotAnId);
  });
});

// ── 5 · sin búsqueda no se filtra ────────────────────────────────────────────────
describe('no buscar NO es buscar y no encontrar', () => {
  it('parámetro ausente, vacío o sólo espacios → null', () => {
    expect(parsePieceSearch(undefined)).toBeNull();
    expect(parsePieceSearch('')).toBeNull();
    expect(parsePieceSearch('   ')).toBeNull();
    expect(parsePieceSearch(42)).toBeNull();
  });

  it('sin búsqueda, todo pasa el filtro', () => {
    expect(idMatchesSearch(UUID, null)).toBe(true);
    expect(idMatchesSearch(null, null)).toBe(true);
  });

  it('una fila sin id nunca cae en una búsqueda: no hay contra qué comparar', () => {
    const s = parsePieceSearch('5b14caa7');
    expect(idMatchesSearch(null, s)).toBe(false);
    expect(idMatchesSearch('', s)).toBe(false);
  });
});

// ── 4, 6, 7 y 8 · lo que fijan los endpoints ─────────────────────────────────────
const soloCodigo = (src: string) => src
  .split('\n')
  .filter((l) => {
    const t = l.trim();
    return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
  })
  .join('\n');

const leer = (f: string) => soloCodigo(readFileSync(new URL(f, import.meta.url), 'utf8'));
const CALIB = leer('./calibration-queue.ts');
const PUBLISH = leer('./publish-queue.ts');
const CHALLENGED = leer('./challenged-queue.ts');
const HISTORY = leer('./evaluated-history.ts');
const SHARED = leer('./_calibrationShared.ts');

/** Las CUATRO bandejas. Historial entró a petición de Sam el 2026-09-13, ver más abajo. */
const BANDEJAS = [
  ['calibración', CALIB], ['publicación', PUBLISH],
  ['retenidas', CHALLENGED], ['historial', HISTORY],
] as const;

/**
 * DÓNDE SE USA EL FILTRO, NO DÓNDE SE IMPORTA — y la distinción no es un detalle.
 *
 * `idMatchesSearch` aparece primero en la línea de `import`, que está al principio de todo
 * archivo. Comparar contra ESA posición hace que cualquier aserción de orden pase siempre,
 * mida lo que mida: una prueba verde que no verifica nada, que es peor que una roja.
 *
 * Se cazó el 2026-09-13 porque en `evaluated-history` la comparación falló por el motivo
 * contrario — y al mirarla se vio que en las otras tres pasaba por el import.
 */
const usoDelFiltro = (src: string) => src.search(/\.filter\([\s\S]{0,80}?idMatchesSearch/);

describe('el lote cortado se declara — la única forma en que este camino puede mentir', () => {
  it('las cuatro bandejas devuelven `search` con su `truncated`', () => {
    for (const [n, src] of BANDEJAS) {
      expect(src, `${n} no declara la búsqueda`).toMatch(/search:\s*search\s*\?/);
      expect(src, `${n} no declara si el lote se cortó`).toContain('truncated');
    }
  });

  it('un uuid completo NUNCA se marca truncado: va como filtro directo', () => {
    for (const [n, src] of BANDEJAS) {
      expect(src, `${n} marca truncado un uuid completo`).toContain("search.mode === 'prefix' && truncated");
    }
  });
});

describe('buscar y filtrar van ANTES de paginar', () => {
  it('en las cuatro bandejas, el filtro precede al slice de la página', () => {
    // Buscar después de paginar haría que el resultado dependiera de en qué página estabas,
    // que es la forma más silenciosa de que una búsqueda mienta.
    for (const [n, src] of BANDEJAS) {
      const filtro = usoDelFiltro(src);
      const pagina = src.indexOf('.slice(offset, offset + limit)');
      expect(filtro, `${n}: no filtra por búsqueda`).toBeGreaterThan(-1);
      expect(pagina, `${n}: no pagina`).toBeGreaterThan(-1);
      expect(filtro, `${n}: filtra DESPUÉS de paginar`).toBeLessThan(pagina);
    }
  });

  it('en las dos bandejas de piezas, el filtro precede a los contadores', () => {
    // Si no, las pastillas de marca contarían lo que ya no se está mirando.
    for (const [n, src] of [['calibración', CALIB], ['publicación', PUBLISH]] as const) {
      expect(usoDelFiltro(src), `${n}: contadores desincronizados`)
        .toBeLessThan(src.indexOf('by_brand: Record<string, number>'));
    }
  });
});

describe('un filtro que no se usa no cambia nada', () => {
  it('los tres filtros nuevos son condicionales: sin valor, no filtran', () => {
    // Un filtro que cambia el resultado por defecto no es un filtro: es un cambio de contrato.
    expect(CALIB).toMatch(/if \(search\) scoped = scoped\.filter/);
    expect(CALIB).toMatch(/if \(platform\) scoped = scoped\.filter/);
    expect(PUBLISH).toMatch(/if \(status\) scoped = scoped\.filter/);
    expect(CHALLENGED).toMatch(/if \(search\) scoped = scoped\.filter/);
    expect(HISTORY).toMatch(/if \(search\) filtradas = filtradas\.filter/);
  });
});

describe('las opciones de los selectores salen del DATO', () => {
  it('plataformas y estados se derivan del lote, no de una lista escrita', () => {
    expect(CALIB).toContain('platforms: platformsOf(');
    expect(PUBLISH).toContain('statuses: statusesOf(');
  });

  it('se derivan del lote COMPLETO, no del ya filtrado', () => {
    // Si se derivaran del filtrado, elegir un valor dejaría el selector con una sola opción
    // y sin forma de volver.
    expect(CALIB).toContain('platformsOf(perPiece)');
    expect(PUBLISH).toContain('statusesOf(perPiece)');
  });
});

describe('multimarca — cero plataformas, canales, marcas o estados escritos a mano', () => {
  const MARCAS = /NeuroneSCF|ForumPHs|LucienSael|UnrealvilleStudio|D7Herbal|VivoseMask/;
  const PLATAFORMAS = /['"](meta_ig|meta_fb|tiktok|instagram|facebook|linkedin|blog)['"]/i;

  it('ninguna marca en los archivos del diff', () => {
    for (const [n, src] of [...BANDEJAS, ['shared', SHARED] as const]) {
      expect(src, `${n} nombra una marca`).not.toMatch(MARCAS);
    }
  });

  it('ninguna plataforma ni canal enumerado: el selector sale del lote', () => {
    // Si aparece un array con 'meta_ig' o 'tiktok' dentro, el eje se habrá cerrado a los
    // valores de hoy y una marca nueva exigiría editar código.
    for (const [n, src] of BANDEJAS) {
      expect(src, `${n} enumera plataformas`).not.toMatch(PLATAFORMAS);
    }
  });

  it('el resolvedor no sabe de bandejas: se llama por lo que hace', () => {
    expect(SHARED).toContain('parsePieceSearch');
    expect(SHARED).not.toMatch(/parseCalibrationSearch|parsePublishSearch|searchInInbox/);
  });
});

// ── 9 · Historial — el círculo que cierra, a petición de Sam el 2026-09-13 ───────
/**
 * POR QUÉ ESTA BANDEJA ES LA IMPORTANTE, medido: `5b14caa7` está `rejected`, SELLADA y con
 * fila en el corpus. Una pieza así ya NO está en calibración (lista sólo `awaiting_approval`
 * sin fila en el corpus), ni en publicación (excluye `rejected`), ni en retenidas. Buscarla
 * en las tres funcionaba y no la encontraba — porque vive aquí.
 *
 * Y buscar aquí NO exige leer `content_pieces`: cada fila del corpus ya trae su `piece_id`.
 * Eso separa BUSCAR de dar ACCIONES; lo segundo sí lo exigiría y sigue fuera de alcance.
 */
describe('el historial también busca, y es donde más falta hacía', () => {
  it('filtra por el `piece_id` de la fila del corpus', () => {
    expect(HISTORY).toMatch(/idMatchesSearch\(r\.piece_id, search\)/);
  });

  it('no necesita leer content_pieces para buscar', () => {
    // Si apareciera, buscar habría arrastrado el coste que U-4 §2.b reservó para las acciones.
    expect(HISTORY).not.toMatch(/fetchLivePieces|fetchPiecesByIds|fetchCalibrationPieces/);
  });

  it('busca DESPUÉS de contar las facetas: una faceta que refleja el filtro es un eco', () => {
    // `by_brand` cuenta el ÁMBITO (fecha + origen). Si contara después de buscar, mostraría
    // una sola marca con el total de la página y dejaría de servir para navegar.
    expect(HISTORY.indexOf('const by_brand'))
      .toBeLessThan(usoDelFiltro(HISTORY));
  });
});
