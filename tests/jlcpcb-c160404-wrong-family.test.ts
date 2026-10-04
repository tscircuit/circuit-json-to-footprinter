import { expect, test } from "bun:test"
import type { PcbSmtPad } from "circuit-json"
import { circuitJsonToFootprinter } from "../lib/index.js"

// Network-free reproduction of the imported PCB pad geometry for JLCPCB
// C160404 (JST SM04B-SRSS-TB(LF)(SN)). With no source metadata, discovery
// incorrectly classifies this four-pin connector as an LED footprint.
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

test("C160404 without source hints is incorrectly discovered as an LED", () => {
  const result = circuitJsonToFootprinter(c160404Pads, { maxCandidates: 5 })

  expect(result.best?.family).toBe("led5050")
  expect(result.best?.footprinterString).toBe(
    "led5050_pin1location(rightside,bottom)",
  )
  expect(result.best?.copperIntersectionOverUnion).toBeLessThan(0.2)
})
