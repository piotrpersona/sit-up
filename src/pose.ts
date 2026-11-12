import { FilesetResolver, PoseLandmarker, type Landmark, type NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { LandmarkName, Point, Point3D, Pose } from "./metrics";

const INDEX: Record<LandmarkName, number> = {
  nose: 0,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftHip: 23,
  rightHip: 24,
};

const NAMES = Object.keys(INDEX) as LandmarkName[];

export async function createLandmarker(): Promise<PoseLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks("./wasm");
  const options = (delegate: "GPU" | "CPU") => ({
    baseOptions: { modelAssetPath: "./models/pose_landmarker_lite.task", delegate },
    runningMode: "VIDEO" as const,
    numPoses: 1,
  });
  try {
    return await PoseLandmarker.createFromOptions(fileset, options("GPU"));
  } catch {
    return await PoseLandmarker.createFromOptions(fileset, options("CPU"));
  }
}

export function toPose(landmarks: NormalizedLandmark[], worldLandmarks: Landmark[]): Pose | undefined {
  const image = {} as Record<LandmarkName, Point>;
  const world = {} as Record<LandmarkName, Point3D>;
  for (const name of NAMES) {
    const landmark = landmarks[INDEX[name]];
    const worldLandmark = worldLandmarks[INDEX[name]];
    if (!landmark || !worldLandmark) return undefined;
    image[name] = { x: landmark.x, y: landmark.y, visibility: landmark.visibility ?? 0 };
    world[name] = { x: worldLandmark.x, y: worldLandmark.y, z: worldLandmark.z };
  }
  return { image, world };
}
