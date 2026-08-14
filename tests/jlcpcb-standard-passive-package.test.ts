import { expect, test } from "bun:test"
import type { AnyCircuitElement, PcbSmtPad } from "circuit-json"
import { circuitJsonToFootprinter } from "../lib/index.js"

const rectPad = (
  pin: number,
  x: number,
  width: number,
  height: number,
): PcbSmtPad => ({
  type: "pcb_smtpad",
  pcb_smtpad_id: `pad_${pin}`,
  layer: "top",
  shape: "rect",
  port_hints: [`pin${pin}`],
  x,
  y: 0,
  width,
  height,
})

const cases = [
  {
    expectedFootprinterString: "0603",
    name: "0603 within tolerance",
    sourceHint: "0603",
    pads: [rectPad(1, -0.82, 0.8, 0.95), rectPad(2, 0.82, 0.8, 0.95)],
  },
  {
    expectedFootprinterString: "0402",
    name: "0402 within tolerance",
    sourceHint: "0402",
    pads: [rectPad(1, -0.505, 0.54, 0.64), rectPad(2, 0.505, 0.54, 0.64)],
  },
]

for (const { expectedFootprinterString, name, pads, sourceHint } of cases) {
  test(`uses the catalog package size for ${name}`, () => {
    const result = circuitJsonToFootprinter(pads as AnyCircuitElement[], {
      maxCandidates: 3,
      sourceHints: [sourceHint],
    })

    expect(result.best?.footprinterString).toBe(expectedFootprinterString)
    expect(result.best?.copperIntersectionOverUnion).toBeGreaterThanOrEqual(
      0.95,
    )
  })
}

test("does not prefer a hinted package below the copper IoU tolerance", () => {
  const result = circuitJsonToFootprinter(
    [
      rectPad(1, -0.753364, 0.8064754, 0.8640064),
      rectPad(2, 0.753364, 0.8064754, 0.8640064),
    ] as AnyCircuitElement[],
    {
      maxCandidates: 10,
      sourceHints: ["C25804 0603WAF1002T5E 0603"],
    },
  )

  const canonicalCandidate = result.candidates.find(
    ({ footprinterString }) => footprinterString === "0603",
  )
  expect(canonicalCandidate?.copperIntersectionOverUnion).toBeLessThan(0.95)
  expect(result.best?.footprinterString).toStartWith("res_p")
})

test("does not prefer a package size without an explicit hint", () => {
  const result = circuitJsonToFootprinter(
    [
      rectPad(1, -0.753364, 0.8064754, 0.8640064),
      rectPad(2, 0.753364, 0.8064754, 0.8640064),
    ] as AnyCircuitElement[],
    { maxCandidates: 1 },
  )

  expect(result.best?.footprinterString).toStartWith("res_p")
})
