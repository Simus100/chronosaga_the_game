/**
 * The one validation of `CausalSource`, for every boundary that accepts one.
 *
 * This module exists because the contract was duplicated and the copy was
 * weaker. The proof validator checked `kind` and `id` and let the optionals
 * through, so `{"kind":"system","id":"x","tick":-1,"actorId":123,"rule":{}}`
 * was refused on a delayed consequence and accepted on a faction agenda item —
 * the same payload, two answers, decided by which collection it was written to.
 *
 * That is precisely the defect class GQP-0 was created to remove, reintroduced
 * three slices later. The lesson it teaches is not "check the optionals too":
 * it is that a contract with two implementations will diverge, and the only
 * repair that lasts is to leave one implementation standing.
 *
 * So `CausalSource` is validated here and nowhere else. A new collection that
 * carries one calls this function; if it needs something this does not check,
 * the change belongs in this file.
 *
 * Everything takes `unknown`. A causal source is how the game explains itself —
 * why a memory exists, why a consequence fired — and a half-checked source is
 * evidence that looks authoritative and cannot be traced, which is worse than
 * no evidence at all.
 */

/** The causes the game can attribute a change to. */
export const CAUSAL_KINDS = [
  "choice",
  "event",
  "world_tick",
  "tactical",
  "warfare",
  "system"
] as const;

export type CausalKind = (typeof CAUSAL_KINDS)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate a `CausalSource`, required fields and optionals alike.
 *
 * The optionals are not decoration. `actorId` names who did it, `rule` names
 * which rule fired, and `tick` says when — they are read by causal callbacks
 * and by the analysis surface. A `rule` that is an object, or a negative
 * `tick`, is a value no producer of ours can write and no consumer can
 * interpret.
 */
export function validateCausalSource(value: unknown, label: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${label} must be an object`);
    return;
  }

  const kind = value.kind;
  if (typeof kind !== "string" || !(CAUSAL_KINDS as readonly string[]).includes(kind)) {
    errors.push(`${label}.kind must be one of ${CAUSAL_KINDS.join(", ")}, got ${JSON.stringify(kind)}`);
  }

  const id = value.id;
  if (typeof id !== "string") errors.push(`${label}.id must be a string, got ${typeof id}`);
  else if (id.trim() === "") errors.push(`${label}.id must not be empty`);

  for (const key of ["actorId", "rule"] as const) {
    const optional = value[key];
    if (optional === undefined) continue;
    if (typeof optional !== "string") {
      errors.push(`${label}.${key} must be a string, got ${typeof optional}`);
    } else if (optional.trim() === "") {
      errors.push(`${label}.${key} must not be empty`);
    }
  }

  if (value.tick !== undefined) {
    if (!Number.isInteger(value.tick)) {
      errors.push(
        `${label}.tick must be an integer, got ${
          typeof value.tick === "number" ? String(value.tick) : typeof value.tick
        }`
      );
    } else if ((value.tick as number) < 0) {
      errors.push(`${label}.tick must be at least 0, got ${String(value.tick)}`);
    }
  }
}
