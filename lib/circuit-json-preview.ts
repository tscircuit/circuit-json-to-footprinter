import { fp } from "@tscircuit/footprinter"
import type { AnyCircuitElement } from "circuit-json"

export type PreviewPadShape = "circle" | "pill" | "rect"
export type PreviewPadKind = "plated-hole" | "smt"

export interface PreviewHole {
  height: number
  offsetX: number
  offsetY: number
  rotation: number
  shape: PreviewPadShape
  width: number
}

export interface PreviewPad {
  cornerRadius?: number
  height: number
  hole?: PreviewHole
  id: string
  kind: PreviewPadKind
  layer: string
  portHints: string[]
  rotation: number
  shape: PreviewPadShape
  width: number
  x: number
  y: number
}

export interface FootprintPreview {
  pads: PreviewPad[]
  sourceHints?: string[]
  subtitle: string
  title: string
}

export interface CircuitJsonPreviewOptions {
  sourceHints?: string[]
  subtitle?: string
  title?: string
}

type CircuitElement = AnyCircuitElement & Record<string, unknown>

const toNumber = (value: unknown, fallback = 0) => {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

const normalizePortHint = (hint: string) => {
  const trimmed = hint.trim()
  const pinMatch = trimmed.match(/^pin(\d+)$/i)
  if (pinMatch) return `pin${pinMatch[1]}`
  const numericMatch = trimmed.match(/^(\d+)$/)
  return numericMatch ? `pin${numericMatch[1]}` : trimmed
}

const normalizeShape = (
  shape: unknown,
  width: number,
  height: number,
): PreviewPadShape => {
  const normalized = typeof shape === "string" ? shape.toLowerCase() : "rect"
  if (normalized === "circle" || normalized === "ellipse") return "circle"
  if (
    normalized === "pill" ||
    normalized === "oval" ||
    normalized === "rotated_pill"
  ) {
    return "pill"
  }
  if (Math.abs(width - height) < 0.00001 && normalized === "round") {
    return "circle"
  }
  return "rect"
}

const getCornerRadius = (
  element: CircuitElement,
  width: number,
  height: number,
) => {
  const radius = toNumber(
    element.corner_radius ?? element.cornerRadius ?? element.rect_border_radius,
  )
  return radius > 0 ? Math.min(radius, width / 2, height / 2) : undefined
}

const getPlatedHolePadGeometry = (element: CircuitElement) => {
  const elementShape = String(element.shape ?? "circle").toLowerCase()
  const hasRectPad =
    element.pad_shape === "rect" || elementShape.includes("with_rect_pad")
  const outerDiameter = toNumber(
    element.outer_diameter ?? element.outerDiameter,
    0.6,
  )
  const width = hasRectPad
    ? toNumber(
        element.rect_pad_width ?? element.outer_width ?? element.width,
        outerDiameter,
      )
    : toNumber(element.outer_width ?? element.width, outerDiameter)
  const height = hasRectPad
    ? toNumber(
        element.rect_pad_height ?? element.outer_height ?? element.height,
        width,
      )
    : toNumber(element.outer_height ?? element.height, width)
  const shape = hasRectPad
    ? normalizeShape(element.pad_shape ?? "rect", width, height)
    : normalizeShape(elementShape, width, height)
  const rotation = hasRectPad
    ? toNumber(
        element.rect_ccw_rotation ?? element.ccw_rotation ?? element.rotation,
      )
    : toNumber(element.ccw_rotation ?? element.rotation)

  return { height, rotation, shape, width }
}

const getPlatedHoleGeometry = (
  element: CircuitElement,
): PreviewHole | undefined => {
  const elementShape = String(element.shape ?? "circle").toLowerCase()
  const rawHoleShape = String(
    element.hole_shape ??
      (elementShape === "circle" ||
      elementShape === "oval" ||
      elementShape === "pill"
        ? elementShape
        : "circle"),
  ).toLowerCase()
  const holeDiameter = toNumber(element.hole_diameter)
  const width = toNumber(element.hole_width, holeDiameter)
  const height = toNumber(element.hole_height, width)
  if (width <= 0 || height <= 0) return undefined

  return {
    height,
    offsetX: toNumber(element.hole_offset_x),
    offsetY: toNumber(element.hole_offset_y),
    rotation: toNumber(
      element.hole_ccw_rotation ??
        (elementShape === "oval" || elementShape === "pill"
          ? element.ccw_rotation
          : undefined) ??
        element.rotation,
    ),
    shape: normalizeShape(rawHoleShape, width, height),
    width,
  }
}

export const circuitJsonToPreview = (
  circuitJson: readonly AnyCircuitElement[],
  options: CircuitJsonPreviewOptions = {},
): FootprintPreview => {
  const pads = circuitJson.flatMap((rawElement, index): PreviewPad[] => {
    const element = rawElement as CircuitElement
    if (element.type === "pcb_smtpad") {
      const diameter = toNumber(element.radius) * 2
      const width = toNumber(element.width, diameter)
      const height = toNumber(element.height, width)
      return [
        {
          cornerRadius: getCornerRadius(element, width, height),
          height,
          id: String(element.pcb_smtpad_id ?? `pcb_smtpad_${index + 1}`),
          kind: "smt",
          layer: String(element.layer ?? "top"),
          portHints: Array.isArray(element.port_hints)
            ? element.port_hints.map((hint) => normalizePortHint(String(hint)))
            : [],
          rotation: toNumber(element.ccw_rotation ?? element.rotation),
          shape: normalizeShape(element.shape, width, height),
          width,
          x: toNumber(element.x),
          y: toNumber(element.y),
        },
      ]
    }
    if (element.type === "pcb_plated_hole") {
      const { height, rotation, shape, width } =
        getPlatedHolePadGeometry(element)
      return [
        {
          cornerRadius: getCornerRadius(element, width, height),
          height,
          hole: getPlatedHoleGeometry(element),
          id: String(
            element.pcb_plated_hole_id ?? `pcb_plated_hole_${index + 1}`,
          ),
          kind: "plated-hole",
          layer: Array.isArray(element.layers)
            ? String(element.layers[0] ?? "top")
            : "top",
          portHints: Array.isArray(element.port_hints)
            ? element.port_hints.map((hint) => normalizePortHint(String(hint)))
            : [],
          rotation,
          shape,
          width,
          x: toNumber(element.x),
          y: toNumber(element.y),
        },
      ]
    }
    return []
  })

  if (pads.length === 0) {
    throw new Error(
      "Circuit JSON must contain at least one PCB SMT pad or plated hole",
    )
  }

  return {
    pads,
    sourceHints: options.sourceHints,
    subtitle: options.subtitle ?? "Circuit JSON footprint",
    title: options.title ?? "Circuit JSON",
  }
}

export const footprinterStringToPreview = (
  footprinterString: string,
): FootprintPreview => {
  const normalized = footprinterString.trim()
  if (!normalized) throw new Error("Footprinter string is required")
  return circuitJsonToPreview(
    fp.string(normalized).circuitJson() as AnyCircuitElement[],
    {
      subtitle: "Generated by @tscircuit/footprinter",
      title: normalized,
    },
  )
}
