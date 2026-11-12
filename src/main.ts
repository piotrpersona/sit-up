import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import { Beeper, SlouchAlarm } from "./alarm";
import { METRICS, METRIC_IDS, canSee, measure, type MetricId, type Pose, type Reading } from "./metrics";
import { createLandmarker, toPose } from "./pose";

const HOLD_MS = 3000;
const REPEAT_MS = 5000;
const DETECTION_INTERVAL_MS = 200;
const SMOOTHING = 0.4;
const STORAGE_KEY = "posture-guard:v2";

interface Settings {
  thresholds: Record<MetricId, number>;
  baselines: Reading;
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing element #${id}`);
  return element as T;
}

const video = byId<HTMLVideoElement>("video");
const overlay = byId<HTMLCanvasElement>("overlay");
const status = byId<HTMLDivElement>("status");
const startButton = byId<HTMLButtonElement>("start");
const calibrateButton = byId<HTMLButtonElement>("calibrate");
const stopButton = byId<HTMLButtonElement>("stop");
const dialog = byId<HTMLDialogElement>("dialog");
const dialogTitle = byId<HTMLHeadingElement>("dialogTitle");
const dialogBody = byId<HTMLParagraphElement>("dialogBody");
const metricsContainer = byId<HTMLDivElement>("metrics");
const context = overlay.getContext("2d");

function loadSettings(): Settings {
  const defaults: Settings = {
    thresholds: { forwardHead: METRICS.forwardHead.initial, slouch: METRICS.slouch.initial, headDown: METRICS.headDown.initial },
    baselines: {},
  };
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Settings> | null;
    return {
      thresholds: { ...defaults.thresholds, ...stored?.thresholds },
      baselines: { ...stored?.baselines },
    };
  } catch {
    return defaults;
  }
}

function saveSettings(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // storage unavailable, settings last for this session only
  }
}

const settings = loadSettings();
const beeper = new Beeper();
const alarm = new SlouchAlarm(beeper, HOLD_MS, REPEAT_MS);
let landmarker: PoseLandmarker | undefined;
let smoothed: Reading = {};
let lastVideoTime = -1;
let wakeLock: WakeLockSentinel | undefined;

function showDialog(title: string, body: string): void {
  dialogTitle.textContent = title;
  dialogBody.textContent = body;
  dialog.showModal();
}

interface Row {
  root: HTMLDivElement;
  limit: HTMLOutputElement;
  readout: HTMLDivElement;
}

function createRow(id: MetricId): Row {
  const metric = METRICS[id];
  const root = document.createElement("div");
  root.className = "metric";

  const title = document.createElement("div");
  title.className = "metric-title";
  const name = document.createElement("span");
  name.textContent = metric.label;
  const limit = document.createElement("output");
  title.append(name, limit);

  const slider = document.createElement("input");
  slider.type = "range";
  slider.step = "1";
  slider.min = String(metric.min);
  slider.max = String(metric.max);
  slider.value = String(settings.thresholds[id]);
  slider.addEventListener("input", () => {
    settings.thresholds[id] = Number(slider.value);
    limit.textContent = `alarm over ${slider.value}°`;
    saveSettings();
  });
  limit.textContent = `alarm over ${slider.value}°`;

  const readout = document.createElement("div");
  readout.className = "metric-readout";

  root.append(title, slider, readout);
  metricsContainer.append(root);
  return { root, limit, readout };
}

const rows = Object.fromEntries(METRIC_IDS.map((id) => [id, createRow(id)])) as Record<MetricId, Row>;

function degrees(value: number | undefined): string {
  return value === undefined ? "-" : `${value.toFixed(1)}°`;
}

function renderRow(id: MetricId, over: number | undefined, bad: boolean): void {
  const row = rows[id];
  row.root.classList.toggle("bad", bad);
  row.readout.textContent = `now ${degrees(smoothed[id])} · baseline ${degrees(settings.baselines[id])} · over ${degrees(over)}`;
}

function setStatus(text: string, kind: "idle" | "good" | "bad"): void {
  status.textContent = text;
  status.className = `status ${kind}`;
}

function draw(pose: Pose | undefined, bad: boolean): void {
  if (!context) return;
  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;
  context.clearRect(0, 0, overlay.width, overlay.height);
  if (!pose) return;
  const { image } = pose;
  const color = bad ? "#d64545" : "#3ddc84";
  const at = (p: { x: number; y: number }) => [p.x * overlay.width, p.y * overlay.height] as const;
  const hipsVisible = Math.min(image.leftHip.visibility, image.rightHip.visibility) >= 0.5;
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = 4;
  const lines = [
    [image.leftEar, image.leftShoulder],
    [image.rightEar, image.rightShoulder],
    [image.leftShoulder, image.rightShoulder],
    [image.leftEar, image.nose],
    [image.rightEar, image.nose],
    ...(hipsVisible
      ? [
          [image.leftShoulder, image.leftHip],
          [image.rightShoulder, image.rightHip],
        ]
      : []),
  ] as const;
  for (const [from, to] of lines) {
    context.beginPath();
    context.moveTo(...at(from));
    context.lineTo(...at(to));
    context.stroke();
  }
  const points = [image.nose, image.leftEar, image.rightEar, image.leftShoulder, image.rightShoulder];
  for (const p of hipsVisible ? [...points, image.leftHip, image.rightHip] : points) {
    context.beginPath();
    context.arc(...at(p), 7, 0, Math.PI * 2);
    context.fill();
  }
}

