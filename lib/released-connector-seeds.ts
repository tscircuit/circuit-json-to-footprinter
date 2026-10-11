import type { Footprint } from "./footprint.js"
import {
  getTransformedPcbPadGeometry,
  type PcbPadGeometry,
  rotatePoint,
  type ShapeGeometry,
} from "./footprint-geometry.js"

const close = (a: number, b: number) => Math.abs(a - b) < 0.00001
const length = (value: number) => `${Number(value.toFixed(9))}mm`
const mean = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length
const coordinates = (values: number[]) =>
  values
    .toSorted((a, b) => a - b)
    .filter((v, i, all) => !i || !close(v, all[i - 1]))
const pitch = (values: number[]) => {
  if (values.length < 2) return undefined
  const step = values[1] - values[0]
  return step > 0 &&
    values.every((value, i) => close(value, values[0] + i * step))
    ? step
    : undefined
}

const getNumericOwner = (pad: PcbPadGeometry) => {
  const owners = (pad.element.port_hints ?? []).flatMap((hint) => {
    const match = /^(?:pin)?([1-9]\d*)$/i.exec(hint)
    return match ? [Number(match[1])] : []
  })
  return new Set(owners).size === 1 ? owners[0] : undefined
}

const getCompleteHeaderSeeds = (pads: PcbPadGeometry[]) => {
  if (
    pads.length < 4 ||
    pads.some(
      (pad) =>
        pad.element.type !== "pcb_plated_hole" ||
        pad.drill?.shape !== "circle" ||
        !close(pad.drill.x, pad.copper.x) ||
        !close(pad.drill.y, pad.copper.y) ||
        (pad.copper.shape !== "circle" && pad.copper.shape !== "rect") ||
        !close(pad.copper.width, pad.copper.height),
    )
  )
    return []
  const first = pads[0]
  if (
    pads.some(
      (pad) =>
        !close(pad.copper.width, first.copper.width) ||
        !close(pad.drill!.width, first.drill!.width),
    )
  )
    return []
  const rectangular = pads.filter((pad) => pad.copper.shape === "rect")
  if (
    rectangular.length > 1 ||
    (rectangular.length === 1 && getNumericOwner(rectangular[0]) !== 1)
  )
    return []
  const xs = coordinates(pads.map((pad) => pad.copper.x))
  const ys = coordinates(pads.map((pad) => pad.copper.y))
  // Existing linear-row discovery already emits concise single-row strings.
  if (xs.length < 2 || ys.length < 2) return []
  if (xs.length * ys.length !== pads.length) return []
  if (
    new Set(
      pads.map(
        (pad) =>
          `${xs.findIndex((x) => close(x, pad.copper.x))},${ys.findIndex((y) => close(y, pad.copper.y))}`,
      ),
    ).size !== pads.length
  )
    return []
  const pitchX = pitch(xs)
  const pitchY = pitch(ys)
  if ((xs.length > 1 && !pitchX) || (ys.length > 1 && !pitchY)) return []
  const seeds: string[] = []
  // Transpose as well as rotate: rectangular header numbering can advance
  // across a row or through a column, including the mirrored socket layout.
  for (const [columns, rows, px, py] of [
    [xs.length, ys.length, pitchX ?? pitchY, pitchY ?? pitchX],
    [ys.length, xs.length, pitchY ?? pitchX, pitchX ?? pitchY],
  ]) {
    for (const numbering of ["rowmajor", "columnmajor"]) {
      seeds.push(
        [
          `pinrow${pads.length}`,
          `rows${rows}`,
          `cols${columns}`,
          `p${length(px!)}`,
          `py${length(py!)}`,
          `pinnumbering(${numbering})`,
          `id${length(first.drill!.width)}`,
          `od${length(first.copper.width)}`,
          ...(rectangular.length ? [] : ["nosquareplating"]),
        ].join("_"),
      )
    }
  }
  return seeds
}

