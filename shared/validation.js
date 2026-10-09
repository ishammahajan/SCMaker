export function assert(condition, message) {
  if (!condition) throw new Error(message);
}
export function number(value, min, max, label) {
  assert(
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max,
    `Invalid ${label}.`,
  );
  return value;
}
export function text(value, max, label) {
  assert(typeof value === 'string' && value.length > 0 && value.length <= max, `Invalid ${label}.`);
  return value;
}
