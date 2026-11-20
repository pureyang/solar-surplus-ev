// Night top-off stop point, % (null = unknown: charge to whatever the car allows).
// A per-car NIGHT_CHARGE_CARn_MAX applies all year. Otherwise, in PG&E winter (Oct-May) NIGHT_CHARGE_WINTER_MAX caps it.
// The car's own charge limit always wins when it is lower.
// Returns { target, why } where why is 'its limit', 'car max' or 'winter cap'.
export function nightTarget({ month, limit, carMax = 0, winterMax = 0 }) {
  const winter = month >= 10 || month <= 5;
  const cap = carMax > 0 ? carMax : winter && winterMax > 0 ? winterMax : 0;
  if (!cap) return { target: limit ?? null, why: 'its limit' };
  if (limit != null && limit <= cap) return { target: limit, why: 'its limit' };
  return { target: cap, why: carMax > 0 ? 'car max' : 'winter cap' };
}
