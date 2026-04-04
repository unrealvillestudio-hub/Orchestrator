/**
 * UNRLVL — Orchestrator: brands.ts
 *
 * NOTA: Este archivo es el fallback estático.
 * En producción, usar brandsLoader.ts → loadBrands() que lee desde Supabase.
 *
 * IDs corregidos a canónicos Supabase (v2.0):
 * - UnrealIlleStudio → UnrealvilleStudio
 * - NeuroneCosmetics → NeuroneSCF
 * - PHAS → ForumPHs (nombre canónico confirmado)
 * - Añadido: UnrealvilleStores, ForumPHs
 */

import { BrandProfile } from '../core/types';

/** @deprecated Usar brandsLoader.ts → loadBrands() para datos en tiempo real desde Supabase */
export const BRANDS: Record<string, BrandProfile> = {
  NeuroneSCF: {
    id: 'NeuroneSCF',
    name: 'Neurone South & Central Florida',
    color: '#0076A8',
    market: 'South & Central Florida',
    description: 'cosmetics_haircare',
  },
  PatriciaOsorioPersonal: {
    id: 'PatriciaOsorioPersonal',
    name: 'Patricia Osorio · Personal',
    color: '#EC4899',
    market: 'Miami, FL',
    description: 'personal_branding',
  },
  PatriciaOsorioComunidad: {
    id: 'PatriciaOsorioComunidad',
    name: 'Patricia Osorio · Comunidad',
    color: '#A855F7',
    market: 'Miami, FL',
    description: 'community_networking',
  },
  PatriciaOsorioVizosSalon: {
    id: 'PatriciaOsorioVizosSalon',
    name: 'Patricia Osorio · Vizos Salon',
    color: '#F59E0B',
    market: 'Miami, FL',
    description: 'luxury_salon',
  },
  DiamondDetails: {
    id: 'DiamondDetails',
    name: 'Diamond Details',
    color: '#3B82F6',
    market: 'Alicante, España',
    description: 'automotive_detailing',
  },
  D7Herbal: {
    id: 'D7Herbal',
    name: 'D7 Herbal',
    color: '#22C55E',
    market: 'Alicante, España',
    description: 'cosmetics_haircare',
  },
  VivoseMask: {
    id: 'VivoseMask',
    name: 'Vivosé Mask',
    color: '#F472B6',
    market: 'España',
    description: 'beauty_skincare',
  },
  VizosCosmetics: {
    id: 'VizosCosmetics',
    name: 'Vizos Cosmetics',
    color: '#6366F1',
    market: 'Miami + España',
    description: 'high_end_beauty',
  },
  ForumPHs: {
    id: 'ForumPHs',
    name: 'ForumPHs',
    color: '#14B8A6',
    market: 'Panamá',
    description: 'property_management',
  },
  UnrealvilleStudio: {
    id: 'UnrealvilleStudio',
    name: 'Unrealville Studio',
    color: '#FFAB00',
    market: 'Florida USA',
    description: 'marketing_agency',
  },
  UnrealvilleStores: {
    id: 'UnrealvilleStores',
    name: 'Unrealville Stores',
    color: '#F97316',
    market: 'Florida USA',
    description: 'ecommerce',
  },
};

export const getBrandById = (id: string): BrandProfile | undefined => BRANDS[id];
