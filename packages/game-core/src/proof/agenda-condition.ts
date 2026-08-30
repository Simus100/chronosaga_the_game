import type { AgendaCondition, FactionAgendaItem, WorldState } from "@paa/game-types";
import { readAuthoritativeResource } from "../state/resource-authority.js";

/**
 * Whether an agenda item's satisfy/resolve condition currently holds.
 *
 * GQP spec 8.1 requires the condition to be a typed predicate with validated
 * arguments, and 13.1 forbids building a general expression language for it.
 * So this is a switch over four named predicates, not an interpreter: adding a
 * fifth predicate is a deliberate act with its own validation, which is the
 * property that keeps a save file from carrying executable intent.
 *
 * Deterministic and side-effect free. It reads authoritative state and returns
 * a boolean; it never mutates, never consults a clock, and never asks an LLM.
 *
 * `kind` is not consulted here on purpose. A desire and a grievance are
 * satisfied and resolved by *different* conditions, not by the same condition
 * read with opposite sign — that asymmetry is the reason spec 8.1 refuses to
 * model them on one numeric axis, and collapsing it here would reintroduce it.
 * Which condition an item carries is content; whether it holds is this.
 */
export function agendaConditionHolds(condition: AgendaCondition, state: WorldState): boolean {
  switch (condition.predicate) {
    case "production_condition_at_least": {
      const node = state.simulation?.productionNodes.find(item => item.id === condition.nodeId);
      // An absent node is not a satisfied condition. Refusing to guess keeps a
      // renamed or removed node from silently satisfying a faction.
      if (!node) return false;
      return node.condition >= condition.value;
    }
    case "resource_stock_at_least": {
      const settlement = state.simulation?.settlements.find(
        item => item.id === condition.settlementId
      );
      if (!settlement) return false;
      // Through the authority, not the projection: the flat map is a mirror,
      // and reading it here would reintroduce the two-truths bug M1-C/1 fixed.
      return readAuthoritativeResource(state, condition.resourceKey) >= condition.amount;
    }
    case "political_approval_at_least": {
      const group = state.simulation?.politicalGroups.find(item => item.id === condition.groupId);
      if (!group) return false;
      return group.approval >= condition.value;
    }
    case "flag_equals": {
      // Strictly the boolean flag. A flag holding the string "true" is not the
      // boolean `true`, and a save is untrusted input.
      return state.flags[condition.key] === condition.value;
    }
  }
}

/** The agenda items of one faction whose condition currently holds. */
export function satisfiedAgendaItems(
  agenda: readonly FactionAgendaItem[],
  state: WorldState
): FactionAgendaItem[] {
  return agenda.filter(item => agendaConditionHolds(item.condition, state));
}
