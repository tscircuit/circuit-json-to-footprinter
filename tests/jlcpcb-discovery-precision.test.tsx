import { expect, test } from "bun:test"
import { Fragment } from "react"
import { expectFootprintRecovery } from "./fixture/jlcpcb-reproduction-utils.js"

const B5psVh = () => (
  <chip
    name="J1"
    footprint={
      <footprint>
        {[-7.92, -3.96, 0, 3.96, 7.92].map((pcbX, index) => (
          <Fragment key={pcbX}>
            <platedhole
              portHints={[`pin${index + 1}`]}
              pcbX={pcbX}
              pcbY={0}
              outerDiameter={2.5}
              holeDiameter={1.8}
              shape="circle"
            />
          </Fragment>
        ))}
      </footprint>
    }
  />
)

const Mmbt3904 = () => (
  <chip
    name="Q1"
    footprint={
      <footprint>
        <smtpad
          portHints={["pin1"]}
          pcbX={0.91}
          pcbY={-0.65}
          width={0.6}
          height={0.4}
          shape="rect"
        />
        <smtpad
          portHints={["pin2"]}
          pcbX={0.91}
          pcbY={0.65}
          width={0.6}
          height={0.4}
          shape="rect"
        />
        <smtpad
          portHints={["pin3"]}
          pcbX={-0.91}
          pcbY={0}
          width={0.6}
          height={0.4}
          shape="rect"
        />
      </footprint>
    }
  />
)

const XlZ1921Rgba = () => (
  <chip
    name="D1"
    footprint={
      <footprint>
        {[
          [-0.83, -0.5],
          [-0.83, 0.5],
          [0.83, 0.5],
          [0.83, -0.5],
        ].map(([pcbX, pcbY], index) => (
          <Fragment key={`${pcbX}-${pcbY}`}>
            <smtpad
              portHints={[`pin${index + 1}`]}
              pcbX={pcbX}
              pcbY={pcbY}
              width={0.66}
              height={0.7}
              shape="rect"
            />
          </Fragment>
        ))}
      </footprint>
    }
  />
)

test("recovers C157989 all-round pinrow pads", async () => {
  const result = await expectFootprintRecovery({
    FootprintComponent: B5psVh,
    sourceHints: ["C157989 B5PS-VH(LF)(SN) connector"],
  })

  expect(result.best!.footprinterString).toBe(
    "pinrow5_nosquareplating_p3.96mm_od2.5mm_id1.8mm",
  )
})

test("refines C58011 SOT-323 dimensions at emitted precision", async () => {
  const result = await expectFootprintRecovery({
    FootprintComponent: Mmbt3904,
    sourceHints: ["C58011 MMBT3904WT1G SC-70 SOT-323"],
  })

  expect(result.best!.footprinterString).toBe(
    "sot323_p0.91mm_pw0.4mm_pl0.6mm_pin1location(rightside,bottom)",
  )
})

test("refines C22461785 DFN dimensions at emitted precision", async () => {
  const result = await expectFootprintRecovery({
    FootprintComponent: XlZ1921Rgba,
    minimumCopperIntersectionOverUnion: 0.98,
    sourceHints: ["C22461785 XL-Z1921RGBA-SG SMD-4P"],
  })

  expect(result.best!.footprinterString).toBe(
    "dfn4_p1mm_w2.32mm_pw0.7mm_pl0.66mm",
  )
})
