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
    expectedFootprinterString: "0603_rounded0mm",
    name: "0603 within tolerance",
    sourceHint: "0603",
    pads: [rectPad(1, -0.82, 0.8, 0.95), rectPad(2, 0.82, 0.8, 0.95)],
  },
  {
    expectedFootprinterString: "0402_rounded0mm",
    name: "0402 within tolerance",
    sourceHint: "0402",
    pads: [rectPad(1, -0.505, 0.54, 0.64), rectPad(2, 0.505, 0.54, 0.64)],
  },
  {
    expectedFootprinterString: "0805_rounded0mm",
    name: "0805 within tolerance",
    sourceHint: "0805",
    pads: [rectPad(1, -0.9075, 1.025, 1.4), rectPad(2, 0.9075, 1.025, 1.4)],
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
      0.96,
    )
  })
}

for (const { expectedFamily, sourceHint } of [
  { expectedFamily: "res", sourceHint: "0402 resistor" },
  { expectedFamily: "cap", sourceHint: "0402 capacitor" },
]) {
  test(`uses the ${expectedFamily} package family for an explicit type hint`, () => {
    const result = circuitJsonToFootprinter(
      [
        rectPad(1, -0.505, 0.54, 0.64),
        rectPad(2, 0.505, 0.54, 0.64),
      ] as AnyCircuitElement[],
      { maxCandidates: 3, sourceHints: [sourceHint] },
    )

    expect(result.best?.family).toBe(expectedFamily)
    expect(result.best?.footprinterString).toStartWith(`${expectedFamily}0402`)
    expect(result.best?.copperIntersectionOverUnion).toBeGreaterThanOrEqual(
      0.96,
    )
  })
}

test("keeps conflicting passive type hints neutral", () => {
  const result = circuitJsonToFootprinter(
    [
      rectPad(1, -0.505, 0.54, 0.64),
      rectPad(2, 0.505, 0.54, 0.64),
    ] as AnyCircuitElement[],
    { maxCandidates: 3, sourceHints: ["0402 resistor capacitor"] },
  )

  expect(result.best?.family).toBe("passive")
  expect(result.best?.footprinterString).toStartWith("0402")
})

test("uses a neutral passive definition when a package hint is below tolerance", () => {
  const result = circuitJsonToFootprinter(
    [
      rectPad(1, -0.805, 0.8, 0.95),
      rectPad(2, 0.805, 0.8, 0.95),
    ] as AnyCircuitElement[],
    { maxCandidates: 10, sourceHints: ["0603"] },
  )

  expect(result.best?.family).toBe("passive")
  expect(result.best?.footprinterString).toStartWith("smdpads2_")
  expect(result.best?.footprinterString).not.toContain("_rounded0mm")
})

test("does not imply a resistor for a mismatched hinted package", () => {
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

  expect(result.best?.family).toBe("passive")
  expect(result.best?.footprinterString).toStartWith("smdpads2_")
  expect(result.best?.footprinterString).not.toContain("_rounded0mm")
})

test("uses the neutral passive definition without an explicit package hint", () => {
  const result = circuitJsonToFootprinter(
    [
      rectPad(1, -0.753364, 0.8064754, 0.8640064),
      rectPad(2, 0.753364, 0.8064754, 0.8640064),
    ] as AnyCircuitElement[],
    { maxCandidates: 1 },
  )

  expect(result.best?.family).toBe("passive")
  expect(result.best?.footprinterString).toStartWith("smdpads2_")
  expect(result.best?.footprinterString).not.toContain("_rounded0mm")
})
