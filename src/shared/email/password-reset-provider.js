export function iniciarProveedorRecuperacionAcceso(runtimeConfig) {
  const settings = runtimeConfig?.security?.passwordReset || { provider: 'disabled' };
  if (settings.provider === 'manual') {
    return Object.freeze({
      name: 'manual',
      async enviarTokenRestablecimiento() {
        return { skipped: true };
      },
    });
  }
  if (settings.provider === 'webhook') {
    return Object.freeze({
      name: 'webhook',
      async enviarTokenRestablecimiento(payload) {
        const response = await fetch(settings.webhookUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${settings.webhookToken}`,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error(`PASSWORD_RESET_WEBHOOK_${response.status}`);
        return { delivered: true };
      },
    });
  }
  return Object.freeze({
    name: 'disabled',

    async enviarTokenRestablecimiento() {
      throw new Error('PASSWORD_RESET_PROVIDER_DISABLED');
    },
  });
}
