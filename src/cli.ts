#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { dispatchQuestionCommand } from "./dispatch.js";
import { handleCliError, finishFanOutput, finishSuccessOutput, machineMode, printJson } from "./io.js";
import { loadConfig, profileConcurrency, resolveProfile } from "./config.js";
import { cmdLogin, cmdLogout } from "./login-cmd.js";
import { cmdProfileList, cmdProfileUse } from "./profile-cmd.js";
import { runFromJson, RunnerError } from "./runner.js";
import { cmdStatus } from "./status-cmd.js";
import { startMcpServer } from "./mcp/server.js";
import type { FanSuccessOutput } from "./batch.js";
import type { SuccessOutput } from "./types.js";

const program = new Command();

program
  .name("decide")
  .description("Multi-engine System One decisions for agents (yes/no, choice, score)")
  .option("--profile <name>", "Profile name (unless directory .decide.toml pins/locks)")
  .option("--json", "Machine-readable JSON on stdout");

function globalOpts(cmd: Command) {
  const root = cmd.optsWithGlobals();
  return { profile: root.profile as string | undefined, json: root.json as boolean | undefined };
}

function addQuestionFlags(cmd: Command, withChoice: boolean, withScore: boolean) {
  cmd
    .option("-q, --question <text>", "Question instructions (exactly one unless --questions/--contexts)", (v, prev: string[]) => [...prev, v], [])
    .option("-s, --state <state>", "Context: literal, @file, or - for stdin")
    .option("--questions <file|->", "Many questions over one shared -s (single engine request when possible)")
    .option("--contexts <file.jsonl|->", "One question (-q) across many contexts (JSONL {id,state})")
    .option("--name <id>", "Answer id for single-question mode", "q")
    .option("--concurrency <n>", "Parallel requests for --contexts (default from config)");
  if (withChoice) {
    cmd.option("-o, --option <pair>", "choice option value=description", (v, p: string[]) => [...p, v], []);
    cmd.option("--value", "TTY: print only the chosen value");
  }
  if (withScore) {
    cmd.option("-l, --level <pair>", "score level label=description", (v, p: string[]) => [...p, v], []);
  }
}

async function runQuestionKind(
  kind: "yesno" | "choice" | "score",
  opts: Record<string, unknown>,
  jsonFlag?: boolean,
  profile?: string,
) {
  const config = loadConfig();
  const resolved = resolveProfile(config, profile);
  const concurrency =
    opts.concurrency !== undefined
      ? Number(opts.concurrency)
      : profileConcurrency(config, resolved.name);

  const out = await dispatchQuestionCommand({
    kind,
    qFlags: opts.question as string[],
    sFlag: opts.state as string | undefined,
    questionsPath: opts.questions as string | undefined,
    contextsPath: opts.contexts as string | undefined,
    name: opts.name as string | undefined,
    concurrency,
    optionFlags: opts.option as string[] | undefined,
    levelFlags: opts.level as string[] | undefined,
    profile,
  });

  if ("results" in out) {
    finishFanOutput(out as FanSuccessOutput, jsonFlag);
    return;
  }
  finishSuccessOutput(out as SuccessOutput, {
    json: jsonFlag,
    valueOnly: kind === "choice" && Boolean(opts.value),
  });
}

const yesno = program.command("yesno").description("Yes/no (probability of yes)");
addQuestionFlags(yesno, false, false);
yesno.action(async function (this: Command) {
  try {
    const g = globalOpts(this);
    await runQuestionKind("yesno", this.opts(), g.json, g.profile);
  } catch (e) {
    handleCliError(e);
  }
});

const choice = program.command("choice").description("Choose one option");
addQuestionFlags(choice, true, false);
choice.action(async function (this: Command) {
  try {
    const g = globalOpts(this);
    await runQuestionKind("choice", this.opts(), g.json, g.profile);
  } catch (e) {
    handleCliError(e);
  }
});

const score = program.command("score").description("Score on an ordered rubric");
addQuestionFlags(score, false, true);
score.action(async function (this: Command) {
  try {
    const g = globalOpts(this);
    await runQuestionKind("score", this.opts(), g.json, g.profile);
  } catch (e) {
    handleCliError(e);
  }
});

program
  .command("run")
  .description("Evaluate a normalized request JSON file")
  .argument("<file>", "Request JSON ({state, questions})")
  .action(async function (file: string, _opts: unknown, cmd: Command) {
    try {
      const g = globalOpts(cmd);
      const json = JSON.parse(readFileSync(file, "utf8"));
      const out = await runFromJson(json, { profile: g.profile });
      finishSuccessOutput(out, { json: g.json });
    } catch (e) {
      handleCliError(e);
    }
  });

program
  .command("login")
  .description("Store API key in OS keychain")
  .argument("[engine]", "typesafe | openai (default: active profile engine)")
  .action(async (engine: string | undefined, _o: unknown, cmd: Command) => {
    try {
      const g = globalOpts(cmd);
      await cmdLogin(engine, g.profile);
    } catch (e) {
      handleCliError(e instanceof RunnerError ? e : new RunnerError("engine", String(e)));
    }
  });

program
  .command("logout")
  .description("Remove stored API key")
  .argument("[engine]", "typesafe | openai")
  .action(async (engine: string | undefined, _o: unknown, cmd: Command) => {
    try {
      const g = globalOpts(cmd);
      await cmdLogout(engine, g.profile);
    } catch (e) {
      handleCliError(e instanceof RunnerError ? e : new RunnerError("engine", String(e)));
    }
  });

program
  .command("status")
  .description("Profile, engine, key, and live test (only command that names the engine)")
  .action(async (_o: unknown, cmd: Command) => {
    try {
      const g = globalOpts(cmd);
      await cmdStatus(g.profile, g.json);
    } catch (e) {
      handleCliError(e instanceof RunnerError ? e : new RunnerError("engine", String(e)));
    }
  });

const profile = program.command("profile").description("Manage profiles");

profile
  .command("list")
  .description("List profiles")
  .action((_o: unknown, cmd: Command) => {
    const g = globalOpts(cmd);
    cmdProfileList(g.json);
  });

profile
  .command("use")
  .description("Set active profile")
  .argument("<name>")
  .action((name: string) => {
    try {
      cmdProfileUse(name);
    } catch (e) {
      handleCliError(new RunnerError("invalid", String(e)));
    }
  });

program
  .command("mcp")
  .description("stdio MCP server (tools: yesno, choice, score, run, yesno_fan, ...)")
  .action(async () => {
    await startMcpServer();
  });

program.parseAsync(process.argv);
