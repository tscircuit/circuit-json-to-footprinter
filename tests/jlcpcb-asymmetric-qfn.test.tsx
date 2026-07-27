import { expect, test } from "bun:test"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { Fragment } from "react"
import {
  expectFootprintRecovery,
  renderFootprintToCircuitJson,
} from "./fixture/jlcpcb-reproduction-utils.js"

interface AsymmetricQfn20Dimensions {
  columnX: number
  horizontalPadLength: number
  horizontalPadWidth: number
  rowY: number
  thermalPadHeight: number
  thermalPadWidth: number
  verticalPadLength: number
  verticalPadWidth: number
}

const createAsymmetricQfn20 = ({
  columnX,
  horizontalPadLength,
  horizontalPadWidth,
  rowY,
  thermalPadHeight,
  thermalPadWidth,
  verticalPadLength,
  verticalPadWidth,
}: AsymmetricQfn20Dimensions) => {
  const topPins = Array.from({ length: 8 }, (_, index) => ({
    pin: 19 - index,
    x: (index - 3.5) * 0.5,
  }))
  const bottomPins = Array.from({ length: 8 }, (_, index) => ({
    pin: index + 2,
    x: (index - 3.5) * 0.5,
  }))
  const sidePins = [
    { pin: 1, x: -columnX, y: -0.75 },
    { pin: 20, x: -columnX, y: 0.75 },
    { pin: 10, x: columnX, y: -0.75 },
    { pin: 11, x: columnX, y: 0.75 },
  ]

  return () => (
    <chip
      name="U1"
      footprint={
        <footprint>
          {sidePins.map(({ pin, x, y }) => (
            <Fragment key={pin}>
              <smtpad
                portHints={[`pin${pin}`]}
                pcbX={x}
                pcbY={y}
                width={horizontalPadLength}
                height={horizontalPadWidth}
                shape="rect"
              />
            </Fragment>
          ))}
          {topPins.map(({ pin, x }) => (
            <Fragment key={pin}>
              <smtpad
                portHints={[`pin${pin}`]}
                pcbX={x}
                pcbY={rowY}
                width={verticalPadWidth}
                height={verticalPadLength}
                shape="rect"
              />
            </Fragment>
          ))}
          {bottomPins.map(({ pin, x }) => (
            <Fragment key={pin}>
              <smtpad
                portHints={[`pin${pin}`]}
                pcbX={x}
                pcbY={-rowY}
                width={verticalPadWidth}
                height={verticalPadLength}
                shape="rect"
              />
            </Fragment>
          ))}
          <smtpad
            portHints={["pin21"]}
            pcbX={0}
            pcbY={0}
            width={thermalPadWidth}
            height={thermalPadHeight}
            shape="rect"
          />
        </footprint>
      }
    />
  )
}

const Pi3usb14Azhex = createAsymmetricQfn20({
  columnX: 2.249932,
  horizontalPadLength: 0.850011,
  horizontalPadWidth: 0.2800096,
  rowY: 1.75006,
  thermalPadHeight: 1.6999966,
  thermalPadWidth: 2.6999946,
  verticalPadLength: 0.850011,
  verticalPadWidth: 0.2800096,
})

const Txs0108ergyr = createAsymmetricQfn20({
  columnX: 2.157476,
  horizontalPadLength: 0.6649974,
  horizontalPadWidth: 0.3359912,
  rowY: 1.657604,
  thermalPadHeight: 2.0500086,
  thermalPadWidth: 3.0500066,
  verticalPadLength: 0.6649974,
  verticalPadWidth: 0.2800096,
})

test("recovers C526711 with unequal QFN side counts and pitches", async () => {
  const result = await expectFootprintRecovery({
    FootprintComponent: Pi3usb14Azhex,
    sourceHints: ["C526711 PI3USB14-AZHEX QFN-20_L5.6-W4.6-P0.50-TL"],
  })

  expect(result.best!.family).toBe("qfn")
  expect(result.best!.footprinterString).toContain("leftpins2")
  expect(result.best!.footprinterString).toContain("toppins8")
  expect(result.best!.footprinterString).toContain("rightpins2")
  expect(result.best!.footprinterString).toContain("bottompins8")
  expect(result.best!.footprinterString).toContain("py1.5mm")
  expect(result.best!.copperIntersectionOverUnion).toBeGreaterThanOrEqual(0.99)
}, 30_000)

test("recovers C90706 despite its unequal side pad widths", async () => {
  const result = await expectFootprintRecovery({
    FootprintComponent: Txs0108ergyr,
    minimumCopperIntersectionOverUnion: 0.95,
    sourceHints: ["C90706 TXS0108ERGYR QFN-20_L5.5-W4.5-P0.50-TL"],
  })

  expect(result.best!.family).toBe("qfn")
  expect(result.best!.footprinterString).toContain("leftpins2")
  expect(result.best!.footprinterString).toContain("toppins8")
  expect(result.best!.footprinterString).toContain("rightpins2")
  expect(result.best!.footprinterString).toContain("bottompins8")
  expect(result.best!.copperIntersectionOverUnion).toBeGreaterThanOrEqual(0.95)
}, 30_000)

test("renders the C526711 unequal-side QFN footprint", async () => {
  const circuitJson = await renderFootprintToCircuitJson(Pi3usb14Azhex)

  expect(convertCircuitJsonToPcbSvg(circuitJson)).toMatchSvgSnapshot(
    import.meta.path,
    "jlcpcb-pi3usb14-unequal-side-qfn",
  )
})
