"use client";

import { useState } from "react";

import type { LatestModelSnapshot } from "@/features/admin/server/loadLatestModel";
import { fetchApi } from "@/lib/callApi";
import { api } from "@/lib/hono/client";

interface TrainPanelProps {
  latest: LatestModelSnapshot | null;
  labeledCount: number;
}

interface TrainResult {
  ok: true;
  version: number;
  sampleSize: number;
  sourceWeights: Record<string, number>;
  cosineScoreWeight: number;
  numSourcesWeight: number;
  bpmDeltaWeight: number;
  bpmCompatibleWeight: number;
  bpmPresentWeight: number;
  keyCompatibleWeight: number;
  keyPresentWeight: number;
}

const MIN_SAMPLES = 20;

export function TrainPanel({ latest, labeledCount }: TrainPanelProps) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<TrainResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canTrain = labeledCount >= MIN_SAMPLES;

  async function handleTrain() {
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const resp = await fetchApi(api.admin.train.$post());
      setResult(resp as TrainResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Training failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border border-td-hair p-4">
        <h2 className="text-lg font-semibold mb-2">Labeled samples</h2>
        <p className="text-td-fg-m">
          {labeledCount} feedback rows accumulated. Minimum {MIN_SAMPLES} to train.
        </p>
        <button
          onClick={handleTrain}
          disabled={pending || !canTrain}
          className="mt-3 px-4 py-2 rounded-md border border-td-hair text-td-fg disabled:opacity-40"
        >
          {pending ? "Training…" : "Train new model"}
        </button>
        {!canTrain && (
          <p className="mt-2 text-sm text-td-fg-d">
            Need {MIN_SAMPLES - labeledCount} more labeled samples before training is allowed.
          </p>
        )}
      </section>

      {error && (
        <section className="rounded-lg border border-red-500/40 bg-red-500/10 p-4">
          <h2 className="text-base font-semibold mb-1">Training failed</h2>
          <p className="text-sm">{error}</p>
        </section>
      )}

      {result && (
        <section className="rounded-lg border border-green-500/40 bg-green-500/10 p-4">
          <h2 className="text-base font-semibold mb-2">
            Trained v{result.version} ({result.sampleSize} samples)
          </h2>
          <WeightsTable
            sourceWeights={result.sourceWeights}
            cosineScoreWeight={result.cosineScoreWeight}
            numSourcesWeight={result.numSourcesWeight}
            bpmDeltaWeight={result.bpmDeltaWeight}
            bpmCompatibleWeight={result.bpmCompatibleWeight}
            bpmPresentWeight={result.bpmPresentWeight}
            keyCompatibleWeight={result.keyCompatibleWeight}
            keyPresentWeight={result.keyPresentWeight}
          />
        </section>
      )}

      <section className="rounded-lg border border-td-hair p-4">
        <h2 className="text-lg font-semibold mb-2">Active model</h2>
        {latest ? (
          <>
            <p className="text-td-fg-m mb-3">
              v{latest.version}, trained {latest.trainedAt.toISOString()} on {latest.sampleSize} samples · rankDecayK ={" "}
              {latest.rankDecayK}
            </p>
            <WeightsTable
              sourceWeights={latest.sourceWeights}
              cosineScoreWeight={latest.cosineScoreWeight}
              numSourcesWeight={latest.numSourcesWeight}
              bpmDeltaWeight={latest.bpmDeltaWeight}
              bpmCompatibleWeight={latest.bpmCompatibleWeight}
              bpmPresentWeight={latest.bpmPresentWeight}
              keyCompatibleWeight={latest.keyCompatibleWeight}
              keyPresentWeight={latest.keyPresentWeight}
            />
          </>
        ) : (
          <p className="text-td-fg-m">No model trained yet — falling back to DEFAULT_WEIGHTS.</p>
        )}
      </section>
    </div>
  );
}

interface WeightsTableProps {
  sourceWeights: Record<string, number>;
  cosineScoreWeight: number;
  numSourcesWeight: number;
  bpmDeltaWeight: number | null;
  bpmCompatibleWeight: number | null;
  bpmPresentWeight: number | null;
  keyCompatibleWeight: number | null;
  keyPresentWeight: number | null;
}

function WeightsTable(props: WeightsTableProps) {
  const audio: Array<[string, number | null]> = [
    ["cosineScore", props.cosineScoreWeight],
    ["numSources", props.numSourcesWeight],
    ["bpmDelta", props.bpmDeltaWeight],
    ["bpmCompatible", props.bpmCompatibleWeight],
    ["bpmPresent", props.bpmPresentWeight],
    ["keyCompatible", props.keyCompatibleWeight],
    ["keyPresent", props.keyPresentWeight],
  ];
  return (
    <div className="grid grid-cols-2 gap-6 font-mono-td text-sm">
      <div>
        <h3 className="text-xs uppercase tracking-wider text-td-fg-d mb-1">Sources</h3>
        {Object.entries(props.sourceWeights).map(([source, w]) => (
          <div key={source} className="flex justify-between gap-3">
            <span>{source}</span>
            <span>{w.toFixed(4)}</span>
          </div>
        ))}
      </div>
      <div>
        <h3 className="text-xs uppercase tracking-wider text-td-fg-d mb-1">Audio / aggregate</h3>
        {audio.map(([label, w]) => (
          <div key={label} className="flex justify-between gap-3">
            <span>{label}</span>
            <span>{w == null ? "—" : w.toFixed(4)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
