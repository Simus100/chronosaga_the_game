import { describe, expect, it } from 'vitest';
import {
  assessAIProfile,
  getAIProfileFallbackChain,
  recommendAIProfile,
  resolveAIProfileChoice,
  type AIModelProfile,
} from '../src/index.js';

const profiles: AIModelProfile[] = [
  {
    id: 'lite',
    label: 'Lite ~1.7B',
    parameterClass: '~1.7B',
    candidateFamily: 'Qwen3-1.7B class',
    contextTarget: 4096,
    minRamMb: 8192,
    recommendedRamMb: 16384,
    minLogicalCores: 4,
    usefulVramMb: 4096,
    storageMinMb: 1024,
    storageMaxMb: 1536,
  },
  {
    id: 'standard',
    label: 'Standard ~3B',
    parameterClass: '~3B',
    candidateFamily: 'SmolLM3-3B class',
    contextTarget: 8192,
    minRamMb: 16384,
    recommendedRamMb: 16384,
    minLogicalCores: 6,
    usefulVramMb: 6144,
    storageMinMb: 1843,
    storageMaxMb: 2560,
  },
];

describe('local AI profile selection', () => {
  it('recommends Standard when current minimum targets are met', () => {
    expect(
      recommendAIProfile(
        { totalRamMb: 16384, logicalCores: 8, freeStorageMb: 10000 },
        profiles,
      ),
    ).toBe('standard');
  });

  it('recommends Lite on the lower target class', () => {
    expect(
      recommendAIProfile(
        { totalRamMb: 8192, logicalCores: 4, freeStorageMb: 5000 },
        profiles,
      ),
    ).toBe('lite');
  });

  it('falls back to Procedural when even Lite is below target', () => {
    expect(
      recommendAIProfile(
        { totalRamMb: 4096, logicalCores: 2, freeStorageMb: 5000 },
        profiles,
      ),
    ).toBe('procedural');
  });

  it('allows an explicit Standard override while returning warnings', () => {
    const result = resolveAIProfileChoice(
      'standard',
      { totalRamMb: 8192, logicalCores: 4, freeStorageMb: 5000 },
      profiles,
    );

    expect(result.selected).toBe('standard');
    expect(result.recommended).toBe('lite');
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('marks GPU VRAM as an acceleration warning rather than a hard failure', () => {
    const standard = profiles.find((profile) => profile.id === 'standard')!;
    const result = assessAIProfile(standard, {
      totalRamMb: 16384,
      logicalCores: 8,
      gpuAccelerationAvailable: true,
      availableVramMb: 4096,
      freeStorageMb: 10000,
    });

    expect(result.compatibility).toBe('usable-with-warning');
    expect(result.warnings.some((warning) => warning.includes('CPU fallback'))).toBe(true);
  });

  it('uses the locked runtime fallback chain', () => {
    expect(getAIProfileFallbackChain('standard')).toEqual(['lite', 'procedural']);
    expect(getAIProfileFallbackChain('lite')).toEqual(['procedural']);
    expect(getAIProfileFallbackChain('procedural')).toEqual([]);
  });
});
