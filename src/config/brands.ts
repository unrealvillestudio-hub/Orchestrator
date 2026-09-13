/**
 * brands.ts — ⛔ VACIADO EN U-9, 2026-09-13. NO VOLVER A PONER MARCAS ACÁ.
 *
 * ── QUÉ HABÍA Y POR QUÉ SE FUE ───────────────────────────────────────────────────
 * Este archivo contenía una lista de once marcas con su color y su mercado: la SEGUNDA
 * copia de la misma lista, porque `brandsLoader.ts` tenía otra como respaldo. Dos copias
 * de la misma cosa divergen, y éstas divergieron de la base: le faltaban cuatro marcas
 * activas —una de ellas con piezas y franjas en producción— y conservaba una que la base
 * marca como fusionada.
 *
 * Nadie lo vio porque nada fallaba. Una marca nueva simplemente no aparecía en el selector,
 * y eso no se parece a un error: se parece a que la marca no está dada de alta.
 *
 * ── DÓNDE ESTÁN AHORA ────────────────────────────────────────────────────────────
 * En `public.brands`, que es su sitio. Se leen con `loadBrands()` de
 * `src/services/brandsLoader.ts`, o con el hook `useBrands()` de `src/services/useBrands.ts`
 * si quien las necesita es un componente. **Meter una marca nueva es insertar una fila; no
 * toca ninguna línea de código.**
 *
 * ── POR QUÉ ESTE ARCHIVO SIGUE EXISTIENDO ────────────────────────────────────────
 * Para que un import olvidado falle de forma legible —«no exporta BRANDS»— en vez de
 * encontrar una lista vieja y seguir funcionando mal en silencio. Es el alias legacy que
 * la regla multimarca manda conservar documentado durante un corte.
 *
 * **Su borrado es un tercer PR**, cuando no quede ningún import apuntando acá.
 */

export {};
