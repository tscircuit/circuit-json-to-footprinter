import { expect, test } from "bun:test"
import type { AnyCircuitElement, PcbSmtPad } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import {
  circuitJsonToFootprint,
  circuitJsonToFootprinter,
  footprinterStringToFootprint,
  summarizeCopperComparison,
} from "../lib/index.js"

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

const cases = [
  {
    expectedFootprinterString:
      "smtpadpair_px2.1mm_p1w2mm_p2w1.2mm_ph1mm",
    lcsc: "C2843791",
    sourceHints: ["XL-3014UWC-02", "SMD3014-2P"],
    pads: [
      rectPad(1, -0.8500364, 0, 1.999996, 0.999998),
      rectPad(2, 1.2500356, 0, 1.1999976, 0.999998),
    ],
  },
  {
    expectedFootprinterString:
      "smtpadpair_px13.45mm_py-2.54mm_pw2.5mm_ph2.55mm",
    lcsc: "C41430893",
    sourceHints: ["CPG151101S11-16", "SMD,14.5x5.9mm"],
    pads: [
      rectPad(1, -6.724904, 1.27, 2.499995, 2.5500076),
      rectPad(2, 6.724904, -1.27, 2.499995, 2.5500076),
    ],
  },
]

for (const { expectedFootprinterString, lcsc, pads, sourceHints } of cases) {
  test(`recovers ${lcsc} as an SMT pad pair`, () => {
    const circuitJson = pads as AnyCircuitElement[]
    const result = circuitJsonToFootprinter(circuitJson, {
      maxCandidates: 3,
      sourceHints: [lcsc, ...sourceHints],
    })

    expect(result.best?.family).toBe("smtpadpair")
    expect(result.best?.footprinterString).toBe(expectedFootprinterString)

    const recovered = footprinterStringToFootprint(
      result.best!.footprinterString,
    )
    const target = circuitJsonToFootprint(circuitJson)
    expect(
      summarizeCopperComparison(recovered, target).copperIntersectionOverUnion,
    ).toBeGreaterThanOrEqual(0.99)
    expect(convertCircuitJsonToPcbSvg(recovered.pads)).toMatchSvgSnapshot(
      import.meta.path,
      lcsc,
    )
  })
}