function smooth(reading: Reading): void {
  const next: Reading = {};
  for (const id of METRIC_IDS) {
    const value = reading[id];
    if (value === undefined) continue;
    const previous = smoothed[id];
    next[id] = previous === undefined ? value : previous + SMOOTHING * (value - previous);
  }
  smoothed = next;
}

function tick(): void {
  if (!landmarker || video.readyState < 2 || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;

  const now = performance.now();
  const result = landmarker.detectForVideo(video, now);
  const landmarks = result.landmarks[0];
  const worldLandmarks = result.worldLandmarks[0];
  const pose = landmarks && worldLandmarks && toPose(landmarks, worldLandmarks);

  if (!pose || !canSee(pose)) {
    alarm.update(false, now);
    draw(undefined, false);
    smoothed = {};
    for (const id of METRIC_IDS) renderRow(id, undefined, false);
    setStatus("Can't see you clearly", "idle");
    return;
  }

  smooth(measure(pose));

  if (settings.baselines.forwardHead === undefined) {
    draw(pose, false);
    for (const id of METRIC_IDS) renderRow(id, undefined, false);
    setStatus("Sit straight, then press Calibrate", "idle");
    return;
  }

  const bad: string[] = [];
  for (const id of METRIC_IDS) {
    const current = smoothed[id];
    const baseline = settings.baselines[id];
    const over = current !== undefined && baseline !== undefined ? current - baseline : undefined;
    const exceeded = over !== undefined && over > settings.thresholds[id];
    if (exceeded) bad.push(METRICS[id].label.split(" (")[0] ?? id);
    renderRow(id, over, exceeded);
  }

  const alarming = alarm.update(bad.length > 0, now);
  draw(pose, bad.length > 0);
  if (bad.length === 0) setStatus("Good posture", "good");
  else setStatus(`${alarming ? "Fix" : "Watch"}: ${bad.join(" + ")}`, "bad");
}

async function start(): Promise<void> {
  startButton.disabled = true;
  setStatus("Loading model...", "idle");
  beeper.unlock();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
    video.srcObject = stream;
    await video.play();
    landmarker = await createLandmarker();
    calibrateButton.disabled = false;
    stopButton.disabled = false;
    wakeLock = await navigator.wakeLock?.request("screen").catch(() => undefined);
    setStatus("Sit straight, then press Calibrate", "idle");
  } catch (error) {
    startButton.disabled = false;
    setStatus(error instanceof Error ? error.message : "Could not start", "bad");
  }
}

function stop(): void {
  landmarker?.close();
  landmarker = undefined;
  for (const track of (video.srcObject as MediaStream | null)?.getTracks() ?? []) track.stop();
  video.srcObject = null;
  void wakeLock?.release();
  wakeLock = undefined;
  alarm.update(false, performance.now());
  smoothed = {};
  lastVideoTime = -1;
  context?.clearRect(0, 0, overlay.width, overlay.height);
  for (const id of METRIC_IDS) renderRow(id, undefined, false);
  startButton.disabled = false;
  calibrateButton.disabled = true;
  stopButton.disabled = true;
  setStatus("Stopped. Camera released.", "idle");
}

startButton.addEventListener("click", () => void start());
stopButton.addEventListener("click", stop);

calibrateButton.addEventListener("click", () => {
  if (smoothed.forwardHead === undefined) {
    showDialog("Calibration failed", "I can't see your head and shoulders clearly. Move into view and try again.");
    return;
  }
  settings.baselines = { ...smoothed };
  saveSettings();
  const lines = METRIC_IDS.map((id) => `${METRICS[id].label.split(" (")[0]}: ${degrees(settings.baselines[id])}`);
  const hipsNote = settings.baselines.slouch === undefined ? "\nHips not in view, slouch check is off." : "";
  showDialog("Posture calibrated", `This is now your good posture.\n${lines.join("\n")}${hipsNote}`);
});

for (const id of METRIC_IDS) renderRow(id, undefined, false);

const ticker = new Worker(new URL("./ticker.worker.ts", import.meta.url), { type: "module" });
ticker.onmessage = tick;
ticker.postMessage({ intervalMs: DETECTION_INTERVAL_MS });
