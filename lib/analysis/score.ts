import type { Flag, Severity, Tier } from "./types";

// Points contributed by each triggered flag, by severity. Only `triggered`
// flags move the score; `passed` and `pending` flags do not.
const SEVERITY_WEIGHT: Record<Severity, number> = {
  info: 0,
  low: 12,
  medium: 28,
  high: 45,
};

export function scoreFromFlags(flags: Flag[]): number {
  // Some checks describe the same underlying arithmetic discrepancy. Count
  // only the strongest flag in each correlation group so one bad total does
  // not inflate the score twice.
  // The generic `arithmetic` check and the claim-specific arithmetic/tax checks
  // (only one claim type runs per receipt) all describe the same underlying
  // money discrepancy, so collapse them into one group and count the strongest.
  const MONEY_IDS = new Set([
    "arithmetic",
    "purchase-arithmetic",
    "purchase-tax",
    "medical-arithmetic",
    "grab-arithmetic",
  ]);
  const correlationGroup = (id: string) => (MONEY_IDS.has(id) ? "money" : id);
  const strongest = new Map<string, Severity>();
  for (const flag of flags.filter((item) => item.status === "triggered")) {
    const group = correlationGroup(flag.id);
    const current = strongest.get(group);
    if (!current || SEVERITY_WEIGHT[flag.severity] > SEVERITY_WEIGHT[current]) {
      strongest.set(group, flag.severity);
    }
  }
  const total = Array.from(strongest.values()).reduce((sum, severity) => sum + SEVERITY_WEIGHT[severity], 0);
  return Math.min(100, total);
}

export function tierFromScore(score: number): Tier {
  if (score >= 60) return "red";
  if (score >= 25) return "amber";
  return "green";
}
