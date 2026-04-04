/**
 * UNRLVL — Orchestrator: brandsLoader.ts
 *
 * Carga marcas desde Supabase brands table.
 * Reemplaza el array hardcoded en brands.ts.
 * Patrón: fetch nativo, sin SDK. Compatible con Vite (VITE_* env vars).
 */

import { BrandProfile } from '../core/types';

const SB_URL = (import.meta as any).env.VITE_SUPABASE_URL as string;
const SB_KEY = (import.meta as any).env.VITE_SUPABASE_ANON_KEY as string;

// Mapeo de colores por marca — se puede mover a Supabase (brand_palette) cuando esté poblado
const BRAND_COLORS: Record<string, string> = {
  NeuroneSCF:               '#0076A8',
  PatriciaOsorioPersonal:   '#EC4899',
  PatriciaOsorioComunidad:  '#A855F7',
  PatriciaOsorioVizosSalon: '#F59E0B',
  DiamondDetails:           '#3B82F6',
  D7Herbal:                 '#22C55E',
  VivoseMask:               '#F472B6',
  VizosCosmetics:           '#6366F1',
  ForumPHs:                 '#14B8A6',
  UnrealvilleStudio:        '#FFAB00',
  UnrealvilleStores:        '#F97316',
};

// Fallback hardcoded (IDs canónicos Supabase)
export const BRANDS_FALLBACK: BrandProfile[] = [
  { id: 'NeuroneSCF',               name: 'Neurone South & Central Florida', color: '#0076A8', market: 'South & Central Florida', description: 'cosmetics_haircare' },
  { id: 'PatriciaOsorioPersonal',   name: 'Patricia Osorio · Personal',      color: '#EC4899', market: 'Miami, FL',               description: 'personal_branding' },
  { id: 'PatriciaOsorioComunidad',  name: 'Patricia Osorio · Comunidad',     color: '#A855F7', market: 'Miami, FL',               description: 'community_networking' },
  { id: 'PatriciaOsorioVizosSalon', name: 'Patricia Osorio · Vizos Salon',   color: '#F59E0B', market: 'Miami, FL',               description: 'luxury_salon' },
  { id: 'DiamondDetails',           name: 'Diamond Details',                  color: '#3B82F6', market: 'Alicante, España',        description: 'automotive_detailing' },
  { id: 'D7Herbal',                 name: 'D7 Herbal',                        color: '#22C55E', market: 'Alicante, España',        description: 'cosmetics_haircare' },
  { id: 'VivoseMask',               name: 'Vivosé Mask',                      color: '#F472B6', market: 'España',                  description: 'beauty_skincare' },
  { id: 'VizosCosmetics',           name: 'Vizos Cosmetics',                  color: '#6366F1', market: 'Miami + España',          description: 'high_end_beauty' },
  { id: 'ForumPHs',                 name: 'ForumPHs',                         color: '#14B8A6', market: 'Panamá',                  description: 'property_management' },
  { id: 'UnrealvilleStudio',        name: 'Unrealville Studio',               color: '#FFAB00', market: 'Florida USA',             description: 'marketing_agency' },
  { id: 'UnrealvilleStores',        name: 'Unrealville Stores',               color: '#F97316', market: 'Florida USA',             description: 'ecommerce' },
];

let _brandsCache: BrandProfile[] | null = null;

export async function loadBrands(): Promise<BrandProfile[]> {
  if (_brandsCache) return _brandsCache;

  if (!SB_URL || !SB_KEY) {
    console.warn('[brandsLoader] Supabase env vars missing — using fallback brands');
    return BRANDS_FALLBACK;
  }

  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/brands?select=id,name,market,status&status=eq.active&order=name`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
    );

    if (!res.ok) throw new Error(`Supabase error: ${res.status}`);

    const rows: Array<{ id: string; name: string; market: string; status: string }> = await res.json();

    _brandsCache = rows.map(r => ({
      id:          r.id,
      name:        r.name,
      color:       BRAND_COLORS[r.id] ?? '#888888',
      market:      r.market,
      description: '',  // no requerido por Orchestrator
    }));

    return _brandsCache;
  } catch (err) {
    console.error('[brandsLoader] Error loading brands from Supabase:', err);
    return BRANDS_FALLBACK;
  }
}

export function getBrandById(brands: BrandProfile[], id: string): BrandProfile | undefined {
  return brands.find(b => b.id === id);
}

/** Invalida el cache (usar si Sam añade una marca en la sesión) */
export function invalidateBrandsCache(): void {
  _brandsCache = null;
}
