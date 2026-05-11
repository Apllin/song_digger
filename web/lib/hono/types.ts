export type RequestMetricsVar = {
  userId: string | null;
  pythonDurationMs: number | null;
  cacheHit: boolean | null;
  sourcesUsed: string[] | null;
};

export type AppEnv = {
  Variables: {
    pythonServiceUrl: string;
    metrics: RequestMetricsVar;
  };
};
