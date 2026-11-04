import { SignJWT, jwtVerify } from 'jose';

const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? 'dev-secret-change-me');

export async function signToken(userId: string): Promise<string> {
    return new SignJWT({ sub: userId })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('7d')
        .sign(secret);
}

/** The user id and when the token was issued (Unix seconds), or null for an invalid or expired token */
export async function verifyToken(token: string): Promise<{ userId: string; issuedAt: number } | null> {
    try {
        const { payload } = await jwtVerify(token, secret);
        if (!payload.sub || payload.iat === undefined) return null;
        return { userId: payload.sub, issuedAt: payload.iat };
    } catch {
        return null;
    }
}
