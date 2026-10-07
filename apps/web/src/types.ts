export type TemplateField = {
  key: string;
  label: string;
  type:
    | "TEXT"
    | "NUMBER"
    | "MONEY"
    | "DATE"
    | "CPF"
    | "CNPJ"
    | "SELECT"
    | "BOOLEAN"
    | "ATTACHMENT";
  required?: boolean;
  min?: number;
  max?: number;
  regex?: string;
  options?: string[];
};

export type TemplateSchema = {
  fields: TemplateField[];
};

export type RequestDetail = {
  request: {
    id: string;
    title: string;
    instructions: string | null;
    competence: string | null;
    due_at: string;
    status: string;
    origin_sector_id: string;
    origin_sector_name: string;
    destination_sector_id: string;
    destination_sector_name: string;
    assigned_to: string | null;
    assignee_name: string | null;
    template_version_id: string | null;
    schema_json: TemplateSchema | null;
    retifies_request_id: string | null;
  };
  permissions: {
    canRead: boolean;
    canEdit: boolean;
    canSubmit: boolean;
    canReview: boolean;
    canAssign: boolean;
    canReassign: boolean;
    canCancel: boolean;
    canClose: boolean;
    canRetify: boolean;
    canAudit: boolean;
  };
};

export type RequestItem = {
  id: string;
  item_key: string;
  data: Record<string, unknown>;
  status: "DRAFT" | "SUBMITTED" | "APPROVED" | "RETURNED";
  return_comment?: string | null;
  correction_due_at?: string | null;
  updated_at: string;
};
