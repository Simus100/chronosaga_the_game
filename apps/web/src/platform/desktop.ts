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

export interface P0ModelProfile {
  id: string;
  label: string;
  parameterClass: string;
  candidateFamily: string;
  file: string;
  contextTarget: number;
  modelSizeMinMb: number;
  modelSizeMaxMb: number;
  minRamMb: number;
  recommendedRamMb: number;
  minLogicalCores: number;
  gpuRequired: boolean;
  usefulVramMb?: number | null;
}

export interface P0RuntimeStatus {
  resourceDir: string;
  modelManifestPath: string;
  modelManifestPresent: boolean;
  llamaServerPath: string;
  llamaServerPresent: boolean;
  /** "packaged", "development workspace", or why resolution failed. */
  llamaServerSource: string;
  recommendedAiProfile: string;
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
