// Escapes user input so it matches literally inside a RegExp / Mongo $regex
// (prevents regex injection and catastrophic-backtracking patterns).
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
