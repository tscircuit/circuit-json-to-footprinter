import { expect, test } from "bun:test"
import type { AnyCircuitElement, PcbSmtPad, PcbVia } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import {
  circuitJsonToFootprint,
  circuitJsonToFootprinter,
  compareFootprints,
  footprinterStringToFootprint,
  summarizeCopperComparison,
} from "../lib/index.js"

const LEAD_LENGTH = 0.6649974
const LEAD_WIDTH = 0.2800096
const PERIMETER_CENTER = 4.407408
const FIRST_LEAD_OFFSET = 3.750056

const pillPad = (
  pin: number,
  x: number,
  y: number,
  width: number,
  height: number,
): PcbSmtPad => ({
  height,
  layer: "top",
  pcb_smtpad_id: `pcb_smtpad_${pin}`,
  port_hints: [`pin${pin}`],
  radius: LEAD_WIDTH / 2,
  shape: "pill",
  type: "pcb_smtpad",
  width,
  x,
  y,
})

const perimeterPads: PcbSmtPad[] = [
  ...Array.from({ length: 16 }, (_, index) =>
    pillPad(
      index + 1,
      -PERIMETER_CENTER,
      FIRST_LEAD_OFFSET - index * 0.5,
      LEAD_LENGTH,
      LEAD_WIDTH,
    ),
  ),
  ...Array.from({ length: 16 }, (_, index) =>
    pillPad(
      index + 17,
      -FIRST_LEAD_OFFSET + index * 0.5,
      -PERIMETER_CENTER,
      LEAD_WIDTH,
      LEAD_LENGTH,
    ),
  ),
  ...Array.from({ length: 16 }, (_, index) =>
    pillPad(
      index + 33,
      PERIMETER_CENTER,
      -FIRST_LEAD_OFFSET + index * 0.5,
      LEAD_LENGTH,
      LEAD_WIDTH,
    ),
  ),
  ...Array.from({ length: 16 }, (_, index) =>
    pillPad(
      index + 49,
      FIRST_LEAD_OFFSET - index * 0.5,
      PERIMETER_CENTER,
      LEAD_WIDTH,
      LEAD_LENGTH,
    ),
  ),
]

const thermalPad: PcbSmtPad = {
  height: 6.2999874,
  layer: "top",
  pcb_smtpad_id: "pcb_smtpad_65",
  port_hints: ["pin65"],
  shape: "rect",
  type: "pcb_smtpad",
  width: 6.2999874,
  x: 0,
  y: 0,
}

const viaCoordinates = [-1.5, -0.5, 0.5, 1.5]
const thermalVias: PcbVia[] = viaCoordinates.flatMap((y, row) =>
  viaCoordinates.map((x, column) => ({
    hole_diameter: 0.3048,
    layers: ["top", "bottom"],
    outer_diameter: 0.6096,
    pcb_via_id: `pcb_via_${row * viaCoordinates.length + column + 1}`,
    type: "pcb_via",
    x,
    y,
  })),
)

const c2871569CircuitJson: AnyCircuitElement[] = [
  ...perimeterPads,
  thermalPad,
  ...thermalVias,
]

test("preserves C2871569 thermal vias separately from its 65 pads", () => {
  const footprint = circuitJsonToFootprint(c2871569CircuitJson, {
    title: "C2871569",
  })

  expect(footprint.pads).toHaveLength(65)
  expect(footprint.holes).toHaveLength(0)
  expect(footprint.vias).toHaveLength(16)
  expect(footprint.vias[0]).toMatchObject({
    hole_diameter: 0.3048,
    outer_diameter: 0.6096,
    type: "pcb_via",
    x: -1.5,
    y: -1.5,
  })
})

test("includes thermal-via copper and drills without changing pad count", () => {
  const withVias = circuitJsonToFootprint(c2871569CircuitJson)
  const withoutVias = circuitJsonToFootprint([...perimeterPads, thermalPad])
  const comparison = compareFootprints(withVias, withoutVias)
  const summary = summarizeCopperComparison(withVias, withoutVias)

  expect(comparison.padCountMatch).toBe(true)
  expect(summary.copperIntersectionOverUnion).toBe(1)
  expect(summary.holeIntersectionOverUnion).toBe(0)
  expect(summarizeCopperComparison(withVias, withVias)).toMatchObject({
    copperIntersectionOverUnion: 1,
    holeIntersectionOverUnion: 1,
  })
})

test("renders the C2871569 4x4 thermal-via array", () => {
  const footprint = circuitJsonToFootprint(c2871569CircuitJson)

  expect(
    convertCircuitJsonToPcbSvg([...footprint.pads, ...footprint.vias]),
  ).toMatchSvgSnapshot(import.meta.path, "C2871569-thermal-vias")
})

test("discovers C2871569 with its QFN thermal-via parameters", () => {
  const discovery = circuitJsonToFootprinter(c2871569CircuitJson, {
    maxCandidates: 5,
    sourceHints: ["C2871569", "QFN-64"],
    title: "C2871569",
  })
  const best = discovery.best

  expect(best).not.toBeNull()
  expect(best!.family).toBe("qfn")
  expect(best!.footprinterString).toContain("_thermalvias4x4")
  expect(best!.footprinterString).toContain("_thermalviapitch1mm")
  expect(best!.footprinterString).toContain("_thermalviaid0.3048mm")
  expect(best!.footprinterString).toContain("_thermalviaod0.6096mm")
  expect(best!.holeIntersectionOverUnion).toBeGreaterThan(0.99)

  const recovered = footprinterStringToFootprint(best!.footprinterString)
  expect(recovered.vias).toHaveLength(16)
})
