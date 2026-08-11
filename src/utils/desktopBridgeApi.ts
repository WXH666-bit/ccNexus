interface ProviderItem {
  id: string;
  name: string;
  isActive?: boolean;
  isLocalProvider?: boolean;
  isCliLoginProvider?: boolean;
}

interface AgentItem {
  id: string;
  name: string;
  description: string;
  file?: string;
  prompt?: string;
  source: 'ccnexus' | 'claude' | string;
  editable: boolean;
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
    providerMode?: string | null;
  };
}

export async function getWorkspace() {
  return await requireDesktopApi().getWorkspace() as { cwd: string; rootName: string };
}

export function getUpdateState() {
  return requireDesktopApi().getUpdateState();
}

export function checkForUpdates() {
  return requireDesktopApi().checkForUpdates();
}

export function downloadUpdate() {
  return requireDesktopApi().downloadUpdate();
}

export function installUpdate() {
  return requireDesktopApi().installUpdate();
}

export function getWindowPreferences() {
  return requireDesktopApi().getWindowPreferences();
}

export function setWindowPreferences(closeBehavior: 'minimize-to-tray' | 'exit') {
  return requireDesktopApi().setWindowPreferences({ closeBehavior });
}

export function onUpdateStatus(callback: (state: AppUpdateState) => void) {
  return requireDesktopApi().onUpdateStatus(callback);
}

export async function switchProvider(providerId: string) {
  return await requireDesktopApi().switchProvider(providerId);
}

export async function getAgents() {
  return await requireDesktopApi().getAgents() as { agents: AgentItem[]; selectedAgentId?: string | null };
}

export async function saveAgent(agent: { id?: string; name: string; prompt: string; description?: string }) {
  return await requireDesktopApi().saveAgent(agent) as {
    success: boolean;
    agent?: AgentItem;
  };
}

export async function deleteAgent(id: string) {
  return await requireDesktopApi().deleteAgent(id) as {
    success: boolean;
    deleted: boolean;
    selectedAgentId?: string | null;
  };
}

export async function setSelectedAgent(id: string | null) {
  return await requireDesktopApi().setSelectedAgent(id) as {
    success: boolean;
    selectedAgentId: string | null;
  };
}

export async function exportAgents() {
  return await requireDesktopApi().exportAgents() as {
    format: string;
    version: number;
    agents: Record<string, { name: string; prompt: string; description?: string }>;
  };
}

export async function importAgents(payload: {
  agents: Array<{ id?: string; name?: string; prompt?: string; description?: string }> | Record<string, { name?: string; prompt?: string; description?: string }>;
  strategy: 'skip' | 'overwrite' | 'duplicate';
}) {
  return await requireDesktopApi().importAgents(payload) as {
    success: boolean;
    added: number;
    updated: number;
    skipped: number;
    duplicated: number;
    total: number;
  };
}

export async function getMcpServers() {
  return await requireDesktopApi().getMcpServers() as {
    servers: Array<{ id: string; name: string; enabled: boolean; scope: string; config: Record<string, unknown> }>;
    disabled: Array<{ id: string; scope: string; reason: string }>;
    invalid: Array<{ id: string; scope: string; reason: string; config: Record<string, unknown> }>;
    scope: string;
    scopeSummary?: { global: number; project: number };
    error?: string;
  };
}

export async function saveMcpServer(server: { id: string; config: Record<string, unknown>; scope: 'global' | 'project' }) {
  return await requireDesktopApi().saveMcpServer(server);
}

export async function deleteMcpServer(server: { id: string; scope: 'global' | 'project' }) {
  return await requireDesktopApi().deleteMcpServer(server);
}

export async function toggleMcpServer(server: { id: string; scope: 'global' | 'project'; enabled: boolean }) {
  return await requireDesktopApi().toggleMcpServer(server);
}

export async function getMcpStatus() {
  return await requireDesktopApi().getMcpStatus() as Array<{
    id: string;
    scope: 'global' | 'project';
    status: 'connected' | 'failed' | 'pending';
    serverInfo?: Record<string, unknown> | null;
    error?: string | null;
  }>;
}

export async function getMcpTools(server: { id: string; scope?: 'global' | 'project' }) {
  return await requireDesktopApi().getMcpTools(server) as {
    id: string;
    scope: 'global' | 'project';
    serverType: string | null;
    tools: Array<Record<string, unknown>>;
    error?: string | null;
  };
}

export async function getMcpServerForEdit(server: { id: string; scope: 'global' | 'project' }) {
  return await requireDesktopApi().getMcpServerForEdit(server) as {
    id: string;
    name: string;
    scope: 'global' | 'project';
    config: Record<string, unknown>;
  };
}

export async function getSkills() {
  return await requireDesktopApi().getSkills() as {
    global: Record<string, { id: string; skillName?: string; name: string; type: string; scope: 'global'; path: string; enabled: boolean; description?: string; modifiedAt?: string }>;
    local: Record<string, { id: string; skillName?: string; name: string; type: string; scope: 'local'; path: string; enabled: boolean; description?: string; modifiedAt?: string }>;
  };
}

export async function importSkills(scope: 'global' | 'local') {
  return await requireDesktopApi().importSkills(scope);
}

export async function deleteSkill(skill: { name: string; scope: 'global' | 'local'; enabled: boolean }) {
  return await requireDesktopApi().deleteSkill(skill);
}

export async function toggleSkill(skill: { name: string; scope: 'global' | 'local'; enabled: boolean }) {
  return await requireDesktopApi().toggleSkill(skill);
}

export async function openSkill(skillPath: string) {
  return await requireDesktopApi().openSkill({ path: skillPath });
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

export async function getUsageStatistics(args: { scope?: 'current' | 'all'; dateRange?: 'today' | '7d' | '30d' | 'all' } = {}) {
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
