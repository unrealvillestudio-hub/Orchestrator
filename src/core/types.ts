// UNRLVL — Orchestrator v1.0 Core Types

export type LabId =
  | "blueprintlab"
  | "copylab"
  | "imagelab"
  | "videolab"
  | "voicelab"
  | "sociallab"
  | "weblab";

export type FlowStageStatus =
  | "pending"
  | "running"
  | "awaiting_approval"
  | "approved"
  | "rejected"
  | "completed"
  | "skipped"
  | "error";

export type FlowStatus =
  | "draft"
  | "planned"
  | "running"
  | "paused"
  | "completed"
  | "cancelled";

export type PlatformId =
  | "INSTAGRAM"
  | "FACEBOOK"
  | "TIKTOK"
  | "YOUTUBE"
  | "LINKEDIN"
  | "THREADS";

export type FlowObjective =
  | "social_post"
  | "ad_campaign"
  | "product_launch"
  | "landing_page"
  | "brand_content"
  | "ecommerce_listing";

// ── FLOW STAGE ──────────────────────────────────────────────────────────────

export interface FlowStage {
  id: string;
  order: number;
  labId: LabId;
  label: string;
  description: string;
  requiresApproval: boolean;         // checkpoint gate
  estimatedSeconds: number;
  status: FlowStageStatus;
  output?: string;                   // generated content preview
  startedAt?: string;
  completedAt?: string;
  errorMsg?: string;
  mockOutput?: string;               // demo content for preview
}

// ── FLOW PLAN ────────────────────────────────────────────────────────────────

export interface FlowPlan {
  id: string;
  brandId: string;
  objective: FlowObjective;
  platforms: PlatformId[];
  userPrompt: string;
  interpretedIntent: string;         // Gemini summary of what it understood
  stages: FlowStage[];
  estimatedTotalSeconds: number;
  complianceFlags: string[];
  dbVariablesKeys: string[];         // which DB_VARIABLES keys will be used
  status: FlowStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

// ── BRAND ────────────────────────────────────────────────────────────────────

export interface BrandProfile {
  id: string;
  name: string;
  color: string;
  market: string;
  description: string;
}

// ── LAB REGISTRY ─────────────────────────────────────────────────────────────

export interface LabDefinition {
  id: LabId;
  label: string;
  description: string;
  icon: string;
  color: string;
  buildTag: string;
}

// ── INTERPRETER RESULT ────────────────────────────────────────────────────────

export interface InterpretResult {
  brandId: string | null;
  platforms: PlatformId[];
  objective: FlowObjective;
  interpretedIntent: string;
  suggestedStages: Omit<FlowStage, "status" | "id">[];
  complianceFlags: string[];
  dbVariablesKeys: string[];
  confidence: number;               // 0-1
}
