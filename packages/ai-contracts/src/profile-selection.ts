export type AIProfileChoice = 'auto' | 'lite' | 'standard' | 'procedural';
export type LocalAIProfileId = 'lite' | 'standard';
export type ActiveAIProfileId = LocalAIProfileId | 'procedural';

export interface AIModelProfile {
  id: LocalAIProfileId;
  label: string;
  parameterClass: string;
  candidateFamily: string;
  contextTarget: number;
  minRamMb: number;
  recommendedRamMb: number;
  minLogicalCores: number;
  usefulVramMb?: number;
  storageMinMb: number;
  storageMaxMb: number;
}

export interface AIHardwareSnapshot {
  totalRamMb: number;
  logicalCores: number;
  gpuAccelerationAvailable?: boolean;
  availableVramMb?: number;
  freeStorageMb?: number;
}

export type AIProfileCompatibility =
  | 'recommended'
  | 'usable-with-warning'
  | 'below-target';

export interface AIProfileAssessment {
  profileId: LocalAIProfileId;
  compatibility: AIProfileCompatibility;
  warnings: string[];
  reasons: string[];
}

export interface AIProfileResolution {
  requested: AIProfileChoice;
  selected: ActiveAIProfileId;
  recommended: ActiveAIProfileId;
  warnings: string[];
  reasons: string[];
}

function byId(profiles: readonly AIModelProfile[], id: LocalAIProfileId): AIModelProfile {
  const profile = profiles.find((candidate) => candidate.id === id);
  if (!profile) {
    throw new Error(`Missing local AI profile configuration: ${id}`);
  }
  return profile;
}

export function assessAIProfile(
  profile: AIModelProfile,
  hardware: AIHardwareSnapshot,
): AIProfileAssessment {
  const warnings: string[] = [];
  const reasons: string[] = [];

  if (hardware.totalRamMb < profile.minRamMb) {
    warnings.push(
      `Detected RAM ${hardware.totalRamMb} MB is below the current ${profile.minRamMb} MB target for ${profile.label}.`,
    );
  } else if (hardware.totalRamMb < profile.recommendedRamMb) {
    warnings.push(
      `Detected RAM meets the current minimum target but is below the ${profile.recommendedRamMb} MB recommendation for ${profile.label}.`,
    );
  } else {
    reasons.push(`RAM meets the current recommended target for ${profile.label}.`);
  }

  if (hardware.logicalCores < profile.minLogicalCores) {
    warnings.push(
      `Detected ${hardware.logicalCores} logical CPU cores are below the current ${profile.minLogicalCores}-core target for ${profile.label}.`,
    );
  } else {
    reasons.push(`CPU core count meets the current target for ${profile.label}.`);
  }

  if (
    hardware.freeStorageMb !== undefined &&
    hardware.freeStorageMb < profile.storageMinMb
  ) {
    warnings.push(
      `Free storage ${hardware.freeStorageMb} MB is below the estimated ${profile.storageMinMb} MB model payload for ${profile.label}.`,
    );
  }

  if (
    profile.usefulVramMb !== undefined &&
    hardware.gpuAccelerationAvailable &&
    hardware.availableVramMb !== undefined &&
    hardware.availableVramMb < profile.usefulVramMb
  ) {
    warnings.push(
      `GPU acceleration is available, but detected VRAM is below the current ${profile.usefulVramMb} MB acceleration target. CPU fallback remains allowed.`,
    );
  }

  const belowMinimum =
    hardware.totalRamMb < profile.minRamMb ||
    hardware.logicalCores < profile.minLogicalCores ||
    (hardware.freeStorageMb !== undefined && hardware.freeStorageMb < profile.storageMinMb);

  if (belowMinimum) {
    return {
      profileId: profile.id,
      compatibility: 'below-target',
      warnings,
      reasons,
    };
  }

  if (warnings.length > 0) {
    return {
      profileId: profile.id,
      compatibility: 'usable-with-warning',
      warnings,
      reasons,
    };
  }

  return {
    profileId: profile.id,
    compatibility: 'recommended',
    warnings,
    reasons,
  };
}

export function recommendAIProfile(
  hardware: AIHardwareSnapshot,
  profiles: readonly AIModelProfile[],
): ActiveAIProfileId {
  const standard = assessAIProfile(byId(profiles, 'standard'), hardware);
  if (standard.compatibility !== 'below-target') {
    return 'standard';
  }

  const lite = assessAIProfile(byId(profiles, 'lite'), hardware);
  if (lite.compatibility !== 'below-target') {
    return 'lite';
  }

  return 'procedural';
}

export function resolveAIProfileChoice(
  requested: AIProfileChoice,
  hardware: AIHardwareSnapshot,
  profiles: readonly AIModelProfile[],
): AIProfileResolution {
  const recommended = recommendAIProfile(hardware, profiles);

  if (requested === 'auto') {
    return {
      requested,
      selected: recommended,
      recommended,
      warnings: [],
      reasons: [`AUTO selected ${recommended} from the current hardware/profile thresholds.`],
    };
  }

  if (requested === 'procedural') {
    return {
      requested,
      selected: 'procedural',
      recommended,
      warnings: [],
      reasons: ['Procedural mode was explicitly selected; no local LLM is required.'],
    };
  }

  const assessment = assessAIProfile(byId(profiles, requested), hardware);
  return {
    requested,
    selected: requested,
    recommended,
    warnings: assessment.warnings,
    reasons: assessment.reasons,
  };
}

export function getAIProfileFallbackChain(
  active: ActiveAIProfileId,
): ActiveAIProfileId[] {
  switch (active) {
    case 'standard':
      return ['lite', 'procedural'];
    case 'lite':
      return ['procedural'];
    case 'procedural':
      return [];
  }
}
