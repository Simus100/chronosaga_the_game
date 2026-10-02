/**
 * The clock contract: every authoritative counter is a safe integer, and a
 * counter is only ever advanced to another safe integer (issue #37).
 *
 * `simulation.tick`, `WorldState.turn` and `WorldState.day` are plain numbers,
 * and above `Number.MAX_SAFE_INTEGER` a plain number stops being a counter:
 * `2 ** 53 + 1 === 2 ** 53`, so a World Tick run there reports success and the
 * clock does not move, and `2 ** 53 + 2` moves it by two. Both are finite and
 * integral, so the save boundary accepted them.
 *
 * That was tolerable debt while nothing measured distance on these clocks. GQP-C
 * does: the quiet bound is `simulation.tick - lastResolved.worldTick` (spec
 * 14.6), and repetition is `WorldState.turn - lastResolved.playerTurn` (14.3).
 * On a clock that can stand still, "one World Tick has passed" is a claim the
 * arithmetic cannot back, and the bound that is supposed to end a quiet
 * sequence can be switched off by a save file.
 *
 * The contract is the smallest one that makes the arithmetic exact: safe
 * integers, checked where a clock is read from outside (the save boundary) and
 * where one is advanced (the World Tick, the decision commit). No BigInt, no
 * clock object, no schema change: every clock any real run can reach is a
 * safe integer already, and every save a real run wrote stays valid.
 */

/** Whether `value` is a clock reading: a safe integer no lower than `min`. */
export function isClockValue(value: unknown, min: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min;
}

/**
 * The next reading of a clock, refused if it would leave the safe range.
 *
 * Computed before anything is written, so a refused advance mutates nothing:
 * the calculate -> validate -> mutate order every authoritative write follows.
 */
export function advanceClock(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} is ${String(value)}, which is not a safe integer; the clock cannot advance exactly`);
  }
  const next = value + 1;
  if (!Number.isSafeInteger(next)) {
    throw new Error(`${label} cannot advance past ${value}: ${next} is beyond Number.MAX_SAFE_INTEGER`);
  }
  return next;
}
