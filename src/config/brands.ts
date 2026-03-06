import { BrandProfile } from '../core/types';

export const BRANDS: BrandProfile[] = [
  { id: "UnrealIlleStudio",          name: "Unreal>ille Studio",    color: "#FFAB00", market: "Miami",          description: "marketing_agency" },
  { id: "PatriciaOsorioPersonal",    name: "Patricia Osorio",        color: "#EC4899", market: "Miami",          description: "personal_branding" },
  { id: "PatriciaOsorioComunidad",   name: "PO — Conectando",        color: "#A855F7", market: "Miami",          description: "community_networking" },
  { id: "PatriciaOsorioVizosSalon",  name: "Vizos Salón Miami",      color: "#F59E0B", market: "Miami",          description: "luxury_salon" },
  { id: "DiamondDetails",            name: "Diamond Details",         color: "#3B82F6", market: "Alicante",       description: "automotive_detailing" },
  { id: "D7Herbal",                  name: "D7Herbal",                color: "#22C55E", market: "España + Miami", description: "cosmetics_haircare" },
  { id: "VivoseMask",                name: "Vivosé Mask",             color: "#F472B6", market: "España + Miami", description: "beauty_skincare" },
  { id: "VizosCosmetics",            name: "Vizos Cosmetics",         color: "#6366F1", market: "España + Miami", description: "high_end_beauty" },
  { id: "PHAS",                      name: "PH Admin Services",       color: "#14B8A6", market: "Panamá",         description: "property_management" },
  { id: "NeuroneCosmetics",          name: "Neurone Cosmética",       color: "#0076A8", market: "South & Central Miami", description: "cosmetics_haircare" },
];

export const getBrandById = (id: string) => BRANDS.find(b => b.id === id);
