import { expect, test } from "bun:test"
import { fp } from "@tscircuit/footprinter"
import type {
  PcbHole,
  PcbPlatedHole,
  PcbSmtPad,
  PcbSmtPadRotatedPill,
  PcbSmtPadRotatedRect,
} from "circuit-json"
import { rotateFootprint } from "../lib/discover-footprinter.js"
import {
  getPcbPadGeometry,
  getTransformedPcbHoleGeometry,
} from "../lib/footprint-geometry.js"
import {
  circuitJsonToFootprint,
  circuitJsonToFootprinter,
  footprinterStringToFootprint,
  summarizeCopperComparison,
} from "../lib/index.js"

test("compares drill geometry independently from outer copper", () => {
  const smallerHole = footprinterStringToFootprint(
    "pinrow2_p2.54mm_id0.7mm_od1.6mm",
  )
  const largerHole = footprinterStringToFootprint(
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
  const smd = footprinterStringToFootprint("0402")

  expect(summarizeCopperComparison(smd, smd)).toEqual({
    copperIntersectionOverUnion: 1,
    holeIntersectionOverUnion: 1,
  })
})

test("preserves rectangular pads and offset rotated slots", () => {
  const footprint = circuitJsonToFootprint([
    {
      hole_ccw_rotation: 90,
      hole_height: 0.6,
      hole_offset_x: 0.1,
      hole_offset_y: -0.2,
      hole_shape: "rotated_pill",
      hole_width: 1.2,
      layers: ["top", "bottom"],
      pad_shape: "rect",
      pcb_plated_hole_id: "pcb_plated_hole_1",
      rect_border_radius: 0.15,
      rect_ccw_rotation: 15,
      rect_pad_height: 2,
      rect_pad_width: 3,
      shape: "rotated_pill_hole_with_rect_pad",
      type: "pcb_plated_hole",
      x: 4,
      y: 5,
    },
  ])

  expect(footprint.pads[0]).toMatchObject({
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
  expect(getPcbPadGeometry(footprint.pads[0]).copper).toMatchObject({
    cornerRadius: 0.15,
    rotation: 15,
  })
})

test("uses canonical SMT pad corner radius fields", () => {
  const pad = {
    corner_radius: 2,
    height: 1,
    layer: "top",
    pcb_smtpad_id: "pcb_smtpad_rounded",
    shape: "rect",
    type: "pcb_smtpad",
    width: 2,
    x: 0,
    y: 0,
  } satisfies PcbSmtPad

  expect(getPcbPadGeometry(pad).copper.cornerRadius).toBe(0.5)
})

test("uses Circuit JSON rotated SMT pad types", () => {
  const rotatedRect = {
    ccw_rotation: 30,
    height: 1,
    layer: "top",
    pcb_smtpad_id: "pcb_smtpad_rotated_rect",
    shape: "rotated_rect",
    type: "pcb_smtpad",
    width: 2,
    x: 0,
    y: 0,
  } satisfies PcbSmtPadRotatedRect
  const rotatedPill = {
    ccw_rotation: 60,
    height: 1,
    layer: "top",
    pcb_smtpad_id: "pcb_smtpad_rotated_pill",
    radius: 0.5,
    shape: "rotated_pill",
    type: "pcb_smtpad",
    width: 2,
    x: 0,
    y: 0,
  } satisfies PcbSmtPadRotatedPill

  expect(getPcbPadGeometry(rotatedRect).copper.rotation).toBe(30)
  expect(getPcbPadGeometry(rotatedPill).copper.rotation).toBe(60)
})

test("uses hole dimensions when recovering inner diameter", () => {
  const source = "pinrow2_p2.54mm_id0.7mm_od1.6mm"
  const circuitJson = fp.string(source).circuitJson()
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

  const footprint = circuitJsonToFootprint([smtPad, platedHole, hole])

  expect(footprint.pads).toEqual([smtPad, platedHole])
  expect(footprint.holes).toEqual([hole])
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
    circuitJsonToFootprint([
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

test("rotates non-plated holes using their Circuit JSON shape types", () => {
  const smtPad = {
    height: 1,
    layer: "top",
    pcb_smtpad_id: "pcb_smtpad_1",
    shape: "rect",
    type: "pcb_smtpad",
    width: 1,
    x: 0,
    y: 0,
  } satisfies PcbSmtPad
  const footprint = rotateFootprint(
    {
      holes: [
        {
          hole_height: 1,
          hole_shape: "rect",
          hole_width: 2,
          pcb_hole_id: "pcb_hole_rect",
          type: "pcb_hole",
          x: 2,
          y: 0,
        },
        {
          hole_height: 1,
          hole_shape: "pill",
          hole_width: 2,
          pcb_hole_id: "pcb_hole_pill",
          type: "pcb_hole",
          x: -2,
          y: 0,
        },
      ],
      pads: [smtPad],
      subtitle: "",
      title: "",
    },
    90,
  )
  const rect = getTransformedPcbHoleGeometry(footprint.holes[0], footprint)
  const pill = getTransformedPcbHoleGeometry(footprint.holes[1], footprint)

  expect(rect).toMatchObject({
    height: 1,
    rotation: 90,
    shape: "rect",
    width: 2,
  })
  expect(pill).toMatchObject({
    rotation: 90,
    shape: "pill",
  })
})
