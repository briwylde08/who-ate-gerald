/** Shared wire shapes from the gerald-auditor worker. */
export interface MorningReport {
  round: number;
  banished: string | null;
  banishedRole: "villager" | "werebear" | null;
  eaten: string | null;
  notes: string[];
  /** GM-only — stripped from the public view; present on GM responses. */
  violations?: string[];
  winner: "village" | "werebear" | null;
  at: string;
}
