import { expect, test } from "bun:test"
import { fp } from "@tscircuit/footprinter"
import type { AnyCircuitElement } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import {
  circuitJsonToFootprint,
  circuitJsonToFootprinter,
  getFootprintBounds,
  summarizeCopperComparison,
} from "../lib/index.js"

const polygonPad = (
  points: Array<{ x: number; y: number }>,
): AnyCircuitElement =>
  ({
    layer: "top",
    pcb_smtpad_id: "pcb_smtpad_polygon",
    points,
    port_hints: ["2"],
    shape: "polygon",
    type: "pcb_smtpad",
  }) as AnyCircuitElement

test("preserves polygon SMT pad vertices and bounds", () => {
  const footprint = circuitJsonToFootprint([
    polygonPad([
      { x: 4, y: 5 },
      { x: 8, y: 5 },
      { x: 8, y: 7 },
      { x: 6, y: 6 },
      { x: 4, y: 7 },
    ]),
  ])

  expect(footprint.pads[0]).toEqual({
    layer: "top",
    points: [
      { x: 4, y: 5 },
      { x: 8, y: 5 },
      { x: 8, y: 7 },
      { x: 6, y: 6 },
      { x: 4, y: 7 },
    ],
    pcb_smtpad_id: "pcb_smtpad_polygon",
    port_hints: ["2"],
    shape: "polygon",
    type: "pcb_smtpad",
  })
  expect(getFootprintBounds(footprint.pads)).toEqual({
    height: 2,
    maxX: 8,
    maxY: 7,
    minX: 4,
    minY: 5,
    width: 4,
  })
})

test("compares polygon copper instead of its bounding rectangle", () => {
  const square = circuitJsonToFootprint([
    polygonPad([
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: 1 },
    ]),
  ])
  const triangle = circuitJsonToFootprint([
    polygonPad([
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 0, y: 1 },
    ]),
  ])
  const equivalentRect = circuitJsonToFootprint([
    {
      height: 2,
      layer: "top",
      pcb_smtpad_id: "pcb_smtpad_rect",
      shape: "rect",
      type: "pcb_smtpad",
      width: 2,
      x: 0,
      y: 0,
    } as AnyCircuitElement,
  ])

  expect(summarizeCopperComparison(square, square, 240)).toEqual({
    copperIntersectionOverUnion: 1,
    holeIntersectionOverUnion: 1,
    pinMatchRate: 1,
    pinMismatches: [],
    pinsMatch: true,
  })
  expect(
    summarizeCopperComparison(square, equivalentRect, 240)
      .copperIntersectionOverUnion,
  ).toBe(1)
  expect(
    summarizeCopperComparison(square, triangle, 240)
      .copperIntersectionOverUnion,
  ).toBeCloseTo(0.5, 2)
})

test("recovers the Footprinter SOT-89 family with its polygon pad", () => {
  const circuitJson = fp.string("sot89").circuitJson() as AnyCircuitElement[]
  const footprint = circuitJsonToFootprint(circuitJson)
  const polygon = footprint.pads.find((pad) => pad.shape === "polygon")

  expect(polygon?.points).toHaveLength(8)
  expect(polygon && getFootprintBounds([polygon]).width).toBeCloseTo(4.6)
  expect(polygon && getFootprintBounds([polygon]).height).toBeCloseTo(1.733)

  const result = circuitJsonToFootprinter(circuitJson, { maxCandidates: 3 })
  expect(result.best?.family).toBe("sot89")
  expect(result.best?.copperIntersectionOverUnion).toBe(1)
})

test("renders the SOT-89 polygon SMT pad", () => {
  const circuitJson = fp.string("sot89").circuitJson() as AnyCircuitElement[]

  expect(convertCircuitJsonToPcbSvg(circuitJson)).toMatchSvgSnapshot(
    import.meta.path,
    "polygon-smtpad-sot89",
  )
})

test("rejects malformed polygon SMT pads", () => {
  expect(() =>
    circuitJsonToFootprint([
      polygonPad([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ]),
    ]),
  ).toThrow("at least three points")

  expect(() =>
    circuitJsonToFootprint([
      polygonPad([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ]),
    ]),
  ).toThrow("non-zero area")
})
