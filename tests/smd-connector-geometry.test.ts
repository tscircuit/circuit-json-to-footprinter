import { expect, test } from "bun:test"
import type { PcbSmtPad } from "circuit-json"
import { circuitJsonToFootprinter } from "../lib/index.js"

type RectPad = Extract<PcbSmtPad, { shape: "rect" }>

const pad = (
  pin: number,
  x: number,
  y: number,
  width: number,
  height: number,
): RectPad => ({
  type: "pcb_smtpad",
  pcb_smtpad_id: `pad_${pin}`,
  shape: "rect",
  layer: "top",
  port_hints: [`pin${pin}`],
  x,
  y,
  width,
  height,
})

for (const pinCount of [2, 3, 4, 8, 12]) {
  for (const sourceHints of [[], ["JST"], ["FPC", "SMD,P=0.75mm"]]) {
    test(`fits ${pinCount} contacts with narrow mounting pads and hints ${JSON.stringify(sourceHints)}`, () => {
      const pitch = 0.75
      const halfSpan = ((pinCount - 1) * pitch) / 2
      // Mounting pads need not be wider than contacts, and their row separation
      // need not exceed half the sum of the two pad lengths.
      const pads = [
        ...Array.from({ length: pinCount }, (_, index) =>
          pad(index + 1, index * pitch - halfSpan, 1, 0.4, 1.25),
        ),
        pad(pinCount + 2, -halfSpan - 1, -0.5, 0.3, 2),
        pad(pinCount + 1, halfSpan + 1, -0.5, 0.3, 2),
      ]
      const result = circuitJsonToFootprinter(pads, { sourceHints })

      expect(result.best?.copperIntersectionOverUnion).toBeGreaterThanOrEqual(
        0.99,
      )
      expect(result.best?.pinsMatch).toBe(true)
    })
  }
}

for (const signalCount of [2, 3]) {
  test(`does not treat a ${signalCount}+2 contact layout as a row with retention pads`, () => {
    const halfSpan = ((signalCount - 1) * 0.95) / 2
    const pads = [
      ...Array.from({ length: signalCount }, (_, index) =>
        pad(index + 1, index * 0.95 - halfSpan, 1.1, 0.6, 1),
      ),
      pad(signalCount + 1, -halfSpan - 0.00025, -1.1, 0.6, 1),
      pad(signalCount + 2, halfSpan + 0.00025, -1.1, 0.6, 1),
    ]
    const result = circuitJsonToFootprinter(pads)

    expect(
      result.candidates.some(
        (candidate) =>
          candidate.family === "jst" &&
          candidate.copperIntersectionOverUnion >= 0.99,
      ),
    ).toBe(false)
  })
}
