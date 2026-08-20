import { invoke, isTauri } from "@tauri-apps/api/core";

export interface P0SystemInfo {
  platform: string;
  osName: string;
  osVersion: string;
  kernelVersion: string;
  arch: string;
  cpuBrand: string;
  logicalCores: number;
  physicalCores?: number | null;
  totalRamMb: number;
  availableRamMb: number;
  freeStorageMb?: number | null;
  appLocalDataDir: string;
  gpuProbeStatus: string;
}

/**
 * One locked profile as the readiness panel shows it.
 *
 * Derived in Rust from `config/local-ai-models.lock.json` plus the AUTO
 * thresholds, so there is nothing here for the interface to keep in sync.
 */
export interface P0ModelProfile {
  id: string;
  label: string;
  family: string;
  quantization: string;
  /** The exact locked filename a player must place in the model directory. */
  file: string;
  contextTarget: number;
  sizeBytes: number;
  license: string;
  status: string;
  releaseApproved: boolean;
  /** Provisional P0 planning guidance, not a finalised requirement. */
  minRamMb: number;
  recommendedRamMb: number;
  minLogicalCores: number;
  gpuRequired: boolean;
  /** One line of quality/speed trade-off. */
  tradeOff: string;
  available: boolean;
  /** "packaged", "user model library" or "development workspace". */
  source?: string | null;
  problem?: string | null;
}

export interface P0RuntimeStatus {
  resourceDir: string;
  /** Where the authoritative model lock was read from, or why it could not be. */
  modelLockPath: string;
  modelLockPresent: boolean;
  /** Where a player may place model files. */
  userModelsDir: string;
  /** The packaged model directory, empty until Full Offline ships weights. */
  packagedModelsDir: string;
  llamaServerPath: string;
  llamaServerPresent: boolean;
  /** "packaged", "development workspace", or why resolution failed. */
  llamaServerSource: string;
  /** What AUTO would choose now, from the one authoritative resolver. */
  recommendedAiProfile: string;
  autoReason: string;
  profiles: P0ModelProfile[];
}

export interface P0DatabaseStatus {
  ready: boolean;
  path: string;
  schemaVersion: number;
}

export interface P0SmokeCampaign {
  campaignId: string;
  seed: number;
  turn: number;
  aiProfile: "auto" | "lite" | "standard" | "procedural";
  createdAt: string;
  schemaVersion: number;
}

export function isChronosagaDesktop(): boolean {
  return isTauri();
}

export function getSystemInfo(): Promise<P0SystemInfo> {
  return invoke<P0SystemInfo>("get_system_info");
}

export function getRuntimeStatus(): Promise<P0RuntimeStatus> {
  return invoke<P0RuntimeStatus>("get_runtime_status");
}

export function getDatabaseStatus(): Promise<P0DatabaseStatus> {
  return invoke<P0DatabaseStatus>("get_database_status");
}

export function saveSmokeCampaign(campaign: P0SmokeCampaign): Promise<P0SmokeCampaign> {
  return invoke<P0SmokeCampaign>("save_smoke_campaign", { campaign });
}

export function loadSmokeCampaign(campaignId: string): Promise<P0SmokeCampaign | null> {
  return invoke<P0SmokeCampaign | null>("load_smoke_campaign", { campaignId });
}

/** Lifecycle phase of the local AI sidecar, mirrored from the Rust enum. */
export type P0LocalAiRuntimePhase =
  | "unavailable"
  | "stopped"
  | "starting"
  | "loading"
  | "ready"
  | "stopping"
  | "failed";

export interface P0LocalAiRuntimeSnapshot {
  state: P0LocalAiRuntimePhase;
  binaryPresent: boolean;
  binaryPath: string;
  pid?: number | null;
  startedAt?: number | null;
  lastError?: string | null;
  host: string;
  port: number;
  endpoint: string;
  /** The HTTP runtime answers /health. Reachable with no model installed. */
  runtimeReady: boolean;
  /** A model is loaded and inference can be served. False until P0.3-C. */
  inferenceReady: boolean;
  loadedModels?: number | null;
  modelProfileId?: string | null;
  modelLabel?: string | null;
  modelContextSize?: number | null;
  modelPath?: string | null;
}

