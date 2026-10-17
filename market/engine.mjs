export {
  DEFAULT_SETTINGS, round2, undercut, toUsd, parseSpecs, colorFromText, storageFromText, simFromText,
  observationsFromWoo, observationsFromShopify, observationsFromShopifySuggest, observationsFromShopifyJs,
  coverageQueries, coverageUrl, matchReport, decideRecord, parseManualCsv, matchPair, evaluate, applyKey,
  canApply, canRestore, applyVerifiedFacts, readStoredOffer, inspectStored, confirmReadback,
  schedulerDecision, selectCoverageBatch, assertCollectorTarget, commercialDrift,
  COLLECTOR_STAGING_HOST, COLLECTOR_PRODUCTION_HOST, listingKind, activationFromText,
  warrantyProviderFromText, safeListingUrl, quoteAgeHours, listingEvidence, simulatePrices,
  PROPOSED_QUOTE_MAX_AGE_HOURS
} from "../supabase/functions/_shared/market-engine.mjs";