const rotateShape = (shape: ShapeGeometry, degrees: number): ShapeGeometry => ({
  ...shape,
  ...rotatePoint(shape.x, shape.y, (degrees * Math.PI) / 180),
  rotation: shape.rotation + degrees,
})
const rotatePads = (pads: PcbPadGeometry[], degrees: number) =>
  pads.map((pad) => ({
    ...pad,
    copper: rotateShape(pad.copper, degrees),
    drill: pad.drill ? rotateShape(pad.drill, degrees) : undefined,
  }))
const dimensions = (shape: ShapeGeometry) => {
  const rotation = ((shape.rotation % 180) + 180) % 180
  if (close(rotation, 0)) return { width: shape.width, height: shape.height }
  if (close(rotation, 90)) return { width: shape.height, height: shape.width }
  return undefined
}
const sameDimensions = (pads: PcbPadGeometry[], kind: "copper" | "drill") => {
  const first = dimensions(pads[0][kind]!)
  if (!first) return undefined
  return pads.every((pad) => {
    const size = dimensions(pad[kind]!)
    return (
      size && close(size.width, first.width) && close(size.height, first.height)
    )
  })
    ? first
    : undefined
}
const sameRow = (pads: PcbPadGeometry[]) =>
  pads.every((pad) => close(pad.copper.y, pads[0].copper.y))
const symmetricPair = (pads: PcbPadGeometry[], centerX: number) =>
  pads.length === 2 &&
  sameRow(pads) &&
  close(mean(pads.map((pad) => pad.copper.x)), centerX)

const getSignalNumbering = (pads: PcbPadGeometry[]) => {
  const owners = pads.map(getNumericOwner)
  if (owners.some((owner) => owner === undefined)) return []
  const start = Math.min(...(owners as number[]))
  if (owners.every((owner, i) => owner === start + i))
    return [...(start === 1 ? [] : [`pinstart${start}`])]
  if (owners.every((owner, i) => owner === start + pads.length - 1 - i))
    return ["reverse", ...(start === 1 ? [] : [`pinstart${start}`])]
  return undefined
}

const getUsbASeed = (pads: PcbPadGeometry[]) => {
  if (
    pads.length !== 6 ||
    pads.some(
      (pad) =>
        pad.element.type !== "pcb_plated_hole" ||
        pad.copper.shape !== "circle" ||
        pad.drill?.shape !== "circle" ||
        !close(pad.copper.x, pad.drill.x) ||
        !close(pad.copper.y, pad.drill.y),
    )
  )
    return undefined
  const rows = coordinates(pads.map((pad) => pad.copper.y))
  if (rows.length !== 2) return undefined
  const contacts = pads.filter((pad) => close(pad.copper.y, rows[0]))
  const signals = (
    contacts.length === 4
      ? contacts
      : pads.filter((pad) => close(pad.copper.y, rows[1]))
  ).toSorted((a, b) => a.copper.x - b.copper.x)
  const shell = pads.filter((pad) => !signals.includes(pad))
  if (signals.length !== 4 || shell.length !== 2) return undefined
  const centerX = mean(signals.map((pad) => pad.copper.x))
  if (
    !symmetricPair(shell, centerX) ||
    !close(signals[0].copper.x + signals[3].copper.x, 2 * centerX) ||
    !close(signals[1].copper.x + signals[2].copper.x, 2 * centerX)
  )
    return undefined
  const contactSize = sameDimensions(signals, "copper")
  const contactDrill = sameDimensions(signals, "drill")
  const shellSize = sameDimensions(shell, "copper")
  const shellDrill = sameDimensions(shell, "drill")
  const numbering = getSignalNumbering(signals)
  if (!contactSize || !contactDrill || !shellSize || !shellDrill || !numbering)
    return undefined
  return [
    "usba4",
    ...numbering,
    `p${length(signals[1].copper.x - signals[0].copper.x)}`,
    `centerp${length(signals[2].copper.x - signals[1].copper.x)}`,
    `id${length(contactDrill.width)}`,
    `ring${length((contactSize.width - contactDrill.width) / 2)}`,
    `shieldspan${length(Math.abs(shell[1].copper.x - shell[0].copper.x))}`,
    `shieldy${length(shell[0].copper.y - signals[0].copper.y)}`,
    `shieldid${length(shellDrill.width)}`,
    `shieldring${length((shellSize.width - shellDrill.width) / 2)}`,
  ].join("_")
}

