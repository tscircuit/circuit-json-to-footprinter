import {
  getBoundsCenter,
  getBoundsFromPoints,
  type Bounds as MathBounds,
} from "@tscircuit/math-utils"
import type { PcbHole, PcbPlatedHole, PcbSmtPad, Point } from "circuit-json"

type ShapeKind = "circle" | "ellipse" | "pill" | "polygon" | "rect"

const HOLE_SHAPE_KIND = {
  circle: "circle",
  oval: "ellipse",
  pill: "pill",
  rect: "rect",
  rotated_pill: "pill",
  square: "rect",
} as const satisfies Record<PcbHole["hole_shape"], ShapeKind>

export interface ShapeGeometry {
  cornerRadius?: number
  height: number
  points?: Point[]
  rotation: number
  shape: ShapeKind
  width: number
  x: number
  y: number
}

export type PcbPad = PcbSmtPad | PcbPlatedHole

export interface PcbPadGeometry {
  copper: ShapeGeometry
  drill?: ShapeGeometry
  element: PcbPad
}

export interface Bounds extends MathBounds {
  height: number
  width: number
}

export const toRadians = (degrees: number) => (degrees * Math.PI) / 180

export const rotatePoint = (x: number, y: number, radians: number) => ({
  x: x * Math.cos(radians) - y * Math.sin(radians),
  y: x * Math.sin(radians) + y * Math.cos(radians),
})

const getSizedBounds = (points: readonly Point[]): Bounds => {
  const bounds = getBoundsFromPoints([...points])
  if (!bounds) {
    throw new Error("Cannot calculate bounds for an empty point list")
  }

  return {
    ...bounds,
    height: bounds.maxY - bounds.minY,
    width: bounds.maxX - bounds.minX,
  }
}

export const getPolygonArea = (points: readonly Point[]) => {
  let doubledArea = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    doubledArea += current.x * next.y - next.x * current.y
  }
  return Math.abs(doubledArea) / 2
}

const validatePolygon = (points: readonly Point[], elementName: string) => {
  if (points.length < 3) {
    throw new Error(`${elementName} must contain at least three points`)
  }
  if (
    points.some(
      (point) => !Number.isFinite(point.x) || !Number.isFinite(point.y),
    )
  ) {
    throw new Error(`${elementName} points must contain finite x/y values`)
  }
  if (getPolygonArea(points) <= 1e-12) {
    throw new Error(`${elementName} must enclose a non-zero area`)
  }
}

export const validatePcbPad = (pad: PcbPad) => {
  if (pad.type === "pcb_smtpad" && pad.shape === "polygon") {
    validatePolygon(pad.points, "Polygon PCB SMT pads")
  }
  if (pad.type === "pcb_plated_hole" && pad.shape === "hole_with_polygon_pad") {
    validatePolygon(pad.pad_outline, "Polygon plated-hole pads")
  }
}

// Compatibility is isolated here so the rest of the converter only handles
// the current Circuit JSON representation.
const getLegacyCornerRadius = (pad: object) =>
  "cornerRadius" in pad &&
  typeof pad.cornerRadius === "number" &&
  Number.isFinite(pad.cornerRadius)
    ? pad.cornerRadius
    : undefined

// @tscircuit/footprinter 0.0.385 emits ccw_rotation on rect and pill pads
// instead of using the rotated_rect and rotated_pill discriminants.
const getLegacySmtPadRotation = (pad: PcbSmtPad) =>
  "ccw_rotation" in pad &&
  typeof pad.ccw_rotation === "number" &&
  Number.isFinite(pad.ccw_rotation)
    ? pad.ccw_rotation
    : 0

const getCornerRadius = (
  pad:
    | Extract<PcbSmtPad, { shape: "rect" | "rotated_rect" }>
    | Extract<
        PcbPlatedHole,
        {
          shape:
            | "circular_hole_with_rect_pad"
            | "pill_hole_with_rect_pad"
            | "rotated_pill_hole_with_rect_pad"
        }
      >,
) => {
  const radius =
    "corner_radius" in pad
      ? (pad.corner_radius ??
        pad.rect_border_radius ??
        getLegacyCornerRadius(pad))
      : (pad.rect_border_radius ?? getLegacyCornerRadius(pad))
  if (!radius || radius <= 0) return undefined
  const width = "width" in pad ? pad.width : pad.rect_pad_width
  const height = "height" in pad ? pad.height : pad.rect_pad_height
  return Math.min(radius, width / 2, height / 2)
}

