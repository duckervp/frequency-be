// Request and response types of the HTTP API: the contract shared with the clients.
// Clients copy this file as-is (web: `npm run sync:api-types`), so it must not import anything.
// src/api-types.check.ts fails the BE type-check if these drift from the database schema.

export interface ApiUser {
    id: string;
    email: string;
    name: string;
    avatarUrl?: string | null;
}

export interface ApiAction {
    id: string;
    userId: string;
    name: string;
    icon: string;
    color: string;
    remindersEnabled: boolean;
    reminderTime: string | null;
    createdAt: string;
}

export interface ApiLogRow {
    id: string;
    userId: string;
    actionId: string | null;
    loggedAt: string;
    note: string | null;
    createdAt: string;
}

/** A log with its action (null for a quick log or a deleted action) */
export interface ApiLog {
    log: ApiLogRow;
    action: ApiAction | null;
}

export interface ApiError {
    error: string;
}

export interface AuthResponse {
    token: string;
    user: ApiUser;
}

export interface MeResponse {
    user: ApiUser;
    /** False for an account that only signs in with Google: it can set a password without a current one */
    hasPassword: boolean;
}

export interface SuccessResponse {
    success: boolean;
}

export interface StatsResponse {
    totalToday: number;
    dateInfo: string;
}

export interface StreakResponse {
    streak: number;
}

export interface RegisterBody {
    email: string;
    password: string;
    name?: string;
}

export interface LoginBody {
    email: string;
    password: string;
}

export interface UpdateProfileBody {
    name: string;
}

export interface ChangePasswordBody {
    /** Required when the account already has a password */
    currentPassword?: string;
    newPassword: string;
}

export interface ActionBody {
    name: string;
    icon?: string;
    color?: string;
    remindersEnabled?: boolean;
    reminderTime?: string;
}

export interface CreateLogBody {
    actionId?: string | null;
    /** ISO instant with Z or an offset */
    loggedAt: string;
    note?: string;
}

export interface UpdateLogBody {
    loggedAt?: string;
    note?: string;
}
