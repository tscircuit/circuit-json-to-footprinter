import { expect, test } from "bun:test"
import { fp } from "@tscircuit/footprinter"
import type { PcbSmtPad } from "circuit-json"
import { circuitJsonToFootprinter } from "../lib/index.js"

const pads = (pitch: number, width: number, height: number): PcbSmtPad[] =>
  [1, 2].map((pin) => ({
    type: "pcb_smtpad",
    pcb_smtpad_id: `pad_${pin}`,
    layer: "top",
    shape: "rect",
    port_hints: [`pin${pin}`],
    x: (pin === 1 ? -1 : 1) * (pitch / 2),
    y: 0,
    width,
    height,
  }))

test("maps an explicit X1-SON-2 package hint to a dimensioned DFN2", () => {
  for (const [packageName, circuitJson] of [
    ["X1-SON-2(0.6x1)", pads(1, 0.6, 0.6)],
    ["X2-SON-2(0.6x1)", pads(0.65, 0.4, 0.6)],
  ] as const) {
    const result = circuitJsonToFootprinter(circuitJson, {
      maxCandidates: 1,
      sourceHints: [packageName],
    })

    expect(result.best?.family).toBe("dfn")
    expect(result.best?.copperIntersectionOverUnion).toBeGreaterThan(0.9999)
    expect(result.best?.pinsMatch).toBe(true)
    const footprint = result.best!.footprinterString
    const parsed = fp.string(footprint).json() as unknown as {
      fn: string
      bodywidth: number
      bodylength: number
      bodythickness: number
      standoff: number
    }
    expect(parsed.fn).toBe("dfn")
    expect(parsed.bodywidth).toBe(1)
    expect(parsed.bodylength).toBe(0.6)
    expect(parsed.bodythickness).toBe(0.35)
    expect(parsed.standoff).toBe(0.025)
  }
})

test("keeps ambiguous two-pad and part-number-only inputs generic", () => {
  for (const sourceHints of [[], ["TPD1E10B06DPYR"], ["X1-SON-3"]]) {
    const result = circuitJsonToFootprinter(pads(1, 0.6, 0.6), {
      maxCandidates: 1,
      sourceHints,
    })
    expect(result.best?.family).not.toBe("dfn")
    expect(result.best?.footprinterString).toStartWith("smdpads2_")
  }
})
