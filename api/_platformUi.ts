/**
 * LA INTERFAZ DE LA PLATAFORMA SOBRE LA VISTA (Sam, 2026-11-18: «un check que habilite una capa que simule los botones
 * y la interfaz de la plataforma a la que va la pieza, así como lo haces en SocialLab»).
 *
 * Todo es dato, como en SocialLab (`src/maqueta.ts`):
 *   · la plataforma del proveedor sale del canal de la marca: `intel.brand_publish_channels.config.provider_platform`
 *     para (brand_id, platform_key de la pieza) — la misma fuente que usa el drenaje de publicación;
 *   · la maqueta, de `intel.platform_previews` (la de SocialLab). Para un video se elige la de forma `vertical` de esa
 *     plataforma (la de formato vacío primero): un video se ve a pantalla completa;
 *   · la cuenta, de `intel.account_profiles` (usuario y foto), con el mismo respaldo que `cuentaDe` de SocialLab.
 * Ninguna plataforma ni marca se nombra en este archivo. Sin canal, sin maqueta vertical o sin perfil: null y la
 * ventana no ofrece la capa (no se inventa).
 */

export interface PlatformUi { platform: string; layout: 'vertical'; cuenta: string; foto: string | null; texto: string | null }

export interface CanalRow { brand_id: string; platform_key: string; config: Record<string, any> | null }
export interface PreviewRow { platform: string; media_format: string | null; layout: string; active?: boolean }
export interface PerfilRow { brand_id: string; platform: string; username: string | null; display_name: string | null; picture_url: string | null }

/** La plataforma del proveedor de un canal de la marca, o null. PURO. */
export function providerPlatformOf(canales: readonly CanalRow[], brandId: string, platformKey: string | null | undefined): string | null {
  if (!platformKey) return null;
  const c = canales.find((x) => x.brand_id === brandId && x.platform_key === platformKey);
  const p = c?.config?.provider_platform;
  return typeof p === 'string' && p.trim() ? p.trim() : null;
}

/** ¿La plataforma tiene maqueta vertical? La de formato vacío primero. PURO. */
export function verticalPreviewOf(previews: readonly PreviewRow[], platform: string): PreviewRow | null {
  const v = previews.filter((p) => p.platform === platform && p.layout === 'vertical' && p.active !== false);
  return v.find((p) => p.media_format == null) ?? v[0] ?? null;
}

/** La cuenta como se ve: su perfil en esa plataforma; si no, uno de la marca con foto; si no, el nombre de la marca. PURO. */
export function cuentaOf(perfiles: readonly PerfilRow[], brandId: string, platform: string): { cuenta: string; foto: string | null } {
  const deMarca = perfiles.filter((p) => p.brand_id === brandId);
  const propio = deMarca.find((p) => p.platform === platform);
  const conFoto = deMarca.find((p) => p.picture_url);
  return {
    cuenta: propio?.username ?? propio?.display_name ?? conFoto?.username ?? conFoto?.display_name ?? brandId,
    foto: propio?.picture_url ?? conFoto?.picture_url ?? null,
  };
}

/** La capa de la plataforma para un video, o null si falta el dato. PURO. */
export function platformUiOf(args: {
  brandId: string; platformKey: string | null | undefined; texto: string | null;
  canales: readonly CanalRow[]; previews: readonly PreviewRow[]; perfiles: readonly PerfilRow[];
}): PlatformUi | null {
  const platform = providerPlatformOf(args.canales, args.brandId, args.platformKey);
  if (!platform || !verticalPreviewOf(args.previews, platform)) return null;
  return { platform, layout: 'vertical', ...cuentaOf(args.perfiles, args.brandId, platform), texto: args.texto };
}
