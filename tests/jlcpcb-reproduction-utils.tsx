import { expect } from "bun:test"
import { Circuit } from "@tscircuit/core"
import type { AnyCircuitElement } from "circuit-json"
import { circuitJsonToFootprinter } from "../lib/index.js"

export const renderFootprintToCircuitJson = async (
  FootprintComponent: () => React.JSX.Element,
) => {
  const circuit = new Circuit()
  circuit.add(<FootprintComponent />)
  await circuit.renderUntilSettled()

  return circuit
    .getCircuitJson()
    .filter(
      (element): element is AnyCircuitElement =>
        element.type === "pcb_smtpad" || element.type === "pcb_plated_hole",
    )
}

export const expectFootprintRecovery = async ({
  FootprintComponent,
  sourceHints,
}: {
  FootprintComponent: () => React.JSX.Element
  sourceHints: string[]
}) => {
  const circuitJson = await renderFootprintToCircuitJson(FootprintComponent)
  const result = circuitJsonToFootprinter(circuitJson, {
    maxCandidates: 5,
    sourceHints,
  })

  expect(result.best).not.toBeNull()
  expect(result.best!.copperIntersectionOverUnion).toBeGreaterThanOrEqual(0.99)
}