const getUsbMicroSeed = (pads: PcbPadGeometry[]) => {
  if (pads.length !== 11) return undefined
  const smt = pads.filter((pad) => pad.element.type === "pcb_smtpad")
  const slots = pads.filter((pad) => pad.element.type === "pcb_plated_hole")
  if (
    smt.length !== 7 ||
    slots.length !== 4 ||
    smt.some((pad) => pad.copper.shape !== "rect" || pad.copper.cornerRadius) ||
    slots.some(
      (pad) =>
        pad.copper.shape !== "pill" ||
        pad.drill?.shape !== "pill" ||
        !close(pad.copper.x, pad.drill.x) ||
        !close(pad.copper.y, pad.drill.y),
    )
  )
    return undefined
  const rows = coordinates(smt.map((pad) => pad.copper.y))
  if (rows.length !== 2) return undefined
  const rowA = smt.filter((pad) => close(pad.copper.y, rows[0]))
  const signals = (
    rowA.length === 5 ? rowA : smt.filter((pad) => close(pad.copper.y, rows[1]))
  ).toSorted((a, b) => a.copper.x - b.copper.x)
  const tabs = smt.filter((pad) => !signals.includes(pad))
  if (signals.length !== 5 || tabs.length !== 2) return undefined
  const centerX = mean(signals.map((pad) => pad.copper.x))
  if (!symmetricPair(tabs, centerX)) return undefined
  const front = slots.filter((pad) => close(pad.copper.y, tabs[0].copper.y))
  const rear = slots.filter((pad) => !front.includes(pad))
  if (!symmetricPair(front, centerX) || !symmetricPair(rear, centerX))
    return undefined
  const contactPitch = pitch(signals.map((pad) => pad.copper.x))
  const contact = sameDimensions(signals, "copper")
  const tab = sameDimensions(tabs, "copper")
  const frontPad = sameDimensions(front, "copper")
  const frontHole = sameDimensions(front, "drill")
  const rearPad = sameDimensions(rear, "copper")
  const rearHole = sameDimensions(rear, "drill")
  const numbering = getSignalNumbering(signals)
  if (
    !contactPitch ||
    !contact ||
    !tab ||
    !frontPad ||
    !frontHole ||
    !rearPad ||
    !rearHole ||
    !numbering ||
    !close(rearPad.width - rearHole.width, rearPad.height - rearHole.height)
  )
    return undefined
  return [
    "usbmicro5",
    ...numbering,
    `p${length(contactPitch)}`,
    `pw${length(contact.width)}`,
    `ph${length(contact.height)}`,
    `rowy${length(signals[0].copper.y - tabs[0].copper.y)}`,
    `rearspan${length(Math.abs(rear[1].copper.x - rear[0].copper.x))}`,
    `reary${length(rear[0].copper.y - tabs[0].copper.y)}`,
    `rearhw${length(rearHole.width)}`,
    `rearhh${length(rearHole.height)}`,
    `rearring${length((rearPad.width - rearHole.width) / 2)}`,
    `frontspan${length(Math.abs(front[1].copper.x - front[0].copper.x))}`,
    `fronthw${length(frontHole.width)}`,
    `fronthh${length(frontHole.height)}`,
    `frontpw${length(frontPad.width)}`,
    `frontph${length(frontPad.height)}`,
    `tabspan${length(Math.abs(tabs[1].copper.x - tabs[0].copper.x))}`,
    `tabpw${length(tab.width)}`,
    `tabph${length(tab.height)}`,
  ].join("_")
}

export const getReleasedConnectorSeeds = (target: Footprint): string[] => {
  if (target.holes.length || target.vias.length) return []
  const pads = target.pads.map((pad) =>
    getTransformedPcbPadGeometry(pad, target),
  )
  const seeds = new Set(getCompleteHeaderSeeds(pads))
  for (const rotation of [0, 90, 180, 270]) {
    const oriented = rotatePads(pads, rotation)
    const seed = getUsbASeed(oriented) ?? getUsbMicroSeed(oriented)
    if (seed) seeds.add(seed)
  }
  return [...seeds]
}
