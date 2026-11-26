import { expect, test } from "bun:test"
import type { AnyCircuitElement, PcbSmtPad } from "circuit-json"
import { circuitJsonToFootprint } from "../lib/index.js"

const pad = (id: string, x: number): PcbSmtPad => ({
  height: 0.8,
  layer: "top",
  pcb_component_id: "pcb_component_1",
  pcb_smtpad_id: id,
  shape: "rect",
  type: "pcb_smtpad",
  width: 0.8,
  x,
  y: 0,
})

test("recognizes rectangular courtyard outlines with collinear vertices", () => {
  const courtyard = {
    type: "pcb_courtyard_outline",
    pcb_component_id: "pcb_component_1",
    pcb_courtyard_outline_id: "pcb_courtyard_outline_1",
    layer: "top",
    outline: [
      { x: -2, y: -1 },
      { x: 0, y: -1 },
      { x: 2, y: -1 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 0, y: 1 },
      { x: -2, y: 1 },
      { x: -2, y: 0 },
      { x: -2, y: -1 },
    ],
  } as AnyCircuitElement
  const footprint = circuitJsonToFootprint([
    pad("pad_1", -0.75),
    pad("pad_2", 0.75),
    courtyard,
  ])

  expect(footprint.courtyard).toEqual({
    center: { x: 0, y: 0 },
    width: 4,
    height: 2,
  })
})
