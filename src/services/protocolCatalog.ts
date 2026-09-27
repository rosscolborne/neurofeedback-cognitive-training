import type {
  ClientProfile,
  ProtocolCatalog,
  ProtocolCatalogEntry,
  ProtocolTemplate,
} from '../types';

export interface ResolvedProtocol {
  protocol: ProtocolTemplate;
  source: ProtocolCatalogEntry['source'];
  revision: string;
}

/**
 * Patient overrides remain authoritative. Otherwise resolution is delegated to
 * the injected catalog so UI code does not duplicate protocol definitions.
 */
export async function resolveAssignedProtocol(
  client: ClientProfile,
  catalog: ProtocolCatalog
): Promise<ResolvedProtocol | null> {
  if (client.customProtocolConfig) {
    return {
      protocol: client.customProtocolConfig,
      source: 'patient-override',
      revision: client.customProtocolConfig.version ?? 'legacy-unversioned',
    };
  }

  if (!client.assignedProtocol) return null;

  const entry = await catalog.getById(client.assignedProtocol, client.clinicId);
  if (!entry || entry.protocol.status === 'retired') return null;

  return {
    protocol: entry.protocol,
    source: entry.source,
    revision: entry.revision,
  };
}

export class InMemoryProtocolCatalog implements ProtocolCatalog {
  constructor(private readonly entries: ProtocolCatalogEntry[]) {}

  async getById(id: string, clinicId?: string): Promise<ProtocolCatalogEntry | null> {
    const candidates = this.entries.filter((entry) =>
      entry.protocol.id === id && (!entry.protocol.clinicId || entry.protocol.clinicId === clinicId)
    );
    return candidates.find((entry) => entry.source === 'clinic') ?? candidates[0] ?? null;
  }

  async list(clinicId?: string): Promise<ProtocolCatalogEntry[]> {
    return this.entries.filter((entry) => !entry.protocol.clinicId || entry.protocol.clinicId === clinicId);
  }
}
