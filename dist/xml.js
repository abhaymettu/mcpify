const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e] ?? m);
export function parseXml(src) {
    const root = { tag: "#root", attrs: {}, children: [] };
    const stack = [root];
    // Comments, CDATA, processing instructions and doctype carry nothing the dictionary model needs.
    const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
    for (const m of src.matchAll(re)) {
        if (m[1]) {
            while (stack.length > 1 && stack.pop().tag !== m[1])
                ;
        }
        else if (m[2]) {
            const attrs = {};
            for (const a of m[3].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
                attrs[a[1]] = decode(a[2] ?? a[3]);
            const node = { tag: m[2], attrs, children: [] };
            stack[stack.length - 1].children.push(node);
            if (!m[4])
                stack.push(node);
        }
    }
    return root;
}
