import type { EventEffect, GameEvent } from "@paa/game-types";

export interface EventValidationResult {
  ok: boolean;
  errors: string[];
}

function validateEffect(effect: EventEffect, label: string, errors: string[]): void {
  if ((effect.type === "RESOURCE_DELTA" || effect.type === "FLAG_SET") && !effect.key?.trim()) {
    errors.push(`${label} ${effect.type} requires key`);
  }
  if (effect.type === "CHARACTER_STRESS" && !effect.targetId?.trim()) {
    errors.push(`${label} CHARACTER_STRESS requires targetId`);
  }
  if (
    (effect.type === "RESOURCE_DELTA" ||
      effect.type === "PRESSURE_DELTA" ||
      effect.type === "CHARACTER_STRESS") &&
    (typeof effect.value !== "number" || !Number.isFinite(effect.value))
  ) {
    errors.push(`${label} ${effect.type} requires a finite numeric value`);
  }
}

/** Validate authored/loaded event JSON before it can enter eligibility/resolution. */
export function validateGameEvent(event: GameEvent): EventValidationResult {
  const errors: string[] = [];

  if (!event.id.trim()) errors.push("event id cannot be empty");
  if (!Number.isInteger(event.version) || event.version < 1) errors.push("event version must be a positive integer");
  if (!event.title.trim()) errors.push(`event ${event.id || "<empty>"} title cannot be empty`);
  if (!event.body.trim()) errors.push(`event ${event.id || "<empty>"} body cannot be empty`);
  if (!Number.isFinite(event.weight) || event.weight <= 0) errors.push(`event ${event.id || "<empty>"} weight must be positive`);
  if (event.choices.length === 0) errors.push(`event ${event.id || "<empty>"} must contain at least one choice`);

  const choiceIds = new Set<string>();
  for (const choice of event.choices) {
    if (!choice.id.trim()) errors.push(`event ${event.id} contains choice with empty id`);
    if (choiceIds.has(choice.id)) errors.push(`event ${event.id} contains duplicate choice id '${choice.id}'`);
    choiceIds.add(choice.id);
    if (!choice.label.trim()) errors.push(`choice ${choice.id || "<empty>"} label cannot be empty`);
    if (choice.effects.length === 0) errors.push(`choice ${choice.id || "<empty>"} must contain at least one effect`);

    if (choice.requirements?.resources) {
      for (const [key, amount] of Object.entries(choice.requirements.resources)) {
        if (!key.trim()) errors.push(`choice ${choice.id} contains an empty resource requirement key`);
        if (!Number.isFinite(amount) || amount < 0) errors.push(`choice ${choice.id} resource requirement '${key}' must be non-negative`);
      }
    }

    choice.effects.forEach((effect, index) =>
      validateEffect(effect, `choice ${choice.id || "<empty>"} effect[${index}]`, errors)
    );
  }

  return { ok: errors.length === 0, errors };
}
