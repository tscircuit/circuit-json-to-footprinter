import { expect, test } from "bun:test"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { Fragment } from "react"
import {
  expectFootprintRecovery,
  renderFootprintToCircuitJson,
} from "./fixture/jlcpcb-reproduction-utils.js"

interface Htssop28Dimensions {
  leadHeight: number
  leadWidth: number
  pillPads: boolean
  rowY: number
  thermalPadHeight: number
  thermalPadWidth: number
}

const createHtssop28 = ({
  leadHeight,
  leadWidth,
  pillPads,
  rowY,
  thermalPadHeight,
  thermalPadWidth,
}: Htssop28Dimensions) => {
  const bottomPins = Array.from({ length: 14 }, (_, index) => ({
    pin: index + 1,
    x: (index - 6.5) * 0.65,
  }))
  const topPins = Array.from({ length: 14 }, (_, index) => ({
    pin: 28 - index,
    x: (index - 6.5) * 0.65,
  }))

  return () => (
    <chip
      name="U1"
      footprint={
        <footprint>
          {bottomPins.map(({ pin, x }) => (
            <Fragment key={pin}>
              {pillPads ? (
                <smtpad
                  portHints={[`pin${pin}`]}
                  pcbX={x}
                  pcbY={-rowY}
                  width={leadWidth}
                  height={leadHeight}
                  shape="pill"
                  radius={leadWidth / 2}
                />
              ) : (
                <smtpad
                  portHints={[`pin${pin}`]}
                  pcbX={x}
                  pcbY={-rowY}
                  width={leadWidth}
                  height={leadHeight}
                  shape="rect"
                />
              )}
            </Fragment>
          ))}
          {topPins.map(({ pin, x }) => (
            <Fragment key={pin}>
              {pillPads ? (
                <smtpad
                  portHints={[`pin${pin}`]}
                  pcbX={x}
                  pcbY={rowY}
                  width={leadWidth}
                  height={leadHeight}
                  shape="pill"
                  radius={leadWidth / 2}
                />
              ) : (
                <smtpad
                  portHints={[`pin${pin}`]}
                  pcbX={x}
                  pcbY={rowY}
                  width={leadWidth}
                  height={leadHeight}
                  shape="rect"
                />
              )}
            </Fragment>
          ))}
          <smtpad
            portHints={["pin29"]}
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

const Drv8825Pwpr = createHtssop28({
  leadHeight: 1.7315,
  leadWidth: 0.343,
  pillPads: true,
  rowY: 2.8658,
  thermalPadHeight: 3.1,
  thermalPadWidth: 5.6,
})

const Drv8844Pwpr = createHtssop28({
  leadHeight: 1.7315,
  leadWidth: 0.343,
  pillPads: true,
  rowY: 2.8658,
  thermalPadHeight: 2.75,
  thermalPadWidth: 6.2,
})

const Tpa3110d2Pwpr = createHtssop28({
  leadHeight: 1.575,
  leadWidth: 0.35,
  pillPads: false,
  rowY: 2.7874,
  thermalPadHeight: 2.4,
  thermalPadWidth: 6.17,
})

test("recovers C81582 with a rotated rectangular thermal pad", async () => {
  const result = await expectFootprintRecovery({
    FootprintComponent: Drv8825Pwpr,
    sourceHints: ["C81582 DRV8825PWPR HTSSOP-28-EP"],
  })

  expect(result.best!.footprinterString).toContain("thermalpad3.1mmx5.6mm")
  expect(result.best!.copperIntersectionOverUnion).toBeGreaterThanOrEqual(0.99)
}, 30_000)

test("recovers C177807 with a rotated rectangular thermal pad", async () => {
  const result = await expectFootprintRecovery({
    FootprintComponent: Drv8844Pwpr,
    sourceHints: ["C177807 DRV8844PWPR HTSSOP-28"],
  })

  expect(result.best!.footprinterString).toContain("thermalpad2.75mmx6.2mm")
  expect(result.best!.copperIntersectionOverUnion).toBeGreaterThanOrEqual(0.99)
}, 30_000)

test("recovers C30132 with a rotated rectangular thermal pad", async () => {
  const result = await expectFootprintRecovery({
    FootprintComponent: Tpa3110d2Pwpr,
    sourceHints: ["C30132 TPA3110D2PWPR HTSSOP-28-EP"],
  })

  expect(result.best!.footprinterString).toContain("thermalpad2.4mmx6.17mm")
  expect(result.best!.copperIntersectionOverUnion).toBeGreaterThanOrEqual(0.99)
}, 30_000)

test("renders the C81582 rotated rectangular thermal pad footprint", async () => {
  const circuitJson = await renderFootprintToCircuitJson(Drv8825Pwpr)

  expect(convertCircuitJsonToPcbSvg(circuitJson)).toMatchSvgSnapshot(
    import.meta.path,
    "jlcpcb-drv8825-rotated-thermal-pad",
  )
})
