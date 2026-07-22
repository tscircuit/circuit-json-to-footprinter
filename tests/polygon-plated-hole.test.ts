import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import {
  circuitJsonToPreview,
  getFootprintBounds,
  summarizeCopperComparison,
} from "../lib/index.js"

const polygonPlatedHole = (
  overrides: Record<string, unknown> = {},
): AnyCircuitElement =>
  ({
    hole_diameter: 0.8,
    hole_offset_x: 0.5,
    hole_offset_y: -0.25,
    hole_shape: "circle",
    layers: ["top", "bottom"],
    pad_outline: [
      { x: -2, y: -1 },
      { x: 3, y: -1 },
      { x: 3, y: 1 },
      { x: 0, y: 2 },
      { x: -2, y: 1 },
    ],
    pcb_plated_hole_id: "pcb_plated_hole_polygon",
    port_hints: ["1"],
    shape: "hole_with_polygon_pad",
    type: "pcb_plated_hole",
    x: 10,
    y: 20,
    ...overrides,
  }) as AnyCircuitElement

test("preserves a polygon plated pad and its offset circular hole", () => {
  const preview = circuitJsonToPreview([polygonPlatedHole()])

  expect(preview.pads[0]).toEqual({
    height: 3,
    hole: {
      height: 0.8,
      offsetX: 0.5,
      offsetY: -0.25,
      rotation: 0,
      shape: "circle",
      width: 0.8,
    },
    id: "pcb_plated_hole_polygon",
    kind: "plated-hole",
    layer: "top",
    points: [
      { x: -2, y: -1 },
      { x: 3, y: -1 },
      { x: 3, y: 1 },
      { x: 0, y: 2 },
      { x: -2, y: 1 },
    ],
    portHints: ["pin1"],
    rotation: 0,
    shape: "polygon",
    width: 5,
    x: 10,
    y: 20,
  })
  expect(getFootprintBounds(preview.pads)).toEqual({
    height: 3,
    maxX: 13,
    maxY: 22,
    minX: 8,
    minY: 19,
    width: 5,
  })

  const polygonPad = preview.pads[0]
  if (polygonPad.shape !== "polygon") {
    throw new Error("Expected a polygon preview pad")
  }
  const rotatedBounds = getFootprintBounds([{ ...polygonPad, rotation: 90 }])
  expect(rotatedBounds.minX).toBeCloseTo(8)
  expect(rotatedBounds.maxX).toBeCloseTo(11)
  expect(rotatedBounds.minY).toBeCloseTo(18)
  expect(rotatedBounds.maxY).toBeCloseTo(23)
  expect(rotatedBounds.width).toBeCloseTo(3)
  expect(rotatedBounds.height).toBeCloseTo(5)
})

test("preserves rotated pill holes inside polygon pads", () => {
  const rotated = circuitJsonToPreview([
    polygonPlatedHole({
      ccw_rotation: 37,
      hole_diameter: undefined,
      hole_height: 2.4,
      hole_offset_x: -0.2,
      hole_offset_y: 0.3,
      hole_shape: "rotated_pill",
      hole_width: 1.2,
    }),
  ])

  expect(rotated.pads[0].hole).toEqual({
    height: 2.4,
    offsetX: -0.2,
    offsetY: 0.3,
    rotation: 37,
    shape: "pill",
    width: 1.2,
  })

  const unrotated = circuitJsonToPreview([
    polygonPlatedHole({
      hole_diameter: undefined,
      hole_height: 2.4,
      hole_offset_x: -0.2,
      hole_offset_y: 0.3,
      hole_shape: "pill",
      hole_width: 1.2,
    }),
  ])
  expect(
    summarizeCopperComparison(rotated, unrotated, 240)
      .holeIntersectionOverUnion,
  ).toBeLessThan(1)
})

test("compares polygon copper independently from its hole", () => {
  const square = circuitJsonToPreview([
    polygonPlatedHole({
      hole_offset_x: 0,
      hole_offset_y: 0,
      pad_outline: [
        { x: -1, y: -1 },
        { x: 1, y: -1 },
        { x: 1, y: 1 },
        { x: -1, y: 1 },
      ],
      x: 0,
      y: 0,
    }),
  ])
  const triangle = circuitJsonToPreview([
    polygonPlatedHole({
      hole_offset_x: 0,
      hole_offset_y: 0,
      pad_outline: [
        { x: -1, y: -1 },
        { x: 1, y: -1 },
        { x: 0, y: 1 },
      ],
      x: 0,
      y: 0,
    }),
  ])

  const comparison = summarizeCopperComparison(square, triangle, 240)
  expect(comparison.copperIntersectionOverUnion).toBeCloseTo(0.5, 2)
  expect(comparison.holeIntersectionOverUnion).toBe(1)
})

test("distinguishes oval holes from pill-shaped holes", () => {
  const oval = circuitJsonToPreview([
    polygonPlatedHole({
      hole_diameter: undefined,
      hole_height: 1,
      hole_offset_x: 0,
      hole_offset_y: 0,
      hole_shape: "oval",
      hole_width: 2,
    }),
  ])
  const pill = circuitJsonToPreview([
    polygonPlatedHole({
      hole_diameter: undefined,
      hole_height: 1,
      hole_offset_x: 0,
      hole_offset_y: 0,
      hole_shape: "pill",
      hole_width: 2,
    }),
  ])

  expect(oval.pads[0].hole?.shape).toBe("oval")
  expect(pill.pads[0].hole?.shape).toBe("pill")
  const comparison = summarizeCopperComparison(oval, pill, 240)
  expect(comparison.copperIntersectionOverUnion).toBe(1)
  expect(comparison.holeIntersectionOverUnion).toBeLessThan(1)
})

test("rejects malformed polygon plated-pad outlines", () => {
  expect(() =>
    circuitJsonToPreview([
      polygonPlatedHole({
        pad_outline: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
      }),
    ]),
  ).toThrow("at least three points")

  expect(() =>
    circuitJsonToPreview([
      polygonPlatedHole({
        pad_outline: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 2, y: 0 },
        ],
      }),
    ]),
  ).toThrow("non-zero area")
})

test("rejects missing drill dimensions instead of silently dropping the hole", () => {
  expect(() =>
    circuitJsonToPreview([
      polygonPlatedHole({
        hole_diameter: undefined,
        hole_shape: "circle",
      }),
    ]),
  ).toThrow("positive hole_diameter")

  expect(() =>
    circuitJsonToPreview([
      polygonPlatedHole({
        hole_diameter: undefined,
        hole_height: 1,
        hole_shape: "pill",
        hole_width: undefined,
      }),
    ]),
  ).toThrow("positive hole_width")
})
