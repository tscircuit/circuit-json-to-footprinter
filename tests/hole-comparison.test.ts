import { expect, test } from "bun:test"
import { fp } from "@tscircuit/footprinter"
import type {
  AnyCircuitElement,
  PcbHole,
  PcbPlatedHole,
  PcbSmtPad,
} from "circuit-json"
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
    hole_diameter: 0.7,
    hole_shape: "circle",
    pad_shape: "rect",
    rect_pad_height: 1.6,
    rect_pad_width: 1.6,
    shape: "circular_hole_with_rect_pad",
    type: "pcb_plated_hole",
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
    hole_ccw_rotation: 90,
    hole_height: 0.6,
    hole_offset_x: 0.1,
    hole_offset_y: -0.2,
    hole_shape: "rotated_pill",
    hole_width: 1.2,
    rect_border_radius: 0.15,
    rect_ccw_rotation: 15,
    rect_pad_height: 2,
    rect_pad_width: 3,
    shape: "rotated_pill_hole_with_rect_pad",
    type: "pcb_plated_hole",
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

test("preserves canonical Circuit JSON pad and hole types", () => {
  const smtPad: PcbSmtPad = {
    height: 1,
    layer: "top",
    pcb_smtpad_id: "pcb_smtpad_1",
    shape: "rect",
    type: "pcb_smtpad",
    width: 2,
    x: 0,
    y: 0,
  }
  const platedHole: PcbPlatedHole = {
    hole_diameter: 0.8,
    layers: ["top", "bottom"],
    outer_diameter: 1.6,
    pcb_plated_hole_id: "pcb_plated_hole_1",
    shape: "circle",
    type: "pcb_plated_hole",
    x: 3,
    y: 0,
  }
  const hole: PcbHole = {
    hole_diameter: 1,
    hole_shape: "circle",
    pcb_hole_id: "pcb_hole_1",
    type: "pcb_hole",
    x: -3,
    y: 0,
  }

  const preview = circuitJsonToPreview([smtPad, platedHole, hole])

  expect(preview.pads).toEqual([smtPad, platedHole])
  expect(preview.holes).toEqual([hole])
})

test("compares non-plated PcbHole geometry", () => {
  const smtPad: PcbSmtPad = {
    height: 1,
    layer: "top",
    pcb_smtpad_id: "pcb_smtpad_1",
    shape: "rect",
    type: "pcb_smtpad",
    width: 2,
    x: 0,
    y: 0,
  }
  const withHole = (diameter: number) =>
    circuitJsonToPreview([
      smtPad,
      {
        hole_diameter: diameter,
        hole_shape: "circle",
        pcb_hole_id: "pcb_hole_1",
        type: "pcb_hole",
        x: 3,
        y: 0,
      } satisfies PcbHole,
    ])

  const comparison = summarizeCopperComparison(withHole(1), withHole(2), 240)

  expect(comparison.copperIntersectionOverUnion).toBe(1)
  expect(comparison.holeIntersectionOverUnion).toBeCloseTo(0.25, 1)
})
