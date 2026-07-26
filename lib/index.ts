import type { AnyCircuitElement } from "circuit-json"
import {
  discoverFootprinterString,
  type FootprinterDiscoveryResult,
} from "./discover-footprinter.js"
import { circuitJsonToFootprint } from "./footprint.js"

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
export type {
  CircuitJsonToFootprintOptions,
  Footprint,
} from "./footprint.js"
export {
  circuitJsonToFootprint,
  footprinterStringToFootprint,
} from "./footprint.js"

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
