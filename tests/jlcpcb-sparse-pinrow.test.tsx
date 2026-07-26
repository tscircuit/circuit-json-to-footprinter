import { expect, test } from "bun:test"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { Fragment } from "react"
import {
  expectFootprintRecovery,
  renderFootprintToCircuitJson,
} from "./fixture/jlcpcb-reproduction-utils.js"

const G5v1Dc24 = () => {
  const pins = [
    { pin: 1, x: -5.08, y: 2.54 },
    { pin: 2, x: -5.08, y: -2.54 },
    { pin: 3, x: -2.54, y: 2.54 },
    { pin: 4, x: 5.08, y: 2.54 },
    { pin: 5, x: 5.08, y: -2.54 },
    { pin: 6, x: -2.54, y: -2.54 },
  ]

  return (
    <chip
      name="K1"
      footprint={
        <footprint>
          {pins.map(({ pin, x, y }) => (
            <Fragment key={pin}>
              <platedhole
                portHints={[`pin${pin}`]}
                pcbX={x}
                pcbY={y}
                holeDiameter={1.2}
                outerDiameter={2.1}
                shape="circle"
              />
            </Fragment>
          ))}
        </footprint>
      }
    />
  )
}

const Srd12vdcSlC = () => {
  const pins = [
    { pin: 1, x: 7.1, y: -5.999 },
    { pin: 2, x: -7.1, y: 0 },
    { pin: 3, x: -5.1, y: 6 },
    { pin: 4, x: -5.1, y: -6 },
    { pin: 5, x: 7.1, y: 5.999 },
  ]

  return (
    <chip
      name="K1"
      footprint={
        <footprint>
          {pins.map(({ pin, x, y }) => (
            <Fragment key={pin}>
              <platedhole
                portHints={[`pin${pin}`]}
                pcbX={x}
                pcbY={y}
                holeDiameter={1.524}
                outerDiameter={2.794}
                shape="circle"
              />
            </Fragment>
          ))}
        </footprint>
      }
    />
  )
}

test("recovers C28694 G5V-1 sparse relay grid", async () => {
  const result = await expectFootprintRecovery({
    FootprintComponent: G5v1Dc24,
    sourceHints: ["C28694 G5V-1-DC24 DIP relay"],
  })

  expect(result.best!.family).toBe("pinrow")
  expect(result.best!.footprinterString).toBe(
    "pinrow6_rows2_cols5_p2.54mm_py5.08mm_missing(3,4,8,9)_nosquareplating_od2.1mm_id1.2mm",
  )
  expect(result.best!.copperIntersectionOverUnion).toBe(1)
})

test("recovers C30431 SRD sparse relay grid", async () => {
  const result = await expectFootprintRecovery({
    FootprintComponent: Srd12vdcSlC,
    minimumCopperIntersectionOverUnion: 0.98,
    sourceHints: ["C30431 SRD-12VDC-SL-C relay"],
  })

  expect(result.best!.family).toBe("pinrow")
  expect(result.best!.footprinterString).toContain(
    "pinrow5_rows3_cols8_p2.03mm_py6mm_missing(",
  )
})

test("renders the C28694 sparse relay footprint", async () => {
  const circuitJson = await renderFootprintToCircuitJson(G5v1Dc24)

  expect(convertCircuitJsonToPcbSvg(circuitJson)).toMatchSvgSnapshot(
    import.meta.path,
    "jlcpcb-g5v-1-sparse-relay",
  )
})
