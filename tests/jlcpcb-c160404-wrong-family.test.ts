import { expect, test } from "bun:test"
import type { PcbSmtPad } from "circuit-json"
import { circuitJsonToFootprinter } from "../lib/index.js"

// Network-free reproduction of the imported PCB pad geometry for JLCPCB
// C160404 (JST SM04B-SRSS-TB(LF)(SN)). Discovery should recognize this as a
// JST connector from geometry alone, without relying on source metadata.
const c160404Pads: PcbSmtPad[] = [
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

test.failing("C160404 is discovered as a JST connector without source hints", () => {
  const result = circuitJsonToFootprinter(c160404Pads, { maxCandidates: 5 })

  expect(result.best?.family).toBe("jst")
  expect(result.best?.footprinterString).toStartWith("jst4_smd")
  expect(result.best?.copperIntersectionOverUnion).toBeGreaterThanOrEqual(0.99)
})
