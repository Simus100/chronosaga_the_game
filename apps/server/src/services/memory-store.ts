import type { StateDelta, WorldState } from "@paa/game-types";

const campaigns = new Map<string, WorldState>();
const logs = new Map<string, StateDelta[]>();

export const memoryStore = {
  get(id: string) {
    return campaigns.get(id) ?? null;
  },
  set(state: WorldState) {
    campaigns.set(state.campaignId, state);
  },
  append(id: string, delta: StateDelta) {
    const current = logs.get(id) ?? [];
    current.push(delta);
    logs.set(id, current);
  },
  log(id: string) {
    return logs.get(id) ?? [];
  }
};
