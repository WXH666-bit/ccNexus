type JsonRecord = Record<string, unknown>;

interface ProviderItem {
  id: string;
  name: string;
  base_url?: string;
  api_key?: string;
  model_mapping?: string | Record<string, string>;
}

interface AgentItem {
  id: string;
  name: string;
  description: string;
  file?: string;
}

interface PromptItem {
  name: string;
  content: string;
  file: string;
}

interface CommandItem {
  name?: string;
  command?: string;
  description?: string;
  args?: string;
  source?: string;
}

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export async function getProviders() {
  if (window.ccNexusDesktop?.getProviders) {
    return await window.ccNexusDesktop?.getProviders() as {
      providers: ProviderItem[];
      currentProviderId?: string | null;
      currentEnv?: Record<string, string | undefined>;
    };
  }
  return readJson<{ providers: ProviderItem[]; currentProviderId?: string | null; currentEnv?: Record<string, string | undefined> }>(
    await fetch('/api/providers'),
  );
}

export async function switchProvider(providerId: string) {
  if (window.ccNexusDesktop?.switchProvider) {
    return await window.ccNexusDesktop?.switchProvider(providerId);
  }
  return readJson<JsonRecord>(
    await fetch('/api/providers/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId }),
    }),
  );
}

export async function getAgents() {
  if (window.ccNexusDesktop?.getAgents) {
    return await window.ccNexusDesktop?.getAgents() as { agents: AgentItem[] };
  }
  return readJson<{ agents: AgentItem[] }>(await fetch('/api/agents'));
}

export async function getCommands() {
  if (window.ccNexusDesktop?.getCommands) {
    return await window.ccNexusDesktop?.getCommands() as { commands: CommandItem[] };
  }
  return readJson<{ commands: CommandItem[] }>(await fetch('/api/commands'));
}

export async function getPrompts() {
  if (window.ccNexusDesktop?.getPrompts) {
    return await window.ccNexusDesktop?.getPrompts() as { prompts: PromptItem[] };
  }
  return readJson<{ prompts: PromptItem[] }>(await fetch('/api/prompts'));
}

export async function savePrompt(prompt: { name: string; content: string }) {
  if (window.ccNexusDesktop?.savePrompt) {
    return await window.ccNexusDesktop?.savePrompt(prompt);
  }
  return readJson<JsonRecord>(
    await fetch('/api/prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prompt),
    }),
  );
}

export async function deletePrompt(name: string) {
  if (window.ccNexusDesktop?.deletePrompt) {
    return await window.ccNexusDesktop?.deletePrompt(name);
  }
  return readJson<JsonRecord>(
    await fetch(`/api/prompts/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  );
}

export async function getProcesses() {
  if (window.ccNexusDesktop?.getProcesses) {
    return await window.ccNexusDesktop?.getProcesses();
  }
  return readJson<JsonRecord>(await fetch('/api/processes'));
}

export async function stopProcess(processRef: { pid: number; id?: string }) {
  if (window.ccNexusDesktop?.stopProcess) {
    return await window.ccNexusDesktop?.stopProcess(processRef);
  }
  return readJson<JsonRecord>(
    await fetch(`/api/processes/${processRef.pid}/kill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: processRef.id }),
    }),
  );
}

export async function restartProcess(processRef: { pid: number; id?: string }) {
  if (window.ccNexusDesktop?.restartProcess) {
    return await window.ccNexusDesktop?.restartProcess(processRef);
  }
  return readJson<JsonRecord>(
    await fetch(`/api/processes/${processRef.pid}/restart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: processRef.id }),
    }),
  );
}

export async function scanFiles(query: string, limit = 20) {
  if (window.ccNexusDesktop?.scanFiles) {
    return await window.ccNexusDesktop?.scanFiles({ q: query, limit });
  }
  return readJson<{ files: string[] }>(
    await fetch(`/api/files/scan?q=${encodeURIComponent(query)}&limit=${limit}`),
  );
}

export async function getFileTree(options: { path?: string; depth?: number; showDotfiles?: boolean; maxItems?: number }) {
  if (window.ccNexusDesktop?.listFiles) {
    return await window.ccNexusDesktop?.listFiles(options);
  }
  const params = new URLSearchParams();
  params.set('path', options.path || '.');
  if (options.depth !== undefined) params.set('depth', String(options.depth));
  if (options.showDotfiles !== undefined) params.set('showDotfiles', String(options.showDotfiles));
  if (options.maxItems !== undefined) params.set('maxItems', String(options.maxItems));
  return readJson<{ tree: unknown[]; root: string; cwd?: string; rootName?: string }>(
    await fetch(`/api/files/tree?${params.toString()}`),
  );
}
