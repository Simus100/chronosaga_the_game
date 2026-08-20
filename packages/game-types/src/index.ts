export type ResourceMap = Record<string, number>;

export interface CausalSource {
  kind: "choice" | "event" | "world_tick" | "tactical" | "warfare" | "system";
  id: string;
  actorId?: string;
  tick?: number;
  rule?: string;
}

export interface CharacterMemory {
  id: string;
  summary: string;
  tags: string[];
  turn: number;
  source: CausalSource;
}

export interface CharacterState {
  id: string;
  name: string;
  role: string;
  health: number;
  stress: number;
  morale: number;
  traits: string[];
  memoryTags: string[];
  factionId?: string;
  locationId?: string;
  memories?: CharacterMemory[];
}

export interface CampaignProfile {
  difficulty: "narrative" | "standard" | "hard" | "simulation";
  mortality: "protected" | "standard" | "permadeath";
  campaignLength: "standard" | "extended" | "persistent";
  aiMode: "local" | "cloud" | "auto" | "procedural";
  simulationDepth: "light" | "standard" | "deep";
}

export interface SettlementState {
  id: string;
  name: string;
  controllingFactionId: string;
  population: number;
  stability: number;
  satisfaction: number;
  resourceStock: ResourceMap;
  productionNodeIds: string[];
  cohortIds: string[];
  politicalGroupIds: string[];
}

export interface FactionState {
  id: string;
  name: string;
  influence: number;
  reputation: number;
  resources: ResourceMap;
  relations: Record<string, number>;
  memoryTags: string[];
}

export interface ProductionNodeState {
  id: string;
  settlementId: string;
  recipe: string;
  capacity: number;
  efficiency: number;
  labor: number;
  inputs: ResourceMap;
  outputs: ResourceMap;
  condition: number;
  enabled: boolean;
}

export interface PopulationCohortState {
  id: string;
  settlementId: string;
  population: number;
  occupation: string;
  wealth: string;
  culture: string;
  satisfaction: number;
  loyalty: number;
  politicalAffinity: string;
  needs: Record<string, number>;
}

export interface PoliticalGroupState {
  id: string;
  settlementId: string;
  name: string;
  influence: number;
  approval: number;
  resources: number;
  goals: string[];
  redLines: string[];
  leaderId?: string;
  relationships: Record<string, number>;
}

export interface WarfareSquadState {
  id: string;
  factionId: string;
  name: string;
  personnel: number;
  morale: number;
  readiness: number;
  supply: number;
  intelligence: number;
  commanderId?: string;
}

export interface EventEffect {
  type: "RESOURCE_DELTA" | "FLAG_SET" | "PRESSURE_DELTA" | "CHARACTER_STRESS";
  key?: string;
  value: number | string | boolean;
  targetId?: string;
}

export interface DelayedConsequenceState {
  id: string;
  triggerTurn: number;
  visibility: "visible" | "hidden";
  scope: "personal" | "local" | "settlement" | "faction" | "regional";
  effects: EventEffect[];
  reversible: boolean;
  status: "pending" | "applied";
  source: CausalSource;
}

export interface SystemicSimulationState {
  schemaVersion: 1;
  settlements: SettlementState[];
  factions: FactionState[];
  productionNodes: ProductionNodeState[];
  populationCohorts: PopulationCohortState[];
  politicalGroups: PoliticalGroupState[];
  warfareSquads: WarfareSquadState[];
  delayedConsequences: DelayedConsequenceState[];
}

export interface WorldState {
  campaignId: string;
  seed: number;
  turn: number;
  day: number;
  worldPressure: number;
  resources: ResourceMap;
  flags: Record<string, boolean | number | string>;
  party: CharacterState[];
  profile: CampaignProfile;
  /**
   * Optional until the M1 migration is complete. New systemic scenarios populate
   * it; legacy P0 smoke saves remain valid without a schema migration.
   */
  simulation?: SystemicSimulationState;
}

export interface EventChoice {
  id: string;
  label: string;
  description?: string;
  requirements?: {
    resources?: ResourceMap;
    flagsAll?: string[];
    flagsNone?: string[];
  };
  effects: EventEffect[];
}

export interface GameEvent {
  id: string;
  version: number;
  title: string;
  body: string;
  category: string;
  tags: string[];
  weight: number;
  requirements?: {
    minTurn?: number;
    maxPressure?: number;
    flagsAll?: string[];
    flagsNone?: string[];
  };
  choices: EventChoice[];
}

export interface StateChange {
  type: string;
  key: string;
  before: unknown;
  after: unknown;
}

export interface StateDelta {
  turn: number;
  source: string;
  changes: StateChange[];
}