const getPolygonGeometry = (
  absolutePoints: readonly Point[],
  elementName: string,
): ShapeGeometry => {
  validatePolygon(absolutePoints, elementName)
  const bounds = getBoundsFromPoints([...absolutePoints])
  if (!bounds) {
    throw new Error(`${elementName} must contain at least three points`)
  }
  const { x, y } = getBoundsCenter(bounds)

  return {
    height: bounds.maxY - bounds.minY,
    points: absolutePoints.map((point) => ({
      x: point.x - x,
      y: point.y - y,
    })),
    rotation: 0,
    shape: "polygon",
    width: bounds.maxX - bounds.minX,
    x,
    y,
  }
}

const getSmtPadCopperShape = (pad: PcbSmtPad): ShapeGeometry => {
  switch (pad.shape) {
    case "circle":
      return {
        height: pad.radius * 2,
        rotation: 0,
        shape: "circle",
        width: pad.radius * 2,
        x: pad.x,
        y: pad.y,
      }
    case "rect":
    case "rotated_rect":
      return {
        cornerRadius: getCornerRadius(pad),
        height: pad.height,
        rotation:
          pad.shape === "rotated_rect"
            ? pad.ccw_rotation
            : getLegacySmtPadRotation(pad),
        shape: "rect",
        width: pad.width,
        x: pad.x,
        y: pad.y,
      }
    case "pill":
    case "rotated_pill":
      return {
        height: pad.height,
        rotation:
          pad.shape === "rotated_pill"
            ? pad.ccw_rotation
            : getLegacySmtPadRotation(pad),
        shape: "pill",
        width: pad.width,
        x: pad.x,
        y: pad.y,
      }
    case "polygon":
      return getPolygonGeometry(pad.points, "Polygon PCB SMT pads")
  }
}

const getPlatedHoleDrillGeometry = (pad: PcbPlatedHole): ShapeGeometry => {
  switch (pad.shape) {
    case "circle":
      return {
        height: pad.hole_diameter,
        rotation: 0,
        shape: "circle",
        width: pad.hole_diameter,
        x: pad.x,
        y: pad.y,
      }
    case "oval":
    case "pill":
      return {
        height: pad.hole_height,
        rotation: pad.ccw_rotation,
        shape: pad.shape === "oval" ? "ellipse" : "pill",
        width: pad.hole_width,
        x: pad.x,
        y: pad.y,
      }
    case "circular_hole_with_rect_pad":
      return {
        height: pad.hole_diameter,
        rotation: 0,
        shape: "circle",
        width: pad.hole_diameter,
        x: pad.x + pad.hole_offset_x,
        y: pad.y + pad.hole_offset_y,
      }
    case "pill_hole_with_rect_pad":
      return {
        height: pad.hole_height,
        rotation: 0,
        shape: "pill",
        width: pad.hole_width,
        x: pad.x + pad.hole_offset_x,
        y: pad.y + pad.hole_offset_y,
      }
    case "rotated_pill_hole_with_rect_pad":
      return {
        height: pad.hole_height,
        rotation: pad.hole_ccw_rotation,
        shape: "pill",
        width: pad.hole_width,
        x: pad.x + pad.hole_offset_x,
        y: pad.y + pad.hole_offset_y,
      }
    case "hole_with_polygon_pad": {
      const diameter = pad.hole_diameter ?? 0
      return {
        height: pad.hole_height ?? diameter,
        rotation:
          pad.hole_shape === "rotated_pill" ? (pad.ccw_rotation ?? 0) : 0,
        shape: HOLE_SHAPE_KIND[pad.hole_shape],
        width: pad.hole_width ?? diameter,
        x: pad.x + pad.hole_offset_x,
        y: pad.y + pad.hole_offset_y,
      }
    }
  }
}

