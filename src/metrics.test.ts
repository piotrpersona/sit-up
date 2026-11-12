import { describe, expect, it } from "vitest";
import { angledAngle, deviation, frontRatio, sideAngle, type Point3D, type Pose, type WorldPose } from "./metrics";

const frame = { width: 100, height: 100 };
const p = (x: number, y: number, visibility = 1) => ({ x, y, visibility });
const noWorld: WorldPose = {
  leftEar: { x: 0, y: 0, z: 0 },
  rightEar: { x: 0, y: 0, z: 0 },
  leftShoulder: { x: 0, y: 0, z: 0 },
  rightShoulder: { x: 0, y: 0, z: 0 },
};

describe("sideAngle", () => {
  const cases: { name: string; pose: Pose; expected: number }[] = [
    {
      name: "ear straight above shoulder",
      pose: { leftEar: p(0.5, 0.2), rightEar: p(0.5, 0.2, 0), leftShoulder: p(0.5, 0.5), rightShoulder: p(0.5, 0.5, 0), world: noWorld },
      expected: 0,
    },
    {
      name: "ear forward 45 degrees",
      pose: { leftEar: p(0.7, 0.3), rightEar: p(0.7, 0.3, 0), leftShoulder: p(0.5, 0.5), rightShoulder: p(0.5, 0.5, 0), world: noWorld },
      expected: 45,
    },
    {
      name: "mirrored facing direction gives the same angle",
      pose: { leftEar: p(0.3, 0.3), rightEar: p(0.3, 0.3, 0), leftShoulder: p(0.5, 0.5), rightShoulder: p(0.5, 0.5, 0), world: noWorld },
      expected: 45,
    },
    {
      name: "uses the more visible right side",
      pose: { leftEar: p(0.9, 0.3, 0.1), rightEar: p(0.5, 0.2), leftShoulder: p(0.9, 0.5, 0.1), rightShoulder: p(0.5, 0.5), world: noWorld },
      expected: 0,
    },
  ];

  it.each(cases)("$name", ({ pose, expected }) => {
    expect(sideAngle(pose, frame)).toBeCloseTo(expected, 5);
  });
});

describe("frontRatio", () => {
  it("shrinks as the head drops toward the shoulders", () => {
    const upright: Pose = { leftEar: p(0.4, 0.2), rightEar: p(0.6, 0.2), leftShoulder: p(0.3, 0.5), rightShoulder: p(0.7, 0.5), world: noWorld };
    const slouched: Pose = { ...upright, leftEar: p(0.4, 0.4), rightEar: p(0.6, 0.4) };
    expect(frontRatio(upright, frame)).toBeCloseTo(0.75, 5);
    expect(frontRatio(slouched, frame)).toBeCloseTo(0.25, 5);
  });
});

describe("deviation", () => {
  const cases = [
    { mode: "side" as const, baseline: 10, current: 25, expected: 15 },
    { mode: "side" as const, baseline: 10, current: 5, expected: -5 },
    { mode: "front" as const, baseline: 0.8, current: 0.6, expected: 25 },
    { mode: "front" as const, baseline: 0.8, current: 0.88, expected: -10 },
  ];

  it.each(cases)("$mode $baseline -> $current", ({ mode, baseline, current, expected }) => {
    expect(deviation(mode, baseline, current)).toBeCloseTo(expected, 5);
  });
});

describe("angledAngle", () => {
  const person = (yawDegrees: number, forwardOffset: number): WorldPose => {
    const yaw = (yawDegrees * Math.PI) / 180;
    const axis = { x: Math.cos(yaw), z: Math.sin(yaw) };
    const forward = { x: -Math.sin(yaw), z: Math.cos(yaw) };
    const at = (along: number, up: number, ahead: number): Point3D => ({
      x: axis.x * along + forward.x * ahead,
      y: -up,
      z: axis.z * along + forward.z * ahead,
    });
    return {
      leftShoulder: at(-0.2, 0, 0),
      rightShoulder: at(0.2, 0, 0),
      leftEar: at(-0.08, 0.15, forwardOffset),
      rightEar: at(0.08, 0.15, forwardOffset),
    };
  };

  const cases = [
    { yaw: 0, forwardOffset: 0.15, expected: 45 },
    { yaw: 45, forwardOffset: 0.15, expected: 45 },
    { yaw: 90, forwardOffset: 0.15, expected: 45 },
    { yaw: 45, forwardOffset: 0, expected: 0 },
    { yaw: 30, forwardOffset: 0.05, expected: Math.atan2(0.05, 0.15) * (180 / Math.PI) },
  ];

  it.each(cases)("yaw $yaw offset $forwardOffset", ({ yaw, forwardOffset, expected }) => {
    expect(angledAngle(person(yaw, forwardOffset))).toBeCloseTo(expected, 5);
  });
});
