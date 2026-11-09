export class NotFoundError extends Error {}
export class UnprocessableError extends Error {
  constructor(
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
/** El plan cambió desde que se calculó la vista previa (control de concurrencia optimista). */
export class ConflictError extends Error {
  constructor(
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