const getPlatedHoleCopperShape = (pad: PcbPlatedHole): ShapeGeometry => {
  switch (pad.shape) {
    case "circle":
      return {
        height: pad.outer_diameter,
        rotation: 0,
        shape: "circle",
        width: pad.outer_diameter,
        x: pad.x,
        y: pad.y,
      }
    case "oval":
    case "pill":
      return {
        height: pad.outer_height,
        rotation: pad.ccw_rotation,
        shape: pad.shape === "oval" ? "ellipse" : "pill",
        width: pad.outer_width,
        x: pad.x,
        y: pad.y,
      }
    case "circular_hole_with_rect_pad":
    case "pill_hole_with_rect_pad":
    case "rotated_pill_hole_with_rect_pad":
      return {
        cornerRadius: getCornerRadius(pad),
        height: pad.rect_pad_height,
        rotation: "rect_ccw_rotation" in pad ? (pad.rect_ccw_rotation ?? 0) : 0,
        shape: "rect",
        width: pad.rect_pad_width,
        x: pad.x,
        y: pad.y,
      }
    case "hole_with_polygon_pad":
      return getPolygonGeometry(
        pad.pad_outline.map((point) => ({
          x: point.x + pad.x,
          y: point.y + pad.y,
        })),
        "Polygon plated-hole pads",
      )
  }
}

export const getPcbPadGeometry = (pad: PcbPad): PcbPadGeometry => ({
  copper:
    pad.type === "pcb_smtpad"
      ? getSmtPadCopperShape(pad)
      : getPlatedHoleCopperShape(pad),
  drill:
    pad.type === "pcb_plated_hole"
      ? getPlatedHoleDrillGeometry(pad)
      : undefined,
  element: pad,
})

export const getPcbHoleGeometry = (hole: PcbHole): ShapeGeometry => {
  switch (hole.hole_shape) {
    case "circle":
    case "square":
      return {
        height: hole.hole_diameter,
        rotation: 0,
        shape: HOLE_SHAPE_KIND[hole.hole_shape],
        width: hole.hole_diameter,
        x: hole.x,
        y: hole.y,
      }
    case "rect":
    case "oval":
    case "pill":
    case "rotated_pill":
      return {
        height: hole.hole_height,
        rotation: hole.hole_shape === "rotated_pill" ? hole.ccw_rotation : 0,
        shape: HOLE_SHAPE_KIND[hole.hole_shape],
        width: hole.hole_width,
        x: hole.x,
        y: hole.y,
      }
  }
}

export const getPolygonWorldPoints = (shape: ShapeGeometry): Point[] => {
  if (shape.shape !== "polygon" || !shape.points) {
    throw new Error("Polygon PCB shapes require points")
  }
  const radians = toRadians(shape.rotation)
  return shape.points.map((point) => {
    const rotated = rotatePoint(point.x, point.y, radians)
    return { x: rotated.x + shape.x, y: rotated.y + shape.y }
  })
}

export const getShapeBounds = (shape: ShapeGeometry): Bounds => {
  if (shape.shape === "polygon") {
    if (!shape.points || shape.points.length < 3) {
      throw new Error("Polygon PCB shapes require at least three points")
    }
    return getSizedBounds(getPolygonWorldPoints(shape))
  }

  const halfWidth = shape.width / 2
  const halfHeight = shape.height / 2
  const radians = toRadians(shape.rotation)
  const corners = [
    rotatePoint(-halfWidth, -halfHeight, radians),
    rotatePoint(halfWidth, -halfHeight, radians),
    rotatePoint(halfWidth, halfHeight, radians),
    rotatePoint(-halfWidth, halfHeight, radians),
  ].map((corner) => ({
    x: corner.x + shape.x,
    y: corner.y + shape.y,
  }))
  return getSizedBounds(corners)
}

export const getShapeListBounds = (
  shapes: readonly ShapeGeometry[],
): Bounds => {
  if (shapes.length === 0) {
    return {
      height: 1,
      maxX: 0.5,
      maxY: 0.5,
      minX: -0.5,
      minY: -0.5,
      width: 1,
    }
  }

  const bounds = shapes.map(getShapeBounds)
  return getSizedBounds(
    bounds.flatMap((bound) => [
      { x: bound.minX, y: bound.minY },
      { x: bound.maxX, y: bound.maxY },
    ]),
  )
}

export const getFootprintBounds = (pads: readonly PcbPad[]): Bounds =>
  getShapeListBounds(pads.map((pad) => getPcbPadGeometry(pad).copper))
