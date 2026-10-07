import net from "node:net";
import { config } from "./config.js";

export type AntivirusResult =
  | { status: "CLEAN" }
  | { status: "INFECTED"; signature: string }
  | { status: "UNAVAILABLE"; error: string };

export async function scanBuffer(buffer: Buffer): Promise<AntivirusResult> {
  if (!config.CLAMAV_ENABLED) return { status: "CLEAN" };

  return new Promise((resolve) => {
    const socket = net.createConnection({
      host: config.CLAMAV_HOST,
      port: config.CLAMAV_PORT,
    });

    let response = "";
    let settled = false;

    const finish = (result: AntivirusResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(config.CLAMAV_TIMEOUT_MS);

    socket.on("connect", () => {
      socket.write(Buffer.from("zINSTREAM\0", "utf8"));

      const chunkSize = 64 * 1024;
      for (let offset = 0; offset < buffer.length; offset += chunkSize) {
        const chunk = buffer.subarray(offset, Math.min(offset + chunkSize, buffer.length));
        const length = Buffer.allocUnsafe(4);
        length.writeUInt32BE(chunk.length, 0);
        socket.write(length);
        socket.write(chunk);
      }

      const end = Buffer.alloc(4);
      end.writeUInt32BE(0, 0);
      socket.write(end);
    });

    socket.on("data", (data) => {
      response += data.toString("utf8");
      if (response.includes("\0") || response.includes("\n")) {
        const normalized = response.replace(/\0/g, "").trim();
        if (normalized.endsWith("OK")) {
          finish({ status: "CLEAN" });
          return;
        }

        const found = normalized.match(/: (.+) FOUND$/);
        if (found?.[1]) {
          finish({ status: "INFECTED", signature: found[1] });
          return;
        }

        finish({ status: "UNAVAILABLE", error: `Resposta inesperada do ClamAV: ${normalized}` });
      }
    });

    socket.on("timeout", () => {
      finish({ status: "UNAVAILABLE", error: "Timeout ao consultar ClamAV." });
    });

    socket.on("error", (error) => {
      finish({ status: "UNAVAILABLE", error: error.message });
    });

    socket.on("end", () => {
      if (!settled) {
        const normalized = response.replace(/\0/g, "").trim();
        if (normalized.endsWith("OK")) finish({ status: "CLEAN" });
        else finish({ status: "UNAVAILABLE", error: normalized || "ClamAV encerrou sem resposta." });
      }
    });
  });
}
