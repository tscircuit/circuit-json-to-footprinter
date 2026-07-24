import { expect, test } from "bun:test"
import { fp } from "@tscircuit/footprinter"
import type { AnyCircuitElement } from "circuit-json"
import {
  circuitJsonToFootprinter,
  circuitJsonToPreview,
  footprinterStringToPreview,
  summarizeCopperComparison,
} from "../lib/index.js"

test("compares drill geometry independently from outer copper", () => {
  const smallerHole = footprinterStringToPreview(
    "pinrow2_p2.54mm_id0.7mm_od1.6mm",
  )
  const largerHole = footprinterStringToPreview(
    "pinrow2_p2.54mm_id1.1mm_od1.6mm",
  )

  expect(smallerHole.pads[0]).toMatchObject({
    height: 1.6,
    hole: {
      height: 0.7,
      shape: "circle",
      width: 0.7,
    },
    width: 1.6,
  })

  const comparison = summarizeCopperComparison(smallerHole, largerHole)
  expect(comparison.copperIntersectionOverUnion).toBe(1)
  expect(comparison.holeIntersectionOverUnion).toBeLessThan(0.5)
})

test("reports perfect hole IoU when neither footprint has holes", () => {
  const smd = footprinterStringToPreview("0402")

  expect(summarizeCopperComparison(smd, smd)).toEqual({
    copperIntersectionOverUnion: 1,
    holeIntersectionOverUnion: 1,
  })
})

test("preserves rectangular pads and offset rotated slots", () => {
  const preview = circuitJsonToPreview([
    {
      hole_ccw_rotation: 90,
      hole_height: 0.6,
      hole_offset_x: 0.1,
      hole_offset_y: -0.2,
      hole_shape: "rotated_pill",
      hole_width: 1.2,
      layers: ["top", "bottom"],
      pcb_plated_hole_id: "pcb_plated_hole_1",
      rect_border_radius: 0.15,
      rect_ccw_rotation: 15,
      rect_pad_height: 2,
      rect_pad_width: 3,
      shape: "rotated_pill_hole_with_rect_pad",
      type: "pcb_plated_hole",
      x: 4,
      y: 5,
    } as AnyCircuitElement,
  ])

  expect(preview.pads[0]).toMatchObject({
    cornerRadius: 0.15,
    height: 2,
    hole: {
      height: 0.6,
      offsetX: 0.1,
      offsetY: -0.2,
      rotation: 90,
      shape: "pill",
      width: 1.2,
    },
    rotation: 15,
    shape: "rect",
    width: 3,
    x: 4,
    y: 5,
  })
})

test("uses hole dimensions when recovering inner diameter", () => {
  const source = "pinrow2_p2.54mm_id0.7mm_od1.6mm"
  const circuitJson = fp.string(source).circuitJson() as AnyCircuitElement[]
  const result = circuitJsonToFootprinter(circuitJson, { maxCandidates: 3 })

  expect(result.best?.footprinterString).toContain("id0.7mm")
  expect(result.best?.holeIntersectionOverUnion).toBeGreaterThan(0.98)
})
