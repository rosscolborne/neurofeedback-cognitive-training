import { z } from 'zod';

/**
 * The cognitive-domain catalogue: product taxonomy for filing games, not a
 * scientific ontology and not a measurement.
 *
 * Changes are additive only. Adding a domain (for example 'attention' or
 * 'cognitive-flexibility') appends it and bumps `version`; aggregates are keyed
 * maps, so no schema migration is needed. A domain ID is never renamed,
 * removed or reused.
 *
 * v1: math, reasoning, memory, verbal, spatial, processing-speed.
 */
export const DOMAIN_CATALOG = {
  version: 1,
  domains: ['math', 'reasoning', 'memory', 'verbal', 'spatial', 'processing-speed'],
} as const;

export type DomainId = (typeof DOMAIN_CATALOG.domains)[number];

/** How prominently a game is filed under each domain. Weights sum to 1. */
export type DomainWeights = Partial<Record<DomainId, number>>;

export const DOMAIN_WEIGHT_SUM_TOLERANCE = 1e-9;

function sumOf(weights: Record<string, number | undefined>): number {
  return Object.values(weights).reduce<number>((total, weight) => total + (weight ?? 0), 0);
}

/**
 * Builds the weights schema for a catalogue. Exported so a future catalogue
 * version can be checked against weights written under an earlier one.
 */
export function domainWeightsSchemaFor<const D extends string>(catalog: { readonly domains: readonly [D, ...D[]] }) {
  return z.partialRecord(z.enum(catalog.domains), z.number().min(0).max(1))
    .refine((weights) => Object.keys(weights).length > 0, 'At least one domain weight is required')
    .refine(
      (weights) => Math.abs(sumOf(weights) - 1) <= DOMAIN_WEIGHT_SUM_TOLERANCE,
      'Domain weights must sum to 1',
    );
}

export const domainIdSchema = z.enum(DOMAIN_CATALOG.domains);
export const domainWeightsSchema = domainWeightsSchemaFor(DOMAIN_CATALOG);

/**
 * The weights recorded on one session's server result. Unlike a game's weights
 * they may be empty (a session that contributes to no domain).
 */
export const domainContributionsSchema = z.partialRecord(domainIdSchema, z.number().min(0).max(1))
  .refine((weights) => sumOf(weights) <= 1 + DOMAIN_WEIGHT_SUM_TOLERANCE, 'Domain contributions cannot exceed 1');
