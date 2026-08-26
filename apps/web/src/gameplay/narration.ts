import type { StateDelta, WorldState } from "@paa/game-types";
import type { FeedEntry } from "./controller";

/**
 * Words about what already happened.
 *
 * Narration runs *after* the authoritative result exists and can only describe
 * it. It receives a finished world and a finished delta; it returns a string.
 * There is no route from here back into state, because there is no state in the
 * signature — which is a stronger guarantee than a rule saying "do not mutate".
 *
 * Every request has a deterministic answer available immediately. Local AI, if
 * it is running and if it answers in time, may replace that text. If it is
 * absent, slow, or rejected, the deterministic line is what the player reads,
 * and play does not pause to find out which.
 */

export interface NarrationRequest {
  readonly state: WorldState;
  readonly delta: StateDelta;
  readonly label: string;
}

export interface NarrationSource {
  readonly kind: "procedural" | "local_ai";
  narrate(request: NarrationRequest): Promise<string>;
}

/**
 * The deterministic narrator. Always available, never wrong about the numbers.
 *
 * Reads the delta rather than inventing anything: a consequence the simulation
 * did not produce must never appear in the feed, or the player learns to
 * distrust the one channel that is supposed to explain the world.
 */
export const proceduralNarration: NarrationSource = {
  kind: "procedural",
  async narrate({ delta, label }) {
    // Every change type the core actually emits for a stock: a player choice
    // writes `resource`, and a tick writes production and consumption.
    const stockChanges = ["resource", "productionInput", "productionOutput", "populationConsumption"];
    const resources = delta.changes.filter(change => stockChanges.includes(change.type));
    const social = delta.changes.filter(
      change => change.type === "cohortSatisfaction" || change.type === "politicalApproval"
    );
    const memories = delta.changes.filter(change => change.type === "characterMemory");

    const parts: string[] = [label];
    for (const change of resources.slice(0, 4)) {
      const key = String(change.key).split(".").pop();
      parts.push(`${key}: ${String(change.before)} → ${String(change.after)}`);
    }
    if (social.length > 0) parts.push(`${social.length} reazioni sociali registrate`);
    if (memories.length > 0) parts.push("un personaggio ricorderà questo turno");
    if (parts.length === 1) parts.push("nessuna variazione autoritativa");

    return parts.join(" · ");
  }
};

/**
 * Local AI narration, with the deterministic line as its floor.
 *
 * `generate` is the existing local orchestration, injected rather than imported
 * so this file owns no model lifecycle: Rust already owns one, and a second
 * would be a second thing to keep alive and reap.
 *
 * A rejected or slow answer is not an error the player has to handle. It is
 * simply the procedural text, delivered at once.
 */
export function localAiNarration(
  generate: (request: NarrationRequest) => Promise<string | null>,
  timeoutMs = 8_000
): NarrationSource {
  return {
    kind: "local_ai",
    async narrate(request) {
      const fallback = await proceduralNarration.narrate(request);
      try {
        const answered = await Promise.race([
          generate(request),
          new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs))
        ]);
        const text = answered?.trim();
        return text ? text : fallback;
      } catch {
        // Unavailable, refused, or broken: all the same answer, immediately.
        return fallback;
      }
    }
  };
}

/** Narration for one feed entry, kept beside the feed and out of the world. */
export async function narrateEntry(
  source: NarrationSource,
  state: WorldState,
  feedEntry: FeedEntry
): Promise<string> {
  return source.narrate({ state, delta: feedEntry.delta, label: feedEntry.label });
}
