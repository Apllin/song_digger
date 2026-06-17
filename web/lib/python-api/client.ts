import { axiosInstance } from "@kubb/plugin-client/clients/axios";

function requireEnv(name: "PYTHON_SERVICE_URL" | "PYTHON_SERVICE_SECRET"): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for python-service requests. Set it in .env.`);
  }
  return value;
}

// Centralize baseURL + internal-auth for every generated python-service client.
// Registered as a request interceptor (not setConfig at import) so the env is
// read lazily, per request: `next build` imports this module while collecting
// page data with no runtime env, and a top-level read would fail the build.
// A missing var still fails loudly on the first real request.
axiosInstance.interceptors.request.use((config) => {
  config.baseURL = requireEnv("PYTHON_SERVICE_URL");
  config.headers.set("x-internal-auth", requireEnv("PYTHON_SERVICE_SECRET"));
  return config;
});
