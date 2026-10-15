export class ProfilePinError extends Error {
  code: "invalid" = "invalid";
}

export class RunnerError extends Error {
  constructor(
    public readonly code: "auth" | "rate_limit" | "invalid" | "engine" | "timeout",
    message: string,
  ) {
    super(message);
  }
}
