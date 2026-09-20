import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function fail(status: number, message: string): never { throw new HttpError(status, message); }
export const idOf = (req: Request) => z.uuid().parse(req.params.id);
export const person = { id: true, name: true, role: true } as const;
export const staff = (_req: Request, res: Response, next: NextFunction) => res.locals.user.role === 'EMPLOYEE' ? next(new HttpError(403,'Support role required')) : next();
export const admin = (_req: Request, res: Response, next: NextFunction) => res.locals.user.role !== 'ADMIN' ? next(new HttpError(403,'Administrator role required')) : next();
