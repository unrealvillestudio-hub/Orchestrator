/**
 * UNRLVL — Orchestrator: brands.ts
 *
 * IDs corregidos a canónicos Supabase (v2.0):
 *   UnrealIlleStudio → UnrealvilleStudio
 *   NeuroneCosmetics → NeuroneSCF
 *   PHAS             → ForumPHs
 * Mantener como BrandProfile[] para compatibilidad con BRANDS.map() en los módulos.
 * Para datos en tiempo real desde Supabase usar brandsLoader.ts → loadBrands().
 */

import { BrandProfile } from '../core/types';

export const BRANDS: BrandProfile[] = [
  { id: 'NeuroneSCF',               name: 'Neurone South & Central Florida', color: '#0076A8', market: 'South & Central Florida', description: 'cosmetics_haircare'   },
  { id: 'PatriciaOsorioPersonal',   name: 'Patricia Osorio · Personal',      color: '#EC4899', market: 'Miami, FL',               description: 'personal_branding'    },
  { id: 'PatriciaOsorioComunidad',  name: 'Patricia Osorio · Comunidad',     color: '#A855F7', market: 'Miami, FL',               description: 'community_networking' },
  { id: 'PatriciaOsorioVizosSalon', name: 'Patricia Osorio · Vizos Salon',   color: '#F59E0B', market: 'Miami, FL',               description: 'luxury_salon'         },
  { id: 'DiamondDetails',           name: 'Diamond Details',                  color: '#3B82F6', market: 'Alicante, España',        description: 'automotive_detailing' },
  { id: 'D7Herbal',                 name: 'D7 Herbal',                        color: '#22C55E', market: 'Alicante, España',        description: 'cosmetics_haircare'   },
  { id: 'VivoseMask',               name: 'Vivosé Mask',                      color: '#F472B6', market: 'España',                  description: 'beauty_skincare'      },
  { id: 'VizosCosmetics',           name: 'Vizos Cosmetics',                  color: '#6366F1', market: 'Miami + España',          description: 'high_end_beauty'      },
  { id: 'ForumPHs',                 name: 'ForumPHs',                         color: '#14B8A6', market: 'Panamá',                  description: 'property_management'  },
  { id: 'UnrealvilleStudio',        name: 'Unrealville Studio',               color: '#FFAB00', market: 'Florida USA',             description: 'marketing_agency'     },
  { id: 'UnrealvilleStores',        name: 'Unrealville Stores',               color: '#F97316', market: 'Florida USA',             description: 'ecommerce'            },
];

export const getBrandById = (id: string): BrandProfile | undefined =>
  BRANDS.find(b => b.id === id);
