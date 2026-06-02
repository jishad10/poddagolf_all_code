export interface IShot {
  _id?: string;

  // ── Round structure ───────────────────────────────────────────────────────
  roundId: string;
  holeNumber: number;
  shotNumber: number;

  // ── Extracted shot data ───────────────────────────────────────────────────
  club: string | null;
  distance: number | null;
  direction: string | null;
  shotType: string | null;
  position: string | null;
  scoring: string | null;
  event: string | null;

  strokeCount: number;

  // ── Raw input ─────────────────────────────────────────────────────────────
  rawText: string;
  sessionId: string;
  recordedAt: Date;

  // ── Validation ────────────────────────────────────────────────────────────
  isValid: boolean;
  /** Populated when isValid = false. Explains why the shot failed validation. */
  invalidReason: string | null;
}

export interface IExtractedShotData {
  club: string | null;
  distance: number | null;
  direction: string | null;
  shotType: string | null;
  position: string | null;
  scoring: string | null;
  event: string | null;
}

export interface ICreateShotDTO {
  rawText: string;
  sessionId?: string;
  /**
   * Par for the hole being played (1–5).
   * Defaults to 4 if omitted. Pass from your hole metadata for
   * accurate score validation on par-3 and par-5 holes.
   */
  holePar?: number;
}