import { expect, test } from "bun:test"
import type { AnyCircuitElement, PcbSmtPad } from "circuit-json"
import { circuitJsonToFootprinter } from "../lib/index.js"

const rectPad = (
  pin: number,
  x: number,
  y: number,
  width: number,
  height: number,
): PcbSmtPad => ({
  type: "pcb_smtpad",
  pcb_smtpad_id: `pad_${pin}`,
  layer: "top",
  shape: "rect",
  port_hints: [`pin${pin}`],
  x,
  y,
  width,
  height,
})

const cases: Array<{
  expectedFamily: "d2pak" | "dpak"
  jlcpcbPartNumber: string
  pads: PcbSmtPad[]
  sourceHint: string
}> = [
  {
    expectedFamily: "dpak",
    jlcpcbPartNumber: "C347278",
    sourceHint: "A_78M05 TO-252",
    pads: [
      rectPad(1, 4.2240454, -2.290064, 2.999994, 1.5999968),
      rectPad(3, 4.2240454, 2.290064, 2.999994, 1.5999968),
      rectPad(2, -2.6240486, 0, 6.1999876, 5.7999884),
    ],
  },
  {
    expectedFamily: "d2pak",
    jlcpcbPartNumber: "C410926",
    sourceHint: "CRSS042N10N TO-263",
    pads: [
      rectPad(2, 3.8874192, 0, 8.3799934, 10.700004),
      rectPad(3, -6.3254128, -2.539746, 3.5040062, 1.499997),
      rectPad(1, -6.3254128, 2.540254, 3.5040062, 1.499997),
    ],
  },
  {
    expectedFamily: "dpak",
    jlcpcbPartNumber: "C73013",
    sourceHint: "XL7015E1 TO-252-5",
    pads: [
      rectPad(6, 2.5407239, 0, 6.2103, 6.2103),
      rectPad(1, -4.5458761, 2.54, 2.1999956, 0.8255),
      rectPad(2, -4.5458761, 1.27, 2.1999956, 0.8255),
      rectPad(3, -4.5458761, 0, 2.1999956, 0.8255),
      rectPad(4, -4.5458761, -1.27, 2.1999956, 0.8255),
      rectPad(5, -4.5458761, -2.54, 2.1999956, 0.8255),
    ],
  },
  {
    expectedFamily: "d2pak",
    jlcpcbPartNumber: "C347421",
    sourceHint: "LM2596S-5.0 TO-263-5",
    pads: [
      rectPad(1, 6.5141602, -3.400044, 3.0828234, 1.0199878),
      rectPad(2, 6.5141602, -1.700022, 3.0828234, 1.0199878),
      rectPad(3, 6.5141602, 0, 3.0828234, 1.0199878),
      rectPad(4, 6.5141602, 1.700022, 3.0828234, 1.0199878),
      rectPad(5, 6.5141602, 3.400044, 3.0828234, 1.0199878),
      rectPad(6, -3.8055804, 0, 8.499983, 10.999978),
    ],
  },
  {
    expectedFamily: "dpak",
    jlcpcbPartNumber: "C908747",
    sourceHint: "SB1045L TO-277",
    pads: [
      rectPad(2, -1.17859175, 0, 4.6999906, 3.2999934),
      rectPad(3, 2.92858825, -0.919988, 1.1999976, 1.0999978),
      rectPad(1, 2.92858825, 0.919988, 1.1999976, 1.0999978),
    ],
  },
]

for (const { expectedFamily, jlcpcbPartNumber, pads, sourceHint } of cases) {
  test(`recovers ${jlcpcbPartNumber} as ${expectedFamily}`, () => {
    const result = circuitJsonToFootprinter(pads as AnyCircuitElement[], {
      maxCandidates: 3,
      sourceHints: [`${jlcpcbPartNumber} ${sourceHint}`],
    })

    expect(result.best?.family).toBe(expectedFamily)
    expect(result.best?.footprinterString).toContain("tabw")
    expect(result.best?.footprinterString).toContain("tabh")
    expect(result.best?.footprinterString).toContain("span")
    expect(result.best?.copperIntersectionOverUnion).toBeGreaterThanOrEqual(
      0.99,
    )
  })
}
