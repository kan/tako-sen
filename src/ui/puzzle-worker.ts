import { generatePuzzleWithAnalysis } from "../core/generator";
import type { WorkerReply, WorkerRequest } from "./puzzle-generation";

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const { id, options } = event.data;
  let reply: WorkerReply;
  try {
    reply = { id, generated: generatePuzzleWithAnalysis(options) };
  } catch (error) {
    reply = { id, error: String(error) };
  }
  self.postMessage(reply);
});
