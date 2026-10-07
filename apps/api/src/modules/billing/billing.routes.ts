import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getBillingSummary, updateBillingProfile } from "./billing.service.js";

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/admin/billing", { preHandler: app.authenticate }, async (request, reply) => {
    const result = await getBillingSummary({
      tenantId: request.user.tenantId,
      actorUserId: request.user.sub,
    });
    if (result.kind === "forbidden") {
      return reply.code(403).send({ message: "Somente Admin da Empresa pode ver cobrança." });
    }
    return reply.send(result.summary);
  });

  app.put("/internal/billing/tenants/:tenantId", async (request, reply) => {
    const params = z.object({ tenantId: z.string().uuid() }).parse(request.params);
    const body = z.object({
      monthlyRequestLimit: z.number().int().min(0).max(2147483647).nullable().optional(),
      storageLimitBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().optional(),
      plan: z.enum(["STARTER", "BUSINESS", "ENTERPRISE"]),
      status: z.enum(["TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED"]),
      monthlyPricePerSectorCents: z.number().int().min(0),
      currency: z.string().length(3).default("BRL"),
      provider: z.string().max(50).nullable().optional(),
      externalCustomerId: z.string().max(200).nullable().optional(),
      externalSubscriptionId: z.string().max(200).nullable().optional(),
      currentPeriodStart: z.coerce.date().nullable().optional(),
      currentPeriodEnd: z.coerce.date().nullable().optional(),
    }).parse(request.body);

    const result = await updateBillingProfile({
      platformAdminKey: request.headers["x-platform-admin-key"] as string | undefined,
      tenantId: params.tenantId,
      plan: body.plan,
      status: body.status,
      monthlyPricePerSectorCents: body.monthlyPricePerSectorCents,
      currency: body.currency.toUpperCase(),
      ...(body.monthlyRequestLimit !== undefined ? { monthlyRequestLimit: body.monthlyRequestLimit } : {}),
      ...(body.storageLimitBytes !== undefined ? { storageLimitBytes: body.storageLimitBytes } : {}),
      ...(body.provider !== undefined ? { provider: body.provider } : {}),
      ...(body.externalCustomerId !== undefined ? { externalCustomerId: body.externalCustomerId } : {}),
      ...(body.externalSubscriptionId !== undefined ? { externalSubscriptionId: body.externalSubscriptionId } : {}),
      ...(body.currentPeriodStart !== undefined ? { currentPeriodStart: body.currentPeriodStart } : {}),
      ...(body.currentPeriodEnd !== undefined ? { currentPeriodEnd: body.currentPeriodEnd } : {}),
    });

    if (result.kind === "forbidden") {
      return reply.code(403).send({ message: "Chave administrativa inválida." });
    }
    if (result.kind === "tenant_not_found") {
      return reply.code(404).send({ message: "Tenant não encontrado." });
    }
    return reply.send(result.profile);
  });
}
