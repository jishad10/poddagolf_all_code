import mongoose, { Document, Schema, Model } from 'mongoose';
import { IShot } from './shot.interface';

export interface IShotDocument extends Omit<IShot, '_id'>, Document {}

const shotSchema: Schema<IShotDocument> = new Schema(
  {
    // ── Round structure ────────────────────────
    roundId: {
      type: String,
      required: true,
      index: true,
    },
    holeNumber: {
      type: Number,
      required: true,
      default: 1,
    },
    shotNumber: {
      type: Number,
      required: true,
      default: 1,
    },

    // ── Extracted shot data ────────────────────
    club:      { type: String, default: null },
    distance:  { type: Number, default: null },
    direction: { type: String, default: null },
    shotType:  { type: String, default: null },
    position:  { type: String, default: null },
    scoring:   { type: String, default: null },
    event:     { type: String, default: null },

    strokeCount: { type: Number, default: 1 },

    // ── Raw input ─────────────────────────────
    rawText:   { type: String, required: true },
    sessionId: { type: String, required: true, index: true },

    recordedAt: { type: Date, default: Date.now },

    // ── Validation ────────────────────────────
    isValid: {
      type: Boolean,
      default: true,
    },
    /**
     * Human-readable explanation of why isValid = false.
     * null when the shot is valid.
     */
    invalidReason: {
      type: String,
      default: null,
    },
  },
  { timestamps: true },
);

const Shot: Model<IShotDocument> = mongoose.model<IShotDocument>('Shot', shotSchema);

export default Shot;