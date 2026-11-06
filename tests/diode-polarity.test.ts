import { expect, test } from "bun:test"
import { fp } from "@tscircuit/footprinter"
import type { AnyCircuitElement, PcbSmtPad } from "circuit-json"
import {
  circuitJsonToFootprint,
  circuitJsonToFootprinter,
} from "../lib/index.js"

const getSod123wPads = () =>
  fp
    .string("sod123w")
    .circuitJson()
    .filter((element): element is PcbSmtPad => element.type === "pcb_smtpad")

test("emits anodepin1 from semantic pad hints", () => {
  const circuitJson = getSod123wPads().map((pad) => ({
    ...pad,
    port_hints: pad.port_hints?.includes("1")
      ? ["pin1", "anode", "pos"]
      : ["pin2", "cathode", "neg"],
  }))

  const result = circuitJsonToFootprinter(circuitJson, {
    sourceHints: ["SOD-123W Schottky diode"],
  })

  expect(result.best?.footprinterString).toContain("_anodepin1")
  expect(result.best?.footprinterString).not.toContain("_cathodepin1")
})

test("emits cathodepin1 from linked source-port hints", () => {
  const circuitJson: AnyCircuitElement[] = [
    ...getSod123wPads(),
    {
      type: "source_port",
      source_port_id: "source_port_1",
      source_component_id: "source_component_1",
      name: "pin1",
      pin_number: 1,
      port_hints: ["_NEG"],
    },
    {
      type: "source_port",
      source_port_id: "source_port_2",
      source_component_id: "source_component_1",
      name: "pin2",
      pin_number: 2,
      port_hints: ["_POS"],
    },
  ]

  const target = circuitJsonToFootprint(circuitJson)
  expect(target.pads[0]?.port_hints).toContain("_NEG")
  expect(target.pads[1]?.port_hints).toContain("_POS")

  const result = circuitJsonToFootprinter(circuitJson, {
    sourceHints: ["SOD-123W Schottky diode"],
  })

  expect(result.best?.footprinterString).toContain("_cathodepin1")
  expect(result.best?.footprinterString).not.toContain("_anodepin1")
})

test("emits anodepin1 from pcb_port linked to source_port", () => {
  const pads = getSod123wPads().map((pad, index) => ({
    ...pad,
    pcb_port_id: `pcb_port_${index + 1}`,
  }))
  const circuitJson: AnyCircuitElement[] = [
    ...pads,
    {
      type: "pcb_port",
      pcb_port_id: "pcb_port_1",
      source_port_id: "source_port_1",
      x: 0,
      y: 0,
      layers: ["top"],
    },
    {
      type: "pcb_port",
      pcb_port_id: "pcb_port_2",
      source_port_id: "source_port_2",
      x: 0,
      y: 0,
      layers: ["top"],
    },
    {
      type: "source_port",
      source_port_id: "source_port_1",
      source_component_id: "source_component_1",
      name: "anode",
      pin_number: 1,
      port_hints: ["pos"],
    },
    {
      type: "source_port",
      source_port_id: "source_port_2",
      source_component_id: "source_component_1",
      name: "cathode",
      pin_number: 2,
      port_hints: ["neg"],
    },
  ]

  const result = circuitJsonToFootprinter(circuitJson, {
    sourceHints: ["SOD-123W Schottky diode"],
  })

  expect(result.best?.footprinterString).toContain("_anodepin1")
  expect(result.best?.footprinterString).not.toContain("_cathodepin1")
})

test("does not infer polarity without complementary hints", () => {
  const result = circuitJsonToFootprinter(getSod123wPads(), {
    sourceHints: ["SOD-123W Schottky diode"],
  })

  expect(result.best?.footprinterString).not.toContain("anodepin")
  expect(result.best?.footprinterString).not.toContain("cathodepin")
})
