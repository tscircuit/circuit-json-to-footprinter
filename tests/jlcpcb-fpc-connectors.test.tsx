import { expect, test } from "bun:test"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { Fragment } from "react"
import {
  expectFootprintRecovery,
  renderFootprintToCircuitJson,
} from "./fixture/jlcpcb-reproduction-utils.js"

const Fpc05f12ph20 = () => (
  <chip
    name="J1"
    footprint={
      <footprint>
        {Array.from({ length: 12 }, (_, index) => (
          <Fragment key={index}>
            <smtpad
              portHints={[`pin${index + 1}`]}
              pcbX={-2.75 + index * 0.5}
              pcbY={1.6}
              width={0.3}
              height={1.25}
              shape="rect"
            />
          </Fragment>
        ))}
        <smtpad
          portHints={["pin13"]}
          pcbX={4.44}
          pcbY={-0.975}
          width={2}
          height={2.5}
          shape="rect"
        />
        <smtpad
          portHints={["pin14"]}
          pcbX={-4.44}
          pcbY={-0.975}
          width={2}
          height={2.5}
          shape="rect"
        />
      </footprint>
    }
  />
)

const Afc11s30ica00 = () => (
  <chip
    name="J1"
    footprint={
      <footprint>
        {Array.from({ length: 30 }, (_, index) => (
          <Fragment key={index}>
            <smtpad
              portHints={[`pin${index + 1}`]}
              pcbX={-7.25 + index * 0.5}
              pcbY={index % 2 === 0 ? -1.2 : 1.2}
              width={0.4}
              height={1.4}
              shape="rect"
            />
          </Fragment>
        ))}
        <smtpad
          portHints={["pin31"]}
          pcbX={9}
          pcbY={0}
          width={2}
          height={2.4}
          shape="rect"
        />
        <smtpad
          portHints={["pin32"]}
          pcbX={-9}
          pcbY={0}
          width={2}
          height={2.4}
          shape="rect"
        />
      </footprint>
    }
  />
)

const Fpc03hf31pwbh10 = () => (
  <chip
    name="J1"
    footprint={
      <footprint>
        {Array.from({ length: 31 }, (_, index) => (
          <Fragment key={index}>
            <smtpad
              portHints={[`pin${index + 1}`]}
              pcbX={-4.5 + index * 0.3}
              pcbY={index % 2 === 0 ? -1.49 : 1.575}
              width={0.3}
              height={index % 2 === 0 ? 0.67 : 0.5}
              shape="rect"
            />
          </Fragment>
        ))}
        <smtpad
          portHints={["pin32"]}
          pcbX={5.475}
          pcbY={-1.248}
          width={0.35}
          height={1}
          shape="rect"
        />
        <smtpad
          portHints={["pin33"]}
          pcbX={-5.475}
          pcbY={-1.225}
          width={0.35}
          height={1}
          shape="rect"
        />
      </footprint>
    }
  />
)

test("recovers C2856799 FPC-05F-12PH20", async () => {
  const result = await expectFootprintRecovery({
    FootprintComponent: Fpc05f12ph20,
    sourceHints: ["C2856799 FPC-05F-12PH20 flat flexible connector"],
  })

  expect(result.best!.family).toBe("fpc")
  expect(result.best!.footprinterString).toStartWith("fpc12_")
  expect(result.best!.copperIntersectionOverUnion).toBeGreaterThanOrEqual(0.99)
})

test("recovers C262505 AFC11-S30ICA-00 staggered FPC", async () => {
  const result = await expectFootprintRecovery({
    FootprintComponent: Afc11s30ica00,
    sourceHints: ["C262505 AFC11-S30ICA-00 FPC connector"],
  })

  expect(result.best!.family).toBe("fpc")
  expect(result.best!.footprinterString).toStartWith("fpc30_staggered")
  expect(result.best!.copperIntersectionOverUnion).toBeGreaterThanOrEqual(0.99)
})

test("recovers C5343246 FPC-0.3HF-31PWBH10 with asymmetric rows", async () => {
  const result = await expectFootprintRecovery({
    FootprintComponent: Fpc03hf31pwbh10,
    sourceHints: ["C5343246 FPC-0.3HF-31PWBH10 FPC connector"],
  })

  expect(result.best!.family).toBe("fpc")
  expect(result.best!.footprinterString).toStartWith("fpc31_staggered")
  expect(result.best!.footprinterString).toContain("toppl0.5mm")
  expect(result.best!.footprinterString).toContain("bottompl0.67mm")
  expect(result.best!.copperIntersectionOverUnion).toBeGreaterThanOrEqual(0.99)
})

test("renders the asymmetric staggered FPC footprint", async () => {
  const circuitJson = await renderFootprintToCircuitJson(Fpc03hf31pwbh10)

  expect(convertCircuitJsonToPcbSvg(circuitJson)).toMatchSvgSnapshot(
    import.meta.path,
    "jlcpcb-fpc-03hf-31pwbh10",
  )
})
