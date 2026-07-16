import { expect, test } from "bun:test"
import { fp } from "@tscircuit/footprinter"
import type { AnyCircuitElement } from "circuit-json"
import {
  circuitJsonToPreview,
  footprinterStringToPreview,
} from "../lib/circuit-json-preview.js"
import { summarizeCopperComparison } from "../lib/compare-copper.js"
import { circuitJsonToFootprinter } from "../lib/index.js"

const circuitJsonFromFootprinter = (footprinterString: string) =>
  fp.string(footprinterString).circuitJson() as AnyCircuitElement[]

test("recovers a parameterized dual-row footprint", () => {
  const result = circuitJsonToFootprinter(
    circuitJsonFromFootprinter("soic8_p1.1mm_w6.2mm_pw0.55mm_pl1.4mm"),
    { maxCandidates: 3, sourceHints: ["SOIC-8"] },
  )

  expect(result.diagnostics.topology).toBe("two-sided")
  expect(result.best?.family).toBe("soic")
  expect(result.best?.copperIntersectionOverUnion).toBeGreaterThan(0.99)
  expect(result.best?.footprinterString).toContain("p1.1mm")
  expect(result.best?.footprinterString).toContain("w6.2mm")
})

test("produces an exact passive footprint string", () => {
  const source = "res_p1.3mm_pw0.55mm_ph0.7mm"
  const result = circuitJsonToFootprinter(circuitJsonFromFootprinter(source), {
    maxCandidates: 2,
  })

  expect(result.best?.footprinterString).toBe(source)
  expect(result.best?.copperIntersectionOverUnion).toBe(1)
})

test("infers a BGA grid and continuous dimensions", () => {
  const result = circuitJsonToFootprinter(
    circuitJsonFromFootprinter("bga16_grid4x4_p0.65mm_pad0.32mm"),
    { maxCandidates: 2 },
  )

  expect(result.diagnostics.topology).toBe("grid")
  expect(result.best?.family).toBe("bga")
  expect(result.best?.footprinterString).toContain("p0.65mm")
  expect(result.best?.footprinterString).toContain("pad0.32mm")
})

test("preserves the C2040-sized thermal pad independently of the body", () => {
  const source = "qfn56_w7_h7_p0.4_pw0.2_pl0.85_thermalpad3.1mmx3.1mm"
  const result = circuitJsonToFootprinter(circuitJsonFromFootprinter(source), {
    maxCandidates: 2,
    sourceHints: ["C2040 QFN-56 exposed pad"],
  })

  expect(result.diagnostics.targetPadCount).toBe(57)
  expect(result.best?.family).toBe("qfn")
  expect(result.best?.footprinterString).toContain("thermalpad3.1mmx3.1mm")
  expect(result.best?.copperIntersectionOverUnion).toBe(1)
})

test("rejects Circuit JSON without PCB pads", () => {
  expect(() =>
    circuitJsonToFootprinter([
      { source_component_id: "source_component_0", type: "source_component" },
    ] as AnyCircuitElement[]),
  ).toThrow("at least one PCB SMT pad or plated hole")
})

test("accepts readonly Circuit JSON", () => {
  const circuitJson: readonly AnyCircuitElement[] =
    circuitJsonFromFootprinter("0402")
  const result = circuitJsonToFootprinter(circuitJson, { maxCandidates: 1 })

  expect(result.best).not.toBeNull()
})

test("compares plated-hole drill geometry separately from copper", () => {
  const smallerHole = footprinterStringToPreview(
    "pinrow2_p2.54mm_id0.7mm_od1.6mm",
  )
  const largerHole = footprinterStringToPreview(
    "pinrow2_p2.54mm_id1.1mm_od1.6mm",
  )

  expect(summarizeCopperComparison(smallerHole, smallerHole)).toEqual({
    copperIntersectionOverUnion: 1,
    holeIntersectionOverUnion: 1,
  })

  const mismatch = summarizeCopperComparison(smallerHole, largerHole)
  expect(mismatch.copperIntersectionOverUnion).toBe(1)
  expect(mismatch.holeIntersectionOverUnion).toBeLessThan(0.5)
})

test("recovers plated-hole inner diameter", () => {
  const result = circuitJsonToFootprinter(
    circuitJsonFromFootprinter("pinrow2_p2.54mm_id0.7mm_od1.6mm"),
    { maxCandidates: 3, sourceHints: ["pinrow header"] },
  )

  expect(result.best?.family).toBe("pinrow")
  expect(result.best?.footprinterString).toContain("id0.7mm")
  expect(result.best?.copperIntersectionOverUnion).toBeGreaterThan(0.99)
  expect(result.best?.holeIntersectionOverUnion).toBeGreaterThan(0.99)
  expect(result.target.pads.every((pad) => pad.hole?.width === 0.7)).toBe(true)
})

test("preserves offset and rotation for slotted plated holes", () => {
  const preview = circuitJsonToPreview([
    {
      type: "pcb_plated_hole",
      shape: "rotated_pill_hole_with_rect_pad",
      pcb_plated_hole_id: "slot_1",
      x: 2,
      y: 3,
      hole_shape: "rotated_pill",
      hole_width: 0.6,
      hole_height: 1.4,
      hole_ccw_rotation: 45,
      hole_offset_x: 0.2,
      hole_offset_y: -0.1,
      pad_shape: "rect",
      rect_pad_width: 1.5,
      rect_pad_height: 2.2,
      rect_ccw_rotation: 15,
      layers: ["top", "bottom"],
    } as AnyCircuitElement,
  ])

  expect(preview.pads[0]).toMatchObject({
    height: 2.2,
    rotation: 15,
    shape: "rect",
    width: 1.5,
    hole: {
      height: 1.4,
      offsetX: 0.2,
      offsetY: -0.1,
      rotation: 45,
      shape: "pill",
      width: 0.6,
    },
  })
})
