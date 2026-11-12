import { FilesetResolver, PoseLandmarker, type NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { Pose } from "./metrics";

const EAR_LEFT = 7;
const EAR_RIGHT = 8;
const SHOULDER_LEFT = 11;
const SHOULDER_RIGHT = 12;

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

export function toPose(landmarks: NormalizedLandmark[]): Pose | undefined {
  const point = (index: number) => {
    const landmark = landmarks[index];
    return landmark && { x: landmark.x, y: landmark.y, visibility: landmark.visibility ?? 0 };
  };
  const leftEar = point(EAR_LEFT);
  const rightEar = point(EAR_RIGHT);
  const leftShoulder = point(SHOULDER_LEFT);
  const rightShoulder = point(SHOULDER_RIGHT);
  if (!leftEar || !rightEar || !leftShoulder || !rightShoulder) return undefined;
  return { leftEar, rightEar, leftShoulder, rightShoulder };
}
