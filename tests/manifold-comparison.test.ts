import { expect, test } from "bun:test"
import type { PcbHole, PcbSmtPad, PcbSmtPadRotatedRect } from "circuit-json"
import {
  circuitJsonToFootprint,
  compareFootprints,
  type Footprint,
  summarizeCopperComparison,
} from "../lib/index.js"

const rect = (id: string, width: number, height: number, x = 0): PcbSmtPad => ({
  height,
  layer: "top",
  pcb_smtpad_id: id,
  shape: "rect",
  type: "pcb_smtpad",
  width,
  x,
  y: 0,
})

const footprint = (pads: PcbSmtPad[]): Footprint => ({
  holes: [],
  pads,
  subtitle: "",
  title: "",
  vias: [],
})

test("comparison metrics do not depend on heatmap resolution", () => {
  const left = footprint([rect("left", 2, 2)])
  const right = footprint([rect("right", 1, 2)])
  const coarse = compareFootprints(left, right, 8)
  const fine = compareFootprints(left, right, 640)

  expect(coarse.iou).toBe(0.5)
  expect(fine.iou).toBe(coarse.iou)
  expect(fine.coverageLeft).toBe(coarse.coverageLeft)
  expect(fine.coverageRight).toBe(coarse.coverageRight)
  expect(coarse.occupancy).toHaveLength(8 * 8)
  expect(fine.occupancy).toHaveLength(640 * 640)
})

test("overlapping pads are unioned before their area is compared", () => {
  const overlappingPads = footprint([
    rect("left_1", 2, 2, -0.5),
    rect("left_2", 2, 2, 0.5),
  ])
  const equivalentOutline = footprint([rect("right", 3, 2)])

  expect(
    summarizeCopperComparison(overlappingPads, equivalentOutline)
      .copperIntersectionOverUnion,
  ).toBe(1)
})

test("compares arbitrarily rotated pads with boolean geometry", () => {
  const rotation = 37
  const radians = (rotation * Math.PI) / 180
  const rotate = (x: number, y: number) => ({
    x: x * Math.cos(radians) - y * Math.sin(radians),
    y: x * Math.sin(radians) + y * Math.cos(radians),
  })
  const rotatedRect = circuitJsonToFootprint([
    {
      ccw_rotation: rotation,
      height: 1,
      layer: "top",
      pcb_smtpad_id: "rotated_rect",
      shape: "rotated_rect",
      type: "pcb_smtpad",
      width: 2,
      x: 0,
      y: 0,
    } satisfies PcbSmtPadRotatedRect,
  ])
  const equivalentPolygon = circuitJsonToFootprint([
    {
      layer: "top",
      pcb_smtpad_id: "polygon",
      points: [
        rotate(-1, -0.5),
        rotate(1, -0.5),
        rotate(1, 0.5),
        rotate(-1, 0.5),
      ],
      shape: "polygon",
      type: "pcb_smtpad",
    } satisfies PcbSmtPad,
  ])

  expect(
    summarizeCopperComparison(rotatedRect, equivalentPolygon)
      .copperIntersectionOverUnion,
  ).toBe(1)
})

test("curved hole IoU is independent of the legacy grid-size argument", () => {
  const copper = rect("copper", 1, 1)
  const withHole = (diameter: number) =>
    circuitJsonToFootprint([
      copper,
      {
        hole_diameter: diameter,
        hole_shape: "circle",
        pcb_hole_id: `hole_${diameter}`,
        type: "pcb_hole",
        x: 2,
        y: 0,
      } satisfies PcbHole,
    ])
  const coarse = summarizeCopperComparison(withHole(1), withHole(2), 8)
  const fine = summarizeCopperComparison(withHole(1), withHole(2), 640)

  expect(coarse).toEqual(fine)
  expect(coarse.holeIntersectionOverUnion).toBeCloseTo(0.25, 6)
})
