import type { DbClient } from "./db.js";

export async function isTenantAdmin(
  client: DbClient,
  tenantId: string,
  userId: string,
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1
       FROM tenant_users
      WHERE tenant_id = $1
        AND user_id = $2
        AND role = 'ADMIN'
        AND active = true
      LIMIT 1`,
    [tenantId, userId],
  );

  return result.rowCount === 1;
}

export async function isActiveSectorMember(
  client: DbClient,
  sectorId: string,
  userId: string,
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1
       FROM memberships
      WHERE sector_id = $1
        AND user_id = $2
        AND active = true
      LIMIT 1`,
    [sectorId, userId],
  );

  return result.rowCount === 1;
}

export async function isSectorManager(
  client: DbClient,
  sectorId: string,
  userId: string,
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1
       FROM memberships
      WHERE sector_id = $1
        AND user_id = $2
        AND role = 'MANAGER'
        AND active = true
      LIMIT 1`,
    [sectorId, userId],
  );

  return result.rowCount === 1;
}
