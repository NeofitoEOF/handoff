import type { DbClient } from "../../db.js";
import { isSectorFieldRole, type FieldViewer, type SectorFieldRole } from "./field-access.js";

export async function loadFieldViewer(
  client: DbClient,
  userId: string,
  sectorIds: string[],
): Promise<FieldViewer> {
  const memberships = await client.query<{ role: string }>(
    `SELECT role
       FROM memberships
      WHERE user_id = $1
        AND active = true
        AND sector_id = ANY($2::uuid[])`,
    [userId, sectorIds],
  );
  const tenant = await client.query<{ role: string }>(
    `SELECT role
       FROM tenant_users
      WHERE user_id = $1
        AND active = true
      LIMIT 1`,
    [userId],
  );
  const roles = [...new Set(memberships.rows.map((row) => row.role).filter(isSectorFieldRole))] as SectorFieldRole[];
  const tenantRole = tenant.rows[0]?.role;
  return {
    guest: false,
    privileged: tenantRole === "ADMIN" || tenantRole === "AUDITOR",
    roles,
  };
}

export const guestFieldViewer: FieldViewer = {
  guest: true,
  privileged: false,
  roles: [],
};
