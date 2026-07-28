import { expect, test } from "bun:test"
import type { AnyCircuitElement, PcbSmtPad } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import {
  circuitJsonToFootprint,
  circuitJsonToFootprinter,
  footprinterStringToFootprint,
  summarizeCopperComparison,
} from "../lib/index.js"

const pads: PcbSmtPad[] = Array.from({ length: 24 }, (_, index) => {
  const rowIndex = index % 12
  const bottom = index < 12
  return {
    type: "pcb_smtpad",
    pcb_smtpad_id: `pad_${index + 1}`,
    layer: "top",
    shape: "rect",
    port_hints: [`pin${index + 1}`],
    x: (bottom ? rowIndex - 5.5 : 5.5 - rowIndex) * 0.635,
    y: bottom ? -2.569972 : 2.569972,
    width: 0.350012,
    height: 1.6400018,
  }
})

test("preserves the C51912240 QSOP 0.635mm pitch", () => {
  const circuitJson: AnyCircuitElement[] = pads
  const result = circuitJsonToFootprinter(circuitJson, {
    maxCandidates: 5,
    sourceHints: ["C51912240", "C8620QP", "QSOP-24"],
  })

  expect(result.best?.footprinterString).toContain("_p0.635mm_")

  const recovered = footprinterStringToFootprint(result.best!.footprinterString)
  const target = circuitJsonToFootprint(circuitJson)
  expect(
    summarizeCopperComparison(recovered, target).copperIntersectionOverUnion,
  ).toBeGreaterThanOrEqual(0.95)
  expect(convertCircuitJsonToPcbSvg(recovered.pads)).toMatchSvgSnapshot(
    import.meta.path,
    "C51912240",
  )
})
