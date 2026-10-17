import { expect, test } from "bun:test"
import type { PcbPlatedHole } from "circuit-json"
import {
  getPcbPadGeometry,
  getPolygonWorldPoints,
} from "../lib/footprint-geometry.js"

const polygonPad = (rotation: number): PcbPlatedHole =>
  ({
    type: "pcb_plated_hole",
    pcb_plated_hole_id: "poly_pad",
    pcb_component_id: "component_0",
    shape: "hole_with_polygon_pad",
    hole_shape: "circle",
    hole_diameter: 0.6,
    hole_offset_x: 0.2,
    hole_offset_y: 0,
    x: 2,
    y: -1,
    layers: ["top", "bottom"],
    pad_outline: [
      { x: -1, y: -0.5 },
      { x: 1, y: -0.5 },
      { x: 1, y: 0.5 },
      { x: -1, y: 0.5 },
    ],
    ...(rotation === 0 ? {} : { ccw_rotation: rotation }),
  }) as unknown as PcbPlatedHole

test("places hole_with_polygon_pad outlines at the hole center", () => {
  const copper = getPcbPadGeometry(polygonPad(0)).copper
  expect(getPolygonWorldPoints(copper)).toEqual([
    { x: 1, y: -1.5 },
    { x: 3, y: -1.5 },
    { x: 3, y: -0.5 },
    { x: 1, y: -0.5 },
  ])
})

test("rotates hole_with_polygon_pad outlines by ccw_rotation", () => {
  const copper = getPcbPadGeometry(polygonPad(90)).copper
  const points = getPolygonWorldPoints(copper).map((point) => ({
    x: Number(point.x.toFixed(10)),
    y: Number(point.y.toFixed(10)),
  }))
  expect(points).toEqual([
    { x: 2.5, y: -2 },
    { x: 2.5, y: 0 },
    { x: 1.5, y: 0 },
    { x: 1.5, y: -2 },
  ])
})

test("rotates hole_with_polygon_pad drill offsets with ccw_rotation", () => {
  const drill = getPcbPadGeometry(polygonPad(90)).drill
  expect(drill).toMatchObject({
    x: 2,
    y: -0.8,
  })
})
