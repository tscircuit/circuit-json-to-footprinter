import type { AnyCircuitElement } from "circuit-json"
import { circuitJsonToPreview } from "./circuit-json-preview.js"
import {
  discoverFootprinterString,
  type FootprinterDiscoveryResult,
} from "./discover-footprinter.js"

export type {
  FootprintPreview,
  PreviewPad,
  PreviewPadKind,
  PreviewPadShape,
} from "./circuit-json-preview.js"
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
  const target = circuitJsonToPreview(circuitJson, options)
  return discoverFootprinterString(target, options.maxCandidates)
}
