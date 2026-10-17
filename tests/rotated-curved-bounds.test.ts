import { expect, test } from "bun:test"
import type { PcbSmtPad } from "circuit-json"
import {
  compareFootprints,
  type Footprint,
  getFootprintBounds,
  summarizeCopperComparison,
} from "../lib/compare.js"
import { getShapeBounds } from "../lib/footprint-geometry.js"

const circle = (
  id: string,
  x: number,
  y: number,
  radius: number,
): PcbSmtPad => ({
  layer: "top",
  pcb_smtpad_id: id,
  radius,
  shape: "circle",
  type: "pcb_smtpad",
  x,
  y,
})

const footprint = (pads: PcbSmtPad[]): Footprint => ({
  holes: [],
  pads,
  subtitle: "",
  title: "",
  vias: [],
})

test.each([45, -45, 90])(
  "equivalent circular pads compare equally after a %d degree footprint rotation",
  (rotation) => {
    const radians = (rotation * Math.PI) / 180
    const left = {
      ...footprint([circle("large", 0, 0, 1), circle("small", 4, 0, 0.5)]),
      rotation,
    }
    const right = footprint([
      circle("large", 0, 0, 1),
      circle("small", 4 * Math.cos(radians), 4 * Math.sin(radians), 0.5),
    ])
    const originalLeft = structuredClone(left)
    const originalRight = structuredClone(right)
    const comparison = compareFootprints(left, right, 32)

    expect(comparison.iou).toBe(1)
    expect(comparison.normalizedLeft.x).toBeCloseTo(
      comparison.normalizedRight.x!,
      10,
    )
    expect(comparison.normalizedLeft.y).toBeCloseTo(
      comparison.normalizedRight.y!,
      10,
    )
    expect(
      summarizeCopperComparison(left, right).copperIntersectionOverUnion,
    ).toBe(1)
    expect(left).toEqual(originalLeft)
    expect(right).toEqual(originalRight)
  },
)

test("rotated circular via copper does not shift copper or drill comparison", () => {
  const via = {
    hole_diameter: 0.4,
    layers: ["top", "bottom"] as ["top", "bottom"],
    outer_diameter: 1,
    pcb_via_id: "via",
    type: "pcb_via" as const,
    x: 4,
    y: 0,
  }
  const left: Footprint = {
    ...footprint([circle("large", 0, 0, 1)]),
    rotation: 45,
    vias: [via],
  }
  const right: Footprint = {
    ...footprint([circle("large", 0, 0, 1)]),
    vias: [{ ...via, x: 4 / Math.sqrt(2), y: 4 / Math.sqrt(2) }],
  }

  expect(summarizeCopperComparison(left, right)).toMatchObject({
    copperIntersectionOverUnion: 1,
    holeIntersectionOverUnion: 1,
  })
})

test("rotated pill bounds follow the circular ends", () => {
  const bounds = getFootprintBounds([
    {
      ccw_rotation: 45,
      height: 2,
      layer: "top",
      pcb_smtpad_id: "pill",
      radius: 1,
      shape: "rotated_pill",
      type: "pcb_smtpad",
      width: 4,
      x: 3,
      y: -2,
    },
  ])
  const extent = 1 + 1 / Math.sqrt(2)
  expect(bounds.minX).toBeCloseTo(3 - extent, 10)
  expect(bounds.maxX).toBeCloseTo(3 + extent, 10)
  expect(bounds.minY).toBeCloseTo(-2 - extent, 10)
  expect(bounds.maxY).toBeCloseTo(-2 + extent, 10)
})

test("rotated ellipse bounds use its extrema", () => {
  const bounds = getShapeBounds({
    height: 2,
    rotation: 45,
    shape: "ellipse",
    width: 4,
    x: 0,
    y: 0,
  })
  expect(bounds.width).toBeCloseTo(Math.sqrt(10), 10)
  expect(bounds.height).toBeCloseTo(Math.sqrt(10), 10)
})

test.each([0, 0.25, 1])(
  "rotated rectangle bounds account for a corner radius of %d",
  (cornerRadius) => {
    const bounds = getFootprintBounds([
      {
        ccw_rotation: 45,
        corner_radius: cornerRadius,
        height: 2,
        layer: "top",
        pcb_smtpad_id: "rounded",
        shape: "rotated_rect",
        type: "pcb_smtpad",
        width: 4,
        x: 0,
        y: 0,
      },
    ])
    const size = Math.SQRT2 * (3 - 2 * cornerRadius) + 2 * cornerRadius
    expect(bounds.width).toBeCloseTo(size, 10)
    expect(bounds.height).toBeCloseTo(size, 10)
  },
)
