export type ResourceMap = Record<string, number>;

export interface CharacterState {
  id: string;
  name: string;
  role: string;
  health: number;
  stress: number;
  morale: number;
  traits: string[];
  memoryTags: string[];
}

export interface CampaignProfile {
  difficulty: "narrative" | "standard" | "hard" | "simulation";
  mortality: "protected" | "standard" | "permadeath";
  campaignLength: "standard" | "extended" | "persistent";
  aiMode: "local" | "cloud" | "auto" | "procedural";
  simulationDepth: "light" | "standard" | "deep";
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
}

export interface EventEffect {
  type: "RESOURCE_DELTA" | "FLAG_SET" | "PRESSURE_DELTA" | "CHARACTER_STRESS";
  key?: string;
  value: number | string | boolean;
  targetId?: string;
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
