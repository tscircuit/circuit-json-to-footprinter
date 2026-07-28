import { expect, test } from "bun:test"
import type { AnyCircuitElement, PcbHoleCircle, PcbSmtPad } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import {
  circuitJsonToFootprinter,
  footprinterStringToFootprint,
} from "../lib/index.js"

const rectPad = (
  pin: number,
  x: number,
  y: number,
  width: number,
  height: number,
): PcbSmtPad => ({
  type: "pcb_smtpad",
  pcb_smtpad_id: `pad_${pin}`,
  layer: "top",
  shape: "rect",
  port_hints: [`pin${pin}`],
  x,
  y,
  width,
  height,
})

const locatorHole = (
  x: number,
  y: number,
  diameter: number,
): PcbHoleCircle => ({
  type: "pcb_hole",
  pcb_hole_id: "",
  pcb_component_id: "",
  hole_shape: "circle",
  hole_diameter: diameter,
  x,
  y,
})

const cases: Array<{
  circuitJson: AnyCircuitElement[]
  expectedFragments: string[]
  manufacturerPartNumber: string
  partNumber: string
}> = [
  {
    partNumber: "C2681570",
    manufacturerPartNumber: "MINI MSK12CO2",
    expectedFragments: [],
    circuitJson: [
      locatorHole(-1.49987, -0.52501165, 0.9000236),
      locatorHole(1.500124, -0.52501165, 0.9000236),
      rectPad(1, -0.999998, 1.27508635, 0.6999986, 1.499997),
      rectPad(2, 0, 1.27508635, 0.6999986, 1.499997),
      rectPad(3, 0.999998, 1.27508635, 0.6999986, 1.499997),
      rectPad(4, -2.750058, 0.57506235, 0.999998, 0.7999984),
      rectPad(5, 2.750058, 0.57506235, 0.999998, 0.7999984),
      rectPad(6, -2.750058, -1.62508565, 0.999998, 0.7999984),
      rectPad(7, 2.750058, -1.62508565, 0.999998, 0.7999984),
    ],
  },
  {
    partNumber: "C431540",
    manufacturerPartNumber: "MSK12C02",
    expectedFragments: ["_signalcols4", "_missing(2)"],
    circuitJson: [
      locatorHole(-1.49987, -0.75616435, 0.9000236),
      locatorHole(1.500124, -0.75616435, 0.9000236),
      rectPad(4, 3.599942, 0.39394765, 1.1999976, 0.6999986),
      rectPad(5, 3.599942, -1.90602235, 1.1999976, 0.6999986),
      rectPad(6, -3.599942, -1.90602235, 1.1999976, 0.6999986),
      rectPad(7, -3.599942, 0.39394765, 1.1999976, 0.6999986),
      rectPad(3, 2.249932, 1.49402165, 0.5999988, 1.524),
      rectPad(2, 0.750062, 1.49402165, 0.5999988, 1.524),
      rectPad(1, -2.249932, 1.49402165, 0.5999988, 1.524),
    ],
  },
]

for (const {
  circuitJson,
  expectedFragments,
  manufacturerPartNumber,
  partNumber,
} of cases) {
  test(`recovers ${partNumber} ${manufacturerPartNumber} as smdslideswitch`, () => {
    const result = circuitJsonToFootprinter(circuitJson, {
      maxCandidates: 3,
      sourceHints: [partNumber, manufacturerPartNumber, "SMD slide switch"],
    })

    expect(result.best?.family).toBe("smdslideswitch")
    expect(result.best?.footprinterString).toStartWith("smdslideswitch7_")
    for (const fragment of expectedFragments) {
      expect(result.best?.footprinterString).toContain(fragment)
    }
    expect(result.best?.copperIntersectionOverUnion).toBeGreaterThanOrEqual(
      0.999,
    )
    expect(result.best?.holeIntersectionOverUnion).toBeGreaterThanOrEqual(0.999)

    const recovered = footprinterStringToFootprint(
      result.best!.footprinterString,
    )
    expect(
      convertCircuitJsonToPcbSvg([...recovered.pads, ...recovered.holes]),
    ).toMatchSvgSnapshot(import.meta.path, partNumber)
  })
}
