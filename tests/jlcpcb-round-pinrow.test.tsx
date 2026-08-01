import { expect, test } from "bun:test"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { Fragment } from "react"
import {
  expectFootprintRecovery,
  renderFootprintToCircuitJson,
} from "./fixture/jlcpcb-reproduction-utils.js"

const createRoundPinrow = ({
  holeDiameter,
  outerDiameter,
  pitch,
}: {
  holeDiameter: number
  outerDiameter: number
  pitch: number
}) => {
  const pins = Array.from({ length: 4 }, (_, index) => ({
    pin: index + 1,
    x: (index - 1.5) * pitch,
  }))

  return () => (
    <chip
      name="J1"
      footprint={
        <footprint>
          {pins.map(({ pin, x }) => (
            <Fragment key={pin}>
              <platedhole
                portHints={[`pin${pin}`]}
                pcbX={x}
                pcbY={0}
                holeDiameter={holeDiameter}
                outerDiameter={outerDiameter}
                shape="circle"
              />
            </Fragment>
          ))}
        </footprint>
      }
    />
  )
}

const ZxXh2544pzz = createRoundPinrow({
  holeDiameter: 1.1000232,
  outerDiameter: 1.5999968,
  pitch: 2.5,
})

const B0505s1w = createRoundPinrow({
  holeDiameter: 1.1000232,
  outerDiameter: 1.7999964,
  pitch: 2.54,
})

test("recovers C7429634 without square pin-one plating", async () => {
  const result = await expectFootprintRecovery({
    FootprintComponent: ZxXh2544pzz,
    sourceHints: ["C7429634 ZX-XH2.54-4PZZ through-hole connector"],
  })

  expect(result.best!.family).toBe("pinrow")
  expect(result.best!.footprinterString).toBe(
    "pinrow4_nosquareplating_p2.5mm_od1.6mm_id1.1mm",
  )
  expect(result.best!.copperIntersectionOverUnion).toBeGreaterThan(0.9999)
  expect(result.best!.holeIntersectionOverUnion).toBeGreaterThan(0.9999)
})

test("recovers C7465127 all-round SIP-4", async () => {
  const result = await expectFootprintRecovery({
    FootprintComponent: B0505s1w,
    sourceHints: ["C7465127 B0505S-1W SIP-4"],
  })

  expect(result.best!.family).toBe("pinrow")
  expect(result.best!.footprinterString).toBe(
    "pinrow4_nosquareplating_od1.8mm_id1.1mm",
  )
  expect(result.best!.copperIntersectionOverUnion).toBeGreaterThan(0.9999)
  expect(result.best!.holeIntersectionOverUnion).toBeGreaterThan(0.9999)
})

test("renders the C7429634 all-round pinrow footprint", async () => {
  const circuitJson = await renderFootprintToCircuitJson(ZxXh2544pzz)

  expect(convertCircuitJsonToPcbSvg(circuitJson)).toMatchSvgSnapshot(
    import.meta.path,
    "jlcpcb-zx-xh2.54-4pzz-round-pinrow",
  )
})
