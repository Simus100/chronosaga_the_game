import type {
  EpidemicPressureState,
  PressureStage,
  ProductionNodeState,
  WorldState
} from "@paa/game-types";

/**
 * The stage boundaries shared by both pressures.
 *
 * PROVISIONAL by spec 9.4 — the numbers are playtest material. What is not
 * provisional is that the stage is *derived*: it is computed from the value
 * every time it is asked for, and never stored beside it.
 *
 * Storing both would be the mistake spec 9.3 declines when it refuses a fourth
 * legitimacy counter. Two representations of one truth drift, and the drift is
 * invisible until a player is shown CRISIS by a world that is STRAINED.
 */
const STAGE_THRESHOLDS: readonly (readonly [number, PressureStage])[] = [
  [0.75, "CRISIS"],
  [0.5, "CRITICAL"],
  [0.25, "STRAINED"]
];

/**
 * The visible qualitative stage of a pressure value in `0..1`.
 *
 * Fail-closed on a value it cannot classify: the callers all read authoritative
 * state that the validator has already proven finite and in range, so a
 * non-finite value here means an invariant broke upstream and the run should
 * stop rather than render a stage derived from `NaN`.
 */
export function pressureStage(value: number): PressureStage {
  if (!Number.isFinite(value)) {
    throw new Error(`Pressure stage requires a finite value, got ${String(value)}`);
  }
  for (const [threshold, stage] of STAGE_THRESHOLDS) {
    if (value >= threshold) return stage;
  }
  return "STABLE";
}

/** The stage of the explicitly stored epidemic pressure. */
export function epidemicStage(epidemic: EpidemicPressureState): PressureStage {
  return pressureStage(epidemic.value);
}

/**
 * Infrastructure pressure, derived rather than stored.
 *
 * Spec 9.2 is explicit that this must not introduce a counter: the Core
 * already computes this truth. The recycler consumes energy and produces
 * water, and its condition and efficiency already govern the cycle the World
 * Tick makes observable. A parallel field would be a second copy of a value
 * that exists, and the two would diverge the first time one of them was
 * written without the other.
 *
 * So this is a pure function of `ProductionNodeState`. A node in perfect
 * condition running at full efficiency contributes no pressure; a disabled
 * node contributes as much as a fully degraded one, because from the
 * settlement's point of view a recycler that is off and a recycler that is
 * broken produce the same amount of water.
 *
 * Averaged over the settlement's nodes rather than summed: with one node the
 * two agree, and with several a sum would make an expanding settlement look
 * like a failing one.
 *
 * No nodes at all is not zero pressure — a settlement with no production is
 * under maximum infrastructure pressure by definition, not under none.
 */
export function deriveInfrastructurePressure(nodes: readonly ProductionNodeState[]): number {
  if (nodes.length === 0) return 1;

  const total = nodes.reduce((sum, node) => sum + nodeShortfall(node), 0);
  const value = total / nodes.length;
  if (!Number.isFinite(value)) {
    throw new Error("Infrastructure pressure derivation produced a non-finite value");
  }
  return value;
}

/** How far one node falls short of carrying its own weight, in `0..1`. */
function nodeShortfall(node: ProductionNodeState): number {
  if (!node.enabled) return 1;
  // Condition and efficiency are both validated to `0..1`. Their product is
  // the fraction of nominal output the node actually sustains, so the
  // shortfall is what is missing from it.
  return 1 - node.condition * node.efficiency;
}

/** Infrastructure pressure for one settlement of a world. */
export function settlementInfrastructurePressure(
  state: WorldState,
  settlementId: string
): number {
  const nodes = (state.simulation?.productionNodes ?? []).filter(
    node => node.settlementId === settlementId
  );
  return deriveInfrastructurePressure(nodes);
}
