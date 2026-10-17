import { expect, test } from "bun:test"
import type { PcbSmtPad } from "circuit-json"
import { circuitJsonToFootprinter } from "../lib/index.js"

// Network-free reproduction of the imported PCB pad geometry for JLCPCB
// C160404 (JST SM04B-SRSS-TB(LF)(SN)). Discovery should recover the
// connector's copper and pin layout without relying on source metadata.
const c160404Pads: Extract<PcbSmtPad, { shape: "rect" }>[] = [
  {
    type: "pcb_smtpad",
    pcb_smtpad_id: "c160404_pin1",
    layer: "top",
    shape: "rect",
    port_hints: ["pin1"],
    x: -1.49987,
    y: 2.0005167,
    width: 0.5999988,
    height: 1.5500096,
  },
  {
    type: "pcb_smtpad",
    pcb_smtpad_id: "c160404_pin2",
    layer: "top",
    shape: "rect",
    port_hints: ["pin2"],
    x: -0.499872,
    y: 2.0005167,
    width: 0.5999988,
    height: 1.5500096,
  },
  {
    type: "pcb_smtpad",
    pcb_smtpad_id: "c160404_pin3",
    layer: "top",
    shape: "rect",
    port_hints: ["pin3"],
    x: 0.50038,
    y: 2.0000087,
    width: 0.5999988,
    height: 1.5500096,
  },
  {
    type: "pcb_smtpad",
    pcb_smtpad_id: "c160404_pin4",
    layer: "top",
    shape: "rect",
    port_hints: ["pin4"],
    x: 1.500378,
    y: 2.0000087,
    width: 0.5999988,
    height: 1.5500096,
  },
  {
    type: "pcb_smtpad",
    pcb_smtpad_id: "c160404_mount6",
    layer: "top",
    shape: "rect",
    port_hints: ["pin6"],
    x: -2.800096,
    y: -1.8750153,
    width: 1.1999976,
    height: 1.7999964,
  },
  {
    type: "pcb_smtpad",
    pcb_smtpad_id: "c160404_mount5",
    layer: "top",
    shape: "rect",
    port_hints: ["pin5"],
    x: 2.800096,
    y: -1.8755233,
    width: 1.1999976,
    height: 1.7999964,
  },
]

for (const rotation of [0, 90, 180, 270]) {
  test(`C160404 is discovered without source hints at ${rotation} degrees`, () => {
    const angle = (rotation * Math.PI) / 180
    const pads = c160404Pads.map((pad) => ({
      ...pad,
      x: pad.x * Math.cos(angle) - pad.y * Math.sin(angle) + 10,
      y: pad.x * Math.sin(angle) + pad.y * Math.cos(angle) - 7,
      width: rotation % 180 === 0 ? pad.width : pad.height,
      height: rotation % 180 === 0 ? pad.height : pad.width,
    }))
    const result = circuitJsonToFootprinter(pads, { maxCandidates: 5 })

    // JST and FPC definitions can represent the same copper. The source's
    // mounting-pad numbering determines which is a usable replacement.
    expect(
      result.candidates.some((candidate) => candidate.family === "jst"),
    ).toBe(true)
    expect(result.best?.copperIntersectionOverUnion).toBeGreaterThanOrEqual(
      0.99,
    )
    expect(result.best?.pinsMatch).toBe(true)
  })
}
