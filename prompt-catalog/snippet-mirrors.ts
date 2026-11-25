// Reserved frontmatter line written only on catalog-owned snippet mirrors.
export const SNIPPET_MIRROR_MARKER = 'prompt-catalog-generated: "snippet-mirror-v1"';

export function isSnippetMirror(markdown: string): boolean {
	const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
	return frontmatter?.[1].split(/\r?\n/).includes(SNIPPET_MIRROR_MARKER) ?? false;
}
