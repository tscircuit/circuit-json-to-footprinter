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

test("infers unequal LGA side counts and continuous dimensions", () => {
  const source = "lga14_grid4x3_p0.5mm_w3.2mm_h2.7mm_pw0.28mm_pl0.675mm"
  const result = circuitJsonToFootprinter(circuitJsonFromFootprinter(source), {
    maxCandidates: 3,
    sourceHints: ["LGA-14(2.5x3)"],
  })

  expect(result.diagnostics.topology).toBe("four-sided")
  expect(result.best?.family).toBe("lga")
  expect(result.best?.footprinterString).toMatch(/^lga/)
  expect(result.best?.copperIntersectionOverUnion).toBeGreaterThan(0.99)
}, 15_000)

test("preserves pill-shaped pads for unequal LGA side counts", () => {
  const source = "lga16_grid5x3_p0.5mm_w3.6mm_h3.6mm_pw0.28mm_pl0.8mm_pillpads"
  const result = circuitJsonToFootprinter(circuitJsonFromFootprinter(source), {
    maxCandidates: 3,
    sourceHints: ["LGA-16(3x3)"],
  })

  expect(result.best?.family).toBe("lga")
  expect(result.best?.footprinterString).toContain("lga16_grid5x3")
  expect(result.best?.footprinterString).toContain("_pillpads")
  expect(result.best?.copperIntersectionOverUnion).toBeGreaterThan(0.99)
}, 15_000)

test("recovers a two-sided LGA footprint", () => {
  const source = "lga6_grid3x0_p0.94mm_w1.74mm_pw0.64mm_pl0.57mm"
  const result = circuitJsonToFootprinter(circuitJsonFromFootprinter(source), {
    maxCandidates: 3,
    sourceHints: ["LGA-6 microphone"],
  })

  expect(result.diagnostics.topology).toBe("two-sided")
  expect(result.best?.family).toBe("lga")
  expect(result.best?.footprinterString).toContain("lga6_grid3x0")
  expect(result.best?.copperIntersectionOverUnion).toBeGreaterThan(0.99)
}, 15_000)

test("recovers a two-sided footprint with a center thermal pad", () => {
  const source = "soic8_p1.27mm_w6.2mm_pw0.55mm_pl1.4mm_thermalpad2.4x3mm"
  const result = circuitJsonToFootprinter(circuitJsonFromFootprinter(source), {
    maxCandidates: 3,
    sourceHints: ["SOIC-8 exposed pad"],
  })

  expect(result.diagnostics.topology).toBe("two-sided")
  expect(result.best?.family).toBe("soic")
  expect(result.best?.footprinterString).toContain("thermalpad2.4mmx3mm")
  expect(result.best?.copperIntersectionOverUnion).toBeGreaterThan(0.99)
})

test("swaps thermal-pad dimensions for a rotated two-sided footprint", () => {
  const source =
    "dfn8_p1.27mm_w7.6mm_pw0.574mm_pl2.038mm_thermalpad3.2x2.4mm_pillpads_pin1location(leftside,bottom)"
  const result = circuitJsonToFootprinter(circuitJsonFromFootprinter(source), {
    maxCandidates: 3,
    sourceHints: ["HTSSOP-8 exposed pad"],
  })

  expect(result.diagnostics.topology).toBe("two-sided")
  expect(result.best?.family).toBe("dfn")
  expect(result.best?.footprinterString).toContain("thermalpad3.2mmx2.4mm")
  expect(result.best?.footprinterString).toContain("_pillpads")
  expect(result.best?.copperIntersectionOverUnion).toBeGreaterThan(0.99)
})

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

test("uses oriented dimensions to recover a rotated dual-row footprint", () => {
  const source =
    "soic8_p1.27mm_w7.3604mm_pw0.5684mm_pl1.9502mm_pillpads_pin1location(leftside,bottom)"
  const result = circuitJsonToFootprinter(circuitJsonFromFootprinter(source), {
    maxCandidates: 3,
    sourceHints: ["SOIC-8"],
  })

  expect(result.best?.family).toBe("soic")
  expect(result.best?.footprinterString).toContain(
    "pin1location(leftside,bottom)",
  )
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
}, 15_000)

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
}, 15_000)

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
