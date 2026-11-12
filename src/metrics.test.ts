import { describe, expect, it } from "vitest";
import { canSee, measure, type LandmarkName, type Point3D, type Pose } from "./metrics";

const DEG = 180 / Math.PI;

interface Build {
  yaw: number;
  trunkForward?: number;
  headForward?: number;
  noseDrop?: number;
  hipVisibility?: number;
  mirrored?: boolean;
}

function person({ yaw, trunkForward = 0, headForward = 0, noseDrop = 0.03, hipVisibility = 1, mirrored = false }: Build): Pose {
  const radians = (yaw * Math.PI) / 180;
  const axis = { x: Math.cos(radians), z: Math.sin(radians) };
  const forward = { x: -Math.sin(radians), z: Math.cos(radians) };
  const at = (along: number, down: number, ahead: number): Point3D => ({
    x: axis.x * along + forward.x * ahead,
    y: down,
    z: axis.z * along + forward.z * ahead,
  });
  const side = mirrored ? -1 : 1;
  const headAhead = trunkForward + headForward;
  const world: Record<LandmarkName, Point3D> = {
    leftShoulder: at(-0.2 * side, 0, trunkForward),
    rightShoulder: at(0.2 * side, 0, trunkForward),
    leftEar: at(-0.08 * side, -0.15, headAhead),
    rightEar: at(0.08 * side, -0.15, headAhead),
    nose: at(0, -0.15 + noseDrop, headAhead + 0.1),
    leftHip: at(-0.1 * side, 0.5, 0),
    rightHip: at(0.1 * side, 0.5, 0),
  };
  const image = Object.fromEntries(
    (Object.keys(world) as LandmarkName[]).map((name) => [
      name,
      { x: 0, y: 0, visibility: name.endsWith("Hip") ? hipVisibility : 1 },
    ]),
  ) as Pose["image"];
  return { image, world };
}

describe("measure", () => {
  const cases = [
    { name: "upright", build: { yaw: 0 }, forwardHead: 0, slouch: 0, headDown: Math.atan2(0.03, 0.1) * DEG },
    { name: "head forward", build: { yaw: 0, headForward: 0.05 }, forwardHead: Math.atan2(0.05, 0.15) * DEG, slouch: 0, headDown: Math.atan2(0.03, 0.1) * DEG },
    { name: "head forward at 45 degrees", build: { yaw: 45, headForward: 0.05 }, forwardHead: Math.atan2(0.05, 0.15) * DEG, slouch: 0, headDown: Math.atan2(0.03, 0.1) * DEG },
    { name: "head forward at 90 degrees", build: { yaw: 90, headForward: 0.05 }, forwardHead: Math.atan2(0.05, 0.15) * DEG, slouch: 0, headDown: Math.atan2(0.03, 0.1) * DEG },
    { name: "mirrored body", build: { yaw: 30, headForward: 0.05, mirrored: true }, forwardHead: Math.atan2(0.05, 0.15) * DEG, slouch: 0, headDown: Math.atan2(0.03, 0.1) * DEG },
    { name: "slouched trunk", build: { yaw: 45, trunkForward: 0.1 }, forwardHead: 0, slouch: Math.atan2(0.1, 0.5) * DEG, headDown: Math.atan2(0.03, 0.1) * DEG },
    { name: "chin tucked", build: { yaw: 45, noseDrop: 0.08 }, forwardHead: 0, slouch: 0, headDown: Math.atan2(0.08, 0.1) * DEG },
    { name: "head leaning back is negative", build: { yaw: 45, headForward: -0.05 }, forwardHead: Math.atan2(-0.05, 0.15) * DEG, slouch: 0, headDown: Math.atan2(0.03, 0.1) * DEG },
  ];

  it.each(cases)("$name", ({ build, forwardHead, slouch, headDown }) => {
    const reading = measure(person(build));
    expect(reading.forwardHead).toBeCloseTo(forwardHead, 5);
    expect(reading.slouch).toBeCloseTo(slouch, 5);
    expect(reading.headDown).toBeCloseTo(headDown, 5);
  });

  it("skips slouch when hips are not visible", () => {
    const reading = measure(person({ yaw: 0, hipVisibility: 0.1 }));
    expect(reading.slouch).toBeUndefined();
    expect(reading.forwardHead).toBeDefined();
  });
});

describe("canSee", () => {
  it("needs one ear and shoulder pair", () => {
    const pose = person({ yaw: 0 });
    expect(canSee(pose)).toBe(true);
    pose.image.leftEar.visibility = 0.1;
    expect(canSee(pose)).toBe(true);
    pose.image.rightShoulder.visibility = 0.1;
    expect(canSee(pose)).toBe(false);
  });
});
