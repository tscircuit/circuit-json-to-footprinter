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

const Sm02bSurs = () => (
  <chip
    name="J1"
    footprint={
      <footprint>
        <smtpad
          portHints={["pin1"]}
          pcbX={0.4}
          pcbY={1}
          width={0.5}
          height={1.3}
          shape="rect"
        />
        <smtpad
          portHints={["pin2"]}
          pcbX={-0.4}
          pcbY={1}
          width={0.5}
          height={1.3}
          shape="rect"
        />
        <smtpad
          portHints={["pin3"]}
          pcbX={-1.7}
          pcbY={-0.8}
          width={1.2}
          height={1.7}
          shape="rect"
        />
        <smtpad
          portHints={["pin4"]}
          pcbX={1.7}
          pcbY={-0.8}
          width={1.2}
          height={1.7}
          shape="rect"
        />
      </footprint>
    }
  />
)

const B2bZr = () => (
  <chip
    name="J1"
    footprint={
      <footprint>
        <smtpad
          portHints={["pin1"]}
          pcbX={-0.75}
          pcbY={-0.7}
          width={0.7}
          height={3.8}
          shape="rect"
        />
        <smtpad
          portHints={["pin2"]}
          pcbX={0.75}
          pcbY={-0.7}
          width={0.7}
          height={3.8}
          shape="rect"
        />
        <smtpad
          portHints={["pin3"]}
          pcbX={2.8}
          pcbY={1.45}
          width={1.5}
          height={2.3}
          shape="rect"
        />
        <smtpad
          portHints={["pin4"]}
          pcbX={-2.8}
          pcbY={1.45}
          width={1.5}
          height={2.3}
          shape="rect"
        />
      </footprint>
    }
  />
)

const Xl3210Rgbc2812b = () => (
  <chip
    name="D1"
    footprint={
      <footprint>
        <smtpad
          portHints={["pin1"]}
          pcbX={-1.5}
          pcbY={0.075}
          width={1}
          height={0.7}
          shape="rect"
        />
        <smtpad
          portHints={["pin4"]}
          pcbX={1.5}
          pcbY={0.075}
          width={1}
          height={0.7}
          shape="rect"
        />
        <smtpad
          portHints={["pin2"]}
          pcbX={-0.415}
          pcbY={-0.175}
          width={0.55}
          height={0.5}
          shape="rect"
        />
        <smtpad
          portHints={["pin3"]}
          pcbX={0.415}
          pcbY={-0.175}
          width={0.55}
          height={0.5}
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
    minimumCopperIntersectionOverUnion: 0.989,
    sourceHints: ["C5343246 FPC-0.3HF-31PWBH10 FPC connector"],
  })

  expect(result.best!.family).toBe("fpc")
  expect(result.best!.footprinterString).toStartWith("fpc31_staggered")
  expect(result.best!.footprinterString).toContain("toppl0.5mm")
  expect(result.best!.footprinterString).toContain("bottompl0.67mm")
  expect(result.best!.copperIntersectionOverUnion).toBeGreaterThanOrEqual(0.989)
})

test("renders the asymmetric staggered FPC footprint", async () => {
  const circuitJson = await renderFootprintToCircuitJson(Fpc03hf31pwbh10)

  expect(convertCircuitJsonToPcbSvg(circuitJson)).toMatchSvgSnapshot(
    import.meta.path,
    "jlcpcb-fpc-03hf-31pwbh10",
  )
})

test("recovers C566239 SM02B-SURS as a JST-style SMD connector", async () => {
  const result = await expectFootprintRecovery({
    FootprintComponent: Sm02bSurs,
    sourceHints: ["C566239 SM02B-SURS-TF(LF)(SN) SMD P=0.8mm"],
  })

  expect(result.best!.family).toBe("jst")
  expect(result.best!.footprinterString).toBe(
    "jst2_smd_p0.8mm_pw0.5mm_pl1.3mm_mpx3.4mm_mpy1.8mm_mpw1.2mm_mpl1.7mm",
  )
  expect(result.best!.copperIntersectionOverUnion).toBe(1)
})

test("prefers matching C265284 pin numbers over its JST domain hint", async () => {
  const result = await expectFootprintRecovery({
    FootprintComponent: B2bZr,
    sourceHints: ["C265284 B2B-ZR-SM4-TF(LF)(SN) SMD P=1.5mm"],
  })

  expect(result.best!.family).toBe("fpc")
  expect(result.best!.footprinterString).toBe(
    "fpc2_mounttop_p1.5mm_pw0.7mm_pl3.8mm_mpx5.6mm_mpy2.15mm_mpw1.5mm_mpl2.3mm",
  )
  expect(result.best!.copperIntersectionOverUnion).toBe(1)
  expect(result.best!.pinsMatch).toBe(true)

  const jstCandidate = result.candidates.find(
    (candidate) => candidate.family === "jst",
  )
  expect(jstCandidate).toMatchObject({
    copperIntersectionOverUnion: 1,
    pinMatchRate: 0.5,
    pinsMatch: false,
  })
  expect(jstCandidate!.rankingScore).toBeLessThan(result.best!.rankingScore)
})

test("renders the two-contact connector footprint", async () => {
  const circuitJson = await renderFootprintToCircuitJson(Sm02bSurs)

  expect(convertCircuitJsonToPcbSvg(circuitJson)).toMatchSvgSnapshot(
    import.meta.path,
    "jlcpcb-sm02b-surs",
  )
})

test("recovers C41413182 four-pad LED with the same topology", async () => {
  const result = await expectFootprintRecovery({
    FootprintComponent: Xl3210Rgbc2812b,
    sourceHints: ["C41413182 XL-3210RGBC-2812B SMD-4P 3.2x1mm LED"],
  })

  expect(result.best!.family).toBe("fpc")
  expect(result.best!.footprinterString).toBe(
    "fpc2_mounttop_p0.83mm_pw0.55mm_pl0.5mm_mpx3mm_mpy0.25mm_mpw1mm_mpl0.7mm",
  )
  expect(result.best!.copperIntersectionOverUnion).toBe(1)
})
