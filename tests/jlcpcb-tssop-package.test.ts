import { expect, test } from "bun:test"
import { fp } from "@tscircuit/footprinter"
import type { AnyCircuitElement } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import {
  circuitJsonToFootprinter,
  footprinterStringToFootprint,
} from "../lib/index.js"
import fixtures from "./fixture/tssop-pads.json"

// Unmodified pad coordinates/shapes from tscircuit/jlc5000 at 51a72b16:
// SN74LVCC3245APWR, STM8S003F3P6TR, and DRV8803PWPR respectively.
const cases = [
  { part: "C14347", hint: "TSSOP-24", pins: 24, minIoU: 0.999 },
  { part: "C52717", hint: "TSSOP-20", pins: 20, minIoU: 0.999 },
  { part: "C114177", hint: "HTSSOP-16-EP", pins: 16, minIoU: 0.997 },
] as const

for (const { part, hint, pins, minIoU } of cases) {
  test(`recovers ${part} as ${hint} without losing copper or pin information`, () => {
    const target = fixtures[part] as AnyCircuitElement[]
    const result = circuitJsonToFootprinter(target, { sourceHints: [hint] })
    const best = result.best!
    expect(best.family).toBe("tssop")
    expect(best.copperIntersectionOverUnion).toBeGreaterThan(minIoU)
    // The numbered EP in the JLC import is not Footprinter's "thermalpad".
    // Keep reporting that mismatch rather than weakening pin validation.
    expect(best.pinMatchRate).toBe(part === "C114177" ? 16 / 17 : 1)
    expect(best.pinsMatch).toBe(part !== "C114177")
    const parsed = fp
      .string(best.footprinterString)
      .json() as unknown as Record<string, unknown>
    expect(parsed.fn).toBe("tssop")
    expect(parsed.num_pins).toBe(pins)
    expect(parsed.rounded).toBe(
      part === "C14347" ? 0 : part === "C52717" ? 0.182 : 0.1715,
    )
    if (part === "C114177") {
      expect(parsed.thermalpad).toEqual({ x: 2.115, y: 3.04 })
    }
    const recovered = footprinterStringToFootprint(best.footprinterString)
    const shifted = [
      ...target.map((pad) => ({ ...pad, x: (pad as any).x - 7 })),
      ...recovered.pads.map((pad) => ({
        ...pad,
        x: ("x" in pad ? pad.x : 0) + 7,
      })),
    ] as AnyCircuitElement[]
    const svg = convertCircuitJsonToPcbSvg(shifted).replace(
      "</svg>",
      `<text x="25%" y="12%" text-anchor="middle" fill="white" font-size="18">${part}: imported pads</text><text x="75%" y="12%" text-anchor="middle" fill="white" font-size="18">${hint}: recovered pads</text></svg>`,
    )
    expect(svg).toMatchSvgSnapshot(import.meta.path, part)
  })
}

for (const hint of [
  undefined,
  "SSOP-24",
  "VTSSOP24",
  "TSSOP-20",
  "TSSOP-24 DFN-24",
  "TSSOP-24 (SOT-363)",
]) {
  test(`does not infer TSSOP from absent, conflicting, or unrelated hint ${hint}`, () => {
    const options = { sourceHints: hint ? [hint] : [] }
    const result = circuitJsonToFootprinter(
      fixtures.C14347 as AnyCircuitElement[],
      options,
    )
    expect(result.best?.family).not.toBe("tssop")
  })
}

test("a TSSOP hint cannot override incompatible copper topology", () => {
  const pads = fp.string("qfn24").circuitJson() as AnyCircuitElement[]
  const result = circuitJsonToFootprinter(pads, { sourceHints: ["TSSOP-24"] })
  expect(result.best?.family).not.toBe("tssop")
  expect(result.best?.copperIntersectionOverUnion).toBeGreaterThan(0.99)
})

test("preserves fine-pitch TSSOP spacing and explicit square pad corners", () => {
  const target = fp
    .string("tssop10_p0.5mm_w3mm_pw0.25mm_pl1.2mm_rounded0mm")
    .circuitJson()
  const result = circuitJsonToFootprinter(target, { sourceHints: ["tssop10"] })
  expect(result.best?.family).toBe("tssop")
  expect(result.best?.copperIntersectionOverUnion).toBeGreaterThan(0.999)
  expect(result.best?.pinsMatch).toBe(true)
})
