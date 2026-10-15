# decide

TypeScript CLI (Node 20+) for **multi-engine System One** decisions: yes/no, choice, and score. Callers choose a **named profile** (not an engine flag); each profile maps to an engine and pinned model. Results always include `profile`, `engine`, and `model` so you can audit what ran.

Built-in engines (v1): **TypeSafe Jev** and **OpenAI Decisions**. The adapter interface is small—adding another engine is mostly a new adapter file plus a config enum value.

## Install

```bash
npm install
npm run build
npm link   # optional: put `decide` on your PATH
```

## Auth

```bash
decide login              # store key for the active profile
```

Resolution order for API keys:

1. `DECIDE_<PROFILE>_API_KEY` (e.g. `DECIDE_JEV_API_KEY` for profile `jev`)
2. Engine env: `TYPESAFE_API_KEY` or `OPENAI_API_KEY`
3. OS keychain (`@napi-rs/keyring`)
4. `~/.config/decide/credentials.json` (`0600`)

`decide login` **never prompts** when stdin/stdout are not a TTY (set an env key instead).

## Profiles

Example `~/.config/decide/config.toml`:

```toml
active_profile = "jev"
concurrency = 4
request_timeout_ms = 120000

[profiles.jev]
engine = "typesafe"
model = "jev-1.13.0"

[profiles.jev.thresholds]
yesno_pass = 0.8

[profiles.openai]
engine = "openai"
model = "gpt-6-luna"
concurrency = 8
```

```bash
decide profile list
decide profile use openai
DECIDE_PROFILE=jev decide yesno -q "Urgent?" -s "Help!"
```

Pin **model IDs** in config (not moving aliases) when thresholds depend on stable behavior.

### Directory profile pin

A **directory** (for example a project folder) can pin—or **lock**—which profile `decide` uses. From the current working directory, `decide` walks **upward** and applies the nearest `.decide.toml` (no git required):

```toml
profile = "openai"
lock = true
```

- **Unlocked pin:** default profile under that tree when `DECIDE_PROFILE` / `--profile` are unset.
- **Locked pin:** only that profile; `--profile` or `DECIDE_PROFILE` with a different name → `invalid` error.

## Commands

| Command | Purpose |
|--------|---------|
| `decide yesno` | Probability of yes |
| `decide choice` | Pick one option (`-o value=desc`) |
| `decide score` | Ordered rubric (`-l label=desc`) |
| `decide run req.json` | Normalized multi-question JSON |
| `decide login` / `logout` | API keys |
| `decide status` | Profile, engine, key, optional live ping |
| `decide mcp` | stdio MCP server |

Global: `--profile`, `--json` (also when stdout is not a TTY).

### Default: one context, one question

```bash
decide yesno -q "Does this convey urgency?" -s "Payouts failing for 3 days"
decide choice -q "Which team?" -s "Double charge" -o billing=refunds -o technical=bugs
```

Exactly one `-q` and one `-s` unless you use the batch switches below.

### Batch switches (explicit only)

Never inferred from input shape. `--questions` and `--contexts` together, or multiple `-q`/`-s` without the matching switch → `invalid`.

**Many questions, one context** — `--questions <file|->` + one `-s`:

```bash
decide yesno --questions triage.json -s @ticket.txt
```

Mixed question types in the file are allowed.

**One question, many contexts** — one `-q` + `--contexts <file.jsonl|->` (lines: `{"id","state"}`):

```bash
decide choice -q "Spam?" --contexts lines.jsonl -o spam=yes -o ham=no
```

Concurrency: `--concurrency` or `concurrency` in config (global or per profile).

### `decide run`

```json
{
  "state": "shared evidence",
  "questions": [
    { "name": "urgent", "type": "yesno", "instructions": "Urgent?" }
  ]
}
```

## JSON contract

Success (stdout):

```json
{
  "ok": true,
  "profile": "jev",
  "engine": "typesafe",
  "model": "jev-1.13.0",
  "answers": {
    "q": { "type": "yesno", "p": 0.91, "pass": true }
  },
  "usage": { "input_tokens": 120 },
  "latency_ms": 45
}
```

Answer types:

| type | fields |
|------|--------|
| `yesno` | `p`; optional `pass` when `yesno_pass` threshold configured |
| `choice` | `value`, `probs`, `confidence` |
| `score` | `score`, `labels`, `probs`, `confidence` |
| `refusal` | optional `reason` (not a low score) |
| `timeout` | — |
| `error` | `code`, optional `message` |

Fan output also includes `profile`, `engine`, `model` at the top level; per-item shape is unchanged (`answer` or `error`).

Errors (stderr): `{ "ok": false, "code", "message" }`

| Exit | Meaning |
|------|---------|
| 0 | Success (all answers are decisions) |
| 1 | General |
| 2 | `auth` |
| 3 | `rate_limit` |
| 4 | `invalid` |
| 5 | `engine` |
| 6 | **Outcome** — refusal, timeout, or `{type:"error"}` in answers; `--value` on refusal/error too |

`decide status` skips the live API call when `DECIDE_STATUS_SKIP=1` (or `true`).

## Engines (v1)

| Engine id | Product | Endpoint | Yes/no field |
|-----------|---------|----------|--------------|
| `typesafe` | TypeSafe Jev | `POST https://api.typesafe.ai/v1/systemone` | `noul` |
| `openai` | OpenAI Decisions | `POST https://api.openai.com/v1/decisions` | `predicate` |

Docs: [TypeSafe API](https://docs.typesafe.ai/api.md), [OpenAI Decisions](https://developers.openai.com/api/docs/guides/decisions). If this README disagrees with docs, **docs win**.

**Token notes:** TypeSafe evaluates many questions in one request over shared `state`. OpenAI Decisions documents input-only pricing on `gpt-6-luna` without separate cache line items. Neither exposes a multi-context single call—`--contexts` uses concurrent per-context requests.

## MCP

```bash
decide mcp
```

Tools: `yesno`, `choice`, `score`, `run`, `batch`, `fan_yesno`. Single by default; batch via `questions[]`; fan via `contexts[]` (not both).

## Extending

1. Add `EngineAdapter` in `src/engines/`.
2. Register in `src/engines/index.ts`.
3. Allow the engine id in `config.toml` / zod schema.

## Prior art

- [tumf/jev-cli](https://github.com/tumf/jev-cli)
- [@jkudish/jev-mcp](https://www.npmjs.com/package/@jkudish/jev-mcp)

**decide** adds profile-based routing, normalized stamped JSON, directory pins, explicit batch switches, and MCP without per-call engine flags.

## Tests

```bash
npm test
```

## License

MIT — not published to npm.
