const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

// "900" -> 900, "15m" -> 900, "1h" -> 3600. Bare numbers are seconds.
export function parseDurationToSeconds(value: string): number {
  const match = /^(\d+)([smhd]?)$/.exec(value.trim());
  if (!match) throw new Error(`Invalid duration: ${value}`);
  return Number(match[1]) * UNIT_SECONDS[match[2] || 's'];
}
