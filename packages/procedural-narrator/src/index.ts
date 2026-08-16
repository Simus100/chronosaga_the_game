import type { AIDMInput, AIDMOutput, AIDMProvider } from "@paa/ai-contracts";

export class ProceduralNarrator implements AIDMProvider {
  async generateNarration(input: AIDMInput): Promise<AIDMOutput> {
    const memory = input.relevantMemory[0]
      ? ` The situation resonates with a prior fact: ${input.relevantMemory[0]}.`
      : "";
    return {
      narration:
        `${input.event.title}. The world state has already been resolved by the Simulation Core.` +
        memory +
        ` Your directive "${input.playerAction}" is now part of the campaign record.`,
      dialogue: [],
      eventProposals: [],
      memorySuggestions: [],
      visualPrompt: null,
      tags: ["procedural-fallback"]
    };
  }
}
