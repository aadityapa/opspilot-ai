import { z } from 'zod';
// The plain value lists live in model.ts, which has no zod dependency, so the browser can import
// them without pulling the validation library into its bundle. Re-exported here for the server.
import { assetStatuses, assetTypes } from './model.js';
export { assetStatuses, assetTypes };
const date=z.iso.date().nullable();
export const assetSchema=z.object({tag:z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9-]+$/).transform(v=>v.toUpperCase()),type:z.enum(assetTypes),manufacturer:z.string().trim().min(1).max(100),model:z.string().trim().min(1).max(100),serialNumber:z.string().trim().min(1).max(100),ownerId:z.uuid().nullable(),status:z.enum(assetStatuses),purchaseDate:date,warrantyExpiry:date}).strict().refine(v=>!v.purchaseDate||!v.warrantyExpiry||v.warrantyExpiry>=v.purchaseDate,{message:'Warranty expiry must not precede purchase date',path:['warrantyExpiry']});
export const assetUpdateSchema=z.object({version:z.number().int().nonnegative(),asset:assetSchema}).strict();
export const pageSchema=z.object({q:z.string().trim().max(160).default(''),page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(15)});
