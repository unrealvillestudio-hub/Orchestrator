// UNRLVL — Orchestrator v2.2 Core Types

export type LabId =
  | "blueprintlab"
  | "copylab"
  | "imagelab"
  | "videolab"
  | "voicelab"
  | "sociallab"
  | "weblab"
  | "klaviyo";    // ← añadido v2.2: destino de email_sequence

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
  | "THREADS"
  | "EMAIL";     // ← añadido v2.2

export type FlowObjective =
  | "social_post"
  | "ad_campaign"
  | "product_launch"
  | "landing_page"
  | "brand_content"
  | "ecommerce_listing"
  | "email_sequence"; // ← añadido v2.2

export type EmailSequenceType =
  | "abandoned_cart"
  | "welcome"
  | "post_purchase"
  | "review_request"
  | "win_back";

// ── FLOW STAGE ──────────────────────────────────────────────────────────────

export interface FlowStage {
  id: string;
  order: number;
  labId: LabId;
  label: string;
  description: string;
  requiresApproval: boolean;
  estimatedSeconds: number;
  status: FlowStageStatus;
  output?: string;
  startedAt?: string;
  completedAt?: string;
  errorMsg?: string;
  mockOutput?: string;
  pack_id?: string;       // ← añadido v2.2: referencia al pack de CopyLab
}

// ── SEQUENCE CONTEXT ─────────────────────────────────────────────────────────

export interface SequenceContext {
  persona_key:          string | null;
  language:             string[];
  utm_content:          string | null;
  klaviyo_template_ids: Record<string, string> | null;
}

// ── FLOW PLAN ────────────────────────────────────────────────────────────────

export interface FlowPlan {
  id: string;
  brandId: string;
  objective: FlowObjective;
  platforms: PlatformId[];
  userPrompt: string;
  interpretedIntent: string;
  stages: FlowStage[];
  estimatedTotalSeconds: number;
  complianceFlags: string[];
  dbVariablesKeys: string[];
  status: FlowStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  // email_sequence fields
  sequence_type?:    EmailSequenceType | null;
  sequence_context?: SequenceContext | null;
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
  brandId:           string | null;
  platforms:         PlatformId[];
  objective:         FlowObjective;
  interpretedIntent: string;
  suggestedStages:   Omit<FlowStage, "status" | "id">[];
  complianceFlags:   string[];
  dbVariablesKeys:   string[];
  confidence:        number;
  // email_sequence fields (opcionales — null para otros objectives)
  sequence_type?:    EmailSequenceType | null;
  sequence_context?: SequenceContext | null;
}
