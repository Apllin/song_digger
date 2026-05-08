const hostUrl = process.env.NEXT_PUBLIC_HOST_URL ?? "";

if (!hostUrl) {
  console.warn(
    "NEXT_PUBLIC_HOST_URL is required to run the web app. Set it in .env (e.g. NEXT_PUBLIC_HOST_URL=http://localhost:3000).",
  );
}

export const env = {
  hostUrl,
} as const;
