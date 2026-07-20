export interface IRequest {}

export interface IResponse<T = unknown> {
  code: number;
  message?: string;
  result: T extends any ? T : T & any;
}

export function success<T>(result: T, message?: string): IResponse<T> {
  return (message === undefined ? { code: 0, result } : { code: 0, message, result }) as IResponse<T>;
}

export function failure(code: number, message: string): IResponse<null> {
  return { code, message, result: null };
}
