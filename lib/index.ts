import type { AnyCircuitElement } from "circuit-json"
import { circuitJsonToFootprint } from "./circuit-json-footprint.js"
import {
  discoverFootprinterString,
  type FootprinterDiscoveryResult,
} from "./discover-footprinter.js"

export type {
  CircuitJsonFootprint,
  CircuitJsonToFootprintOptions,
} from "./circuit-json-footprint.js"
export {
  circuitJsonToFootprint,
  footprinterStringToFootprint,
} from "./circuit-json-footprint.js"
export {
  type Bounds,
  type CopperComparisonSummary,
  compareFootprints,
  getFootprintBounds,
  type RasterComparison,
  summarizeCopperComparison,
} from "./compare-copper.js"
export type {
  FootprinterDiscoveryCandidate,
  FootprinterDiscoveryResult,
} from "./discover-footprinter.js"

export interface CircuitJsonToFootprinterOptions {
  maxCandidates?: number
  sourceHints?: string[]
  subtitle?: string
  title?: string
}

export const circuitJsonToFootprinter = (
  circuitJson: readonly AnyCircuitElement[],
  options: CircuitJsonToFootprinterOptions = {},
): FootprinterDiscoveryResult => {
  const target = circuitJsonToFootprint(circuitJson, options)
  return discoverFootprinterString(target, options.maxCandidates)
}
