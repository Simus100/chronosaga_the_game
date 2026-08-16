export interface AIDMInput {
  turn: number;
  locationId?: string;
  relevantCharacters: Array<{
    id: string;
    name: string;
    role: string;
    stress: number;
    traits: string[];
  }>;
  relevantMemory: string[];
  recentDelta: Array<{ type: string; key: string; before: unknown; after: unknown }>;
  event: { id: string; title: string; body: string };
  playerAction: string;
}

export interface AIDMOutput {
  narration: string;
  dialogue: Array<{ speakerId: string; text: string }>;
  eventProposals: Array<{ templateId: string; tags: string[] }>;
  memorySuggestions: string[];
  visualPrompt: string | null;
  tags: string[];
}

export interface AIDMProvider {
  generateNarration(input: AIDMInput): Promise<AIDMOutput>;
}
