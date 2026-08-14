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
    lcsc: "C25804",
    sourceHint: "0603WAF1002T5E 0603",
    pads: [
      rectPad(1, -0.753364, 0.8064754, 0.8640064),
      rectPad(2, 0.753364, 0.8064754, 0.8640064),
    ],
  },
  {
    expectedFootprinterString: "0402",
    lcsc: "C25744",
    sourceHint: "0402WGF1002TCE 0402",
    pads: [
      rectPad(1, -0.432816, 0.565658, 0.540004),
      rectPad(2, 0.432816, 0.565658, 0.540004),
    ],
  },
]

for (const { expectedFootprinterString, lcsc, pads, sourceHint } of cases) {
  test(`uses the catalog package size for JLCPCB ${lcsc}`, () => {
    const result = circuitJsonToFootprinter(pads as AnyCircuitElement[], {
      maxCandidates: 3,
      sourceHints: [`${lcsc} ${sourceHint}`],
    })

    expect(result.best?.footprinterString).toBe(expectedFootprinterString)
  })
}

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
