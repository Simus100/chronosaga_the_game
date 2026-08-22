/**
 * Binding each profile to the artifact the project actually locked.
 *
 * `inputParityProblems` proves a profile used one artifact throughout. It cannot
 * prove that artifact is the locked candidate, so forged evidence could record
 * Lite and Standard as the same SHA, or two artifacts outside the lock entirely,
 * consistently per profile — and the report would publish an official
 * Lite-versus-Standard comparison of one model against itself.
 *
 * The authority is `config/local-ai-models.lock.json`, imported directly. There
 * is deliberately no package-local copy: a second list of digests would be a
 * second authority, and the two would eventually disagree about which model was
 * measured.
 */
import lockDocument from '../../../config/local-ai-models.lock.json' with { type: 'json' };
import type { ArtifactIdentity, BenchmarkGeneration, BenchmarkProfile, BenchmarkRun } from './result.js';

/** The fields of a locked profile that identify the artifact itself. */
interface LockedArtifact {
  profileId: string;
  family: string;
  quantization: string;
  artifactFilename: string;
  sizeBytes: number;
  sha256: string;
  releaseApproved: boolean;
}

const LOCK = lockDocument as unknown as { profiles: Record<string, LockedArtifact> };

/**
 * The identity fields a recorded artifact must match, in comparison order.
 *
 * `source` is absent on purpose: it records where the resolver found the bytes —
 * packaged, user library, development workspace — which is runtime provenance
 * and not part of what the lock defines. The same locked artifact found in three
 * places is still the same artifact.
 */
const IDENTITY_FIELDS = [
  'profileId',
  'family',
  'quantization',
  'artifactFilename',
  'sizeBytes',
  'sha256',
  'releaseApproved',
] as const;

/** The locked entry for a profile, or `undefined` if the lock has no such profile. */
export function lockedArtifact(profile: string): LockedArtifact | undefined {
  return LOCK.profiles[profile];
}

/** Every profile the model lock defines. */
export function lockedProfiles(): string[] {
  return Object.keys(LOCK.profiles);
}

/** Why a recorded artifact identity is not the locked one for its profile. */
export function lockedArtifactMismatches(
  profile: BenchmarkProfile,
  artifact: ArtifactIdentity,
): string[] {
  const locked = lockedArtifact(profile);
  if (locked === undefined) {
    return [`'${profile}' is not a profile the model lock defines`];
  }
  const recorded = artifact as unknown as Record<string, unknown>;
  const expected = locked as unknown as Record<string, unknown>;
  return IDENTITY_FIELDS.filter(field => recorded[field] !== expected[field]).map(
    field =>
      `${field} is ${JSON.stringify(recorded[field])} but the lock says ` +
      `${JSON.stringify(expected[field])}`,
  );
}

/**
 * Whether every compared profile's rows carry that profile's locked artifact.
 *
 * One mismatched generation invalidates the whole official report: an artifact is
 * never silently relabelled or substituted, because the entire point of the
 * comparison is which specific bytes produced which answers.
 */
export function lockedArtifactProblems(
  run: BenchmarkRun,
  profiles: BenchmarkProfile[],
): string[] {
  const problems: string[] = [];

  // Two locked entries that name the same bytes would make the comparison
  // meaningless before any evidence is even read.
  const digests = new Map<string, string[]>();
  for (const profile of profiles) {
    const locked = lockedArtifact(profile);
    if (locked === undefined) {
      problems.push(`'${profile}' is not a profile the model lock defines`);
      continue;
    }
    digests.set(locked.sha256, [...(digests.get(locked.sha256) ?? []), profile]);
  }
  for (const [sha256, sharing] of digests) {
    if (sharing.length > 1) {
      problems.push(
        `the lock gives ${sharing.join(' and ')} the same artifact ${sha256}; ` +
          'comparing a model with itself is not a comparison',
      );
    }
  }
  if (problems.length > 0) return problems;

  const reported = new Set<string>();
  for (const generation of run.generations as BenchmarkGeneration[]) {
    if (!profiles.includes(generation.profile)) continue;
    for (const mismatch of lockedArtifactMismatches(generation.profile, generation.artifact)) {
      // One line per distinct disagreement rather than per row: 65 identical
      // complaints say nothing 1 does not.
      const line = `${generation.profile}: ${mismatch}`;
      if (reported.has(line)) continue;
      reported.add(line);
      problems.push(`${generation.id} does not carry the locked artifact — ${line}`);
    }
  }

  return problems;
}
