// Ported from the installed VSCode theme CLEm_Monokai_001 (a Monokai variant with a
// teal editor background). Source: CLEm_Monokai_001-color-theme.json + its tmTheme.
// Consumed by Shiki (shikiToMonaco) so the in-app editor colours match the editor.
// Deviations from the tmTheme, both harmless: the `variable.` scope is written as
// `variable` (trailing dot matches nothing), and the color-only `support.other.variable`
// rule (empty fontStyle, no foreground) is dropped.

// Shiki accepts this shape directly (ThemeRegistrationRaw); kept dependency-free here.
export const clemMonokai001Theme = {
  name: 'clem-monokai-001',
  type: 'dark',
  colors: {
    'editor.background': '#1a2a30',
    'editor.foreground': '#F8F8F2',
    'editorCursor.foreground': '#F8F8F0',
    'editorWhitespace.foreground': '#3B3A32',
    'editor.lineHighlightBackground': '#2a3a40',
    'editor.selectionBackground': '#222222',
  },
  tokenColors: [
    { scope: 'comment', settings: { foreground: '#aaaaaa' } },
    { scope: 'comment.line', settings: { foreground: '#666666' } },
    { scope: 'comment.block', settings: { foreground: '#889999' } },
    { scope: 'comment.block.documentation', settings: { foreground: '#5a6a70' } },
    { scope: 'string', settings: { foreground: '#ffffbb' } },
    { scope: 'string.quoted.double', settings: { foreground: '#eeee00' } },
    { scope: 'string.quoted.double.json', settings: { foreground: '#00ffff' } },
    { scope: 'string.quoted.single', settings: { foreground: '#00ee55' } },
    { scope: 'string.template.ts', settings: { foreground: '#ffffaa' } },
    { scope: 'string.template.ts.html.tag', settings: { foreground: '#ffff00' } },
    { scope: 'string.template.ts.html.tag.attr', settings: { foreground: '#ffbb22' } },
    { scope: 'meta.template.expression.ts', settings: { foreground: '#ff6600' } },
    { scope: 'constant.numeric', settings: { foreground: '#00ffff' } },
    { scope: 'constant.language', settings: { foreground: '#00ffff' } },
    { scope: ['constant.character', 'constant.other'], settings: { foreground: '#88ffff' } },
    { scope: ['meta.object-literal', 'meta.object-literal.key'], settings: { foreground: '#ffff44' } },
    { scope: 'variable', settings: { foreground: '#ffffff' } },
    { scope: 'keyword', settings: { foreground: '#00ccff' } },
    { scope: 'storage', settings: { foreground: '#00ffdd' } },
    { scope: 'storage.type', settings: { foreground: '#00ffdd' } },
    { scope: 'entity.name.class', settings: { foreground: '#44ffaa' } },
    { scope: 'entity.other.inherited-class', settings: { foreground: '#ffffff' } },
    { scope: 'variable.parameter', settings: { foreground: '#aaffcc' } },
    { scope: 'entity.name.tag', settings: { foreground: '#00ffff' } },
    { scope: 'entity.other.attribute-name', settings: { foreground: '#00ccdd' } },
    { scope: ['support.function', 'entity.name.function'], settings: { foreground: '#99ffff' } },
    { scope: 'support.constant', settings: { foreground: '#66D9EF' } },
    { scope: ['support.type', 'support.class'], settings: { foreground: '#00ffdd' } },
    { scope: 'invalid', settings: { foreground: '#ff4444', background: '#ffff00', fontStyle: 'bold' } },
    { scope: 'invalid.deprecated', settings: { foreground: '#000000', background: '#ffffff' } },
    { scope: 'meta.structure.dictionary.value.json string.quoted.double.json', settings: { foreground: '#ffffff' } },
    { scope: 'meta.structure.dictionary.json', settings: { foreground: '#00ddff' } },
    { scope: ['meta.diff', 'meta.diff.header'], settings: { foreground: '#75715E' } },
    { scope: 'markup.deleted', settings: { foreground: '#F92672' } },
    { scope: 'markup.inserted', settings: { foreground: '#A6E22E' } },
    { scope: 'markup.changed', settings: { foreground: '#E6DB74' } },
    { scope: 'constant.numeric.line-number.find-in-files - match', settings: { foreground: '#AE81FFA0' } },
    { scope: 'entity.name.filename', settings: { foreground: '#E6DB74' } },
    { scope: 'message.error', settings: { foreground: '#F83333' } },
    { scope: ['punctuation.definition.block', 'punctuation.separator.comma'], settings: { foreground: '#ffff88' } },
  ],
}
