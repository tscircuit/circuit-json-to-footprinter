import { expect, test } from "bun:test"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { Fragment } from "react"
import {
  expectFootprintRecovery,
  renderFootprintToCircuitJson,
} from "./fixture/jlcpcb-reproduction-utils.js"

const uc3843Pins = [
  { pin: 1, x: -3.81, y: -3.81 },
  { pin: 2, x: -1.27, y: -3.81 },
  { pin: 3, x: 1.27, y: -3.81 },
  { pin: 4, x: 3.81, y: -3.81 },
  { pin: 5, x: 3.81, y: 3.81 },
  { pin: 6, x: 1.27, y: 3.81 },
  { pin: 7, x: -1.27, y: 3.81 },
  { pin: 8, x: -3.81, y: 3.81 },
]

const Uc3843bn = () => (
  <chip
    name="U1"
    footprint={
      <footprint>
        {uc3843Pins.map(({ pin, x, y }) => (
          <Fragment key={pin}>
            <platedhole
              portHints={[`pin${pin}`]}
              pcbX={x}
              pcbY={y}
              holeDiameter={1}
              outerDiameter={1.6}
              shape="circle"
            />
          </Fragment>
        ))}
      </footprint>
    }
  />
)

const Db107 = () => (
  <chip
    name="D1"
    footprint={
      <footprint>
        <platedhole
          portHints={["pin1"]}
          pcbX={-4.5}
          pcbY={2.54}
          holeDiameter={1.2}
          outerDiameter={2}
          shape="circle"
        />
        <platedhole
          portHints={["pin2"]}
          pcbX={-4.5}
          pcbY={-2.54}
          holeDiameter={1.2}
          outerDiameter={2}
          shape="circle"
        />
        <platedhole
          portHints={["pin3"]}
          pcbX={4.5}
          pcbY={-2.54}
          holeDiameter={1.2}
          outerDiameter={2}
          shape="circle"
        />
        <platedhole
          portHints={["pin4"]}
          pcbX={4.5}
          pcbY={2.54}
          holeDiameter={1.2}
          outerDiameter={2}
          shape="circle"
        />
      </footprint>
    }
  />
)

const X49sd8msd2sc = () => (
  <chip
    name="Y1"
    footprint={
      <footprint>
        <platedhole
          portHints={["pin2"]}
          pcbX={0}
          pcbY={-2.45}
          holeDiameter={0.7}
          outerDiameter={1.2}
          shape="circle"
        />
        <platedhole
          portHints={["pin1"]}
          pcbX={0}
          pcbY={2.45}
          holeDiameter={0.7}
          outerDiameter={1.2}
          shape="circle"
        />
      </footprint>
    }
  />
)

test("recovers C5177 rotated DIP with all-round pads", async () => {
  const result = await expectFootprintRecovery({
    FootprintComponent: Uc3843bn,
    sourceHints: ["C5177 UC3843BN DIP-8"],
  })

  expect(result.best!.family).toBe("dip")
  expect(result.best!.footprinterString).toBe(
    "dip8_nosquareplating_od1.6mm_id1mm_pin1location(leftside,bottom)",
  )
  expect(result.best!.copperIntersectionOverUnion).toBe(1)
})

test("recovers C2492 bridge rectifier with continuous DIP spacing", async () => {
  const result = await expectFootprintRecovery({
    FootprintComponent: Db107,
    sourceHints: ["C2492 DB107 bridge rectifier DB"],
  })

  expect(result.best!.family).toBe("dip")
  expect(result.best!.footprinterString).toBe(
    "dip4_nosquareplating_p5.08mm_w9mm_od2mm_id1.2mm",
  )
  expect(result.best!.copperIntersectionOverUnion).toBeGreaterThanOrEqual(0.999)
})

test("recovers C21263 rotated HC-49 crystal", async () => {
  const result = await expectFootprintRecovery({
    FootprintComponent: X49sd8msd2sc,
    sourceHints: ["C21263 X49SD8MSD2SC HC-49S crystal"],
  })

  expect(result.best!.family).toBe("hc49")
  expect(result.best!.footprinterString).toBe(
    "hc49_p4.9mm_od1.2mm_id0.7mm_pin1location(rightside,bottom)",
  )
  expect(result.best!.copperIntersectionOverUnion).toBe(1)
})

test("renders the all-round rotated DIP footprint", async () => {
  const circuitJson = await renderFootprintToCircuitJson(Uc3843bn)

  expect(convertCircuitJsonToPcbSvg(circuitJson)).toMatchSvgSnapshot(
    import.meta.path,
    "jlcpcb-uc3843bn-round-dip",
  )
})
