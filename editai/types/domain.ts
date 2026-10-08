import type { EditingPlan, AspectRatio } from "@/lib/editing-plan";
import type { RejectedOperation } from "@/lib/editing-plan/validate";
import type { VideoMetadata, AnalysisStatus } from "./video";

export type ProjectStatus = "draft" | "uploading" | "analyzing" | "ready" | "processing" | "failed" | "archived";
export type RenderStatus = "queued" | "processing" | "completed" | "failed";
export type RenderKind = "edit" | "export";
export type VersionStatus = "pending" | "ready" | "failed";
export type CommandStatus = "planned" | "confirmed" | "rendered" | "failed" | "discarded";
export type TranscriptionSource = "stt" | "browser" | "text";
export type ExportQuality = "720p" | "1080p";
export type JobType = "analyze" | "render";
export type JobStatus = "queued" | "processing" | "completed" | "failed";
export type MediaKind = "original_video" | "audio_command" | "version_video" | "export" | "thumbnail" | "music" | "image";
export type CreditReason =
  | "signup_bonus"
  | "render"
  | "export"
  | "refund"
  | "purchase"
  | "subscription_grant"
  | "adjustment";

export interface Project {
  id: string;
  user_id: string;
  name: string;
  status: ProjectStatus;
  original_video_url: string | null;
  thumbnail_url: string | null;
  current_version_id: string | null;
  original_file_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectVersion {
  id: string;
  project_id: string;
  user_id: string;
  version_number: number;
  label: string;
  status: VersionStatus;
  video_url: string | null;
  editing_plan: EditingPlan;
  command_id: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  size_bytes: number | null;
  created_at: string;
}

export interface EditingCommand {
  id: string;
  project_id: string;
  user_id: string;
  audio_url: string | null;
  audio_duration: number | null;
  transcription: string | null;
  transcription_source: TranscriptionSource;
  instruction_text: string;
  editing_plan: EditingPlan;
  assistant_reply: string;
  rejected_operations: RejectedOperation[];
  planner_provider: string;
  status: CommandStatus;
  base_version_id: string | null;
  result_version_id: string | null;
  estimated_credits: number;
  created_at: string;
}

export interface RenderOptions {
  aspectRatio?: AspectRatio;
  quality: ExportQuality;
}

export interface Render {
  id: string;
  project_id: string;
  user_id: string;
  version_id: string;
  command_id: string | null;
  kind: RenderKind;
  status: RenderStatus;
  progress: number;
  stage: string | null;
  message: string | null;
  output_url: string | null;
  output_size_bytes: number | null;
  output_duration: number | null;
  output_width: number | null;
  output_height: number | null;
  error: string | null;
  warnings: string[];
  options: RenderOptions;
  credits_charged: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface VideoMetadataRow {
  id: string;
  project_id: string;
  user_id: string;
  analysis_status: AnalysisStatus;
  analysis_error: string | null;
  metadata: VideoMetadata | null;
  analyzed_at: string | null;
}

export interface CreditTransaction {
  id: string;
  user_id: string;
  amount: number;
  balance_after: number;
  reason: CreditReason;
  reference_id: string | null;
  description: string | null;
  created_at: string;
}

export interface Subscription {
  id: string;
  user_id: string;
  plan_id: string;
  status: "active" | "trialing" | "past_due" | "canceled" | "incomplete";
  provider: string;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  current_period_end: string | null;
}

export interface MediaAsset {
  id: string;
  user_id: string;
  project_id: string | null;
  kind: MediaKind;
  storage_path: string;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  duration_seconds: number | null;
  metadata: Record<string, unknown>;
  expires_at: string | null;
  created_at: string;
}

export interface Job {
  id: string;
  type: JobType;
  user_id: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  priority: number;
  last_error: string | null;
}

/** Payloads dos jobs da fila. */
export interface AnalyzeJobPayload {
  projectId: string;
}
export interface RenderJobPayload {
  renderId: string;
}
