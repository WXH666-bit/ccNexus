import { marked } from 'marked';
import hljs from 'highlight.js';

// Configure marked
marked.setOptions({
  gfm: true,
  breaks: false,
});

// Add highlight.js support
const renderer = new marked.Renderer();
renderer.code = function ({ text, lang }: { text: string; lang?: string }) {
  const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
  const highlighted = hljs.highlight(text, { language }).value;
  return `<pre><code class="hljs language-${language}">${highlighted}</code></pre>`;
};

marked.use({ renderer });

export function renderMarkdown(text: string): string {
  try {
    const html = marked.parse(text) as string;
    // Convert file references to clickable links
    return html.replace(/`([^`\n]+\.\w{1,4})`/g, '<code class="file-link" data-file="$1">$1</code>');
  } catch {
    return text;
  }
}
