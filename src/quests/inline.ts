/**
 * Splitting objective text into plain runs and wikilinks.
 *
 * Objectives are written by hand in the quest note, so they contain the same
 * `[[links]]` as any other line of the vault. Pure and obsidian-free so the
 * splitting is covered by `npm test`.
 */

export type InlineSegment =
    | { kind: 'text'; text: string }
    | { kind: 'link'; target: string; display: string }

// Non-greedy so `[[a]] and [[b]]` is two links, not one spanning both.
const WIKILINK_RE = /\[\[([^\[\]]+?)\]\]/g

/**
 * `[[Note]]`, `[[Note|Alias]]`, `[[Note#Heading]]` and the combination.
 *
 * An unclosed `[[` stays plain text rather than swallowing the rest of the
 * line — a half-typed link should look half-typed, not eat the objective.
 */
export function parseInline(text: string): InlineSegment[] {
    const segments: InlineSegment[] = []
    let last = 0

    WIKILINK_RE.lastIndex = 0
    let match = WIKILINK_RE.exec(text)
    while (match !== null) {
        if (match.index > last) segments.push({ kind: 'text', text: text.slice(last, match.index) })

        const inner = match[1]
        const pipe = inner.indexOf('|')
        const target = (pipe === -1 ? inner : inner.slice(0, pipe)).trim()
        const alias = pipe === -1 ? null : inner.slice(pipe + 1).trim()

        // Obsidian shows `Note > Heading` when a subpath is linked without an alias.
        const hash = target.indexOf('#')
        let display: string
        if (alias) display = alias
        else if (hash > 0) display = `${target.slice(0, hash)} > ${target.slice(hash + 1)}`
        else if (hash === 0) display = target.slice(1)
        else display = target

        if (target) segments.push({ kind: 'link', target, display })
        else segments.push({ kind: 'text', text: match[0] })

        last = match.index + match[0].length
        match = WIKILINK_RE.exec(text)
    }

    if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) })
    return segments
}
