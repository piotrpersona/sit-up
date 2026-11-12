let timer: ReturnType<typeof setInterval> | undefined;

self.onmessage = (event: MessageEvent<{ intervalMs: number } | "stop">) => {
  clearInterval(timer);
  if (event.data === "stop") return;
  timer = setInterval(() => self.postMessage(null), event.data.intervalMs);
};
