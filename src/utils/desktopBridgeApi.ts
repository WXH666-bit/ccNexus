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

export async function switchProvider(providerId: string) {
  return await requireDesktopApi().switchProvider(providerId);
}

export async function getAgents() {
  return await requireDesktopApi().getAgents() as { agents: AgentItem[] };
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

export async function scanFiles(query: string, limit = 20) {
  return await requireDesktopApi().scanFiles({ q: query, limit });
}

export async function getFileTree(options: { path?: string; depth?: number; showDotfiles?: boolean; maxItems?: number }) {
  return await requireDesktopApi().listFiles(options);
}
