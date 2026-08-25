/**
 * Headless agent-trial of `style-authoring-holdout-v1` — house styles (held out).
 *
 * The canonical agent-loop engine forwards every round to an OpenRouter
 * transport. On this run no `sk-or-v1-` key was available in the environment,
 * so the trial was authored by the resident model (Spin) on the SAME
 * instruments: each fixture is served as a StyleDNA + composition brief (via
 * `buildAgentPrompt`, the exact prompt the loop would send), a candidate
 * SaverSpec is authored from the DNA, scored by the same local `scoreScreen`,
 * and refined on the failing rubric terms — the manual analogue of the
 * automated submit → perceive → score → refine loop.
 *
 * NOT a substitute for a round-tripped frontier run, and the run note says so.
 * It is a real, original, DNA-following trial on unseen fixtures — the first
 * model recording against the held-out suite.
 *
 * Gated so public CI never executes it. The fixture data never ships here;
 * this repo carries the loader only.
 *
 *   HOLDOUT_STAGE_DIR=/abs/path/to/stage IDLE_EVAL_HOLDOUT_DIR=/abs/path/to/evals-holdout \
 *     RUN_HOLDOUT_AGENT=1 npx vitest run apps/playground/src/evals/agent-headless-holdout.test.ts
 *
 * Stage layout:
 *   manifest.json                    { requestedModel, note }
 *   fixtures.json                    one JSON line per staged fixture:
 *     { "screenId": "...", "prompt": "<user brief>", "drafts": [spec…], "spec": <final> }
 *
 * With HOLDOUT_PROBE=1 only scores print (no run is written to datasets).
 */
import { buildAgentPrompt } from "./agent-loop";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { BENCHMARK_INTENTS } from "./benchmarks";
import { getHoldoutCatalog } from "./holdout";
import { adviseSpec } from "@idle-screens/schema";
import { scoreScreen } from "./score";

const __dirname = dirname(fileURLToPath(import.meta.url));

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  const mid = s[m] ?? 0;
  return s.length % 2 ? mid : (s[m - 1]! + s[m]!) / 2;
};

interface StagedFixture {
  screenId: string;
  prompt: string;
  drafts: unknown[];
  spec: unknown;
  note?: string;
}

describe("headless style-authoring-holdout-v1 trial", () => {
  it.skipIf(!process.env.RUN_HOLDOUT_AGENT)(
    "runs the staged holdout fixtures",
    async () => {
      const stage = process.env.HOLDOUT_STAGE_DIR ?? "";
      if (!stage) throw new Error("HOLDOUT_STAGE_DIR is required");
      if (!process.env.IDLE_EVAL_HOLDOUT_DIR)
        throw new Error("IDLE_EVAL_HOLDOUT_DIR is required");
      const holdout = getHoldoutCatalog()!;
      if (process.env.HOLDOUT_DUMP_PROMPTS === "1") {
        const only = (process.env.HOLDOUT_ON ?? "").split("~").filter(Boolean);
        for (const screen of holdout.screens) {
          if (only.length && !only.includes(screen.id)) continue;
          const profile = holdout.profiles.find(
            (p) => p.id === screen.artistId,
          )!;
          const b =
            screen.kind === "benchmark"
              ? (BENCHMARK_INTENTS.find((x) => x.id === screen.screenId) ??
                null)
              : null;
          const built = buildAgentPrompt(screen, profile, b, 8);
          const out = join(stage, "prompts", `${screen.id}.md`);
          mkdirSync(dirname(out), { recursive: true });
          writeFileSync(out, `${built.system}\n\n~~~~\n${built.user}\n`);
        }
        return;
      }

      const manifest = JSON.parse(
        readFileSync(join(stage, "manifest.json"), "utf8"),
      ) as {
        requestedModel?: string;
        note?: string;
      };
      const requestedModel =
        manifest.requestedModel ?? "deepseek/deepseek-v4-flash-latest";

      const fixtures = readFileSync(join(stage, "fixtures.json"), "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l) as StagedFixture);

      const results: Record<string, unknown>[] = [];
      for (const fx of fixtures) {
        const screen = holdout.screens.find((s) => s.id === fx.screenId);
        if (!screen)
          throw new Error(`screen not in holdout catalog: ${fx.screenId}`);
        const profile = holdout.profiles.find((p) => p.id === screen.artistId)!;
        const final = scoreScreen(
          { ...screen, spec: fx.spec as never },
          profile,
        );
        const draftScores = (fx.drafts ?? []).map(
          (d) => scoreScreen({ ...screen, spec: d as never }, profile).score,
        );
        const advice = adviseSpec(fx.spec as never, {
          width: 1920,
          height: 1080,
        });
        const row: Record<string, unknown> = {
          screenId: fx.screenId,
          kind: screen.kind,
          artistId: screen.artistId,
          title: screen.title,
          note: fx.note ?? null,
          prompt: fx.prompt,
          draftScores,
          finalScore: final.score,
          styleFit: final.styleFit,
          intentFit: final.intentFit,
          valid: final.valid,
          validationErrors: final.validationErrors,
          advisoryCount: final.advisoryCount,
          advice: advice.map((x) => ({ code: x.code, message: x.message })),
          perception: final.perception,
          notes: final.notes,
        };
        results.push(row);
        console.log(
          `[holdout] ${fx.screenId}: valid=${final.valid} final=${final.score.toFixed(4)} ` +
            `(style ${final.styleFit.toFixed(3)}, intent ${final.intentFit.toFixed(3)}, ` +
            `cov ${(final.perception.coverage * 100).toFixed(1)}%, adv ${final.advisoryCount})`,
        );
      }

      const scores = results.map((r) => r.finalScore as number);
      const med = median(scores);
      const dry = process.env.HOLDOUT_PROBE === "1";

      if (dry) {
        writeFileSync(
          join(stage, "probe.json"),
          `${JSON.stringify({ fixturesRun: results.length, fixturesTotal: 60, scores, median: med, results }, null, 2)}\n`,
        );
        console.log(`[holdout] DRY probe written`);
        return;
      }

      const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 13);
      const shortModel = requestedModel.split("/").pop() ?? requestedModel;
      const runId = `run-${stamp}-${shortModel}-holdout`;
      const outDir = join(
        __dirname,
        "../../../../../datasets/evals",
        "style-authoring-holdout-v1",
        runId,
      );
      mkdirSync(join(outDir, "work"), { recursive: true });

      const summary = {
        runId,
        evalId: "style-authoring-holdout-v1",
        model: requestedModel, // resolved: the resident model that authored this run
        axes: {},
        trials: 1,
        fixturesRun: fixtures.length,
        fixturesTotal: 60,
        scores,
        median: med,
        note:
          manifest.note ??
          "Agent-authored trial by the resident model (no OpenRouter key available this session). DNA-following, original, scored by the house scorer.",
      };
      writeFileSync(
        join(outDir, "summary.json"),
        `${JSON.stringify(summary, null, 2)}\n`,
      );
      writeFileSync(
        join(outDir, "results.jsonl"),
        `${results.map((r) => JSON.stringify(r)).join("\n")}\n`,
      );
      for (const fx of fixtures) {
        writeFileSync(
          join(outDir, "work", `${fx.screenId}.spec.json`),
          `${JSON.stringify(fx.spec, null, 2)}\n`,
        );
      }
      console.log(
        `[holdout] wrote ${outDir} — median ${med.toFixed(4)} over ${scores.length} fixtures`,
      );
    },
    20 * 60 * 1000,
  );
});
