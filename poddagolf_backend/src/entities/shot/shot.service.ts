import Shot, { IShotDocument } from './shot.model';
import { IExtractedShotData } from './shot.interface';
import { v4 as uuidv4 } from 'uuid';
import fetch from 'node-fetch';
import config from '../../core/config/config';


// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface HoleAdvanceResult {
  advance: boolean;
  totalStrokes: number;
  isScoreValid: boolean;
  invalidReason: string | undefined;
}

interface SaveShotOptions {
  sessionId?: string;
  holePar?: number;
}


// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const SCORING_LABELS = new Set([
  'hole in one',
  'albatross',
  'eagle',
  'birdie',
  'par',
  'bogey',
  'double bogey',
  'triple bogey',
]);

const MAX_SHOT_DISTANCE = 400;

const SCORING_RELATIVE_TO_PAR: Record<string, number> = {
  'hole in one': -99, // special-cased in validateScoreConsistency
  'albatross':   -3,
  'eagle':       -2,
  'birdie':      -1,
  'par':          0,
  'bogey':        1,
  'double bogey': 2,
  'triple bogey': 3,
};


// ─────────────────────────────────────────────────────────────────────────────
// SPEECH ERROR CORRECTION
//
// Real-world Whisper outputs seen in tests:
//   "two ports for power"  → should be "two putts for par"
//   "3 poots 2k boggy"     → should be "three putts, took a bogey"
//   "T-Shirt into the rough" → should be "tee shot into the rough"
//
// Strategy: use fuzzy regex patterns on the putt word family so that
// "poot", "port", "pootz", "putts", "poots" etc. all normalise to "putt".
// Scoring words ("power", "boggy", "bogie") are also covered.
// ─────────────────────────────────────────────────────────────────────────────

function fixSpeechErrors(text: string): string {
  let t = text.toLowerCase().trim();

  // ── Step 1: Fix putt variants FIRST (before scoring fixes consume the text)
  // Regex: \b(one|two|three|1|2|3)\s*p[aeiou]*[rt][sz]?\b
  // Matches: "two putts", "two ports", "two poots", "3 poot", "3 poots", "three putts"
  t = t.replace(/\bthree\s+p[a-z]*t+[sz]?\b/g, 'three putts');
  t = t.replace(/\b3\s+p[a-z]*t+[sz]?\b/g,     'three putts');
  t = t.replace(/\btwo\s+p[a-z]*t+[sz]?\b/g,   'two putts');
  t = t.replace(/\b2\s+p[a-z]*t+[sz]?\b/g,     'two putts');
  t = t.replace(/\bone\s+p[a-z]*t+[sz]?\b/g,   'one putt');
  t = t.replace(/\b1\s+p[a-z]*t+[sz]?\b/g,     'one putt');

  // ── Step 2: Fix scoring variants
  // "boggy", "bogie", "bogi" → "bogey"
  t = t.replace(/\bbog+[yi]e?\b/g, 'bogey');
  // "double boggy / bogie" → "double bogey"
  t = t.replace(/\bdouble\s+bog+[yi]e?\b/g, 'double bogey');
  t = t.replace(/\btriple\s+bog+[yi]e?\b/g, 'triple bogey');
  t = t.replace(/\bdubble\s+bogey\b/g,      'double bogey');

  // "birdy" → "birdie"
  t = t.replace(/\bbirdy\b/g, 'birdie');

  // ── Step 3: Fix "par" variants that Whisper commonly mishears
  // "for power", "for poor", "for paw", "for pa" → "for par"
  t = t.replace(/\bfor\s+p(?:ower|oor|aw|a)\b/g, 'for par');
  t = t.replace(/\bfull\s+bar\b/g,               'for par');
  t = t.replace(/\b4\s+bar\b/g,                  'for par');
  t = t.replace(/\bfore\s+par\b/g,               'for par');
  // "took a bogey/par/birdie" → "for bogey/par/birdie" (natural speech normalisation)
  t = t.replace(/\btook\s+a\s+(bogey|par|birdie|eagle)\b/g, 'for $1');
  t = t.replace(/\bmade\s+(bogey|par|birdie|eagle)\b/g,     'for $1');
  t = t.replace(/\bgot\s+a?\s*(bogey|par|birdie|eagle)\b/g, 'for $1');

  // ── Step 4: Fix tee shot mishearings (real case: "T-Shirt" → "tee shot")
  t = t.replace(/\bt[\s-]shirt\b/g, 'tee shot');
  t = t.replace(/\btea\s+shot\b/g,  'tee shot');

  // ── Step 5: Fix shot type mishearings
  t = t.replace(/\bpeach\s+shot\b/g,      'pitch shot');
  t = t.replace(/\bpeach\b/g,             'pitch');
  t = t.replace(/\bpeace\s+to\s+green\b/g,'pitch to green');

  // ── Step 6: Fix club mishearings
  t = t.replace(/\bi\s+ran\b/g,  'iron');
  t = t.replace(/\bi-?ron\b/g,   'iron');
  t = t.replace(/\bhybred\b/g,   'hybrid');

  // ── Step 7: Fix position mishearings
  t = t.replace(/\bbuncker\b/g,        'bunker');
  t = t.replace(/\bout\s+of\s+bound\b/g, 'out of bounds');
  t = t.replace(/\boob\b/g,           'out of bounds');

  // ── Step 8: Fix "put" (singular, no double-t) when used as a putt verb
  // e.g. "to put" → "two putt"  but only when preceded by "to" (not "I put")
  t = t.replace(/\bto\s+put\b/g, 'two putts');

  return t;
}


