// Starts the API (wrangler dev) and the screen (vite) together. The API takes
// a free port and vite proxies /api to it, so another project's wrangler dev
// cannot collide. Under `roji run`, vite listens on the port roji chose and
// the API accepts the URL roji assigned as an origin.
import { spawn } from "node:child_process";
import { createServer } from "node:net";

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const apiPort = String(await freePort());
const rojiUrl = process.env.ROJI_URL;
// Without roji the screen keeps the port .dev.vars allows as an origin.
const screenPort = (rojiUrl && process.env.PORT) || "5173";

const apiArgs = ["dev", "--port", apiPort];
// .dev.vars lists the localhost origins only; roji's URL differs by machine.
if (rojiUrl)
  apiArgs.push(
    "--var",
    `ALLOWED_ORIGINS:${new URL(rojiUrl).origin},http://localhost:${screenPort}`,
  );

// npm puts .cmd shims on the PATH on Windows; those need a shell.
const shell = process.platform === "win32";
const children = [
  spawn("wrangler", apiArgs, { stdio: "inherit", shell }),
  // A moved port would be an origin the API rejects, so fail instead. Only
  // wrangler reads the keyboard: two readers would split the key presses.
  spawn("vite", ["--port", screenPort, "--strictPort"], {
    stdio: ["ignore", "inherit", "inherit"],
    shell,
    env: { ...process.env, TAKO_API_PORT: apiPort },
  }),
];

let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill("SIGTERM");
  // A server that ignores SIGTERM must not keep its port.
  setTimeout(() => {
    for (const child of children) child.kill("SIGKILL");
  }, 5000).unref();
}

for (const child of children) {
  child.once("error", (error) => {
    console.error(error);
    stop(1);
  });
  // Either server alone is not a working app.
  child.once("exit", (code) => stop(code ?? 1));
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop(0));
