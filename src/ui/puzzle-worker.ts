import { SuperSeedError } from "../core/super-puzzle";
import {
  runGenerationJob,
  type WorkerReply,
  type WorkerRequest,
} from "./puzzle-generation";

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const { id, ...job } = event.data;
  let reply: WorkerReply;
  try {
    reply = { id, generated: runGenerationJob(job) };
  } catch (error) {
    reply = {
      id,
      error: error instanceof Error ? error.message : String(error),
      superSeedError: error instanceof SuperSeedError,
    };
  }
  self.postMessage(reply);
});
