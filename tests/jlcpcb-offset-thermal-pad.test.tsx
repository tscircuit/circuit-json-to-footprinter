import { expect, test } from "bun:test"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { Fragment } from "react"
import {
  expectFootprintRecovery,
  renderFootprintToCircuitJson,
} from "./fixture/jlcpcb-reproduction-utils.js"

const Aon7403 = () => {
  const bottomPins = [1, 2, 3, 4]
  const topPins = [8, 7, 6, 5]
  const xCoordinates = [-0.975, -0.325, 0.325, 0.975]

  return (
    <chip
      name="U1"
      footprint={
        <footprint>
          {bottomPins.map((pin, index) => (
            <Fragment key={pin}>
              <smtpad
                portHints={[`pin${pin}`]}
                pcbX={xCoordinates[index]}
                pcbY={-1.5}
                width={0.4}
                height={0.8}
                shape="rect"
              />
            </Fragment>
          ))}
          {topPins.map((pin, index) => (
            <Fragment key={pin}>
              <smtpad
                portHints={[`pin${pin}`]}
                pcbX={xCoordinates[index]}
                pcbY={1.5}
                width={0.4}
                height={0.8}
                shape="rect"
              />
            </Fragment>
          ))}
          <smtpad
            portHints={["pin9"]}
            pcbX={0}
            pcbY={0.35}
            width={2.4}
            height={2.1}
            shape="rect"
          />
        </footprint>
      }
    />
  )
}

test("recovers C5310961 with an offset rectangular thermal pad", async () => {
  const result = await expectFootprintRecovery({
    FootprintComponent: Aon7403,
    sourceHints: ["C5310961 AON7403 PDFN-8"],
  })

  expect(result.best!.footprinterString).toMatch(
    /thermalpadcenteroffset[xy](?:-)?0\.35mm/,
  )
  expect(result.best!.copperIntersectionOverUnion).toBeGreaterThanOrEqual(0.99)
}, 30_000)

test("renders the C5310961 offset thermal pad footprint", async () => {
  const circuitJson = await renderFootprintToCircuitJson(Aon7403)

  expect(convertCircuitJsonToPcbSvg(circuitJson)).toMatchSvgSnapshot(
    import.meta.path,
    "jlcpcb-aon7403-offset-thermal-pad",
  )
})
