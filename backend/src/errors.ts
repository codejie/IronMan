export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 502;

export class AppError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly status: ErrorStatus
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const errors = {
  invalidCredentials: () => new AppError(10001, "邮箱或密码错误", 401),
  unauthenticated: () => new AppError(10002, "登录状态无效或已过期", 401),
  forbidden: () => new AppError(10003, "没有执行此操作的权限", 403),
  alreadyExists: (message: string) => new AppError(10004, message, 409),
  validation: (message: string) => new AppError(10005, message, 400),
  notFound: (message: string) => new AppError(10006, message, 404),
  external: (message: string) => new AppError(20001, message, 502)
};
