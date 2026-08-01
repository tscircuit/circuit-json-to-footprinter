import { expect, test } from "bun:test"
import { fp } from "@tscircuit/footprinter"
import type { AnyCircuitElement } from "circuit-json"
import {
  discoverFootprinterString,
  formatLength,
  rotateFootprint,
} from "../lib/discover-footprinter.js"
import {
  circuitJsonToFootprint,
  circuitJsonToFootprinter,
} from "../lib/index.js"

const circuitJsonFromFootprinter = (footprinterString: string) =>
  fp.string(footprinterString).circuitJson()

const rotatedCircuitJsonFromFootprinter = (
  footprinterString: string,
  rotation: 90 | 270,
  sourceHints: string[],
) => {
  return rotateFootprint(
    circuitJsonToFootprint(circuitJsonFromFootprinter(footprinterString), {
      sourceHints,
    }),
    rotation,
  )
}

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

test("infers USB-C mid-mount shell slots and locator holes", () => {
  const source =
    "usbcmidmount16_tophw0.8mm_bottomhw0.8mm_tophh1.6mm_bottomhh1.4mm_topring0.2mm_bottomring0.2mm_rowy2.174mm_ph1.3mm_pw0.3mm_powerpw0.6mm_powerx3.2mm_shellx4.3251mm_topy1.4057mm_bottomy2.7741mm_holex2.8999mm_holey0.9056mm_holed0.75mm"
  const result = circuitJsonToFootprinter(circuitJsonFromFootprinter(source), {
    maxCandidates: 3,
    sourceHints: ["TYPE-C-31-M-12"],
  })

  expect(result.best?.family).toBe("usbcmidmount")
  expect(result.best?.footprinterString).toContain("tophw0.8mm")
  expect(result.best?.footprinterString).toContain("bottomhw0.8mm")
  expect(result.best?.footprinterString).toContain("tophh1.6mm")
  expect(result.best?.footprinterString).toContain("bottomhh1.4mm")
  expect(result.best?.copperIntersectionOverUnion).toBeGreaterThan(0.99)
  expect(result.best?.holeIntersectionOverUnion).toBeGreaterThan(0.99)
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
    "dfn8_p1.27mm_w7.6mm_pw0.574mm_pl2.038mm_thermalpad3.2x2.4mm_pillpads"
  const result = discoverFootprinterString(
    rotatedCircuitJsonFromFootprinter(source, 90, ["HTSSOP-8 exposed pad"]),
    3,
  )

  expect(result.diagnostics.topology).toBe("two-sided")
  expect(result.best?.family).toBe("dfn")
  expect(result.best?.footprinterString).toContain("thermalpad3.2mmx2.4mm")
  expect(result.best?.footprinterString).toContain("_pillpads")
  expect(result.best?.copperIntersectionOverUnion).toBeGreaterThan(0.99)
})

test("uses micrometer units only for dimensions below 0.1mm", () => {
  expect(formatLength(0.05)).toBe("50um")
  expect(formatLength(0.09)).toBe("90um")
  expect(formatLength(0.1)).toBe("0.1mm")
  expect(formatLength(0.55)).toBe("0.55mm")
  expect(formatLength(1.3)).toBe("1.3mm")
})

test("rounds general dimensions to the nearest 10 micrometers", () => {
  expect(formatLength(0.054)).toBe("50um")
  expect(formatLength(0.056)).toBe("60um")
  expect(formatLength(0.554)).toBe("0.55mm")
  expect(formatLength(0.706)).toBe("0.71mm")
  expect(formatLength(1.304)).toBe("1.3mm")
})

test("encodes a rotated match in the footprinter string", () => {
  const source = "soic8_pin1location(topside,right)"
  const result = discoverFootprinterString(
    rotatedCircuitJsonFromFootprinter("soic8", 270, ["SOIC-8"]),
    3,
  )

  expect(result.best?.footprinterString).toContain("pin1location(")
  expect(result.best).not.toHaveProperty("pcbRotation")
  expect(result.best?.copperIntersectionOverUnion).toBe(1)
  expect(circuitJsonFromFootprinter(result.best!.footprinterString)).toEqual(
    circuitJsonFromFootprinter(source),
  )
})

test("uses oriented dimensions to recover a rotated dual-row footprint", () => {
  const source = "soic8_p1.27mm_w7.3604mm_pw0.5684mm_pl1.9502mm_pillpads"
  const result = discoverFootprinterString(
    rotatedCircuitJsonFromFootprinter(source, 90, ["SOIC-8"]),
    3,
  )

  expect(result.best?.family).toBe("soic")
  expect(result.best?.footprinterString).toContain(
    "pin1location(leftside,bottom)",
  )
  expect(result.best?.copperIntersectionOverUnion).toBeGreaterThan(0.997)
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
  ).toThrow("at least one PcbSmtPad or PcbPlatedHole")
})

test("accepts readonly Circuit JSON", () => {
  const circuitJson: readonly AnyCircuitElement[] =
    circuitJsonFromFootprinter("0402")
  const result = circuitJsonToFootprinter(circuitJson, { maxCandidates: 1 })

  expect(result.best).not.toBeNull()
})
