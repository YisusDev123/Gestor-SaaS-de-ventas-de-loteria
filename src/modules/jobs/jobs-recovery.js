export async function solicitarRecuperacionTenant(jobsService, tenantId, trigger) {
  if (!jobsService || !tenantId) return {};
  try {
    const execution = await jobsService.generarSorteosParaTenant(tenantId, { trigger });
    if (!execution?.acquired) return { drawRecovery: { status: 'PENDING' } };
    const result = execution.result;
    return {
      drawRecovery: {
        status: result.status,
        created: result.created,
        existing: result.existing,
        skipped: result.skipped,
        incomplete: result.incomplete,
      },
    };
  } catch {
    return { drawRecovery: { status: 'PENDING' } };
  }
}
