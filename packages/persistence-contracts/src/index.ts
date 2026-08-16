import type { StateDelta, WorldState } from "@paa/game-types";

export interface PersistenceAdapter {
  loadCampaign(campaignId: string): Promise<WorldState | null>;
  saveCampaign(state: WorldState): Promise<void>;
  appendDelta(campaignId: string, delta: StateDelta): Promise<void>;
  loadRelevantMemory(campaignId: string, entityIds: string[], limit: number): Promise<string[]>;
}
