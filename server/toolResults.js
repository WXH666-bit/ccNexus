/** Converts Claude SDK user tool-result blocks into the desktop chat protocol. */
export function extractToolResults(message) {
  if (!Array.isArray(message?.content)) return [];

  return message.content
    .filter((block) => block?.type === 'tool_result')
    .map((block) => ({
      type: 'tool_result',
      tool_use_id: block.tool_use_id,
      content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
      is_error: Boolean(block.is_error),
    }));
}
