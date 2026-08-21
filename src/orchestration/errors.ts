/** Orchestration manifest and runtime errors. */

export class OrchestrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrchestrationError";
  }
}

export class ManifestLoadError extends OrchestrationError {
  constructor(message: string) {
    super(message);
    this.name = "ManifestLoadError";
  }
}

export class PromptNotFoundError extends OrchestrationError {
  readonly promptName: string;
  readonly available: string[];

  constructor(promptName: string, available: string[]) {
    const keys = available.length ? available.sort().join(", ") : "(none)";
    super(`Prompt '${promptName}' not found in PROMPTS registry. Available: ${keys}`);
    this.name = "PromptNotFoundError";
    this.promptName = promptName;
    this.available = available;
  }
}

export class ReferenceCycleError extends OrchestrationError {
  readonly cyclePath: string[];

  constructor(cyclePath: string[]) {
    super(`Circular group reference detected: ${cyclePath.join(" -> ")}`);
    this.name = "ReferenceCycleError";
    this.cyclePath = cyclePath;
  }
}

export class MemberNotFoundError extends OrchestrationError {
  constructor(name: string, group: string) {
    super(`Member '${name}' not found for group '${group}'`);
    this.name = "MemberNotFoundError";
  }
}
