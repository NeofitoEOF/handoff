import type { FastifyInstance, FastifyRequest } from "fastify";
import fastifyJwt from "@fastify/jwt";
import { config } from "./config.js";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: {
      sub: string;
      tenantId: string;
    };
    user: {
      sub: string;
      tenantId: string;
    };
  }
}

export async function registerAuth(app: FastifyInstance): Promise<void> {
  await app.register(fastifyJwt, {
    secret: config.JWT_SECRET,
  });

  app.decorate("authenticate", async function authenticate(request: FastifyRequest) {
    await request.jwtVerify();
  });
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate(request: FastifyRequest): Promise<void>;
  }
}
