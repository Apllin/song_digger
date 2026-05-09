import { defineConfig } from "@kubb/core";
import { pluginClient } from "@kubb/plugin-client";
import { pluginOas } from "@kubb/plugin-oas";
import { pluginTs } from "@kubb/plugin-ts";
import { pluginZod } from "@kubb/plugin-zod";

export default defineConfig({
  root: ".",
  input: { path: "../python-service/openapi.json" },
  output: {
    path: "./lib/python-api/generated",
    clean: true,
    extension: { ".ts": "" },
  },
  plugins: [
    pluginOas({ generators: [] }),
    pluginTs({ output: { path: "types" } }),
    pluginZod({ output: { path: "zod" }, typed: true }),
    pluginClient({ output: { path: "clients" }, parser: "zod" }),
  ],
});