/**
 * Read the runtime status. A pure read on the Rust side: it never advances the
 * state machine, so calling it on a timer is safe. The background watcher is
 * what drives STARTING to READY.
 */
export function getLocalAiRuntimeStatus(): Promise<P0LocalAiRuntimeSnapshot> {
  return invoke<P0LocalAiRuntimeSnapshot>("get_local_ai_runtime_status");
}

export function startLocalAiRuntime(): Promise<P0LocalAiRuntimeSnapshot> {
  return invoke<P0LocalAiRuntimeSnapshot>("start_local_ai_runtime");
}

export function stopLocalAiRuntime(): Promise<P0LocalAiRuntimeSnapshot> {
  return invoke<P0LocalAiRuntimeSnapshot>("stop_local_ai_runtime");
}

/** The locked Lite model, as the diagnostics see it. */
export interface P0LocalAiModelStatus {
  profileId: string;
  label: string;
  resolved: boolean;
  path: string;
  license: string;
  contextSize: number;
  releaseApproved: boolean;
  /** The artifact was hashed and matches the locked SHA-256. */
  integrityVerified: boolean;
  verificationMs?: number | null;
  sizeBytes: number;
  expectedSha256: string;
  status: string;
  artifactRepository: string;
  artifactRevision: string;
  problem?: string | null;
}

export interface P0DialogueLine {
  speakerId: string;
  text: string;
}

/** Result of one real local generation, after the application validator ran. */
export interface P0InferenceOutcome {
  accepted: boolean;
  durationMs: number;
  narration?: string | null;
  dialogue: P0DialogueLine[];
  toneTags: string[];
  validationError?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  tokensPerSecond?: number | null;
  model?: string | null;
}

export function getLocalAiModelStatus(): Promise<P0LocalAiModelStatus> {
  return invoke<P0LocalAiModelStatus>("get_local_ai_model_status");
}

/** Every locked profile, for the diagnostic selector. Does not hash. */
export function listLocalAiProfiles(): Promise<P0LocalAiModelStatus[]> {
  return invoke<P0LocalAiModelStatus[]>("list_local_ai_profiles");
}

/**
 * Choose the profile the runtime will load next.
 *
 * The interface sends a profile id and nothing else: the model path, its digest
 * and the llama-server command line all stay in Rust.
 */
export function selectLocalAiProfile(profileId: string): Promise<P0LocalAiModelStatus> {
  return invoke<P0LocalAiModelStatus>("select_local_ai_profile", { profileId });
}

/** One attempt at bringing a profile up, in chain order. */
export interface P0ProfileAttempt {
  profileId: string;
  succeeded: boolean;
  error?: string | null;
}

/** How the last profile transition ended, including any fallback. */
export interface P0ProfileOutcome {
  requestedProfile: string;
  resolvedProfile: string;
  activeProfile?: string | null;
  safeMode: boolean;
  autoReason: string;
  attempts: P0ProfileAttempt[];
  fallbackReason?: string | null;
  presentation: string;
}

/**
 * Apply a requested profile: AUTO resolves it, the current runtime is stopped
 * and reaped, then the chain STANDARD -> LITE -> SAFE is walked until one
 * serves. The whole transition happens in Rust; the interface sends an id.
 */
export function applyLocalAiProfile(profileId: string): Promise<P0ProfileOutcome> {
  return invoke<P0ProfileOutcome>("apply_local_ai_profile", { profileId });
}

export function getLocalAiProfileOutcome(): Promise<P0ProfileOutcome | null> {
  return invoke<P0ProfileOutcome | null>("get_local_ai_profile_outcome");
}

/**
 * Run the grounded P0 smoke generation. The request never leaves the machine:
 * React invokes Rust, Rust talks to llama-server on loopback.
 */
export function runLocalAiSmokeInference(): Promise<P0InferenceOutcome> {
  return invoke<P0InferenceOutcome>("run_local_ai_smoke_inference");
}
