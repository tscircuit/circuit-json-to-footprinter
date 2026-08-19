import { expect } from "bun:test"
import { Circuit } from "@tscircuit/core"
import type { AnyCircuitElement } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { circuitJsonToFootprinter } from "../../lib/index.js"

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
  minimumCopperIntersectionOverUnion = 0.99,
  sourceHints,
}: {
  FootprintComponent: () => React.JSX.Element
  minimumCopperIntersectionOverUnion?: number
  sourceHints: string[]
}) => {
  const circuitJson = await renderFootprintToCircuitJson(FootprintComponent)
  const result = circuitJsonToFootprinter(circuitJson, {
    maxCandidates: 5,
    sourceHints,
  })

  expect(result.best).not.toBeNull()
  expect(result.best!.copperIntersectionOverUnion).toBeGreaterThanOrEqual(
    minimumCopperIntersectionOverUnion,
  )
  return result
}

export const expectJlcpcbFootprintComparison = async ({
  expectedFootprinterString,
  jlcpcbPartNumber,
  matchedPcbX = 10,
  minimumCopperIntersectionOverUnion = 0.99,
  renderJlcpcbComponent,
  snapshotFilePath,
  snapshotName = `${jlcpcbPartNumber}-jlc-vs-match`,
  sourceHints,
  sourcePcbX = -10,
}: {
  expectedFootprinterString?: string
  jlcpcbPartNumber: `C${number}`
  matchedPcbX?: number
  minimumCopperIntersectionOverUnion?: number
  renderJlcpcbComponent: (props: {
    name: string
    pcbX: number
  }) => React.JSX.Element
  snapshotFilePath: string
  snapshotName?: string
  sourceHints: string[]
  sourcePcbX?: number
}) => {
  const sourceCircuit = new Circuit()
  sourceCircuit.add(
    renderJlcpcbComponent({ name: `JLC_${jlcpcbPartNumber}`, pcbX: 0 }),
  )
  await sourceCircuit.renderUntilSettled()
  const sourceCircuitJson = sourceCircuit.getCircuitJson()

  const result = circuitJsonToFootprinter(sourceCircuitJson, {
    maxCandidates: 5,
    sourceHints,
  })

  expect(result.best).not.toBeNull()
  expect(result.best!.copperIntersectionOverUnion).toBeGreaterThanOrEqual(
    minimumCopperIntersectionOverUnion,
  )
  if (expectedFootprinterString) {
    expect(result.best!.footprinterString).toBe(expectedFootprinterString)
  }

  const comparisonCircuit = new Circuit()
  comparisonCircuit.add(
    renderJlcpcbComponent({
      name: `JLC_${jlcpcbPartNumber}`,
      pcbX: sourcePcbX,
    }),
  )
  comparisonCircuit.add(
    <chip
      name="MATCHED"
      footprint={result.best!.footprinterString}
      pcbX={matchedPcbX}
    />,
  )
  await comparisonCircuit.renderUntilSettled()

  expect(
    convertCircuitJsonToPcbSvg(comparisonCircuit.getCircuitJson()),
  ).toMatchSvgSnapshot(snapshotFilePath, snapshotName)

  return { result, sourceCircuitJson }
}
