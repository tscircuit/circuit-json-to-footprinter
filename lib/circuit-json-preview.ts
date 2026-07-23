import { fp } from "@tscircuit/footprinter"
import {
  getBoundsCenter,
  getBoundsFromPoints,
  type Point,
} from "@tscircuit/math-utils"
import type { AnyCircuitElement } from "circuit-json"
import { getPolygonArea } from "./preview-geometry.js"

export type PreviewPadShape = "circle" | "pill" | "polygon" | "rect"
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
  points?: Point[]
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

const parsePolygonPoints = (value: unknown, elementName: string) => {
  if (!Array.isArray(value) || value.length < 3) {
    throw new Error(`${elementName} must contain at least three points`)
  }

  const points = value.map((rawPoint) => {
    if (!rawPoint || typeof rawPoint !== "object") {
      throw new Error(`${elementName} points must contain finite x/y values`)
    }
    const point = rawPoint as Record<string, unknown>
    const x = toNumber(point.x, Number.NaN)
    const y = toNumber(point.y, Number.NaN)
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error(`${elementName} points must contain finite x/y values`)
    }
    return { x, y }
  })
  if (getPolygonArea(points) <= 1e-12) {
    throw new Error(`${elementName} must enclose a non-zero area`)
  }
  return points
}

const getPolygonSmtPadGeometry = (element: CircuitElement) => {
  const absolutePoints = parsePolygonPoints(
    element.points,
    "Polygon PCB SMT pads",
  )
  const bounds = getBoundsFromPoints(absolutePoints)
  if (!bounds) {
    throw new Error("Polygon PCB SMT pads must contain at least three points")
  }
  const { x, y } = getBoundsCenter(bounds)

  return {
    height: bounds.maxY - bounds.minY,
    points: absolutePoints.map((point) => ({
      x: point.x - x,
      y: point.y - y,
    })),
    width: bounds.maxX - bounds.minX,
    x,
    y,
  }
}

const getSmtPadMetadata = (element: CircuitElement, index: number) => ({
  id: String(element.pcb_smtpad_id ?? `pcb_smtpad_${index + 1}`),
  kind: "smt" as const,
  layer: String(element.layer ?? "top"),
  portHints: Array.isArray(element.port_hints)
    ? element.port_hints.map((hint) => normalizePortHint(String(hint)))
    : [],
})

const parseSmtPad = (element: CircuitElement, index: number): PreviewPad => {
  const metadata = getSmtPadMetadata(element, index)
  if (element.shape === "polygon") {
    return {
      ...metadata,
      ...getPolygonSmtPadGeometry(element),
      rotation: 0,
      shape: "polygon",
    }
  }

  const diameter = toNumber(element.radius) * 2
  const width = toNumber(element.width, diameter)
  const height = toNumber(element.height, width)
  return {
    ...metadata,
    cornerRadius: getCornerRadius(element, width, height),
    height,
    rotation: toNumber(element.ccw_rotation ?? element.rotation),
    shape: normalizeShape(element.shape, width, height),
    width,
    x: toNumber(element.x),
    y: toNumber(element.y),
  }
}

export const circuitJsonToPreview = (
  circuitJson: readonly AnyCircuitElement[],
  options: CircuitJsonPreviewOptions = {},
): FootprintPreview => {
  const pads = circuitJson.flatMap((rawElement, index): PreviewPad[] => {
    const element = rawElement as CircuitElement
    if (element.type === "pcb_smtpad") {
      return [parseSmtPad(element, index)]
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
