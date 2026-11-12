import type { PoseLandmarker, PoseLandmarkerResult } from "@mediapipe/tasks-vision";
import { Beeper, SlouchAlarm } from "./alarm";
import { METRICS, METRIC_IDS, canSee, measure, type MetricId, type Pose, type Reading } from "./metrics";
import { createLandmarker, toPose } from "./pose";
import { render, type Scene, type SilhouetteMask } from "./render";

const HOLD_MS = 3000;
const REPEAT_MS = 5000;
const DETECTION_INTERVAL_MS = 200;
const SMOOTHING = 0.4;
const STORAGE_KEY = "posture-guard:v2";

interface Settings {
  showCamera: boolean;
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
const stage = byId<HTMLDivElement>("stage");
const showCameraInput = byId<HTMLInputElement>("showCamera");
const stopButton = byId<HTMLButtonElement>("stop");
const dialog = byId<HTMLDialogElement>("dialog");
const dialogTitle = byId<HTMLHeadingElement>("dialogTitle");
const dialogBody = byId<HTMLParagraphElement>("dialogBody");
const metricsContainer = byId<HTMLDivElement>("metrics");
const context = overlay.getContext("2d");

function loadSettings(): Settings {
  const defaults: Settings = {
    showCamera: false,
    thresholds: { forwardHead: METRICS.forwardHead.initial, slouch: METRICS.slouch.initial, headDown: METRICS.headDown.initial },
    baselines: {},
  };
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Settings> | null;
    return {
      showCamera: stored?.showCamera ?? defaults.showCamera,
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

function paint(scene: Scene): void {
  if (!context) return;
  if (overlay.width !== video.videoWidth || overlay.height !== video.videoHeight) {
    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;
  }
  render(context, overlay, scene);
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
  landmarker.detectForVideo(video, performance.now(), process);
}

function process(result: PoseLandmarkerResult): void {
  const now = performance.now();
  const landmarks = result.landmarks[0];
  const worldLandmarks = result.worldLandmarks[0];
  const pose = landmarks && worldLandmarks && toPose(landmarks, worldLandmarks);
  const rawMask = result.segmentationMasks?.[0];
  const mask: SilhouetteMask | undefined = rawMask && {
    width: rawMask.width,
    height: rawMask.height,
    values: rawMask.getAsFloat32Array(),
  };

  if (!pose || !canSee(pose)) {
    alarm.update(false, now);
    paint({ mask, bad: false });
    smoothed = {};
    for (const id of METRIC_IDS) renderRow(id, undefined, false);
    setStatus("Can't see you clearly", "idle");
    return;
  }

  smooth(measure(pose));

  if (settings.baselines.forwardHead === undefined) {
    paint({ landmarks, mask, bad: false });
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
  paint({ landmarks, mask, bad: bad.length > 0 });
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
    landmarker = await createLandmarker(!settings.showCamera);
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

showCameraInput.checked = settings.showCamera;
stage.classList.toggle("abstract", !settings.showCamera);
showCameraInput.addEventListener("change", () => {
  settings.showCamera = showCameraInput.checked;
  stage.classList.toggle("abstract", !settings.showCamera);
  void landmarker?.setOptions({ outputSegmentationMasks: !settings.showCamera });
  saveSettings();
});

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
