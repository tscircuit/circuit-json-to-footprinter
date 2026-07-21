import { expect, test } from "bun:test"
import { fp } from "@tscircuit/footprinter"
import type { AnyCircuitElement } from "circuit-json"
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

test("preserves pill-shaped pads when the footprint family supports them", () => {
  const source = "soic8_p1.1mm_w6.2mm_pw0.55mm_pl1.4mm_pillpads"
  const result = circuitJsonToFootprinter(circuitJsonFromFootprinter(source), {
    maxCandidates: 3,
    sourceHints: ["SOIC-8"],
  })

  expect(result.best?.family).toBe("soic")
  expect(result.best?.footprinterString).toContain("_pillpads")
  expect(result.best?.copperIntersectionOverUnion).toBeGreaterThan(0.99)
})

test("preserves pill-shaped pads for quad footprints", () => {
  const source =
    "qfn32_p0.5mm_w5.8mm_h5.8mm_pw0.28mm_pl0.8mm_thermalpad3.4mmx3.4mm_pillpads"
  const result = circuitJsonToFootprinter(circuitJsonFromFootprinter(source), {
    maxCandidates: 3,
    sourceHints: ["QFN-32 exposed pad"],
  })

  expect(result.best?.family).toBe("qfn")
  expect(result.best?.footprinterString).toContain("_pillpads")
  expect(result.best?.footprinterString).toContain("thermalpad3.4mmx3.4mm")
  expect(result.best?.copperIntersectionOverUnion).toBeGreaterThan(0.99)
}, 15_000)

test("produces an exact passive footprint string", () => {
  const source = "res_p1.3mm_pw0.55mm_ph0.7mm"
  const result = circuitJsonToFootprinter(circuitJsonFromFootprinter(source), {
    maxCandidates: 2,
  })

  expect(result.best?.footprinterString).toBe(source)
  expect(result.best?.copperIntersectionOverUnion).toBe(1)
})

test("encodes a rotated match in the footprinter string", () => {
  const source = "soic8_pin1location(topside,right)"
  const result = circuitJsonToFootprinter(circuitJsonFromFootprinter(source), {
    maxCandidates: 3,
    sourceHints: ["SOIC-8"],
  })

  expect(result.best?.footprinterString).toContain("pin1location(")
  expect(result.best).not.toHaveProperty("pcbRotation")
  expect(result.best?.copperIntersectionOverUnion).toBe(1)
  expect(circuitJsonFromFootprinter(result.best!.footprinterString)).toEqual(
    circuitJsonFromFootprinter(source),
  )
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
