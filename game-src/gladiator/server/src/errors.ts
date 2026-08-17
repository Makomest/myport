export class RgBlockedError extends Error {
  constructor(readonly reason: string) {
    super(`responsible-gaming: ${reason}`);
    this.name = "RgBlockedError";
  }
}
export class InsufficientFundsError extends Error {
  constructor() {
    super("insufficient funds");
    this.name = "InsufficientFundsError";
  }
}
export class RoundNotFoundError extends Error {
  constructor(id: string) {
    super(`round not found: ${id}`);
    this.name = "RoundNotFoundError";
  }
}
export class InvalidStateError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "InvalidStateError";
  }
}
/** A second money-moving action arrived while one was already running for this account. */
export class ConflictError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ConflictError";
  }
}
