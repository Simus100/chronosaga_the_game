import type { EventChoice, StateDelta, WorldState } from "@paa/game-types";

export function canChoose(choice: EventChoice, state: WorldState): boolean {
  const req = choice.requirements;
  if (!req) return true;
  if (req.resources) {
    for (const [key, amount] of Object.entries(req.resources)) {
      if ((state.resources[key] ?? 0) < amount) return false;
    }
  }
  if (req.flagsAll?.some(flag => !state.flags[flag])) return false;
  if (req.flagsNone?.some(flag => Boolean(state.flags[flag]))) return false;
  return true;
}

export function resolveChoice(
  state: WorldState,
  choice: EventChoice,
  source: string
): { state: WorldState; delta: StateDelta } {
  if (!canChoose(choice, state)) throw new Error("Choice requirements not met");

  const next: WorldState = structuredClone(state);
  const changes: StateDelta["changes"] = [];

  for (const effect of choice.effects) {
    if (effect.type === "RESOURCE_DELTA" && effect.key) {
      const before = next.resources[effect.key] ?? 0;
      const after = before + Number(effect.value);
      next.resources[effect.key] = after;
      changes.push({ type: "resource", key: effect.key, before, after });
    }
    if (effect.type === "FLAG_SET" && effect.key) {
      const before = next.flags[effect.key];
      const after = effect.value;
      next.flags[effect.key] = after;
      changes.push({ type: "flag", key: effect.key, before, after });
    }
    if (effect.type === "PRESSURE_DELTA") {
      const before = next.worldPressure;
      const after = Math.max(0, before + Number(effect.value));
      next.worldPressure = after;
      changes.push({ type: "worldPressure", key: "worldPressure", before, after });
    }
    if (effect.type === "CHARACTER_STRESS" && effect.targetId) {
      const character = next.party.find(c => c.id === effect.targetId);
      if (character) {
        const before = character.stress;
        const after = Math.max(0, Math.min(100, before + Number(effect.value)));
        character.stress = after;
        changes.push({ type: "characterStress", key: character.id, before, after });
      }
    }
  }

  next.turn += 1;
  if (next.turn % 4 === 0) next.day += 1;

  return {
    state: next,
    delta: {
      turn: state.turn,
      source,
      changes
    }
  };
}
