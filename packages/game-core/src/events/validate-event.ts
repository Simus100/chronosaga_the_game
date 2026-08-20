export interface EventValidationResult {
  ok: boolean;
  errors: string[];
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function validateEffect(effect: unknown, label: string, errors: string[]): void {
  if (!isRecord(effect)) {
    errors.push(`${label} must be an object`);
    return;
  }

  const type = text(effect.type);
  const allowed = new Set([
    "RESOURCE_DELTA",
    "FLAG_SET",
    "PRESSURE_DELTA",
    "CHARACTER_STRESS"
  ]);
  if (!type || !allowed.has(type)) {
    errors.push(`${label} has unsupported effect type`);
    return;
  }

  if ((type === "RESOURCE_DELTA" || type === "FLAG_SET") && !text(effect.key)?.trim()) {
    errors.push(`${label} ${type} requires key`);
  }
  if (type === "CHARACTER_STRESS" && !text(effect.targetId)?.trim()) {
    errors.push(`${label} CHARACTER_STRESS requires targetId`);
  }
  if (
    (type === "RESOURCE_DELTA" || type === "PRESSURE_DELTA" || type === "CHARACTER_STRESS") &&
    (typeof effect.value !== "number" || !Number.isFinite(effect.value))
  ) {
    errors.push(`${label} ${type} requires a finite numeric value`);
  }
  if (type === "FLAG_SET" && !["string", "number", "boolean"].includes(typeof effect.value)) {
    errors.push(`${label} FLAG_SET requires string, number or boolean value`);
  }
}

/**
 * Validate untrusted authored/loaded event JSON before it can enter
 * eligibility/resolution. Accepting `unknown` is deliberate: the JSON boundary
 * must reject malformed payloads rather than relying on compile-time types.
 */
export function validateGameEvent(input: unknown): EventValidationResult {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ["event must be an object"] };

  const id = text(input.id);
  const title = text(input.title);
  const body = text(input.body);

  if (!id?.trim()) errors.push("event id cannot be empty");
  if (!Number.isInteger(input.version) || Number(input.version) < 1) {
    errors.push("event version must be a positive integer");
  }
  if (!title?.trim()) errors.push(`event ${id || "<empty>"} title cannot be empty`);
  if (!body?.trim()) errors.push(`event ${id || "<empty>"} body cannot be empty`);
  if (typeof input.category !== "string" || !input.category.trim()) {
    errors.push(`event ${id || "<empty>"} category cannot be empty`);
  }
  if (!Array.isArray(input.tags) || input.tags.some(tag => typeof tag !== "string")) {
    errors.push(`event ${id || "<empty>"} tags must be a string array`);
  }
  if (typeof input.weight !== "number" || !Number.isFinite(input.weight) || input.weight <= 0) {
    errors.push(`event ${id || "<empty>"} weight must be positive`);
  }
  if (!Array.isArray(input.choices)) {
    errors.push(`event ${id || "<empty>"} choices must be an array`);
    return { ok: false, errors };
  }
  if (input.choices.length === 0) errors.push(`event ${id || "<empty>"} must contain at least one choice`);

  const choiceIds = new Set<string>();
  input.choices.forEach((choiceValue, choiceIndex) => {
    if (!isRecord(choiceValue)) {
      errors.push(`event ${id || "<empty>"} choice[${choiceIndex}] must be an object`);
      return;
    }
    const choiceId = text(choiceValue.id);
    const label = text(choiceValue.label);
    if (!choiceId?.trim()) errors.push(`event ${id || "<empty>"} contains choice with empty id`);
    if (choiceId && choiceIds.has(choiceId)) {
      errors.push(`event ${id || "<empty>"} contains duplicate choice id '${choiceId}'`);
    }
    if (choiceId) choiceIds.add(choiceId);
    if (!label?.trim()) errors.push(`choice ${choiceId || "<empty>"} label cannot be empty`);

    if (!Array.isArray(choiceValue.effects)) {
      errors.push(`choice ${choiceId || "<empty>"} effects must be an array`);
    } else {
      if (choiceValue.effects.length === 0) {
        errors.push(`choice ${choiceId || "<empty>"} must contain at least one effect`);
      }
      choiceValue.effects.forEach((effect, effectIndex) =>
        validateEffect(effect, `choice ${choiceId || "<empty>"} effect[${effectIndex}]`, errors)
      );
    }

    if (choiceValue.requirements !== undefined) {
      if (!isRecord(choiceValue.requirements)) {
        errors.push(`choice ${choiceId || "<empty>"} requirements must be an object`);
      } else if (choiceValue.requirements.resources !== undefined) {
        const resources = choiceValue.requirements.resources;
        if (!isRecord(resources)) {
          errors.push(`choice ${choiceId || "<empty>"} resource requirements must be an object`);
        } else {
          for (const [key, amount] of Object.entries(resources)) {
            if (!key.trim()) errors.push(`choice ${choiceId || "<empty>"} contains an empty resource requirement key`);
            if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
              errors.push(`choice ${choiceId || "<empty>"} resource requirement '${key}' must be non-negative`);
            }
          }
        }
      }
    }
  });

  return { ok: errors.length === 0, errors };
}
