import { withTenantTransaction } from "../../db.js";
import { createInAppNotification, enqueueEmail } from "../notifications/notification.service.js";

async function canReview(
  client: import("../../db.js").DbClient,
  requestId: string,
  actorUserId: string,
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1
       FROM requests r
       JOIN memberships m
         ON m.sector_id = r.origin_sector_id
        AND m.user_id = $2
        AND m.active = true
        AND m.role IN ('MANAGER', 'APPROVER')
      WHERE r.id = $1
      LIMIT 1`,
    [requestId, actorUserId],
  );
  return result.rowCount === 1;
}

async function recalculateRequestStatus(
  client: import("../../db.js").DbClient,
  requestId: string,
): Promise<string> {
  const counts = await client.query<{
    total: string;
    approved: string;
    returned: string;
    submitted: string;
  }>(
    `SELECT
       count(*)::text AS total,
       count(*) FILTER (WHERE status = 'APPROVED')::text AS approved,
       count(*) FILTER (WHERE status = 'RETURNED')::text AS returned,
       count(*) FILTER (WHERE status = 'SUBMITTED')::text AS submitted
     FROM request_items
     WHERE request_id = $1`,
    [requestId],
  );

  const row = counts.rows[0]!;
  const total = Number(row.total);
  const approved = Number(row.approved);
  const returned = Number(row.returned);
  const submitted = Number(row.submitted);

  const nextStatus =
    total > 0 && approved === total
      ? "APPROVED"
      : returned > 0
        ? "IN_CORRECTION"
        : submitted > 0
          ? "IN_REVIEW"
          : "IN_PROGRESS";

  await client.query(
    `UPDATE requests SET status = $2::request_status, updated_at = now() WHERE id = $1`,
    [requestId, nextStatus],
  );

  return nextStatus;
}

async function notifyRequestParticipant(
  client: import("../../db.js").DbClient,
  input: {
    tenantId: string;
    requestId: string;
    userId?: string | null;
    guestLinkId?: string | null;
    type: string;
    subject: string;
    message: string;
    dedupeKey: string;
  },
) {
  if (input.userId) {
    const user = await client.query<{ email: string }>(
      `SELECT email FROM users WHERE id = $1 AND active = true LIMIT 1`,
      [input.userId],
    );
    if (user.rows[0]) {
      await enqueueEmail(client, {
        tenantId: input.tenantId,
        requestId: input.requestId,
        recipientEmail: user.rows[0].email,
        subject: input.subject,
        bodyText: input.message,
        dedupeKey: input.dedupeKey,
      });
      await createInAppNotification(client, {
        tenantId: input.tenantId,
        userId: input.userId,
        requestId: input.requestId,
        type: input.type,
        title: input.subject.replace("[Handoff] ", ""),
        message: input.message,
      });
    }
  } else if (input.guestLinkId) {
    const guest = await client.query<{ email: string }>(
      `SELECT email FROM guest_links WHERE id = $1 LIMIT 1`,
      [input.guestLinkId],
    );
    if (guest.rows[0]) {
      await enqueueEmail(client, {
        tenantId: input.tenantId,
        requestId: input.requestId,
        recipientEmail: guest.rows[0].email,
        subject: input.subject,
        bodyText: input.message,
        dedupeKey: input.dedupeKey,
      });
    }
  }
}

export async function approveItem(input: {
  tenantId: string;
  requestId: string;
  itemId: string;
  actorUserId: string;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    if (!(await canReview(client, input.requestId, input.actorUserId))) {
      return { kind: "forbidden" as const };
    }

    const itemResult = await client.query<{
      id: string;
      status: string;
      submitted_by: string | null;
      submitted_guest_link_id: string | null;
    }>(
      `SELECT id, status, submitted_by, submitted_guest_link_id
         FROM request_items
        WHERE id = $1 AND request_id = $2
        FOR UPDATE`,
      [input.itemId, input.requestId],
    );

    const item = itemResult.rows[0];
    if (!item) return { kind: "not_found" as const };
    if (item.status !== "SUBMITTED") return { kind: "invalid_state" as const, status: item.status };
    if (item.submitted_by === input.actorUserId) return { kind: "maker_checker" as const };

    await client.query(
      `UPDATE request_items
          SET status = 'APPROVED',
              reviewed_by = $2,
              reviewed_at = now(),
              return_comment = NULL,
              correction_due_at = NULL,
              updated_at = now()
        WHERE id = $1`,
      [input.itemId, input.actorUserId],
    );

    const requestStatus = await recalculateRequestStatus(client, input.requestId);

    await notifyRequestParticipant(client, {
      tenantId: input.tenantId,
      requestId: input.requestId,
      userId: item.submitted_by,
      guestLinkId: item.submitted_guest_link_id,
      type: "ITEM_APPROVED",
      subject: "[Handoff] Item aprovado",
      message: "Um item enviado por você foi aprovado.",
      dedupeKey: `request:${input.requestId}:item:${input.itemId}:approved`,
    });

    if (requestStatus === "APPROVED") {
      const creator = await client.query<{ created_by: string; email: string }>(
        `SELECT r.created_by, u.email
           FROM requests r
           JOIN users u ON u.id = r.created_by
          WHERE r.id = $1`,
        [input.requestId],
      );
      if (creator.rows[0]) {
        await enqueueEmail(client, {
          tenantId: input.tenantId,
          requestId: input.requestId,
          recipientEmail: creator.rows[0].email,
          subject: "[Handoff] Solicitação totalmente aprovada",
          bodyText: "Todos os itens da solicitação foram aprovados e ela está pronta para fechamento.",
          dedupeKey: `request:${input.requestId}:fully-approved`,
        });
        await createInAppNotification(client, {
          tenantId: input.tenantId,
          userId: creator.rows[0].created_by,
          requestId: input.requestId,
          type: "REQUEST_APPROVED",
          title: "Solicitação aprovada",
          message: "Todos os itens foram aprovados e a solicitação está pronta para fechamento.",
        });
      }
    }

    await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
       VALUES ($1, $2, 'REQUEST_ITEM_APPROVED', 'request_item', $3, $4::jsonb)`,
      [
        input.tenantId,
        input.actorUserId,
        input.itemId,
        JSON.stringify({ status: "APPROVED", requestStatus }),
      ],
    );

    return { kind: "approved" as const, requestStatus };
  });
}

