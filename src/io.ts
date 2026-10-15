import type { ErrorOutput, SuccessOutput } from "./types.js";
import { EXIT, isNonDecisionOutcome } from "./types.js";
import type { FanSuccessOutput } from "./batch.js";
import { RunnerError } from "./errors.js";
import { ProfilePinError } from "./errors.js";

export function machineMode(jsonFlag?: boolean): boolean {
  return jsonFlag === true || !process.stdout.isTTY;
}

export function printJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data) + "\n");
}

export function printError(err: ErrorOutput): never {
  process.stderr.write(JSON.stringify(err) + "\n");
  const code =
    err.code === "auth"
      ? EXIT.auth
      : err.code === "rate_limit"
        ? EXIT.rate_limit
        : err.code === "invalid"
          ? EXIT.invalid
          : err.code === "timeout"
            ? EXIT.outcome
            : EXIT.engine;
  process.exit(code);
}

export function handleCliError(e: unknown): never {
  if (e instanceof ProfilePinError) {
    printError({ ok: false, code: "invalid", message: e.message });
  }
  if (e instanceof RunnerError) {
    printError({ ok: false, code: e.code, message: e.message });
  }
  printError({ ok: false, code: "engine", message: e instanceof Error ? e.message : String(e) });
}

function outcomeMessage(answer: SuccessOutput["answers"][string]): string {
  if (answer.type === "refusal") {
    return answer.reason ? `refusal: ${answer.reason}` : "refusal";
  }
  if (answer.type === "timeout") return "timeout";
  if (answer.type === "error") {
    return `error (${answer.code})${answer.message ? `: ${answer.message}` : ""}`;
  }
  return answer.type;
}

export function finishSuccessOutput(
  out: SuccessOutput,
  opts?: { valueOnly?: boolean; json?: boolean },
): void {
  const machine = machineMode(opts?.json);
  const outcomes = Object.entries(out.answers).filter(([, a]) => isNonDecisionOutcome(a));

  if (machine) {
    printJson(out);
  } else if (opts?.valueOnly) {
    if (outcomes.length > 0) {
      const [, ans] = outcomes[0];
      process.stderr.write(outcomeMessage(ans) + "\n");
      process.exit(EXIT.outcome);
    }
    const choice = Object.values(out.answers).find((a) => a.type === "choice");
    if (choice && choice.type === "choice") {
      console.log(choice.value);
    } else {
      printSuccessHuman(out, false);
    }
  } else {
    printSuccessHuman(out, false);
  }

  if (outcomes.length > 0) {
    if (!machine && !opts?.valueOnly) {
      process.stderr.write(
        `Non-decision outcome: ${outcomes.map(([n, a]) => `${n}=${a.type}`).join(", ")}\n`,
      );
    }
    process.exit(EXIT.outcome);
  }
}

export function finishFanOutput(out: FanSuccessOutput, json?: boolean): void {
  if (machineMode(json)) printJson(out);
  else printFanHuman(out);
}

export function printSuccessHuman(out: SuccessOutput, valueOnly?: boolean): void {
  for (const [name, ans] of Object.entries(out.answers)) {
    if (ans.type === "yesno") {
      const pass =
        ans.pass !== undefined ? ` pass=${ans.pass}` : "";
      console.log(`${name}: p=${ans.p}${pass}`);
    } else if (ans.type === "choice") {
      if (valueOnly) {
        console.log(ans.value);
      } else {
        console.log(`${name}: ${ans.value} (confidence ${ans.confidence})`);
      }
    } else if (ans.type === "score") {
      console.log(`${name}: score=${ans.score} (confidence ${ans.confidence})`);
    } else if (ans.type === "refusal") {
      console.log(`${name}: refusal${ans.reason ? ` (${ans.reason})` : ""}`);
    } else if (ans.type === "timeout") {
      console.log(`${name}: timeout`);
    } else if (ans.type === "error") {
      console.log(`${name}: error ${ans.code}${ans.message ? ` — ${ans.message}` : ""}`);
    }
  }
}

export function printFanHuman(out: FanSuccessOutput): void {
  for (const [id, row] of Object.entries(out.results)) {
    if ("error" in row) {
      console.log(`${id}: error ${row.error.code} — ${row.error.message}`);
    } else {
      console.log(`${id}: ${JSON.stringify(row.answer)}`);
    }
  }
}
