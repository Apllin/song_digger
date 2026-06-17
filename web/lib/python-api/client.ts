import { setConfig } from "@kubb/plugin-client/clients/axios";

function requireEnv(name: "PYTHON_SERVICE_URL" | "PYTHON_SERVICE_SECRET"): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for python-service requests. Set it in .env.`);
  }
  return value;
}

// Configure the kubb/axios singleton once at startup so every generated client
// inherits the baseURL + internal-auth header — call sites never pass them.
setConfig({
  baseURL: requireEnv("PYTHON_SERVICE_URL"),
  headers: { "x-internal-auth": requireEnv("PYTHON_SERVICE_SECRET") },
});
