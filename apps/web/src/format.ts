const statusLabels: Record<string, string> = {
  DRAFT: "Rascunho",
  OPEN: "Aberta",
  IN_PROGRESS: "Em preenchimento",
  WAITING_REASSIGNMENT: "Aguardando reatribuição",
  IN_REVIEW: "Em revisão",
  IN_CORRECTION: "Em correção",
  APPROVED: "Aprovada",
  CLOSED: "Fechada",
  CANCELLED: "Cancelada",
  SUBMITTED: "Enviado",
  RETURNED: "Devolvido",
  PUBLISHED: "Publicado",
};

export function statusLabel(status: string): string {
  return statusLabels[status] ?? status;
}

export function dueLabel(iso: string, overdue = false): string {
  const due = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDay = new Date(due);
  dueDay.setHours(0, 0, 0, 0);
  const days = Math.round((dueDay.getTime() - today.getTime()) / 86_400_000);
  if (overdue || days < 0) {
    const late = Math.abs(days);
    return late === 1 ? "atrasada 1 dia" : `atrasada ${late} dias`;
  }
  if (days === 0) return "vence hoje";
  if (days === 1) return "vence em 1 dia";
  return `vence em ${days} dias`;
}
