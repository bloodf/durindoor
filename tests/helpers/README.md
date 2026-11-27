The image upscale staging guard searches all tracked production paths. The private
SYNTX media unit records upscale ownership in two full-line comments and in the
`modalities.upscale` status and owner fields of its registration metadata. These
inert notes caused the original literal search to fail despite no registration.
Only those comment lines and exact JSON fields are recognized; runtime references,
additional ownership fields and matches anywhere else remain forbidden.

A line that starts with `//` is not necessarily a comment. The guard once exempted
any such line, including one inside a template literal whose value was later
sliced into an import path. It now exempts a match in the two private JavaScript
files only within the leading comment header: every line from the start of the
file through the match must be blank or a `//` comment. Lines are split on every
JavaScript line terminator, including U+2028 and U+2029.

Limitation: the guard does not lex JavaScript. A genuine comment placed after any
other line, including a block comment, is ambiguous and therefore forbidden. Keep
ownership notes in the header. The guard matches only the literal unit name, so it
does not detect a path assembled from fragments or from other text.