export async function returnItem(input: {
  tenantId: string;
  requestId: string;
  itemId: string;
  actorUserId: string;
  comment: string;
  correctionDueAt: Date;
}) {
  return withTenantTransaction(input.tenantId, async (client) => {
    if (!(await canReview(client, input.requestId, input.actorUserId))) {
      return { kind: "forbidden" as const };
    }
    if (input.correctionDueAt.getTime() <= Date.now()) {
      return { kind: "invalid_due_date" as const };
    }

    const itemResult = await client.query<{
      id: string;
      status: string;
      submitted_by: string | null;
      submitted_guest_link_id: string | null;
    }>(
      `SELECT id, status, submitted_by, submitted_guest_link_id
         FROM request_items
        WHERE id = $1 AND request_id = $2
        FOR UPDATE`,
      [input.itemId, input.requestId],
    );

    const item = itemResult.rows[0];
    if (!item) return { kind: "not_found" as const };
    if (item.status !== "SUBMITTED") return { kind: "invalid_state" as const, status: item.status };
    if (item.submitted_by === input.actorUserId) return { kind: "maker_checker" as const };

    await client.query(
      `UPDATE request_items
          SET status = 'RETURNED',
              reviewed_by = $2,
              reviewed_at = now(),
              return_comment = $3,
              correction_due_at = $4,
              updated_at = now()
        WHERE id = $1`,
      [input.itemId, input.actorUserId, input.comment, input.correctionDueAt],
    );

    const requestStatus = await recalculateRequestStatus(client, input.requestId);

    await notifyRequestParticipant(client, {
      tenantId: input.tenantId,
      requestId: input.requestId,
      userId: item.submitted_by,
      guestLinkId: item.submitted_guest_link_id,
      type: "ITEM_RETURNED",
      subject: "[Handoff] Item devolvido para correção",
      message: `Um item foi devolvido. Motivo: ${input.comment}. Novo prazo: ${input.correctionDueAt.toISOString()}.`,
      dedupeKey: `request:${input.requestId}:item:${input.itemId}:returned:${input.correctionDueAt.toISOString()}`,
    });

    await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
       VALUES ($1, $2, 'REQUEST_ITEM_RETURNED', 'request_item', $3, $4::jsonb)`,
      [
        input.tenantId,
        input.actorUserId,
        input.itemId,
        JSON.stringify({
          status: "RETURNED",
          comment: input.comment,
          correctionDueAt: input.correctionDueAt,
          requestStatus,
        }),
      ],
    );

    return { kind: "returned" as const, requestStatus };
  });
}
