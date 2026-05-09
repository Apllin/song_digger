import { config } from "@vanya2h/eslint-config/next";

export default [
  ...config,
  {
    ignores: [".next/**", "app/generated/**"],
  },
];
