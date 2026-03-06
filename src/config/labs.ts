import { LabDefinition } from '../core/types';

export const LABS: LabDefinition[] = [
  { id: "blueprintlab", label: "BlueprintLab",  description: "Gestión de personas, locaciones y copy blueprints", icon: "◈", color: "#FFAB00", buildTag: "BL_1.2" },
  { id: "copylab",      label: "CopyLab",        description: "Generación de copy multicanal con IA",              icon: "✦", color: "#F97316", buildTag: "CL_1.0" },
  { id: "imagelab",     label: "ImageLab",        description: "Generación de imágenes con prompts de DB_VAR",      icon: "⬡", color: "#8B5CF6", buildTag: "IL_1.0" },
  { id: "videolab",     label: "VideoLab",        description: "Producción de video y guiones visuales",            icon: "▶", color: "#EF4444", buildTag: "VD_1.0" },
  { id: "voicelab",     label: "VoiceLab",        description: "Síntesis de voz y clonación por marca",             icon: "◎", color: "#06B6D4", buildTag: "VL_1.0" },
  { id: "sociallab",    label: "SocialLab",       description: "Programación y publicación en redes sociales",      icon: "⊕", color: "#EC4899", buildTag: "SL_1.0" },
  { id: "weblab",       label: "WebLab",          description: "Generación de copy para web, landing y e-commerce", icon: "◻", color: "#22C55E", buildTag: "WL_1.0" },
];

export const getLabById = (id: string) => LABS.find(l => l.id === id);
