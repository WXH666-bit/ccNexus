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

function requireDesktopApi(): CcNexusDesktopApi {
  if (!window.ccNexusDesktop) {
    throw new Error('ccNexus desktop bridge is unavailable');
  }
  return window.ccNexusDesktop;
}

export async function getProviders() {
  return await requireDesktopApi().getProviders() as {
    providers: ProviderItem[];
    currentProviderId?: string | null;
    currentEnv?: Record<string, string | undefined>;
  };
}

export async function getWorkspace() {
  return await requireDesktopApi().getWorkspace() as { cwd: string; rootName: string };
}

export async function switchProvider(providerId: string) {
  return await requireDesktopApi().switchProvider(providerId);
}

export async function getAgents() {
  return await requireDesktopApi().getAgents() as { agents: AgentItem[] };
}

export async function getMcpServers() {
  return await requireDesktopApi().getMcpServers() as {
    servers: Array<{ id: string; name: string; enabled: boolean; scope: string; config: Record<string, unknown> }>;
    disabled: string[];
    invalid: Array<{ id: string; reason: string }>;
    scope: string;
  };
}

export async function getSkills() {
  return await requireDesktopApi().getSkills() as {
    global: Record<string, { id: string; name: string; type: string; scope: string; path: string; enabled: boolean; description?: string; modifiedAt?: string }>;
    local: Record<string, { id: string; name: string; type: string; scope: string; path: string; enabled: boolean; description?: string; modifiedAt?: string }>;
  };
}

export async function getCommands() {
  return await requireDesktopApi().getCommands() as { commands: CommandItem[] };
}

export async function getPrompts() {
  return await requireDesktopApi().getPrompts() as { prompts: PromptItem[] };
}

export async function savePrompt(prompt: { name: string; content: string }) {
  return await requireDesktopApi().savePrompt(prompt);
}

export async function deletePrompt(name: string) {
  return await requireDesktopApi().deletePrompt(name);
}

export async function getProcesses() {
  return await requireDesktopApi().getProcesses();
}

export async function stopProcess(processRef: { pid: number; id?: string }) {
  return await requireDesktopApi().stopProcess(processRef);
}

export async function restartProcess(processRef: { pid: number; id?: string }) {
  return await requireDesktopApi().restartProcess(processRef);
}

export async function getUsageStatistics(args: { scope?: 'current' | 'all'; dateRange?: '7d' | '30d' | 'all' } = {}) {
  return await requireDesktopApi().getUsageStatistics(args);
}

export async function getContextUsage(args: { sessionId?: string | null; model?: string } = {}) {
  return await requireDesktopApi().getContextUsage(args);
}

export async function exportSession(sessionId: string, title?: string) {
  return await requireDesktopApi().exportSession(sessionId, title);
}

export async function scanFiles(query: string, limit = 20) {
  return await requireDesktopApi().scanFiles({ q: query, limit });
}

export async function getFileTree(options: { path?: string; depth?: number; showDotfiles?: boolean; maxItems?: number }) {
  return await requireDesktopApi().listFiles(options);
}
