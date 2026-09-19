import { describe, expect, it } from "vitest";
import { createSystemicScenario, validateProofCatalogue } from "../src";
import { SYNTHETIC_CATALOGUE as CATALOGUE, proofWorld } from "./support/synthetic-proof-catalogue";

/**
 * The content gate: authored content is untrusted input.
 *
 * Each promise the proof makes that content could silently break -- a delayed
 * harm that was foreshadowed (GQP-4), a major choice that says what is known,
 * risked and unknown (GQP-3), eligibility that can actually become true -- is
 * refused here, one case per promise.
 */

// Hostile content is untyped by definition; the gate takes `unknown`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Hostile = any;

const clone = (): Hostile[] => structuredClone(CATALOGUE) as Hostile[];
const errors = (catalogue: unknown) => validateProofCatalogue(catalogue, proofWorld()).errors;
const refuses = (catalogue: unknown, pattern: RegExp) => expect(errors(catalogue).some(e => pattern.test(e))).toBe(true);

describe("GQP-B catalogue gate", () => {
  it("accepts the synthetic catalogue", () => {
    expect(validateProofCatalogue(CATALOGUE, proofWorld())).toEqual({ ok: true, errors: [] });
  });

  it("refuses to judge content against a baseline world, or a non-array", () => {
    expect(validateProofCatalogue(CATALOGUE, createSystemicScenario(7419)).ok).toBe(false);
    expect(errors({})).toEqual(["catalogue must be an array"]);
  });

  describe("GQP-4: every delayed outcome is foreshadowed", () => {
    it("refuses a breadcrumb the same choice does not record", () => {
      const c = clone();
      c[0].choices[1].schedules[0].breadcrumb.memoryId = "fact_elsewhere";
      refuses(c, /has no breadcrumb recorded by the same choice/);
    });

    it("refuses a breadcrumb that cannot be called back", () => {
      const c = clone();
      c[0].choices[1].effects[0].callbackEligible = false;
      refuses(c, /cannot be called back/);
    });

    it.each([
      ["infrastructure", { type: "NODE_CONDITION_SHIFT", nodeId: "prod_recycler_01", delta: -0.1 }],
      ["epidemic", { type: "EPIDEMIC_SHIFT", cause: "crowding", delta: 0.1 }],
      ["supply", { type: "RESOURCE_DELTA", key: "water", value: -2 }],
      ["political", { type: "PRESSURE_DELTA", value: 1 }]
    ])("refuses undisclosed delayed %s harm", (category, effect) => {
      const c = clone();
      c[0].choices[1].schedules[0].effects = [effect];
      c[0].choices[1].disclosure.risks = ["social"];
      refuses(c, new RegExp(`delivers ${category} harm the choice does not disclose`));
    });

    it("does not count a delayed benefit as harm", () => {
      const c = clone();
      c[0].choices[1].schedules[0].effects = [{ type: "NODE_CONDITION_SHIFT", nodeId: "prod_recycler_01", delta: 0.1 }];
      c[0].choices[1].disclosure.risks = ["social"];
      expect(errors(c)).toEqual([]);
    });

    it.each([
      ["a zero delay", { delay: 0 }, /delay must be a positive whole number/],
      ["an unsafe delay", { delay: 2 ** 53 }, /delay must be a positive whole number/],
      ["an unknown visibility", { visibility: "secret" }, /visibility is invalid/],
      ["an unknown scope", { scope: "global" }, /scope is invalid/],
      ["no effects", { effects: [] }, /must be a non-empty array/]
    ])("refuses a schedule with %s", (_label, patch, pattern) => {
      const c = clone();
      Object.assign(c[0].choices[1].schedules[0], patch);
      refuses(c, pattern);
    });
  });

  describe("GQP-3: a major choice says what is known, risked and unknown", () => {
    it("refuses a major choice with no RISK or no UNKNOWN", () => {
      const c = clone();
      c[0].choices[0].disclosure = { risks: [], unknowns: [] };
      refuses(c, /major choice with no RISK/);
      refuses(c, /major choice with no UNKNOWN/);
    });

    it("lets a signal carry no RISK", () => {
      expect(CATALOGUE[1]!.choices[0]!.disclosure).toEqual({ risks: [], unknowns: [] });
      expect(errors(clone())).toEqual([]);
    });

    it("refuses an unknown or repeated risk category, and an empty unknown", () => {
      const c = clone();
      c[0].choices[0].disclosure = { risks: ["supply", "supply", "weather"], unknowns: [" "] };
      refuses(c, /repeats a category/);
      refuses(c, /unknown category/);
      refuses(c, /unknowns holds an empty entry/);
    });

    it("refuses a choice with no disclosure at all", () => {
      const c = clone();
      delete c[0].choices[0].disclosure;
      refuses(c, /has no disclosure/);
    });
  });

  describe("a decision is a decision", () => {
    it("refuses a decision with a single option", () => {
      const c = clone();
      c[0].choices = [c[0].choices[0]];
      refuses(c, /fewer than two options/);
    });

    it("refuses duplicate event and choice ids", () => {
      const c = clone();
      c.push(structuredClone(c[1]));
      c[0].choices[1].id = "repair";
      refuses(c, /event id 'evt_t_signal' is duplicated/);
      refuses(c, /repeats choice id 'repair'/);
    });

    it("refuses an unknown family or taxonomy and a missing presentation", () => {
      const c = clone();
      c[0].familyId = "warfare";
      c[0].taxonomy = "CUTSCENE";
      c[0].presentation = { title: "", body: "b" };
      refuses(c, /familyId must be a proof family/);
      refuses(c, /taxonomy must be one of/);
      refuses(c, /needs a presentation title and body/);
    });
  });

  describe("no dead content", () => {
    it("refuses a hook predicate no choice can satisfy", () => {
      const c = clone();
      c[1].eligibility[0].hook = "volunteer_help";
      refuses(c, /reads hook 'volunteer_help' on 'tarek_001', which no choice records/);
    });

    it("refuses a hook recorded for someone else", () => {
      const c = clone();
      c[1].eligibility[0].characterId = "mara_001";
      refuses(c, /reads hook 'offer_unprompted_warning' on 'mara_001'/);
    });

    it("refuses a flag nothing sets and the world does not hold", () => {
      const c = clone();
      c[1].eligibility.push({ predicate: "flag_equals", key: "never_set_anywhere", value: true });
      refuses(c, /never_set_anywhere' is neither in the world nor set by any choice/);
    });

    it("accepts a flag a choice sets, even in a delayed consequence", () => {
      const c = clone();
      c[0].choices[1].schedules[0].effects.push({ type: "FLAG_SET", key: "set_later", value: true });
      c[1].eligibility.push({ predicate: "flag_equals", key: "set_later", value: true });
      expect(errors(c)).toEqual([]);
    });

    it("refuses a consequence id nothing schedules", () => {
      const c = clone();
      c[1].eligibility[1].consequenceId = "con.evt_t_maint.repair.wear";
      refuses(c, /is scheduled by no choice/);
    });

    it("refuses a memory id nothing records, and an agenda that does not exist", () => {
      const c = clone();
      c[1].eligibility.push({ predicate: "memory_known", characterId: "mara_001", memoryId: "fact_nowhere", value: true });
      c[1].eligibility.push({ predicate: "agenda_satisfied", agendaId: "agenda_nothing", value: true });
      refuses(c, /memoryId 'fact_nowhere' is recorded by no choice/);
      refuses(c, /agendaId matches no agenda item/);
    });

    it("refuses references to things the world does not have", () => {
      const c = clone();
      c[0].eligibility[0].nodeId = "prod_ghost";
      c[1].eligibility.push({ predicate: "infrastructure_stage_in", settlementId: "settlement_ghost", stages: ["CRITICAL"] });
      c[0].choices[0].effects.push({ type: "NODE_CONDITION_SHIFT", nodeId: "prod_ghost", delta: 0.1 });
      refuses(c, /eligibility\[0\]\.nodeId matches no production node/);
      refuses(c, /settlementId matches no settlement/);
      refuses(c, /effects\[2\].*prod_ghost/);
    });
  });

  describe("closed predicate arguments", () => {
    it("refuses an argument that belongs to another predicate", () => {
      const c = clone();
      c[0].eligibility[0].key = "smuggled";
      refuses(c, /key is not an argument of node_condition_below/);
    });

    it("refuses an unknown predicate and malformed values", () => {
      const c = clone();
      c[0].eligibility = [
        { predicate: "reputation_at_least", value: 3 },
        { predicate: "epidemic_stage_in", stages: [] },
        { predicate: "node_condition_below", nodeId: "prod_recycler_01", value: 0 },
        { predicate: "memory_known", characterId: "tarek_001", memoryId: "fact_t_warning", value: "yes" },
        { predicate: "consequence_status", consequenceId: "con.evt_t_maint.defer.wear", status: "done" }
      ];
      refuses(c, /is not a proof predicate/);
      refuses(c, /stages must be a non-empty list/);
      refuses(c, /value must be within \(0, 1\]/);
      refuses(c, /value must be a boolean/);
      refuses(c, /status must be pending, applied or absent/);
    });
  });

  describe("memory identity", () => {
    it("refuses one fact recorded by two different events", () => {
      const c = clone();
      c[1].choices[0].effects.push({ ...c[0].choices[1].effects[0] });
      refuses(c, /recorded by both 'evt_t_maint' and 'evt_t_signal'/);
    });

    it("allows alternative choices of one event to record the same fact", () => {
      const c = clone();
      c[0].choices[0].effects.push({ ...c[0].choices[1].effects[0] });
      expect(errors(c)).toEqual([]);
    });

    it("refuses one choice recording the same fact twice", () => {
      const c = clone();
      c[0].choices[1].effects.push({ ...c[0].choices[1].effects[0] });
      refuses(c, /records 'fact_t_warning' twice/);
    });

    it("refuses one fact id recorded on different characters by different events", () => {
      // The second record would meet a propagated copy of the first and be
      // refused at runtime, so the gate refuses it now.
      const c = clone();
      c[1].choices[0].effects.push({ ...c[0].choices[1].effects[0], characterId: "mara_001" });
      refuses(c, /memory 'fact_t_warning' is recorded by both 'evt_t_maint' and 'evt_t_signal'/);
    });

    it("refuses one choice recording the same fact id on two characters", () => {
      const c = clone();
      c[0].choices[1].effects.push({ ...c[0].choices[1].effects[0], characterId: "mara_001" });
      refuses(c, /records 'fact_t_warning' twice/);
    });
  });

  describe("effects go through the same contracts the Core applies", () => {
    it("refuses a malformed legacy effect and a malformed proof effect", () => {
      const c = clone();
      c[0].choices[0].effects = [
        { type: "RESOURCE_DELTA", key: "energy", value: "ten" },
        { type: "EPIDEMIC_SHIFT", cause: "water_shortage", delta: 0.1 }
      ];
      const found = errors(c);
      expect(found.some(e => /effects\[0\]/.test(e))).toBe(true);
      expect(found.some(e => /effects\[1\].*water_shortage/.test(e))).toBe(true);
    });
  });
});
