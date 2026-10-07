{{- define "handoff.name" -}}
handoff
{{- end }}

{{- define "handoff.labels" -}}
app.kubernetes.io/name: {{ include "handoff.name" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
