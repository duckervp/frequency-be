// Compile-time only: fails `tsc` when the contract in api-types.ts and the database rows the
// routes return drift apart, in either direction (a field added, removed or retyped).
import type { Action, ActionLog, User } from './db/schema.js';
import type { ApiAction, ApiLogRow, ApiUser } from './api-types.js';

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Expect<T extends true> = T;

export type ContractChecks = [
    Expect<Same<Action, ApiAction>>,
    Expect<Same<ActionLog, ApiLogRow>>,
    // The API never returns password_hash or google_id
    Expect<Same<Pick<User, 'id' | 'email' | 'name' | 'avatarUrl'>, Required<ApiUser>>>,
];
