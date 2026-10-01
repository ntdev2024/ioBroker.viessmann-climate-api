/**
 *
 * @param client
 */
export async function discoverEquipment(client) {
  const installations = await client.get("/iot/v2/equipment/installations?includeGateways=true");
  const result = [];

  for (const installation of installations.data || []) {
    for (const gateway of installation.gateways || []) {
      const devices = await client.get(
        `/iot/v2/equipment/installations/${installation.id}/gateways/${gateway.serial}/devices/`
      );
      for (const device of devices.data || gateway.devices || []) {
        const deviceId = device.id;
        if (!deviceId) {
          continue;
        }
        const features = await client.get(
          `/iot/v2/features/installations/${installation.id}/gateways/${gateway.serial}/devices/${deviceId}/features`
        );
        result.push({
          installationId: installation.id,
          gatewaySerial: gateway.serial,
          deviceId,
          device,
          features: features.data || []
        });
      }
    }
  }

  return result;
}

export function commandPath(command) {
  const url = new URL(command.uri);
  return `${url.pathname}${url.search}`;
}
