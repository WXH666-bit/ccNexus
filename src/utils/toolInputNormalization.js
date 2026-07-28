import { normalizeToolName } from './toolRendering.js';

function getFirstEdit(input) {
  const edits = input?.edits;
  if (!Array.isArray(edits) || edits.length === 0) return undefined;
  const first = edits[0];
  return first && typeof first === 'object' ? first : undefined;
}

function pickString(...values) {
  return values.find((value) => typeof value === 'string');
}

export function normalizeToolInput(name, input) {
  if (!input) return input;

  const normalizedName = normalizeToolName(name ?? '');
  const firstEdit = getFirstEdit(input);

  if (normalizedName === 'edit' ||
      normalizedName === 'multiedit' ||
      normalizedName === 'edit_file' ||
      normalizedName === 'replace_string') {
    return {
      ...input,
      file_path: pickString(input.file_path, input.filePath, input.path, input.target_file, input.targetFile),
      old_string: pickString(input.old_string, input.oldString, firstEdit?.old_string, firstEdit?.oldString, firstEdit?.oldText),
      new_string: pickString(input.new_string, input.newString, firstEdit?.new_string, firstEdit?.newString, firstEdit?.newText),
    };
  }

  if (normalizedName === 'write' ||
      normalizedName === 'write_file' ||
      normalizedName === 'write_to_file' ||
      normalizedName === 'create_file') {
    return {
      ...input,
      file_path: pickString(input.file_path, input.filePath, input.path, input.target_file, input.targetFile),
      new_string: pickString(input.new_string, input.newString, input.content),
    };
  }

  return input;
}
