import { describe, expect, it } from "vitest";
import {
  canEditField,
  canSeeField,
  prepareItemData,
  presentFields,
  redactData,
  readSchemaFields,
  requiredApprovals,
  type FieldViewer,
} from "./field-access.js";

const salary = {
  key: "salario",
  visibleTo: ["APPROVER", "MANAGER"] as Array<"APPROVER" | "MANAGER">,
  readOnlyFor: ["MEMBER"] as Array<"MEMBER">,
};

const member: FieldViewer = { guest: false, privileged: false, roles: ["MEMBER"] };
const approver: FieldViewer = { guest: false, privileged: false, roles: ["APPROVER"] };
const guest: FieldViewer = { guest: true, privileged: false, roles: [] };
const auditor: FieldViewer = { guest: false, privileged: true, roles: [] };

describe("acesso a campo por papel", () => {
  it("esconde campo sensível de membro e de convidado", () => {
    expect(canSeeField(salary, member)).toBe(false);
    expect(canSeeField(salary, guest)).toBe(false);
    expect(canSeeField(salary, approver)).toBe(true);
    expect(canSeeField(salary, auditor)).toBe(true);
  });

  it("mantém campo só leitura para o papel indicado", () => {
    const note = { key: "obs", readOnlyFor: ["MEMBER"] as Array<"MEMBER"> };
    expect(canEditField(note, member)).toBe(false);
    expect(canEditField(note, approver)).toBe(true);
    expect(canEditField(note, guest)).toBe(false);
  });

  it("rejeita alteração de campo bloqueado e preserva o valor anterior", () => {
    const fields = [salary, { key: "descricao" }];
    const blocked = prepareItemData({
      existing: { salario: 1000, descricao: "antes" },
      incoming: { salario: 2000, descricao: "depois" },
      fields,
      viewer: member,
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.fields).toEqual(["salario"]);

    const allowed = prepareItemData({
      existing: { salario: 1000, descricao: "antes" },
      incoming: { descricao: "depois" },
      fields,
      viewer: member,
    });
    expect(allowed).toEqual({
      ok: true,
      data: { salario: 1000, descricao: "depois" },
    });
  });

  it("remove o campo da resposta e do schema apresentado", () => {
    expect(redactData({ salario: 1000, descricao: "a" }, [salary, { key: "descricao" }], member)).toEqual({
      descricao: "a",
    });
    expect(presentFields([salary, { key: "descricao" }], member).map((field) => field.key)).toEqual(["descricao"]);
  });
});

describe("alçada por valor", () => {
  const policy = { fieldKey: "valor", threshold: 20000 };

  it("exige segundo aprovador só acima do limite", () => {
    expect(requiredApprovals(policy, { valor: 20000 })).toBe(1);
    expect(requiredApprovals(policy, { valor: 20000.01 })).toBe(2);
    expect(requiredApprovals(policy, { valor: "20.000,00" })).toBe(1);
    expect(requiredApprovals(policy, { valor: "R$ 20.000,01" })).toBe(2);
    expect(requiredApprovals(policy, { valor: "não informado" })).toBe(2);
    expect(requiredApprovals(null, { valor: 999999 })).toBe(1);
  });

  it("não libera campo quando a lista de papéis é inválida", () => {
    const broken = { key: "salario", visibleTo: ["administrador"] as never };
    expect(canSeeField(readSchemaFields({ fields: [broken] })[0]!, member)).toBe(false);
    expect(canSeeField(readSchemaFields({ fields: [broken] })[0]!, auditor)).toBe(true);
  });
});
