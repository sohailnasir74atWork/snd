/** Roles — FR-1.2. One role per account, set by the Owner. */
export type Role = 'admin' | 'booker' | 'rider';

/** What the auth layer resolves after Sign in with Google (§10.1). */
export interface SessionUser {
  uid: string;
  email: string;
  name: string;
  companyId: string;
  role: Role;
}
