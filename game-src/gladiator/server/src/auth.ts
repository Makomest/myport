// Maps a connection credential to an account. In production this validates a
// signed session token (JWT etc.); here a simple token->account table and a
// dev-only allow-all are provided behind one interface.

import { verifyJwt } from "./jwt.js";

export interface AuthProvider {
  /** Returns the account id, or null if the token is invalid/missing. */
  resolve(token: string | null): string | null;
}

/**
 * Validates an HS256 JWT and maps a claim (default `sub`) to the account.
 * If `requiredRole` is set, the token must also carry `roleClaim === requiredRole`
 * (used to gate the operator/ops channel).
 */
export class JwtAuth implements AuthProvider {
  constructor(
    private readonly secret: string,
    private readonly accountClaim: string = "sub",
    private readonly requiredRole?: string,
    private readonly roleClaim: string = "role",
  ) {}
  resolve(token: string | null): string | null {
    if (!token) return null;
    try {
      const claims = verifyJwt(token, this.secret);
      if (this.requiredRole !== undefined && claims[this.roleClaim] !== this.requiredRole) return null;
      const acct = claims[this.accountClaim];
      return typeof acct === "string" ? acct : null;
    } catch {
      return null; // invalid signature / expired / malformed / wrong role -> unauthorized
    }
  }
}

export class TokenAuth implements AuthProvider {
  constructor(private readonly tokens: Map<string, string>) {}
  resolve(token: string | null): string | null {
    return token ? this.tokens.get(token) ?? null : null;
  }
}

/** Dev only: accepts any token, echoing it (or "guest") as the account. */
export class AllowAllAuth implements AuthProvider {
  resolve(token: string | null): string | null {
    return token || "guest";
  }
}
