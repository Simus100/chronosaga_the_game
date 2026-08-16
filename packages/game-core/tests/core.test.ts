import { describe, expect, it } from "vitest";
import { createCampaign, resolveChoice } from "../src";
import type { EventChoice } from "@paa/game-types";

describe("Simulation Core", () => {
  it("applies deterministic state changes without AI", () => {
    const state = createCampaign(42);
    const choice: EventChoice = {
      id: "test",
      label: "Test",
      effects: [
        { type: "RESOURCE_DELTA", key: "provisions", value: -2 },
        { type: "FLAG_SET", key: "visited_test", value: true }
      ]
    };
    const result = resolveChoice(state, choice, "test");
    expect(result.state.resources.provisions).toBe(16);
    expect(result.state.flags.visited_test).toBe(true);
    expect(result.state.turn).toBe(2);
  });
});
