import { type FootprinterParamsBuilder, fp } from "@tscircuit/footprinter"
import type {
  AnyCircuitElement,
  PcbCourtyardOutline,
  PcbCourtyardRect,
  PcbHole,
  PcbPlatedHole,
  PcbSmtPad,
  PcbVia,
} from "circuit-json"
import { validatePcbPad } from "./footprint-geometry.js"

export interface Footprint {
  courtyard?: {
    center: { x: number; y: number }
    height: number
    width: number
  }
  holes: PcbHole[]
  pads: Array<PcbSmtPad | PcbPlatedHole>
  rotation?: number
  sourceHints?: string[]
  subtitle: string
  title: string
  vias: PcbVia[]
  x?: number
  y?: number
}

export interface CircuitJsonToFootprintOptions {
  sourceHints?: string[]
  subtitle?: string
  title?: string
}

const isPcbPad = (
  element: AnyCircuitElement,
): element is PcbSmtPad | PcbPlatedHole =>
  element.type === "pcb_smtpad" || element.type === "pcb_plated_hole"

const isPcbHole = (element: AnyCircuitElement): element is PcbHole =>
  element.type === "pcb_hole"

const isPcbVia = (element: AnyCircuitElement): element is PcbVia =>
  element.type === "pcb_via"

const getAxisAlignedCourtyard = (
  circuitJson: readonly AnyCircuitElement[],
  pads: Array<PcbSmtPad | PcbPlatedHole>,
): Footprint["courtyard"] => {
  const pcbComponentIds = new Set(
    pads.flatMap((pad) => (pad.pcb_component_id ? [pad.pcb_component_id] : [])),
  )
  const belongsToFootprint = (
    courtyard: PcbCourtyardOutline | PcbCourtyardRect,
  ) =>
    pcbComponentIds.size === 0 ||
    pcbComponentIds.has(courtyard.pcb_component_id)

  const candidates = circuitJson.flatMap((element) => {
    if (element.type === "pcb_courtyard_rect" && belongsToFootprint(element)) {
      const normalizedRotation =
        (((element.ccw_rotation ?? 0) % 180) + 180) % 180
      if (Math.abs(normalizedRotation) < 0.00001) {
        return [
          {
            center: element.center,
            width: element.width,
            height: element.height,
          },
        ]
      }
      if (Math.abs(normalizedRotation - 90) < 0.00001) {
        return [
          {
            center: element.center,
            width: element.height,
            height: element.width,
          },
        ]
      }
      return []
    }

    if (
      element.type !== "pcb_courtyard_outline" ||
      !belongsToFootprint(element) ||
      element.outline.length < 4
    ) {
      return []
    }

    const xs = element.outline.map(({ x }) => x)
    const ys = element.outline.map(({ y }) => y)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const isCorner = ({ x, y }: { x: number; y: number }) =>
      (Math.abs(x - minX) < 0.00001 || Math.abs(x - maxX) < 0.00001) &&
      (Math.abs(y - minY) < 0.00001 || Math.abs(y - maxY) < 0.00001)
    if (maxX <= minX || maxY <= minY || !element.outline.every(isCorner)) {
      return []
    }

    return [
      {
        center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
        width: maxX - minX,
        height: maxY - minY,
      },
    ]
  })

  return candidates.toSorted(
    (left, right) => right.width * right.height - left.width * left.height,
  )[0]
}

const SOURCE_COMPONENT_FAMILY_HINTS: Record<string, string> = {
  simple_capacitor: "capacitor",
  simple_diode: "diode",
  simple_fuse: "fuse",
  simple_inductor: "inductor",
  simple_led: "led",
  simple_resistor: "resistor",
}

const getSourceComponentFamilyHints = (
  circuitJson: readonly AnyCircuitElement[],
  pads: Array<PcbSmtPad | PcbPlatedHole>,
) => {
  const pcbComponentIds = new Set(
    pads.flatMap((pad) => (pad.pcb_component_id ? [pad.pcb_component_id] : [])),
  )
  if (pcbComponentIds.size === 0) return []

  const sourceComponentIds = new Set(
    circuitJson.flatMap((element) =>
      element.type === "pcb_component" &&
      pcbComponentIds.has(element.pcb_component_id)
        ? [element.source_component_id]
        : [],
    ),
  )

  return [
    ...new Set(
      circuitJson.flatMap((element) => {
        if (
          element.type !== "source_component" ||
          !sourceComponentIds.has(element.source_component_id) ||
          !element.ftype
        ) {
          return []
        }
        const hint = SOURCE_COMPONENT_FAMILY_HINTS[element.ftype]
        return hint ? [hint] : []
      }),
    ),
  ]
}

export const circuitJsonToFootprint = (
  circuitJson: readonly AnyCircuitElement[],
  options: CircuitJsonToFootprintOptions = {},
): Footprint => {
  const pads = circuitJson.filter(isPcbPad)
  const holes = circuitJson.filter(isPcbHole)
  const vias = circuitJson.filter(isPcbVia)

  if (pads.length === 0) {
    throw new Error(
      "Circuit JSON must contain at least one PcbSmtPad or PcbPlatedHole",
    )
  }

  pads.forEach(validatePcbPad)

  const sourceComponentFamilyHints = getSourceComponentFamilyHints(
    circuitJson,
    pads,
  )

  return {
    courtyard: getAxisAlignedCourtyard(circuitJson, pads),
    holes,
    pads,
    rotation: 0,
    sourceHints: [
      ...(options.sourceHints ?? []),
      ...sourceComponentFamilyHints,
    ],
    subtitle: options.subtitle ?? "Circuit JSON footprint",
    title: options.title ?? "Circuit JSON",
    vias,
    x: 0,
    y: 0,
  }
}

export const footprinterStringToFootprint = (
  footprinterString: string,
): Footprint => {
  const normalized = footprinterString.trim()
  if (!normalized) throw new Error("Footprinter string is required")
  const builder = fp.string(normalized)
  const usesRectangularBgaPads =
    /^bga(?:\d|_)/i.test(normalized) && /_rectpads(?:_|$)/i.test(normalized)
  // string() is typed without family modifiers, but returns the same proxy as bga().
  const bgaBuilder =
    builder as unknown as FootprinterParamsBuilder<"circularpads">
  const circuitJson = usesRectangularBgaPads
    ? bgaBuilder.circularpads(false).circuitJson()
    : builder.circuitJson()

  return circuitJsonToFootprint(circuitJson, {
    subtitle: "Generated by @tscircuit/footprinter",
    title: normalized,
  })
}
