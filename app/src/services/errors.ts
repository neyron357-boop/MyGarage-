/** Business rule violation; `code` is an i18n key shown to the user. */
export class AppError extends Error {
  constructor(public code: string, public params?: Record<string, unknown>) {
    super(code);
    this.name = 'AppError';
  }
}