// ─────────────────────────────────────────────────────────────────────────────
// AI EXTRACTION  (with retry)
// ─────────────────────────────────────────────────────────────────────────────

const EMPTY_EXTRACTION: IExtractedShotData = {
  club: null,
  distance: null,
  direction: null,
  shotType: null,
  position: null,
  scoring: null,
  event: null,
};

export async function extractShotData(
  transcript: string,
  attempt = 1,
): Promise<IExtractedShotData> {
  const apiKey = config.openAiApiKey;
  if (!apiKey) {
    console.warn('[ShotService] OPENAI_API_KEY not set — skipping AI extraction');
    return { ...EMPTY_EXTRACTION };
  }

  const prompt = `
You are a STRICT golf data extractor. The input may contain speech recognition errors.
Be tolerant of spelling/phonetic mistakes but extract the intended meaning.

Return ONLY valid JSON. No explanation. No markdown fences.

=== CORE RULES ===
- Extract ONLY the LAST shot mentioned
- If correction happens → use FINAL value
- Be tolerant of Whisper speech recognition errors
- NEVER guess → use null if genuinely unclear
- Prefer RESULT over intention

=== FIELD DEFINITIONS ===

club:
Driver, 3 Wood, 5 Wood, Hybrid, 3 Iron, 4 Iron, 5 Iron, 6 Iron, 7 Iron, 8 Iron, 9 Iron,
Pitching Wedge, Gap Wedge, Sand Wedge, Lob Wedge, Putter
Note: "5 around" or "5 iron" → 5 Iron. A number alone (e.g. "5") next to a distance → likely club number.

distance:
Integer only (yards/meters, no unit). null if not stated.

direction:
ONLY ball flight direction. One of:
straight, left, right, slight left, slight right, far left, far right,
draw, fade, hook, slice, push, pull, short, long
null if not stated.

position:
ONLY where the ball ended up. One of:
fairway, rough, bunker, green, fringe, out of bounds, water, hazard
IMPORTANT: "onto the green", "on the green" → position = "green" (NOT direction)
null if not stated.

shotType:
One of: drive, approach, chip, pitch, bunker shot, putt, recovery shot
IMPORTANT: "putt", "two putts", "three putts" → shotType = "putt"
IMPORTANT: "tee shot" → shotType = "drive"
null if not stated.

scoring:
One of: hole in one, albatross, eagle, birdie, par, bogey, double bogey, triple bogey
IMPORTANT: "for par / for bogey / for birdie" → extract the scoring word
IMPORTANT: "took a bogey", "made par", "got a birdie" → extract scoring
ALWAYS extract scoring if mentioned, even with spelling variants.
null if not stated.

event:
One of: penalty, lost ball, out of bounds, drop, up and down, chip in,
        holed putt, two putt, three putt
IMPORTANT: Use the most specific event possible.
  "out of bounds" → event = "out of bounds"
  "water" or "hazard" → event = "penalty"
  "two putts" → event = "two putt"
  "three putts" → event = "three putt"
null if not stated.

=== INPUT ===
"${transcript.replace(/"/g, "'")}"

=== OUTPUT FORMAT (return exactly this structure) ===
{"club":null,"distance":null,"direction":null,"shotType":null,"position":null,"scoring":null,"event":null}
`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0,
        max_tokens: 150,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[ShotService] OpenAI API error (${response.status}): ${errText}`);
      return { ...EMPTY_EXTRACTION };
    }

    const data = await response.json() as any;
    const content: string = data?.choices?.[0]?.message?.content ?? '';
    const clean = content.replace(/```json|```/g, '').trim();

    return JSON.parse(clean) as IExtractedShotData;

  } catch (err) {
    if (attempt < 2) {
      console.warn('[ShotService] JSON parse failed on attempt 1, retrying...');
      return extractShotData(transcript, 2);
    }
    console.error('[ShotService] extractShotData failed after 2 attempts:', err);
    return { ...EMPTY_EXTRACTION };
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// NORMALIZATION
// ─────────────────────────────────────────────────────────────────────────────

function capitalizeWords(s: string): string {
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

function normalizeExtraction(data: IExtractedShotData): IExtractedShotData {
  return {
    club:      data.club      ? capitalizeWords(data.club.trim())   : null,
    distance:  data.distance  != null ? Math.round(data.distance)   : null,
    direction: data.direction ? data.direction.toLowerCase().trim() : null,
    shotType:  data.shotType  ? data.shotType.toLowerCase().trim()  : null,
    position:  data.position  ? data.position.toLowerCase().trim()  : null,
    scoring:   data.scoring   ? data.scoring.toLowerCase().trim()   : null,
    event:     data.event     ? data.event.toLowerCase().trim()     : null,
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// FALLBACKS  (keyword scan on cleaned text — safety net after AI)
// ─────────────────────────────────────────────────────────────────────────────

function applyFallbacks(data: IExtractedShotData, text: string): IExtractedShotData {
  const t = text.toLowerCase();
  const result = { ...data };

  // ── Scoring fallbacks ────────────────────────────────────────────────────
  if (!result.scoring) {
    if (t.includes('hole in one'))        result.scoring = 'hole in one';
    else if (t.includes('albatross'))     result.scoring = 'albatross';
    else if (t.includes('eagle'))         result.scoring = 'eagle';
    else if (t.includes('birdie'))        result.scoring = 'birdie';
    else if (t.includes('double bogey'))  result.scoring = 'double bogey';
    else if (t.includes('triple bogey'))  result.scoring = 'triple bogey';
    else if (t.includes('bogey'))         result.scoring = 'bogey';
    else if (/\bfor par\b/.test(t))       result.scoring = 'par';
  }

  // ── ShotType fallbacks ───────────────────────────────────────────────────
  if (!result.shotType) {
    if (t.includes('three putts') || t.includes('two putts') ||
        t.includes('one putt')    || t.includes('putt')) {
      result.shotType = 'putt';
    } else if (t.includes('chip'))  { result.shotType = 'chip'; }
    else if (t.includes('pitch'))   { result.shotType = 'pitch'; }
    else if (t.includes('tee shot')){ result.shotType = 'drive'; }
  }

  // ── Event fallbacks ──────────────────────────────────────────────────────
  if (!result.event) {
    if (t.includes('out of bounds') || t.includes('oob')) {
      result.event = 'out of bounds';
    } else if (t.includes('lost ball')) {
      result.event = 'lost ball';
    } else if (t.includes('water') || t.includes('hazard')) {
      result.event = 'penalty';
    } else if (t.includes('three putts')) {
      result.event = 'three putt';
    } else if (t.includes('two putts')) {
      result.event = 'two putt';
    } else if (t.includes('chip in')) {
      result.event = 'chip in';
    } else if (t.includes('holed')) {
      result.event = 'holed putt';
    }
  }

  return result;
}


// ─────────────────────────────────────────────────────────────────────────────
// STROKE COUNT
//
// Key insight from real tests:
// After fixSpeechErrors runs, "two putts" / "three putts" will be normalised.
// We read strokeCount from the CLEANED text and also from the AI-extracted
// event field as a cross-check. The event field is the most reliable signal
// after the speech fix has normalised the text.
// ─────────────────────────────────────────────────────────────────────────────

function detectStrokeCount(data: IExtractedShotData, cleanedText: string): number {
  const t = cleanedText.toLowerCase();

  // Primary: check normalised text (after fixSpeechErrors has run)
  if (t.includes('three putts')) return 3;
  if (t.includes('two putts'))   return 2;
  if (t.includes('one putt'))    return 1;

  // Secondary: check AI-extracted event as a cross-check
  // (catches cases where speech fix normalised but text scan missed)
  if (data.event === 'three putt') return 3;
  if (data.event === 'two putt')   return 2;

  return 1;
}


// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

interface ValidationResult {
  isValid: boolean;
  invalidReason?: string;
}

function validateShot(data: IExtractedShotData): ValidationResult {
  if (!data) return { isValid: false, invalidReason: 'No extraction data' };

  if (data.distance != null) {
    if (data.distance < 0) {
      return { isValid: false, invalidReason: `Negative distance: ${data.distance}` };
    }
    if (data.distance > MAX_SHOT_DISTANCE) {
      return { isValid: false, invalidReason: `Distance exceeds maximum: ${data.distance}` };
    }
  }

  if (data.club === 'Putter' && data.distance != null && data.distance > 50) {
    return { isValid: false, invalidReason: `Putter distance too large: ${data.distance}` };
  }

  if (data.club === 'Driver' && data.shotType === 'putt') {
    return { isValid: false, invalidReason: 'Driver cannot be used for a putt' };
  }

  if (data.scoring && !SCORING_LABELS.has(data.scoring)) {
    return { isValid: false, invalidReason: `Unknown scoring label: "${data.scoring}"` };
  }

  return { isValid: true };
}

function validateScoreConsistency(
  totalStrokes: number,
  scoring: string | null,
  holePar: number,
): ValidationResult {
  if (!scoring) return { isValid: true };

  if (scoring === 'hole in one') {
    if (totalStrokes === 1) return { isValid: true };
    return {
      isValid: false,
      invalidReason: `Hole in one requires 1 stroke, got ${totalStrokes}`,
    };
  }

  const relative = SCORING_RELATIVE_TO_PAR[scoring];
  if (relative === undefined) return { isValid: true };

  const expected = holePar + relative;
  if (totalStrokes === expected) return { isValid: true };

  return {
    isValid: false,
    invalidReason: `"${scoring}" on par-${holePar} expects ${expected} strokes, got ${totalStrokes}`,
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// ROUND STATE  (single DB round-trip)
// ─────────────────────────────────────────────────────────────────────────────

async function getRoundState(roundId: string): Promise<{
  holeNumber: number;
  shotNumber: number;
  currentHoleStrokes: number;
}> {
  const lastShot = await Shot.findOne({ roundId }).sort({ createdAt: -1 }).lean();

  if (!lastShot) {
    return { holeNumber: 1, shotNumber: 1, currentHoleStrokes: 0 };
  }

  // If last shot had a scoring label, the hole is complete → start next hole
  const holeAdvanced = !!(lastShot.scoring && SCORING_LABELS.has(lastShot.scoring));

  const currentHoleNumber = holeAdvanced
    ? lastShot.holeNumber + 1
    : lastShot.holeNumber;

  // Only sum strokes if we are still on the same hole (no DB call needed if hole advanced)
  let currentHoleStrokes = 0;
  if (!holeAdvanced) {
    const agg = await Shot.aggregate<{ total: number }>([
      { $match: { roundId, holeNumber: currentHoleNumber } },
      { $group: { _id: null, total: { $sum: '$strokeCount' } } },
    ]);
    currentHoleStrokes = agg[0]?.total ?? 0;
  }

  return {
    holeNumber: currentHoleNumber,
    shotNumber: holeAdvanced ? 1 : lastShot.shotNumber + 1,
    currentHoleStrokes,
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// HOLE COMPLETION CHECK
// ─────────────────────────────────────────────────────────────────────────────

async function evaluateHoleCompletion(
  data: IExtractedShotData,
  currentHoleStrokes: number,
  strokeCount: number,
  holePar: number,
): Promise<HoleAdvanceResult> {
  if (!data.scoring || !SCORING_LABELS.has(data.scoring)) {
    return { advance: false, totalStrokes: 0, isScoreValid: true, invalidReason: undefined };
  }

  const finalTotal = currentHoleStrokes + strokeCount;
  const scoreCheck = validateScoreConsistency(finalTotal, data.scoring, holePar);

  return {
    advance: true,
    totalStrokes: finalTotal,
    isScoreValid: scoreCheck.isValid,
    invalidReason: scoreCheck.invalidReason,
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// MAIN SERVICE
// ─────────────────────────────────────────────────────────────────────────────

const ShotService = {

  async saveShot(
    rawText: string,
    options: SaveShotOptions | string = {},
  ): Promise<IShotDocument> {

    const opts: SaveShotOptions =
      typeof options === 'string' ? { sessionId: options } : options;

    const { holePar = 4 } = opts;
    const sessionId = opts.sessionId ?? uuidv4();
    const roundId = sessionId;

    // 1. Speech correction
    const cleanedText = fixSpeechErrors(rawText);

    // 2. AI extraction (with retry)
    const raw = await extractShotData(cleanedText);

    // 3. Fallbacks → normalisation (pure, no mutation)
    const withFallbacks = applyFallbacks(raw, cleanedText);
    const extracted = normalizeExtraction(withFallbacks);

    // 4. Round state (single DB round-trip)
    const { holeNumber, shotNumber, currentHoleStrokes } = await getRoundState(roundId);

    // 5. Stroke count — uses cleaned text + AI event as cross-check
    const strokeCount = detectStrokeCount(extracted, cleanedText);

    // 6. Structural shot validation
    const shotValidation = validateShot(extracted);

    // 7. Score consistency check
    const holeResult = await evaluateHoleCompletion(
      extracted,
      currentHoleStrokes,
      strokeCount,
      holePar,
    );

    const isValid = shotValidation.isValid && holeResult.isScoreValid;
    const invalidReason = shotValidation.invalidReason ?? holeResult.invalidReason ?? undefined;

    if (!isValid) {
      console.warn(`[ShotService] Invalid shot — ${invalidReason}`);
    }

    return Shot.create({
      rawText,
      sessionId,
      roundId,
      holeNumber,
      shotNumber,
      strokeCount,
      recordedAt: new Date(),
      isValid,
      invalidReason: invalidReason ?? null,
      ...extracted,
    });
  },


  async getShotsByRound(roundId: string) {
    const shots = await Shot.find({ roundId })
      .sort({ holeNumber: 1, shotNumber: 1 })
      .lean();

    const holeMap = new Map<number, {
      holeNumber: number;
      totalStrokes: number;
      scoring: string | null;
      isValid: boolean;
      invalidReasons: string[];
    }>();

    for (const shot of shots) {
      if (!holeMap.has(shot.holeNumber)) {
        holeMap.set(shot.holeNumber, {
          holeNumber: shot.holeNumber,
          totalStrokes: 0,
          scoring: null,
          isValid: true,
          invalidReasons: [],
        });
      }

      const hole = holeMap.get(shot.holeNumber)!;
      hole.totalStrokes += shot.strokeCount ?? 1;

      if (shot.scoring) {
        hole.scoring = shot.scoring;
      }

      if (!shot.isValid) {
        hole.isValid = false;
        if ((shot as any).invalidReason) {
          hole.invalidReasons.push((shot as any).invalidReason);
        }
      }
    }

    return {
      shots,
      summary: Array.from(holeMap.values()),
    };
  },


  async getShotsBySession(sessionId: string) {
    if (!sessionId || typeof sessionId !== 'string') {
      throw new Error('sessionId must be a non-empty string');
    }
    return Shot.find({ sessionId })
      .sort({ holeNumber: 1, shotNumber: 1 })
      .lean();
  },


  async getAllShots() {
    return Shot.find().sort({ recordedAt: -1 }).lean();
  },


  async deleteShot(id: string) {
    if (!id || typeof id !== 'string') {
      throw new Error('id must be a non-empty string');
    }
    return Shot.findByIdAndDelete(id);
  },


  async deleteSessionShots(sessionId: string): Promise<number> {
    if (!sessionId || typeof sessionId !== 'string') {
      throw new Error('sessionId must be a non-empty string');
    }
    const result = await Shot.deleteMany({ sessionId });
    return result.deletedCount;
  },
};


export default ShotService;