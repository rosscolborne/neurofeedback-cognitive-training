import { z } from 'zod';
import {
  boundedTextSchema,
  compareTimestamps,
  documentIdSchema,
  fractionSchema,
  nonNegativeIntSchema,
  positiveIntSchema,
  timestampSchema,
  uidSchema,
} from '../primitives';
import { readVersioned } from './read';

// users/{uid}/eegRecordings/{recordingId}: one summary per recording, linked to
// its game session. No raw samples and no affective or state labels are
// stored, and nothing in progression reads this collection.

export const EEG_RECORDING_SCHEMA_VERSION = 1;
export const MAX_EEG_TIMELINE_POINTS = 360;

/** The actual headset. Simulation is recorded in `source`, never as a model. */
export const EEG_DEVICE_MODELS = ['muse-2', 'muse-s', 'muse-s-athena', 'unknown'] as const;
export const eegDeviceModelSchema = z.enum(EEG_DEVICE_MODELS);
export type EegDeviceModel = z.infer<typeof eegDeviceModelSchema>;

/** Provenance. Simulated data is never shown or counted as measured. */
export const EEG_SOURCES = ['measured', 'simulated'] as const;
export const eegSourceSchema = z.enum(EEG_SOURCES);
export type EegSource = z.infer<typeof eegSourceSchema>;

const channelNameSchema = z.string().regex(/^[A-Za-z0-9]{1,16}$/);

const distributionSchema = z.strictObject({
  mean: z.number(),
  median: z.number(),
  p10: z.number(),
  p90: z.number(),
  n: nonNegativeIntSchema,
});

const timelineSeriesSchema = z.array(fractionSchema.nullable()).max(MAX_EEG_TIMELINE_POINTS);

const eegRecordingV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  userId: uidSchema,
  gameSessionId: documentIdSchema,
  source: eegSourceSchema,
  createdAt: timestampSchema,
  startedAt: timestampSchema,
  endedAt: timestampSchema,
  device: z.strictObject({
    model: eegDeviceModelSchema,
    firmwareVersion: boundedTextSchema(40).nullable(),
    transport: z.enum(['web-bluetooth', 'native-ble', 'brainflow']),
    channels: z.array(channelNameSchema).min(1).max(16),
    sampleRateHz: z.number().positive().max(10_000),
  }),
  processing: z.strictObject({
    service: z.literal('brainflow-service'),
    serviceVersion: boundedTextSchema(40),
    featureVersion: positiveIntSchema,
    windowSeconds: z.number().positive().max(60),
  }),
  calibration: z.strictObject({
    status: z.enum(['none', 'partial', 'complete']),
    windowsCollected: nonNegativeIntSchema,
    windowsRequired: nonNegativeIntSchema,
  }),
  quality: z.strictObject({
    windowsTotal: nonNegativeIntSchema,
    windowsUsable: nonNegativeIntSchema,
    usableFraction: fractionSchema,
    channelGoodFraction: z.record(channelNameSchema, fractionSchema),
    artifactFraction: fractionSchema,
  }),
  summary: z.strictObject({
    mindfulness: distributionSchema.nullable(),
    restfulness: distributionSchema.nullable(),
    relativeBandPower: z.strictObject({
      delta: fractionSchema.optional(),
      theta: fractionSchema.optional(),
      alpha: fractionSchema.optional(),
      beta: fractionSchema.optional(),
      gamma: fractionSchema.optional(),
    }).nullable(),
  }),
  timeline: z.strictObject({
    bucketSeconds: z.literal(10),
    mindfulness: timelineSeriesSchema,
    restfulness: timelineSeriesSchema,
  }).nullable(),
}).superRefine((recording, ctx) => {
  if (compareTimestamps(recording.endedAt, recording.startedAt) <= 0) {
    ctx.addIssue({ code: 'custom', path: ['endedAt'], message: 'endedAt must be after startedAt' });
  }
  if (new Set(recording.device.channels).size !== recording.device.channels.length) {
    ctx.addIssue({ code: 'custom', path: ['device', 'channels'], message: 'channels must be unique' });
  }
  for (const channel of Object.keys(recording.quality.channelGoodFraction)) {
    if (!recording.device.channels.includes(channel)) {
      ctx.addIssue({
        code: 'custom',
        path: ['quality', 'channelGoodFraction', channel],
        message: 'channel is not one of device.channels',
      });
    }
  }
  if (recording.quality.windowsUsable > recording.quality.windowsTotal) {
    ctx.addIssue({ code: 'custom', path: ['quality', 'windowsUsable'], message: 'cannot exceed windowsTotal' });
  }
  if (recording.timeline
    && recording.timeline.mindfulness.length !== recording.timeline.restfulness.length) {
    ctx.addIssue({ code: 'custom', path: ['timeline'], message: 'timeline series must be the same length' });
  }
});

export const eegRecordingSchema = eegRecordingV1Schema;
export type EegRecording = z.infer<typeof eegRecordingSchema>;

export function readEegRecording(raw: unknown): EegRecording {
  return readVersioned('eegRecordings', raw, { 1: eegRecordingV1Schema });
}
